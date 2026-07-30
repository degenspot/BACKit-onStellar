//! Passive-yield lending pool for BACKit prediction markets.
//!
//! Depositors pool USDC (or any configured SAC / native XLM) and receive LP
//! shares tracking their proportional claim on the pool. Anyone may then call
//! [`LendingPool::allocate_capital`] to have the pool stake a slice of its
//! capital on the statistically favored side of open markets (a simplified
//! Kelly-Criterion edge strategy), and anyone may call
//! [`LendingPool::harvest_yield`] once a staked market resolves to realize
//! the pool's winnings (or losses) and update the LP share price.
//!
//! **Scope decisions** (see `lending_pool` design notes / issue #466):
//!
//! - **LP shares are a plain internal ledger**, not a deployed SAC token.
//!   `prediction_market::Call::share_tokens` is a `Map<u32, Address>` of
//!   *per-outcome-position* addresses that field is populated by nothing in
//!   this codebase today (no constructor arg sets it, no code writes to it)
//!   — it is not an established, reusable "mint a real SAC for pool shares"
//!   pattern to mirror. Deploying and administering a full second SAC per
//!   pool instance is a large amount of additional surface (asset issuer
//!   setup, trustlines, a second contract deployment) for what the
//!   acceptance criteria actually needs: a proportional, transfer-free
//!   accounting unit. A `Map<Address, i128>` + `total_lp_shares` counter
//!   (mirroring `index_fund`'s `UserIndexBalance` ledger) captures the same
//!   economics — deposit mints shares at the current NAV, withdraw burns
//!   them — without the extra deployment/administration surface.
//! - **No "true" oracle-probability feed exists pre-existing in this
//!   codebase** for *open* (unresolved) markets — see doc comment on
//!   [`LendingPool::allocate_capital`].
//! - **Harvesting**: this pool is the staker of record on every allocation
//!   (it stakes *as itself*, mirroring `parlay_betting`'s escrow model), so
//!   after a market resolves it must claim its own payout. `prediction_market`
//!   has no standalone "claim" entrypoint of its own — claims are brokered by
//!   `outcome_manager::claim_payout_for_market`, which computes the pro-rata
//!   payout from caller-supplied stake totals and calls back into
//!   `prediction_market::release_escrow` to move the tokens. `harvest_yield`
//!   wraps that call, deducts the protocol fee on any realized profit, and
//!   updates `total_yield_earned` / the LP share price.
#![no_std]
#![allow(clippy::too_many_arguments)]

mod errors;
mod events;
mod storage;
mod types;
mod xcontract;

pub use types::{Allocation, AllocationOutcome, MarketAllocationInput, PoolConfig, PoolStats};

#[cfg(test)]
mod test;

use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::{contract, contractimpl, token, Address, Env, IntoVal, Symbol, Vec};

use errors::LendingPoolError;
use events::{emit_capital_allocated, emit_deposited, emit_withdrawn, emit_yield_harvested};
use prediction_market::PredictionMarketClient;
use storage::*;
use types::YieldEvent;

/// Basis-point scale: 10_000 == 100%. All probability / edge / fee / APY
/// math in this contract is fixed-point integer arithmetic in this unit —
/// Soroban/WASM contracts must not use floats.
const BPS_SCALE: i128 = 10_000;
/// Rolling window, in seconds, used to annualize realized yield into an APY.
const APY_WINDOW_SECS: u64 = 7 * 86_400;
/// Days-per-year used to annualize the rolling-window yield sum.
const DAYS_PER_YEAR: i128 = 365;
const WINDOW_DAYS: i128 = 7;

const DEFAULT_MAX_ALLOCATION_BPS: u32 = 500; // 5%
const DEFAULT_PROTOCOL_FEE_BPS: u32 = 1_000; // 10%
const DEFAULT_EDGE_THRESHOLD_BPS: u32 = 100; // 1%
const MAX_BPS: u32 = 10_000;

// ─── Native-XLM / SAC token dispatch (mirrors prediction_market::transfer_token) ──

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

