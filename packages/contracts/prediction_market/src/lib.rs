//! Lightweight single-market prediction contract.
//!
//! Each instance holds exactly one market's call data, stake tracking, and
//! resolution logic. Deployed exclusively via [`prediction_market_factory`].
#![no_std]
#![allow(clippy::too_many_arguments)]

mod errors;
mod events;
mod storage;
mod types;

pub use types::{Call, ConditionType, LimitOrder, MarketConfig, MarketInitArgs};

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Map, Vec};
use storage::*;

use errors::MarketError;
use events::{
    emit_call_created, emit_call_resolved, emit_limit_order_cancelled, emit_limit_order_created,
    emit_limit_order_expired_refunded, emit_limit_order_filled, emit_market_initialized,
    emit_reserve_discrepancy, emit_reserve_verification, emit_stake_added,
};
use types::ReserveVerification;

/// #465: Maximum TTL a user may set on a limit order (7 days).
pub const MAX_ORDER_TTL_SECS: u64 = 7 * 24 * 3600;

/// #465: Default bps cut of an expired order's escrow paid to whoever calls
/// `refund_expired_order`, set at market construction time (0.5%).
pub const DEFAULT_EXPIRED_ORDER_REFUND_BPS: u32 = 50;

/// #465: Upper bound on how many open limit orders are examined per
/// `stake_on_call` invocation, to keep the matching loop's budget bounded.
/// Orders beyond this cap simply remain open for a future stake to pick up
/// (see the "partial fill" note on `PredictionMarket::stake_on_call`).
const MAX_ORDERS_MATCHED_PER_STAKE: u32 = 20;

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

fn transfer_token(env: &Env, stake_token: &Address, from: &Address, to: &Address, amount: i128) {
    if is_native_xlm(env, stake_token) {
        token::StellarAssetClient::new(env, stake_token).transfer(from, to, &amount);
    } else {
        token::Client::new(env, stake_token).transfer(from, to, &amount);
    }
}

fn require_call_id(config: &MarketConfig, call_id: u64) -> Result<(), MarketError> {
    if config.call_id != call_id {
        return Err(MarketError::InvalidCallId);
    }
    Ok(())
}

macro_rules! reentrancy_guard {
    ($env:expr) => {
        if storage::is_locked($env) {
            return Err(MarketError::Unauthorized);
        }
        storage::acquire_lock($env);
    };
}

/// #465: Acquire the reentrancy lock, run `f`, and *always* release the lock
/// afterwards — regardless of whether `f` returned `Ok` or `Err`.
///
/// Note: the pre-existing `reentrancy_guard!` macro (still used by
/// `resolve_call`, unchanged here) only releases the lock on the successful
/// exit path; any early `return Err(..)` after acquiring the lock leaves it
/// permanently held, bricking every future guarded call. `stake_on_call` is
/// refactored to use this helper instead because this change adds several
/// new fallible operations (checked-arithmetic overflow, limit-order
/// bookkeeping) into its guarded section, and a single failed stake must not
/// be able to permanently lock the market.
fn with_lock<T>(env: &Env, f: impl FnOnce() -> Result<T, MarketError>) -> Result<T, MarketError> {
    if storage::is_locked(env) {
        return Err(MarketError::Unauthorized);
    }
    storage::acquire_lock(env);
    let result = f();
    storage::release_lock(env);
    result
}

/// #465: Shared checked-arithmetic helper: adds `amount` to `current` and,
/// if `config.max_stake_per_user` is set, rejects the result if it would
/// exceed the cap. Returns the updated total on success.
fn check_max_stake(config: &MarketConfig, current: i128, amount: i128) -> Result<i128, MarketError> {
    let updated = current.checked_add(amount).ok_or(MarketError::Overflow)?;
    if config.max_stake_per_user > 0 && updated > config.max_stake_per_user {
        return Err(MarketError::InvalidStakeAmount);
    }
    Ok(updated)
}

