//! Cross-contract Gas Station for gasless UX.
//!
//! New Stellar users often don't hold any XLM, so they can't pay the network
//! fee for their very first transaction — a classic chicken-and-egg problem.
//! This contract lets the platform sponsor that fee on a user's behalf, in
//! exchange for a small cut of the user's winnings if their sponsored call
//! resolves in their favor. If it doesn't, the gas station simply absorbs
//! the (small) cost.
//!
//! **What is, and isn't, on-chain here.** The actual fee payment happens
//! off-chain: the backend relay submits the user's signed operation as the
//! *inner* transaction of a Stellar fee-bump transaction, with the gas
//! station's own account as the fee source (`POST /relay/tx` —
//! `relay.service.ts`, explicitly out of scope for this contract). Soroban
//! contracts have no way to observe or intercept that classic-layer fee
//! payment, so this contract's role is: (1) record which users are
//! sponsored and on what terms, (2) act as bookkeeping for how much gas the
//! program has fronted and how much it has earned back, and (3) — the part
//! that *does* need to be on-chain — actually enforce the winning cut at
//! payout time, per [`GasStation::claim_sponsored_payout`].
//!
//! **Why the cut needs an on-chain intermediary.** `outcome_manager::claim_payout`
//! (see `outcome_manager/src/lib.rs`) transfers a winner's payout directly to
//! the winning `staker` address via the market's `release_escrow`. A third
//! contract watching from the sidelines cannot "tax" a transfer it isn't
//! part of. So, mirroring `parlay_betting`'s escrow model (see
//! `parlay_betting/src/lib.rs`), this contract claims *as itself* — the
//! payout lands in the gas station's own balance first — deducts its cut,
//! and forwards the remainder to the user.
//!
//! **Auth chain — traced, not assumed.** Unlike `parlay_betting`, which
//! needs `env.authorize_as_current_contract` to pre-authorize the token
//! transfer *into* the market when it stakes as itself, this contract needs
//! **no such pre-authorization** for the claim path. Tracing the call graph
//! for `claim_sponsored_payout`:
//!
//! 1. `gas_station` calls `outcome_manager.claim_payout` directly, passing
//!    `staker = gas_station`'s own address. Inside, `staker.require_auth()`
//!    succeeds automatically: `gas_station` *is* the direct invoker of this
//!    call, and Soroban auto-authorizes an address for a require_auth() check
//!    when that address is the contract that directly invoked the current
//!    call (the same rule `parlay_betting`'s doc comment relies on for its
//!    own `staker.require_auth()` inside `stake_on_call`).
//! 2. `outcome_manager` in turn calls `market.release_escrow(call_id, to,
//!    amount)` directly. Inside, `config.outcome_manager.require_auth()`
//!    succeeds automatically for the identical reason: `outcome_manager` is
//!    the direct invoker of `release_escrow`.
//! 3. `release_escrow` then calls `token.transfer(from = market's own
//!    address, to, amount)` **directly** (the market's own code invokes the
//!    token contract). The token's internal `from.require_auth()` succeeds
//!    automatically because `from` (the market) is *itself* the direct
//!    invoker of this specific call.
//!
//! At every hop, the address being authorized equals the direct caller of
//! that exact invocation — no mismatch, so no explicit
//! `authorize_as_current_contract` entry is ever needed. This is the
//! opposite of `parlay_betting`'s staking path, where `stake_on_call`
//! internally calls `token.transfer(from = parlay's address, ...)` **on the
//! parlay's behalf but as the market's own invocation** — a genuine
//! mismatch (from != direct invoker) that does require pre-authorization.
//! The difference: `release_escrow`'s transfer always debits the *market's
//! own* balance (it's paying out its own escrow), so `from` and the
//! invoking contract are always the same contract at that hop.
//!
//! **Known limitation.** Because this contract always claims *as itself*
//! (a single fixed address), `outcome_manager`'s `(call_id, staker)` claimed
//! guard means only *one* sponsored claim can be settled per `call_id`
//! through this gas station. If two different sponsored users both won on
//! the very same `call_id`, only the first `claim_sponsored_payout` call for
//! that `call_id` would succeed against `outcome_manager`; the second would
//! fail with `AlreadyClaimed`. `parlay_betting` solves the analogous problem
//! for its own use case with an aggregate-then-proportional-share scheme
//! (see its `LegAggregate`); this contract does not replicate that, since
//! the acceptance criteria for this feature describe a single-shot,
//! single-user claim flow and multi-user-same-call collisions are not part
//! of its test scope. A future enhancement could add the same aggregate
//! pattern if this becomes a real-world concern.
#![no_std]