fn token_balance(env: &Env, token_addr: &Address) -> i128 {
    token::Client::new(env, token_addr).balance(&env.current_contract_address())
}

/// Pre-authorizes the nested `transfer` that `prediction_market::stake_on_call`
/// performs on this contract's behalf, exactly mirroring
/// `parlay_betting::authorize_stake_transfer` (see that function's doc
/// comment for the full explanation of why this is required).
fn authorize_stake_transfer(
    env: &Env,
    stake_token: &Address,
    from: &Address,
    market_address: &Address,
    amount: i128,
) {
    let args: Vec<soroban_sdk::Val> = (from.clone(), market_address.clone(), amount).into_val(env);
    let entry = InvokerContractAuthEntry::Contract(SubContractInvocation {
        context: ContractContext {
            contract: stake_token.clone(),
            fn_name: Symbol::new(env, "transfer"),
            args,
        },
        sub_invocations: Vec::new(env),
    });
    env.authorize_as_current_contract(Vec::from_array(env, [entry]));
}

fn other_position(position: u32) -> u32 {
    if position == 1 {
        2
    } else {
        1
    }
}

fn compute_tvl(env: &Env, config: &PoolConfig) -> Result<i128, LendingPoolError> {
    let liquid = token_balance(env, &config.stake_token);
    let locked = get_total_allocated_locked(env);
    liquid
        .checked_add(locked)
        .ok_or(LendingPoolError::Overflow)
}

/// Appends a yield event and prunes entries older than [`APY_WINDOW_SECS`],
/// bounding the list's storage footprint over the pool's lifetime.
fn record_yield_event(env: &Env, net_yield: i128) {
    let now = env.ledger().timestamp();
    let existing = get_yield_events(env);
    let mut kept = Vec::new(env);
    for ev in existing.iter() {
        if now.saturating_sub(ev.timestamp) <= APY_WINDOW_SECS {
            kept.push_back(ev);
        }
    }
    kept.push_back(YieldEvent {
        timestamp: now,
        net_yield,
    });
    set_yield_events(env, &kept);
}

/// Rolling 7-day annualized yield, in basis points (can be negative).
/// `apy_bps = sum(net_yield over last 7 days) * 10_000 * 365 / (7 * tvl)`.
/// This treats the trailing window's yield as representative of a full
/// 7-day period even early in the pool's life (fewer than 7 days of
/// history) — a documented simplification, not a true annualization of a
/// partial sample.
fn compute_apy_bps(env: &Env, tvl: i128) -> i128 {
    if tvl <= 0 {
        return 0;
    }
    let now = env.ledger().timestamp();
    let events = get_yield_events(env);
    let mut sum: i128 = 0;
    for ev in events.iter() {
        if now.saturating_sub(ev.timestamp) <= APY_WINDOW_SECS {
            sum = sum.saturating_add(ev.net_yield);
        }
    }
    sum.saturating_mul(BPS_SCALE)
        .saturating_mul(DAYS_PER_YEAR)
        .checked_div(WINDOW_DAYS)
        .and_then(|v| v.checked_div(tvl))
        .unwrap_or(0)
}

/// Resolve `call_id`'s deployed market address via the configured factory.
fn resolve_market_address(
    env: &Env,
    config: &PoolConfig,
    call_id: u64,
) -> Result<Address, LendingPoolError> {
    xcontract::resolve_market_address(env, config, call_id)
}

#[contract]
pub struct LendingPool;