/// #465: Shared stake-bookkeeping helper used by both the public
/// `stake_on_call` entry point and the internal limit-order matching loop.
///
/// This mutates `call.outcome_stakes` / `call.stakes` and the per-user stake
/// storage in place. It performs **no token transfer** — callers are
/// responsible for that, since the two call sites move tokens differently:
/// `stake_on_call` transfers fresh tokens in from the staker, while the
/// matching loop moves tokens that are already sitting in contract escrow
/// (deposited back when the limit order was created). Keeping this
/// bookkeeping in one shared, non-public helper (rather than having the
/// matching loop call back into the public `stake_on_call` entry point) is
/// what prevents the matching loop from recursively re-triggering itself.
fn apply_stake(
    env: &Env,
    config: &MarketConfig,
    call: &mut Call,
    staker: &Address,
    amount: i128,
    position: u32,
) -> Result<(), MarketError> {
    let mut outcome_stakers = call.stakes.get(position).unwrap_or_else(|| Map::new(env));
    let current_staker_stake = outcome_stakers.get(staker.clone()).unwrap_or(0);
    let updated_staker_stake = check_max_stake(config, current_staker_stake, amount)?;

    let current_total = call.outcome_stakes.get(position).unwrap_or(0);
    let updated_total = current_total.checked_add(amount).ok_or(MarketError::Overflow)?;

    call.outcome_stakes.set(position, updated_total);
    outcome_stakers.set(staker.clone(), updated_staker_stake);
    call.stakes.set(position, outcome_stakers);

    set_user_stake(env, staker, position, updated_staker_stake);

    let current_timestamp = env.ledger().timestamp();
    let existing_ts = get_user_stake_timestamp(env, staker, position);
    if existing_ts == 0 {
        set_user_stake_timestamp(env, staker, position, current_timestamp);
        let bonus_window = config.early_staker_bonus_window_secs;
        if current_timestamp < call.created_at + bonus_window {
            let count = get_early_staker_count(env);
            set_early_staker_count(env, count + 1);
        }
    }

    Ok(())
}

/// #465: Sum of `call.outcome_stakes` across every outcome position, using
/// checked addition throughout. Returns `None` on overflow (astronomically
/// unlikely given i128's range, but handled rather than assumed away).
fn total_call_stake(call: &Call) -> Option<i128> {
    let mut total: i128 = 0;
    for i in 1..=call.outcome_count {
        let v = call.outcome_stakes.get(i).unwrap_or(0);
        total = total.checked_add(v)?;
    }
    Some(total)
}

fn remove_id_from_call_orders(env: &Env, call_id: u64, order_id: u64) {
    let ids = get_open_order_ids_for_call(env, call_id);
    let mut new_ids = Vec::new(env);
    for id in ids.iter() {
        if id != order_id {
            new_ids.push_back(id);
        }
    }
    set_open_order_ids_for_call(env, call_id, &new_ids);
}

fn remove_id_from_user_orders(env: &Env, user: &Address, order_id: u64) {
    let ids = get_user_order_ids(env, user);
    let mut new_ids = Vec::new(env);
    for id in ids.iter() {
        if id != order_id {
            new_ids.push_back(id);
        }
    }
    set_user_order_ids(env, user, &new_ids);
}