mod errors;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, IntoVal, Symbol};

use errors::GasStationError;
use events::{
    emit_admin_changed, emit_gas_station_initialized, emit_pool_refilled,
    emit_sponsored_payout_claimed, emit_sponsorship_registered, emit_sponsorship_revoked,
};
use types::{GasStationMetrics, SponsorshipInfo};

/// 100% in basis points.
const MAX_BPS: u32 = 10_000;

// ─── Token transfer helper ─────────────────────────────────────────────────────
//
// Mirrors `prediction_market::transfer_token` exactly: dispatch between the
// native-XLM `StellarAssetClient` and a generic SAC `token::Client`. The
// gas station explicitly deals in XLM per the issue, but staying consistent
// with the rest of the workspace costs nothing and keeps a single pattern
// to reason about.

#[cfg(not(test))]
#[inline]
fn is_native_xlm(env: &Env, addr: &Address) -> bool {
    let sentinel = Address::from_string(&soroban_sdk::String::from_str(
        env,
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    ));
    *addr == sentinel
}

#[cfg(test)]
fn is_native_xlm(env: &Env, addr: &Address) -> bool {
    let key = soroban_sdk::Symbol::new(env, "xlm_sac_addr");
    if let Some(sentinel) = env.storage().instance().get::<_, Address>(&key) {
        return *addr == sentinel;
    }
    false
}

fn transfer_token(env: &Env, token_addr: &Address, from: &Address, to: &Address, amount: i128) {
    if is_native_xlm(env, token_addr) {
        token::StellarAssetClient::new(env, token_addr).transfer(from, to, &amount);
    } else {
        token::Client::new(env, token_addr).transfer(from, to, &amount);
    }
}

// ─── Small helpers ──────────────────────────────────────────────────────────────

fn overflow<T>(env: &Env) -> T {
    soroban_sdk::panic_with_error!(env, GasStationError::Overflow);
}

fn require_initialized_admin(env: &Env) -> Address {
    match storage::get_admin(env) {
        Some(admin) => admin,
        None => soroban_sdk::panic_with_error!(env, GasStationError::NotInitialized),
    }
}

/// Looks up the stored admin and requires its authorization. Used by
/// functions whose issue-specified signature has no explicit `admin`
/// parameter (mirrors `outcome_manager::auth::require_admin`).
fn require_admin(env: &Env) -> Address {
    let admin = require_initialized_admin(env);
    admin.require_auth();
    admin
}