#[contractimpl]
impl LendingPool {
    /// Initialize the pool (callable once). `min_allocation_pool_size` is
    /// the minimum TVL `allocate_capital` requires before it will stake
    /// anything. `max_allocation_bps_per_market`, `protocol_fee_bps` and
    /// `edge_threshold_bps` are seeded with sane defaults (5%, 10%, 1%) and
    /// can be tuned afterwards by `admin` via the `set_*` functions below.
    pub fn initialize(
        env: Env,
        admin: Address,
        treasury: Address,
        stake_token: Address,
        prediction_market_factory: Address,
        outcome_manager: Address,
        min_deposit: i128,
        max_pool_size: i128,
        min_allocation_pool_size: i128,
    ) -> Result<(), LendingPoolError> {
        if get_config(&env).is_some() {
            return Err(LendingPoolError::AlreadyInitialized);
        }
        admin.require_auth();

        if min_deposit <= 0 || max_pool_size <= 0 || min_allocation_pool_size <= 0 {
            return Err(LendingPoolError::InvalidConfig);
        }
        if min_allocation_pool_size > max_pool_size {
            return Err(LendingPoolError::InvalidConfig);
        }

        set_config(
            &env,
            &PoolConfig {
                admin,
                treasury,
                stake_token,
                prediction_market_factory,
                outcome_manager,
                min_deposit,
                max_pool_size,
                min_allocation_pool_size,
                max_allocation_bps_per_market: DEFAULT_MAX_ALLOCATION_BPS,
                protocol_fee_bps: DEFAULT_PROTOCOL_FEE_BPS,
                edge_threshold_bps: DEFAULT_EDGE_THRESHOLD_BPS,
            },
        );
        Ok(())
    }

    // ─── Depositor-facing ────────────────────────────────────────────────

    /// Deposit `amount` of the pool's stake token and mint LP shares at the
    /// current share price (`total_value_locked / total_lp_shares`, 1:1 on
    /// the very first deposit). Returns the number of LP shares minted.
    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, LendingPoolError> {
        user.require_auth();

        let config = get_config(&env).ok_or(LendingPoolError::NotInitialized)?;
        if amount <= 0 {
            return Err(LendingPoolError::InvalidAmount);
        }
        if amount < config.min_deposit {
            return Err(LendingPoolError::BelowMinDeposit);
        }

        let tvl_before = compute_tvl(&env, &config)?;
        let new_tvl = tvl_before
            .checked_add(amount)
            .ok_or(LendingPoolError::Overflow)?;
        if new_tvl > config.max_pool_size {
            return Err(LendingPoolError::PoolFull);
        }

        let total_supply = get_total_lp_shares(&env);
        let lp_shares = if total_supply <= 0 || tvl_before <= 0 {
            amount
        } else {
            amount
                .checked_mul(total_supply)
                .ok_or(LendingPoolError::Overflow)?
                .checked_div(tvl_before)
                .ok_or(LendingPoolError::Overflow)?
        };
        if lp_shares <= 0 {
            return Err(LendingPoolError::InvalidAmount);
        }

        transfer_token(&env, &config.stake_token, &user, &env.current_contract_address(), amount);

        set_total_lp_shares(
            &env,
            total_supply
                .checked_add(lp_shares)
                .ok_or(LendingPoolError::Overflow)?,
        );
        let total_deposited = get_total_deposited(&env);
        set_total_deposited(
            &env,
            total_deposited
                .checked_add(amount)
                .ok_or(LendingPoolError::Overflow)?,
        );
        let user_shares = get_lp_shares(&env, &user);
        set_lp_shares(
            &env,
            &user,
            user_shares
                .checked_add(lp_shares)
                .ok_or(LendingPoolError::Overflow)?,
        );

        emit_deposited(&env, &user, amount, lp_shares);
        Ok(lp_shares)
    }