/// #465: Best-effort matching pass over open limit orders for `call_id`,
/// run from inside `stake_on_call` right after the triggering stake has
/// been applied to `call`.
///
/// For each open order (oldest first, capped at
/// `MAX_ORDERS_MATCHED_PER_STAKE`): if it isn't expired and the position's
/// current implied probability (recomputed after every fill, since each
/// fill changes the pool ratios) is at or below the order's
/// `target_probability_bps`, the order is filled — its escrowed tokens are
/// applied to the pool via `apply_stake` — and removed from storage.
/// Anything not reached because of the cap, not yet at its target price, or
/// expired (expired orders are left for `refund_expired_order`) simply stays
/// open for a future `stake_on_call` to reconsider. See the "partial fill"
/// doc comment on `stake_on_call` for why this is the chosen interpretation.
///
/// This function deliberately never returns an error: a bookkeeping problem
/// with one unrelated limit order (e.g. filling it would push its owner
/// over `max_stake_per_user`) must never roll back the stake that the
/// caller of `stake_on_call` just successfully made. Any such order is
/// simply skipped and left open.
fn match_limit_orders(env: &Env, config: &MarketConfig, call: &mut Call, call_id: u64) {
    let open_ids = get_open_order_ids_for_call(env, call_id);
    let len = open_ids.len();
    if len == 0 {
        return;
    }

    let now = env.ledger().timestamp();
    let cap = core::cmp::min(MAX_ORDERS_MATCHED_PER_STAKE, len);

    let mut remaining_ids: Vec<u64> = Vec::new(env);
    let mut changed = false;

    for i in 0..len {
        let order_id = match open_ids.get(i) {
            Some(id) => id,
            None => continue,
        };

        if i >= cap {
            // Past the per-call iteration budget: leave untouched for a
            // future stake to reconsider.
            remaining_ids.push_back(order_id);
            continue;
        }

        let order = match get_limit_order(env, order_id) {
            Some(o) => o,
            None => {
                // Stale index entry (shouldn't normally happen); drop it.
                changed = true;
                continue;
            }
        };

        if order.call_id != call_id || order.expires_at <= now {
            // Expired (or, defensively, a mismatched call id): leave open —
            // expired orders are only ever cleaned up via
            // `refund_expired_order`, never silently dropped here.
            remaining_ids.push_back(order_id);
            continue;
        }

        let total_stake = match total_call_stake(call) {
            Some(t) if t > 0 => t,
            _ => {
                remaining_ids.push_back(order_id);
                continue;
            }
        };

        let position_stake = call.outcome_stakes.get(order.outcome).unwrap_or(0);
        let implied_bps = match position_stake
            .checked_mul(10_000)
            .and_then(|v| v.checked_div(total_stake))
        {
            Some(v) => v,
            None => {
                remaining_ids.push_back(order_id);
                continue;
            }
        };

        if implied_bps > order.target_probability_bps as i128 {
            remaining_ids.push_back(order_id);
            continue;
        }

        match apply_stake(env, config, call, &order.user, order.amount, order.outcome) {
            Ok(()) => {
                remove_limit_order(env, order.id);
                changed = true;
                emit_limit_order_filled(
                    env,
                    order.id,
                    call_id,
                    &order.user,
                    order.outcome,
                    order.amount,
                    implied_bps as u32,
                );
                remove_id_from_user_orders(env, &order.user, order.id);
            }
            Err(_) => {
                // e.g. filling would exceed max_stake_per_user: leave open.
                remaining_ids.push_back(order_id);
            }
        }
    }

    if changed {
        set_open_order_ids_for_call(env, call_id, &remaining_ids);
    }
}

#[contract]
pub struct PredictionMarket;