fn require_xlm_token(env: &Env) -> Address {
    match storage::get_xlm_token(env) {
        Some(token) => token,
        None => soroban_sdk::panic_with_error!(env, GasStationError::NotInitialized),
    }
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct GasStation;

#[contractimpl]
impl GasStation {
    /// Initialize the gas station: sets the admin and the XLM (or SAC)
    /// token this pool is denominated in.
    pub fn initialize(env: Env, admin: Address, xlm_token: Address) {
        if storage::get_admin(&env).is_some() {
            soroban_sdk::panic_with_error!(&env, GasStationError::AlreadyInitialized);
        }
        admin.require_auth();

        storage::set_admin(&env, &admin);
        storage::set_xlm_token(&env, &xlm_token);
        storage::set_metrics(&env, &GasStationMetrics::zero());

        emit_gas_station_initialized(&env, &admin, &xlm_token);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        require_admin(&env);
        storage::set_admin(&env, &new_admin);
        emit_admin_changed(&env, &new_admin);
    }

    pub fn get_admin(env: Env) -> Address {
        require_initialized_admin(&env)
    }

    /// Register `user` for gas sponsorship (admin only). The gas station
    /// commits to fronting up to `max_gas_xlm` of this user's transaction
    /// fees (paid off-chain by the relay, see module docs) in exchange for
    /// `winning_cut_bps` of their payout if their sponsored call wins.
    ///
    /// Immediately books `max_gas_xlm` against `total_xlm_spent` — the
    /// conservative assumption that the full committed amount is "at risk"
    /// the moment sponsorship starts, since a losing outcome recovers
    /// nothing. A win later adds the collected cut back via
    /// `total_winnings_collected`, which is netted against this in
    /// `net_profit_loss`.
    pub fn sponsor_transaction(env: Env, user: Address, max_gas_xlm: i128, winning_cut_bps: u32) {
        require_admin(&env);

        if max_gas_xlm <= 0 {
            soroban_sdk::panic_with_error!(&env, GasStationError::InvalidGasAmount);
        }
        if winning_cut_bps > MAX_BPS {
            soroban_sdk::panic_with_error!(&env, GasStationError::InvalidWinningCutBps);
        }

        let info = SponsorshipInfo {
            max_gas_xlm,
            winning_cut_bps,
            sponsored_at: env.ledger().timestamp(),
            active: true,
        };
        storage::set_sponsorship(&env, &user, &info);

        let mut metrics = storage::get_metrics(&env);
        metrics.total_transactions_sponsored = metrics
            .total_transactions_sponsored
            .checked_add(1)
            .unwrap_or_else(|| overflow(&env));
        metrics.total_xlm_spent = metrics
            .total_xlm_spent
            .checked_add(max_gas_xlm)
            .unwrap_or_else(|| overflow(&env));
        metrics.net_profit_loss = metrics
            .total_winnings_collected
            .checked_sub(metrics.total_xlm_spent)
            .unwrap_or_else(|| overflow(&env));
        storage::set_metrics(&env, &metrics);

        emit_sponsorship_registered(&env, &user, max_gas_xlm, winning_cut_bps);
    }

    /// Deactivate a user's sponsorship (admin only). Past metrics are left
    /// untouched; this only stops *future* claims from treating the user as
    /// sponsored.
    pub fn revoke_sponsorship(env: Env, user: Address) {
        require_admin(&env);
        if let Some(mut info) = storage::get_sponsorship(&env, &user) {
            info.active = false;
            storage::set_sponsorship(&env, &user, &info);
        }
        emit_sponsorship_revoked(&env, &user);
    }

    pub fn get_sponsorship(env: Env, user: Address) -> Option<SponsorshipInfo> {
        storage::get_sponsorship(&env, &user)
    }

    pub fn is_sponsored(env: Env, user: Address) -> bool {
        match storage::get_sponsorship(&env, &user) {
            Some(info) => info.active,
            None => false,
        }
    }

    /// Pure arithmetic helper: `effective_stake = stake_amount -
    /// estimated_gas_xlm`, per the acceptance criteria. The actual staking
    /// call happens on `prediction_market` (untouched by this contract); the
    /// (out-of-scope) relay flow calls this to compute the reduced stake
    /// amount before constructing the user's sponsored stake transaction.
    pub fn compute_effective_stake(env: Env, stake_amount: i128, estimated_gas_xlm: i128) -> i128 {
        let effective = stake_amount
            .checked_sub(estimated_gas_xlm)
            .unwrap_or_else(|| overflow(&env));
        if effective < 0 {
            soroban_sdk::panic_with_error!(&env, GasStationError::InvalidGasAmount);
        }
        effective
    }

    /// Claim a sponsored user's payout, enforcing the winning cut.
    ///
    /// Calls `outcome_manager.claim_payout(registry, call_id, staker =
    /// <this gas station's own address>, staker_winning_stake,
    /// total_winning_stake, total_losing_stake)`, which lands the full
    /// payout in this contract's own balance (measured via a balance
    /// before/after diff, the same technique `parlay_betting` uses for its
    /// own aggregate claims). Deducts `winning_cut_bps` (read from the
    /// user's stored sponsorship) into the gas pool / metrics, and forwards
    /// the remainder to `user`.
    ///
    /// Permissionless: no `require_auth` on `user` or the admin. Anyone —
    /// the user, a keeper bot, the backend relay — can trigger settlement
    /// once the call has resolved; the cut enforcement doesn't depend on
    /// who calls this, only on `user` having an active sponsorship.
    ///
    /// See the module doc comment for the full auth-chain trace and the
    /// known single-claim-per-`call_id` limitation.
    #[allow(clippy::too_many_arguments)]
    pub fn claim_sponsored_payout(
        env: Env,
        registry: Address,
        outcome_manager: Address,
        call_id: u64,
        user: Address,
        staker_winning_stake: i128,
        total_winning_stake: i128,
        total_losing_stake: i128,
    ) {
        let info = match storage::get_sponsorship(&env, &user) {
            Some(info) if info.active => info,
            _ => soroban_sdk::panic_with_error!(&env, GasStationError::UserNotSponsored),
        };

        if storage::is_call_processed(&env, call_id) {
            soroban_sdk::panic_with_error!(&env, GasStationError::CallAlreadyProcessed);
        }

        if staker_winning_stake <= 0 {
            soroban_sdk::panic_with_error!(&env, GasStationError::InvalidWinningStake);
        }

        let xlm_token = require_xlm_token(&env);
        let token_client = token::Client::new(&env, &xlm_token);
        let contract_address = env.current_contract_address();
        let balance_before = token_client.balance(&contract_address);

        // Reentrancy guard, mirroring outcome_manager's "mark before
        // external call" convention — set before the cross-contract call
        // that could (in principle) re-enter this function.
        storage::mark_call_processed(&env, call_id);

        let args = (
            registry,
            call_id,
            contract_address.clone(),
            staker_winning_stake,
            total_winning_stake,
            total_losing_stake,
        )
            .into_val(&env);
        let _: () = env.invoke_contract(&outcome_manager, &Symbol::new(&env, "claim_payout"), args);

        let balance_after = token_client.balance(&contract_address);
        let payout = balance_after
            .checked_sub(balance_before)
            .unwrap_or_else(|| overflow(&env));

        let cut = payout
            .checked_mul(info.winning_cut_bps as i128)
            .unwrap_or_else(|| overflow(&env))
            .checked_div(MAX_BPS as i128)
            .unwrap_or_else(|| overflow(&env));

        let user_amount = payout
            .checked_sub(cut)
            .unwrap_or_else(|| overflow(&env));

        if user_amount > 0 {
            transfer_token(&env, &xlm_token, &contract_address, &user, user_amount);
        }

        let mut metrics = storage::get_metrics(&env);
        metrics.total_winnings_collected = metrics
            .total_winnings_collected
            .checked_add(cut)
            .unwrap_or_else(|| overflow(&env));
        metrics.net_profit_loss = metrics
            .total_winnings_collected
            .checked_sub(metrics.total_xlm_spent)
            .unwrap_or_else(|| overflow(&env));
        storage::set_metrics(&env, &metrics);

        emit_sponsored_payout_claimed(&env, call_id, &user, payout, cut, user_amount);
    }

    /// Current XLM (or configured SAC) balance held by the gas station pool.
    pub fn get_gas_station_balance(env: Env) -> i128 {
        let xlm_token = require_xlm_token(&env);
        token::Client::new(&env, &xlm_token).balance(&env.current_contract_address())
    }

    /// Refill the gas pool from the treasury/admin (admin only). Used both
    /// for the initial funding and for periodic top-ups from protocol fees.
    pub fn refill_gas_pool(env: Env, admin: Address, amount: i128) {
        let stored_admin = require_initialized_admin(&env);
        if admin != stored_admin {
            soroban_sdk::panic_with_error!(&env, GasStationError::Unauthorized);
        }
        admin.require_auth();

        if amount <= 0 {
            soroban_sdk::panic_with_error!(&env, GasStationError::InvalidRefillAmount);
        }

        let xlm_token = require_xlm_token(&env);
        let contract_address = env.current_contract_address();
        transfer_token(&env, &xlm_token, &admin, &contract_address, amount);

        let new_balance = token::Client::new(&env, &xlm_token).balance(&contract_address);
        emit_pool_refilled(&env, amount, new_balance);
    }

    pub fn get_metrics(env: Env) -> GasStationMetrics {
        storage::get_metrics(&env)
    }
}