    /// Burn `lp_amount` LP shares and return the proportional share of the
    /// pool's current total value locked. Fails with
    /// `InsufficientLiquidity` if the pool's *unallocated* balance can't
    /// cover it (capital currently staked in open markets isn't
    /// withdrawable until `harvest_yield` frees it).
    pub fn withdraw(env: Env, user: Address, lp_amount: i128) -> Result<i128, LendingPoolError> {
        user.require_auth();

        let config = get_config(&env).ok_or(LendingPoolError::NotInitialized)?;
        if lp_amount <= 0 {
            return Err(LendingPoolError::InvalidAmount);
        }

        let user_shares = get_lp_shares(&env, &user);
        if user_shares < lp_amount {
            return Err(LendingPoolError::InsufficientShares);
        }

        let total_supply = get_total_lp_shares(&env);
        if total_supply <= 0 {
            return Err(LendingPoolError::ZeroSupply);
        }

        let tvl = compute_tvl(&env, &config)?;
        let amount_out = lp_amount
            .checked_mul(tvl)
            .ok_or(LendingPoolError::Overflow)?
            .checked_div(total_supply)
            .ok_or(LendingPoolError::Overflow)?;

        let liquid = token_balance(&env, &config.stake_token);
        if amount_out > liquid {
            return Err(LendingPoolError::InsufficientLiquidity);
        }

        set_total_lp_shares(
            &env,
            total_supply
                .checked_sub(lp_amount)
                .ok_or(LendingPoolError::Overflow)?,
        );
        set_lp_shares(
            &env,
            &user,
            user_shares
                .checked_sub(lp_amount)
                .ok_or(LendingPoolError::Overflow)?,
        );

        transfer_token(&env, &config.stake_token, &env.current_contract_address(), &user, amount_out);

        emit_withdrawn(&env, &user, lp_amount, amount_out);
        Ok(amount_out)
    }

    // ─── Capital allocation (Kelly-edge strategy) ───────────────────────