#[contractimpl]
impl PredictionMarket {
    /// Constructor invoked by the factory via `deploy_v2`.
    pub fn __constructor(
        env: Env,
        call_id: u64,
        creator: Address,
        outcome_manager: Address,
        factory: Address,
        min_stake: i128,
        max_stake_per_user: i128,
        staking_cutoff_secs: u64,
        args: MarketInitArgs,
    ) {
        if get_config(&env).is_some() {
            soroban_sdk::panic_with_error!(&env, MarketError::AlreadyInitialized);
        }

        let MarketInitArgs {
            stake_token,
            stake_amount,
            start_price,
            end_ts,
            token_address,
            pair_id,
            metadata_hash,
            condition,
            outcome_count,
        } = args;

        if stake_amount < min_stake || stake_amount <= 0 {
            soroban_sdk::panic_with_error!(&env, MarketError::InvalidStakeAmount);
        }
        if start_price <= 0 {
            soroban_sdk::panic_with_error!(&env, MarketError::InvalidStakeAmount);
        }
        if outcome_count < 2 {
            soroban_sdk::panic_with_error!(&env, MarketError::InvalidOutcomeCount);
        }

        let current_timestamp = env.ledger().timestamp();
        if end_ts <= current_timestamp {
            soroban_sdk::panic_with_error!(&env, MarketError::InvalidEndTime);
        }

        let config = MarketConfig {
            call_id,
            creator: creator.clone(),
            outcome_manager: outcome_manager.clone(),
            factory: factory.clone(),
            min_stake,
            max_stake_per_user,
            staking_cutoff_secs,
            paused: false,
            early_staker_bonus_window_secs: 3600,
            early_staker_bonus_bps: 200,
            expired_order_refund_bps: DEFAULT_EXPIRED_ORDER_REFUND_BPS,
        };
        set_config(&env, &config);

        let mut outcome_stakes = Map::new(&env);
        let mut stakes = Map::new(&env);
        for i in 1..=outcome_count {
            outcome_stakes.set(i, 0);
            stakes.set(i, Map::new(&env));
        }

        let call = Call {
            id: call_id,
            creator: creator.clone(),
            stake_token: stake_token.clone(),
            stake_amount,
            end_ts,
            token_address: token_address.clone(),
            pair_id: pair_id.clone(),
            metadata_hash: metadata_hash.clone(),
            outcome_count,
            outcome_stakes,
            stakes,
            outcome: 0,
            start_price,
            end_price: 0,
            condition,
            settled: false,
            voided: false,
            created_at: current_timestamp,
            cancelled: false,
            metadata_version: 0,
            share_tokens: Map::new(&env),
        };

        set_call(&env, &call);
        emit_market_initialized(&env, call_id, &creator, &stake_token, end_ts);
        emit_call_created(
            &env,
            call_id,
            &creator,
            &stake_token,
            stake_amount,
            start_price,
            end_ts,
            &token_address,
            &pair_id,
            &metadata_hash,
            outcome_count,
        );
    }

    /// Stake tokens on an outcome position.
    ///
    /// #465: After the triggering stake is applied, this runs a best-effort
    /// matching pass (`match_limit_orders`) over open limit orders for this
    /// call — see that function's doc comment for the exact semantics,
    /// including how "partial fill" is interpreted here: because this
    /// contract's pari-mutuel pool has no order-book-style partial-fill
    /// mechanism for a single order, an order either fills in full (at the
    /// amount it was created with) or stays fully open. "Partial fill" thus
    /// refers to *batches* of eligible orders: if more than
    /// `MAX_ORDERS_MATCHED_PER_STAKE` orders are eligible in one
    /// `stake_on_call` call, only the first batch fills and the rest remain
    /// open for a subsequent stake to pick up.
    pub fn stake_on_call(
        env: Env,
        staker: Address,
        call_id: u64,
        amount: i128,
        position: u32,
    ) -> Result<Call, MarketError> {
        staker.require_auth();
        with_lock(&env, || {
            let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
            require_call_id(&config, call_id)?;
            if config.paused {
                return Err(MarketError::ContractPaused);
            }
            if amount <= 0 || amount < config.min_stake {
                return Err(MarketError::InvalidStakeAmount);
            }

            let mut call = get_call(&env).ok_or(MarketError::CallNotFound)?;
            let current_timestamp = env.ledger().timestamp();

            if current_timestamp >= call.end_ts {
                return Err(MarketError::CallEnded);
            }

            let cutoff = config.staking_cutoff_secs;
            if cutoff > 0 && call.end_ts > cutoff && current_timestamp >= call.end_ts - cutoff {
                return Err(MarketError::StakingCutoffActive);
            }

            if call.settled || call.cancelled || call.voided {
                return Err(MarketError::CallSettled);
            }

            if position < 1 || position > call.outcome_count {
                return Err(MarketError::InvalidPosition);
            }

            let outcome_stakers = call.stakes.get(position).unwrap_or_else(|| Map::new(&env));
            let current_staker_stake = outcome_stakers.get(staker.clone()).unwrap_or(0);
            check_max_stake(&config, current_staker_stake, amount)?;

            transfer_token(
                &env,
                &call.stake_token,
                &staker,
                &env.current_contract_address(),
                amount,
            );

            apply_stake(&env, &config, &mut call, &staker, amount, position)?;
            set_call(&env, &call);

            emit_stake_added(&env, call_id, &staker, amount, position);

            // #465: matching pass for open limit orders on this call, now
            // that the pool ratios reflect this stake.
            match_limit_orders(&env, &config, &mut call, call_id);
            set_call(&env, &call);

            Ok(call)
        })
    }