    /// Permissionless: stake a slice of the pool's liquid capital on each
    /// open market in `markets`, once the pool's total value locked is at
    /// least `min_allocation_pool_size`.
    ///
    /// **Scope decision on `oracle_probability_bps`:** there is no
    /// pre-existing canonical "true probability" feed for *open* markets
    /// anywhere in this codebase — `schelling_oracle` / `outcome_manager`
    /// only resolve *already-ended* markets to a discrete outcome. Rather
    /// than fabricate a live price-feed integration, `oracle_probability_bps`
    /// is accepted as a trusted, caller-supplied estimate (the same pattern
    /// this codebase already uses for e.g.
    /// `schelling_oracle::dispute_outcome`'s caller-supplied
    /// `total_pool_amount`). Off-chain callers (a keeper bot backed by a real
    /// forecasting model, a DAO vote, etc.) are expected to supply it; this
    /// contract only validates it is in `0..=10_000` and computes the
    /// resulting edge.
    ///
    /// For each market: `market_implied_probability_bps` is read from the
    /// live `prediction_market` instance's `outcome_stakes`
    /// (`stakes[1] * 10_000 / (stakes[1] + stakes[2])`, or `5_000` if no one
    /// has staked yet). `edge_bps = |oracle_probability_bps -
    /// market_implied_probability_bps|`. If `edge_bps` is at least
    /// `edge_threshold_bps`, the pool stakes
    /// `min(tvl * edge_bps / 10_000, tvl * max_allocation_bps_per_market /
    /// 10_000, remaining liquid balance)` on whichever side the oracle
    /// estimate favors over the market's own pricing.
    ///
    /// This only supports binary (2-outcome) markets — the edge/Kelly math
    /// here is a "yes/no" simplification (see the module doc comment); a
    /// market with more than 2 outcomes is skipped with
    /// `AllocationOutcome::SkippedNotBinary`.
    ///
    /// Individual markets that can't be allocated to (already resolved,
    /// wrong stake token, edge too small, etc.) are skipped rather than
    /// aborting the whole batch — the returned `Vec<AllocationOutcome>`
    /// reports what happened to each input, in order.
    pub fn allocate_capital(
        env: Env,
        markets: Vec<MarketAllocationInput>,
    ) -> Result<Vec<AllocationOutcome>, LendingPoolError> {
        let config = get_config(&env).ok_or(LendingPoolError::NotInitialized)?;
        if markets.is_empty() {
            return Err(LendingPoolError::EmptyInput);
        }

        let tvl = compute_tvl(&env, &config)?;
        if tvl < config.min_allocation_pool_size {
            return Err(LendingPoolError::PoolTooSmall);
        }

        let mut liquid_remaining = token_balance(&env, &config.stake_token);
        let mut results = Vec::new(&env);
        let now = env.ledger().timestamp();
        let contract_address = env.current_contract_address();

        for input in markets.iter() {
            if input.oracle_probability_bps > MAX_BPS {
                results.push_back(AllocationOutcome::SkippedInvalidOracleProbability);
                continue;
            }
            if get_allocation(&env, input.call_id)
                .map(|a| !a.settled)
                .unwrap_or(false)
            {
                results.push_back(AllocationOutcome::SkippedAlreadyOpen);
                continue;
            }

            let market_address = match resolve_market_address(&env, &config, input.call_id) {
                Ok(addr) => addr,
                Err(_) => {
                    results.push_back(AllocationOutcome::SkippedMarketUnavailable);
                    continue;
                }
            };
            let market = PredictionMarketClient::new(&env, &market_address);
            let call = match market.try_get_call(&input.call_id) {
                Ok(Ok(call)) => call,
                _ => {
                    results.push_back(AllocationOutcome::SkippedMarketUnavailable);
                    continue;
                }
            };

            if call.stake_token != config.stake_token {
                results.push_back(AllocationOutcome::SkippedTokenMismatch);
                continue;
            }
            if call.outcome_count != 2 {
                results.push_back(AllocationOutcome::SkippedNotBinary);
                continue;
            }
            if call.settled || call.cancelled || call.voided || call.outcome != 0 || now >= call.end_ts
            {
                results.push_back(AllocationOutcome::SkippedMarketUnavailable);
                continue;
            }

            let stakes_1 = call.outcome_stakes.get(1).unwrap_or(0);
            let stakes_2 = call.outcome_stakes.get(2).unwrap_or(0);
            let total_stakes = match stakes_1.checked_add(stakes_2) {
                Some(v) => v,
                None => return Err(LendingPoolError::Overflow),
            };
            let market_implied_bps: u32 = if total_stakes <= 0 {
                5_000
            } else {
                let bps = match stakes_1
                    .checked_mul(BPS_SCALE)
                    .and_then(|v| v.checked_div(total_stakes))
                {
                    Some(v) => v,
                    None => return Err(LendingPoolError::Overflow),
                };
                bps as u32
            };

            let oracle_bps = input.oracle_probability_bps;
            let edge_bps: u32 = if oracle_bps > market_implied_bps {
                oracle_bps - market_implied_bps
            } else {
                market_implied_bps - oracle_bps
            };
            if edge_bps < config.edge_threshold_bps {
                results.push_back(AllocationOutcome::SkippedEdgeTooSmall);
                continue;
            }

            let position: u32 = if oracle_bps > market_implied_bps { 1 } else { 2 };

            let raw_alloc = match tvl
                .checked_mul(edge_bps as i128)
                .and_then(|v| v.checked_div(BPS_SCALE))
            {
                Some(v) => v,
                None => return Err(LendingPoolError::Overflow),
            };
            let cap = match tvl
                .checked_mul(config.max_allocation_bps_per_market as i128)
                .and_then(|v| v.checked_div(BPS_SCALE))
            {
                Some(v) => v,
                None => return Err(LendingPoolError::Overflow),
            };
            let mut amount = core::cmp::min(raw_alloc, cap);
            amount = core::cmp::min(amount, liquid_remaining);

            if amount <= 0 {
                results.push_back(AllocationOutcome::SkippedInsufficientLiquidity);
                continue;
            }

            authorize_stake_transfer(&env, &call.stake_token, &contract_address, &market_address, amount);
            match market.try_stake_on_call(&contract_address, &input.call_id, &amount, &position) {
                Ok(Ok(_)) => {
                    liquid_remaining = match liquid_remaining.checked_sub(amount) {
                        Some(v) => v,
                        None => return Err(LendingPoolError::Overflow),
                    };
                    let locked = get_total_allocated_locked(&env);
                    set_total_allocated_locked(
                        &env,
                        locked.checked_add(amount).ok_or(LendingPoolError::Overflow)?,
                    );
                    set_allocation(
                        &env,
                        &Allocation {
                            call_id: input.call_id,
                            market_address: market_address.clone(),
                            position,
                            amount,
                            settled: false,
                            won: false,
                            payout: 0,
                            created_at: now,
                        },
                    );
                    add_open_call_id(&env, input.call_id);
                    emit_capital_allocated(&env, input.call_id, &market_address, position, amount);
                    results.push_back(AllocationOutcome::Allocated(amount, position));
                }
                _ => {
                    results.push_back(AllocationOutcome::SkippedStakeRejected);
                }
            }
        }

        Ok(results)
    }