    /// #465: Create a non-custodial limit order to stake `amount` on
    /// `outcome` once the pool's current implied probability for that
    /// outcome reaches (or falls below) `target_implied_probability_bps`.
    /// `amount` is transferred from `user` into contract escrow immediately.
    ///
    /// # Implied probability & fill-direction semantics (read carefully)
    ///
    /// This market is a pari-mutuel pool, not an AMM with a price curve, so
    /// "implied probability" for a position is defined purely from the pool
    /// ratio:
    ///
    /// ```text
    /// implied_probability_bps(outcome) =
    ///     outcome_stakes[outcome] * 10_000 / total_stake_across_all_outcomes
    /// ```
    ///
    /// `target_implied_probability_bps` is the **maximum** implied
    /// probability the user is willing to accept for `outcome` — a lower
    /// implied probability means a *better* payout multiplier if the
    /// outcome turns out to be correct (the position is a smaller share of
    /// the pool, so it captures more of the losing side's stake per unit
    /// staked). The order fills the first time:
    ///
    /// ```text
    /// current_implied_probability_bps(outcome) <= target_implied_probability_bps
    /// ```
    ///
    /// Worked example: the pool has 7_000 staked on outcome 1 and 3_000 on
    /// outcome 2 (total 10_000), so
    /// `implied_probability_bps(1) = 7_000 * 10_000 / 10_000 = 7_000` (70%).
    /// A limit order on outcome 1 with `target_implied_probability_bps =
    /// 3_000` (30%) will NOT fill yet, since 7_000 > 3_000. If later stakes
    /// push outcome 2's total up enough that outcome 1's share drops to,
    /// say, 2_500 / 10_000 = 25% (<= 30%), the order fills at that moment,
    /// at a recorded implied price of 2_500 bps.
    ///
    /// Escrowed tokens are held until the order fills (via the matching
    /// loop inside `stake_on_call`), is cancelled (`cancel_limit_order`), or
    /// expires and is refunded (`refund_expired_order`).
    ///
    /// `ttl_secs` is chosen by the caller and capped at `MAX_ORDER_TTL_SECS`
    /// (7 days); the order expires at `now + ttl_secs`.
    pub fn create_limit_order(
        env: Env,
        user: Address,
        call_id: u64,
        outcome: u32,
        amount: i128,
        target_implied_probability_bps: u32,
        ttl_secs: u64,
    ) -> Result<u64, MarketError> {
        user.require_auth();
        with_lock(&env, || {
            let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
            require_call_id(&config, call_id)?;
            if config.paused {
                return Err(MarketError::ContractPaused);
            }

            let call = get_call(&env).ok_or(MarketError::CallNotFound)?;
            let now = env.ledger().timestamp();

            if now >= call.end_ts {
                return Err(MarketError::CallEnded);
            }
            let cutoff = config.staking_cutoff_secs;
            if cutoff > 0 && call.end_ts > cutoff && now >= call.end_ts - cutoff {
                return Err(MarketError::StakingCutoffActive);
            }
            if call.settled || call.cancelled || call.voided {
                return Err(MarketError::CallSettled);
            }
            if outcome < 1 || outcome > call.outcome_count {
                return Err(MarketError::InvalidPosition);
            }
            if amount <= 0 || amount < config.min_stake {
                return Err(MarketError::InvalidStakeAmount);
            }
            if target_implied_probability_bps > 10_000 {
                return Err(MarketError::InvalidTargetProbability);
            }
            if ttl_secs == 0 || ttl_secs > MAX_ORDER_TTL_SECS {
                return Err(MarketError::InvalidOrderTTL);
            }

            // Pre-check the per-user cap so an order that can never fill
            // (the user is already at/over their cap) is rejected up front
            // rather than escrowing tokens into a dead order.
            let current_user_stake = get_user_stake(&env, &user, outcome);
            check_max_stake(&config, current_user_stake, amount)?;

            transfer_token(
                &env,
                &call.stake_token,
                &user,
                &env.current_contract_address(),
                amount,
            );

            let order_id = next_order_id(&env);
            let expires_at = now.checked_add(ttl_secs).ok_or(MarketError::Overflow)?;

            let order = LimitOrder {
                id: order_id,
                user: user.clone(),
                call_id,
                outcome,
                amount,
                target_probability_bps: target_implied_probability_bps,
                created_at: now,
                expires_at,
            };

            set_limit_order(&env, &order);

            let mut open_ids = get_open_order_ids_for_call(&env, call_id);
            open_ids.push_back(order_id);
            set_open_order_ids_for_call(&env, call_id, &open_ids);

            let mut user_ids = get_user_order_ids(&env, &user);
            user_ids.push_back(order_id);
            set_user_order_ids(&env, &user, &user_ids);

            emit_limit_order_created(
                &env,
                order_id,
                call_id,
                &user,
                outcome,
                amount,
                target_implied_probability_bps,
                expires_at,
            );

            Ok(order_id)
        })
    }