    /// Permissionless: once `call_id`'s market has resolved, claim the
    /// pool's own settled stake (if it won) via `outcome_manager`, deduct
    /// the protocol fee from any realized profit, and update
    /// `total_yield_earned` / the LP share price. Returns the net yield
    /// recorded for this allocation (can be negative on a loss).
    pub fn harvest_yield(env: Env, call_id: u64) -> Result<i128, LendingPoolError> {
        let config = get_config(&env).ok_or(LendingPoolError::NotInitialized)?;
        let mut allocation = get_allocation(&env, call_id).ok_or(LendingPoolError::AllocationNotFound)?;
        if allocation.settled {
            return Err(LendingPoolError::AlreadyHarvested);
        }

        let market = PredictionMarketClient::new(&env, &allocation.market_address);
        let call = market
            .try_get_call(&call_id)
            .map_err(|_| LendingPoolError::MarketCallFailed)?
            .map_err(|_| LendingPoolError::MarketCallFailed)?;

        if call.outcome == 0 {
            return Err(LendingPoolError::MarketNotResolved);
        }

        let contract_address = env.current_contract_address();
        let won = call.outcome == allocation.position;
        let mut payout: i128 = 0;

        if won {
            let total_winning_stake = call.outcome_stakes.get(allocation.position).unwrap_or(0);
            let total_losing_stake = call
                .outcome_stakes
                .get(other_position(allocation.position))
                .unwrap_or(0);

            let balance_before = token_balance(&env, &config.stake_token);
            xcontract::claim_payout_for_market(
                &env,
                &config,
                call_id,
                &contract_address,
                allocation.amount,
                total_winning_stake,
                total_losing_stake,
            )?;
            let balance_after = token_balance(&env, &config.stake_token);
            payout = balance_after
                .checked_sub(balance_before)
                .ok_or(LendingPoolError::Overflow)?;
        }

        let gross_change = payout
            .checked_sub(allocation.amount)
            .ok_or(LendingPoolError::Overflow)?;

        allocation.settled = true;
        allocation.won = won;
        allocation.payout = payout;
        set_allocation(&env, &allocation);
        remove_open_call_id(&env, call_id);

        let locked = get_total_allocated_locked(&env);
        set_total_allocated_locked(
            &env,
            locked
                .checked_sub(allocation.amount)
                .ok_or(LendingPoolError::Overflow)?,
        );

        let (protocol_fee, net_yield) = if gross_change > 0 {
            let fee = gross_change
                .checked_mul(config.protocol_fee_bps as i128)
                .ok_or(LendingPoolError::Overflow)?
                .checked_div(BPS_SCALE)
                .ok_or(LendingPoolError::Overflow)?;
            let net = gross_change.checked_sub(fee).ok_or(LendingPoolError::Overflow)?;
            if fee > 0 {
                transfer_token(&env, &config.stake_token, &contract_address, &config.treasury, fee);
                let total_fees = get_total_fees_paid(&env);
                set_total_fees_paid(&env, total_fees.checked_add(fee).ok_or(LendingPoolError::Overflow)?);
            }
            (fee, net)
        } else {
            (0, gross_change)
        };

        let total_yield = get_total_yield_earned(&env);
        set_total_yield_earned(
            &env,
            total_yield
                .checked_add(net_yield)
                .ok_or(LendingPoolError::Overflow)?,
        );
        record_yield_event(&env, net_yield);

        emit_yield_harvested(&env, call_id, won, gross_change, protocol_fee, net_yield);
        Ok(net_yield)
    }