    /// #465: Cancel an open limit order and refund its full escrowed amount
    /// to its owner. Only the order's owner may cancel it.
    pub fn cancel_limit_order(env: Env, user: Address, order_id: u64) -> Result<(), MarketError> {
        user.require_auth();
        with_lock(&env, || {
            let order = get_limit_order(&env, order_id).ok_or(MarketError::OrderNotFound)?;
            if order.user != user {
                return Err(MarketError::NotOrderOwner);
            }

            let call = get_call(&env).ok_or(MarketError::CallNotFound)?;

            transfer_token(
                &env,
                &call.stake_token,
                &env.current_contract_address(),
                &user,
                order.amount,
            );

            remove_limit_order(&env, order_id);
            remove_id_from_call_orders(&env, order.call_id, order_id);
            remove_id_from_user_orders(&env, &user, order_id);

            emit_limit_order_cancelled(&env, order_id, order.call_id, &user, order.amount);
            Ok(())
        })
    }

    /// #465: Permissionlessly refund an *expired* limit order. Anyone may
    /// call this once `env.ledger().timestamp() >= order.expires_at`; the
    /// caller receives `config.expired_order_refund_bps` of the escrowed
    /// amount as a small reward for the cleanup, and the remainder goes back
    /// to the order's original owner.
    pub fn refund_expired_order(env: Env, caller: Address, order_id: u64) -> Result<(), MarketError> {
        caller.require_auth();
        with_lock(&env, || {
            let order = get_limit_order(&env, order_id).ok_or(MarketError::OrderNotFound)?;
            let now = env.ledger().timestamp();
            if order.expires_at > now {
                return Err(MarketError::OrderNotExpired);
            }

            let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
            let call = get_call(&env).ok_or(MarketError::CallNotFound)?;

            let reward = order
                .amount
                .checked_mul(config.expired_order_refund_bps as i128)
                .ok_or(MarketError::Overflow)?
                .checked_div(10_000)
                .ok_or(MarketError::Overflow)?;
            let refund_to_user = order.amount.checked_sub(reward).ok_or(MarketError::Overflow)?;

            if reward > 0 {
                transfer_token(
                    &env,
                    &call.stake_token,
                    &env.current_contract_address(),
                    &caller,
                    reward,
                );
            }
            if refund_to_user > 0 {
                transfer_token(
                    &env,
                    &call.stake_token,
                    &env.current_contract_address(),
                    &order.user,
                    refund_to_user,
                );
            }

            remove_limit_order(&env, order_id);
            remove_id_from_call_orders(&env, order.call_id, order_id);
            remove_id_from_user_orders(&env, &order.user, order_id);

            emit_limit_order_expired_refunded(
                &env,
                order_id,
                order.call_id,
                &order.user,
                refund_to_user,
                reward,
                &caller,
            );
            Ok(())
        })
    }

    /// #465: Return all currently open limit orders for a call.
    pub fn get_open_orders(env: Env, call_id: u64) -> Result<Vec<LimitOrder>, MarketError> {
        let ids = get_open_order_ids_for_call(&env, call_id);
        let mut orders = Vec::new(&env);
        for id in ids.iter() {
            if let Some(o) = get_limit_order(&env, id) {
                orders.push_back(o);
            }
        }
        Ok(orders)
    }

    /// #465: Return all currently open limit orders belonging to a user.
    pub fn get_user_orders(env: Env, user: Address) -> Result<Vec<LimitOrder>, MarketError> {
        let ids = get_user_order_ids(&env, &user);
        let mut orders = Vec::new(&env);
        for id in ids.iter() {
            if let Some(o) = get_limit_order(&env, id) {
                orders.push_back(o);
            }
        }
        Ok(orders)
    }

    /// Resolve the market (outcome_manager only).
    pub fn resolve_call(
        env: Env,
        call_id: u64,
        outcome: u32,
        end_price: i128,
    ) -> Result<Call, MarketError> {
        let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
        require_call_id(&config, call_id)?;
        config.outcome_manager.require_auth();
        reentrancy_guard!(&env);

        let mut call = get_call(&env).ok_or(MarketError::CallNotFound)?;

        if outcome < 1 || outcome > call.outcome_count {
            return Err(MarketError::InvalidOutcome);
        }
        if env.ledger().timestamp() < call.end_ts {
            return Err(MarketError::CallNotEnded);
        }
        if call.voided {
            return Err(MarketError::Unauthorized);
        }

        call.outcome = outcome;
        call.end_price = end_price;
        set_call(&env, &call);
        emit_call_resolved(&env, call_id, outcome, end_price);

        storage::release_lock(&env);
        Ok(call)
    }

    /// Mark the market as settled (outcome_manager only).
    pub fn mark_settled(env: Env, call_id: u64) -> Result<(), MarketError> {
        let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
        require_call_id(&config, call_id)?;
        config.outcome_manager.require_auth();

        let mut call = get_call(&env).ok_or(MarketError::CallNotFound)?;
        if call.settled {
            return Err(MarketError::CallSettled);
        }
        call.settled = true;
        set_call(&env, &call);
        Ok(())
    }

    /// Release escrowed tokens (outcome_manager only).
    pub fn release_escrow(
        env: Env,
        call_id: u64,
        to: Address,
        amount: i128,
    ) -> Result<(), MarketError> {
        let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
        require_call_id(&config, call_id)?;
        config.outcome_manager.require_auth();

        let call = get_call(&env).ok_or(MarketError::CallNotFound)?;
        transfer_token(
            &env,
            &call.stake_token,
            &env.current_contract_address(),
            &to,
            amount,
        );
        Ok(())
    }

    /// Return the full call struct (compatible with outcome_manager cross-contract reads).
    pub fn get_call(env: Env, call_id: u64) -> Result<Call, MarketError> {
        let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
        require_call_id(&config, call_id)?;
        get_call(&env).ok_or(MarketError::CallNotFound)
    }

    /// Return a staker's stake on a given outcome position.
    pub fn get_staker_stake(
        env: Env,
        call_id: u64,
        staker: Address,
        position: u32,
    ) -> Result<i128, MarketError> {
        let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
        require_call_id(&config, call_id)?;
        Ok(get_user_stake(&env, &staker, position))
    }