    // ─── Views ────────────────────────────────────────────────────────────

    pub fn get_pool_stats(env: Env) -> Result<PoolStats, LendingPoolError> {
        let config = get_config(&env).ok_or(LendingPoolError::NotInitialized)?;
        let liquid = token_balance(&env, &config.stake_token);
        let locked = get_total_allocated_locked(&env);
        let tvl = liquid.checked_add(locked).ok_or(LendingPoolError::Overflow)?;

        Ok(PoolStats {
            total_deposited: get_total_deposited(&env),
            total_value_locked: tvl,
            total_yield_earned: get_total_yield_earned(&env),
            current_apy_bps: compute_apy_bps(&env, tvl),
            total_lp_shares: get_total_lp_shares(&env),
            liquid_balance: liquid,
            total_allocated_locked: locked,
            open_market_count: get_open_call_ids(&env).len(),
            min_deposit: config.min_deposit,
            max_pool_size: config.max_pool_size,
            protocol_fee_bps: config.protocol_fee_bps,
            max_allocation_bps_per_market: config.max_allocation_bps_per_market,
        })
    }

    pub fn get_user_lp_shares(env: Env, user: Address) -> i128 {
        get_lp_shares(&env, &user)
    }

    pub fn get_allocation(env: Env, call_id: u64) -> Option<Allocation> {
        get_allocation(&env, call_id)
    }

    pub fn get_open_call_ids(env: Env) -> Vec<u64> {
        get_open_call_ids(&env)
    }

    pub fn get_config(env: Env) -> Result<PoolConfig, LendingPoolError> {
        get_config(&env).ok_or(LendingPoolError::NotInitialized)
    }

    // ─── Admin-tunable parameters ───────────────────────────────────────

    pub fn set_max_alloc_bps_per_market(env: Env, new_bps: u32) -> Result<(), LendingPoolError> {
        let mut config = get_config(&env).ok_or(LendingPoolError::NotInitialized)?;
        config.admin.require_auth();
        if new_bps == 0 || new_bps > MAX_BPS {
            return Err(LendingPoolError::InvalidBps);
        }
        config.max_allocation_bps_per_market = new_bps;
        set_config(&env, &config);
        Ok(())
    }

    pub fn set_protocol_fee_bps(env: Env, new_bps: u32) -> Result<(), LendingPoolError> {
        let mut config = get_config(&env).ok_or(LendingPoolError::NotInitialized)?;
        config.admin.require_auth();
        if new_bps > MAX_BPS {
            return Err(LendingPoolError::InvalidBps);
        }
        config.protocol_fee_bps = new_bps;
        set_config(&env, &config);
        Ok(())
    }

    pub fn set_edge_threshold_bps(env: Env, new_bps: u32) -> Result<(), LendingPoolError> {
        let mut config = get_config(&env).ok_or(LendingPoolError::NotInitialized)?;
        config.admin.require_auth();
        if new_bps > MAX_BPS {
            return Err(LendingPoolError::InvalidBps);
        }
        config.edge_threshold_bps = new_bps;
        set_config(&env, &config);
        Ok(())
    }

    pub fn set_min_deposit(env: Env, new_min: i128) -> Result<(), LendingPoolError> {
        let mut config = get_config(&env).ok_or(LendingPoolError::NotInitialized)?;
        config.admin.require_auth();
        if new_min <= 0 {
            return Err(LendingPoolError::InvalidConfig);
        }
        config.min_deposit = new_min;
        set_config(&env, &config);
        Ok(())
    }

    pub fn set_max_pool_size(env: Env, new_max: i128) -> Result<(), LendingPoolError> {
        let mut config = get_config(&env).ok_or(LendingPoolError::NotInitialized)?;
        config.admin.require_auth();
        if new_max <= 0 {
            return Err(LendingPoolError::InvalidConfig);
        }
        config.max_pool_size = new_max;
        set_config(&env, &config);
        Ok(())
    }
}