    /// Return total stakes per outcome.
    pub fn get_outcome_stakes(env: Env, call_id: u64) -> Result<Map<u32, i128>, MarketError> {
        let call = Self::get_call(env, call_id)?;
        Ok(call.outcome_stakes)
    }

    /// Return this market's global call ID assigned by the factory.
    pub fn get_call_id(env: Env) -> Result<u64, MarketError> {
        let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
        Ok(config.call_id)
    }

    /// Return the factory address that deployed this market.
    pub fn get_factory(env: Env) -> Result<Address, MarketError> {
        let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
        Ok(config.factory)
    }

    /// #498: Check if a staker is eligible for the early staker bonus.
    pub fn is_eligible_early_bonus(
        env: Env,
        _call_id: u64,
        staker: Address,
        position: u32,
    ) -> Result<bool, MarketError> {
        let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
        let call = get_call(&env).ok_or(MarketError::CallNotFound)?;

        if get_user_has_withdrawn(&env, &staker, position) {
            return Ok(false);
        }

        let stake_ts = get_user_stake_timestamp(&env, &staker, position);
        if stake_ts == 0 {
            return Ok(false);
        }

        let bonus_deadline = call.created_at + config.early_staker_bonus_window_secs;
        Ok(stake_ts < bonus_deadline)
    }

    /// #498: Get the number of early stakers.
    pub fn get_early_staker_count(env: Env) -> Result<u64, MarketError> {
        Ok(storage::get_early_staker_count(&env))
    }

    /// #498: Get the total early staker bonus paid.
    pub fn get_total_bonus_paid(env: Env) -> Result<i128, MarketError> {
        Ok(storage::get_total_early_staker_bonus_paid(&env))
    }

    /// #497: Verify on-chain reserves against total stakes.
    pub fn verify_reserves(
        env: Env,
        token_address: Address,
    ) -> Result<ReserveVerification, MarketError> {
        let config = get_config(&env).ok_or(MarketError::NotInitialized)?;
        let call = get_call(&env).ok_or(MarketError::CallNotFound)?;

        let contract_address = env.current_contract_address();
        let balance_on_chain = token::Client::new(&env, &token_address).balance(&contract_address);

        let mut total_staked: i128 = 0;
        for i in 1..=call.outcome_count {
            total_staked += call.outcome_stakes.get(i).unwrap_or(0);
        }

        let total_escrowed: i128 = 0;
        let discrepancy = balance_on_chain - total_staked - total_escrowed;
        let is_fully_reserved = discrepancy == 0;

        let verification = ReserveVerification {
            balance_on_chain,
            total_staked,
            total_escrowed,
            is_fully_reserved,
            discrepancy,
        };

        emit_reserve_verification(
            &env,
            config.call_id,
            balance_on_chain,
            total_staked,
            is_fully_reserved,
        );

        if !is_fully_reserved {
            emit_reserve_discrepancy(&env, config.call_id, discrepancy);
        }

        Ok(verification)
    }

    /// #497: Get current reserve status (view function).
    pub fn get_reserve_status(
        env: Env,
    ) -> Result<ReserveVerification, MarketError> {
        let _config = get_config(&env).ok_or(MarketError::NotInitialized)?;
        let call = get_call(&env).ok_or(MarketError::CallNotFound)?;

        let contract_address = env.current_contract_address();
        let balance_on_chain =
            token::Client::new(&env, &call.stake_token).balance(&contract_address);

        let mut total_staked: i128 = 0;
        for i in 1..=call.outcome_count {
            total_staked += call.outcome_stakes.get(i).unwrap_or(0);
        }

        let total_escrowed: i128 = 0;
        let discrepancy = balance_on_chain - total_staked - total_escrowed;

        Ok(ReserveVerification {
            balance_on_chain,
            total_staked,
            total_escrowed,
            is_fully_reserved: discrepancy == 0,
            discrepancy,
        })
    }
}
