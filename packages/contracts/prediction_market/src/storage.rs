use crate::types::{Call, LimitOrder, MarketConfig};
use soroban_sdk::{contracttype, Address, Env, Vec};

// #465: Limit orders can live up to 7 days (`MAX_ORDER_TTL_SECS` in lib.rs).
// Bump generously beyond that so an order's storage entry never expires out
// from under it before it fills, is cancelled, or is force-refunded.
// ~7 days in ledgers (5s per ledger): 7 * 24 * 3600 / 5 = 120_960
pub const ORDER_PERSISTENT_BUMP_AMOUNT: u32 = 120_960; // ~7 days
pub const ORDER_PERSISTENT_LIFETIME_THRESHOLD: u32 = 60_480; // ~3.5 days

#[contracttype]
pub enum DataKey {
    Config,
    Call,
    UserStake(Address, u32),
    Locked,
    EarlyStakerCount,
    TotalEarlyStakerBonusPaid,
    UserStakeTimestamp(Address, u32),
    UserHasWithdrawn(Address, u32),
    // #465: limit-order storage.
    LimitOrder(u64),
    NextOrderId,
    OpenOrdersByCall(u64),
    UserOrderIds(Address),
}

pub fn set_config(env: &Env, config: &MarketConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_config(env: &Env) -> Option<MarketConfig> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn set_call(env: &Env, call: &Call) {
    env.storage().instance().set(&DataKey::Call, call);
}

pub fn get_call(env: &Env) -> Option<Call> {
    env.storage().instance().get(&DataKey::Call)
}

pub fn set_user_stake(env: &Env, staker: &soroban_sdk::Address, position: u32, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::UserStake(staker.clone(), position), &amount);
}

pub fn get_user_stake(env: &Env, staker: &soroban_sdk::Address, position: u32) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::UserStake(staker.clone(), position))
        .unwrap_or(0)
}

pub fn acquire_lock(env: &Env) {
    env.storage().instance().set(&DataKey::Locked, &true);
}

pub fn release_lock(env: &Env) {
    env.storage().instance().set(&DataKey::Locked, &false);
}

pub fn is_locked(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Locked)
        .unwrap_or(false)
}

pub fn set_user_stake_timestamp(env: &Env, staker: &Address, position: u32, ts: u64) {
    env.storage()
        .instance()
        .set(&DataKey::UserStakeTimestamp(staker.clone(), position), &ts);
}

pub fn get_user_stake_timestamp(env: &Env, staker: &Address, position: u32) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::UserStakeTimestamp(staker.clone(), position))
        .unwrap_or(0)
}

pub fn set_user_has_withdrawn(env: &Env, staker: &Address, position: u32, withdrawn: bool) {
    env.storage()
        .instance()
        .set(&DataKey::UserHasWithdrawn(staker.clone(), position), &withdrawn);
}

pub fn get_user_has_withdrawn(env: &Env, staker: &Address, position: u32) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::UserHasWithdrawn(staker.clone(), position))
        .unwrap_or(false)
}

pub fn get_early_staker_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::EarlyStakerCount)
        .unwrap_or(0)
}

pub fn set_early_staker_count(env: &Env, count: u64) {
    env.storage().instance().set(&DataKey::EarlyStakerCount, &count);
}

pub fn get_total_early_staker_bonus_paid(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalEarlyStakerBonusPaid)
        .unwrap_or(0)
}

pub fn set_total_early_staker_bonus_paid(env: &Env, total: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalEarlyStakerBonusPaid, &total);
}

// ─── #465: Limit orders ───────────────────────────────────────────────────

/// Allocate the next limit order id (monotonically increasing, starts at 1).
pub fn next_order_id(env: &Env) -> u64 {
    let counter: u64 = env.storage().instance().get(&DataKey::NextOrderId).unwrap_or(0);
    let next_id = counter + 1;
    env.storage().instance().set(&DataKey::NextOrderId, &next_id);
    next_id
}

/// Store a limit order in persistent storage, bumping its TTL.
pub fn set_limit_order(env: &Env, order: &LimitOrder) {
    let key = DataKey::LimitOrder(order.id);
    env.storage().persistent().set(&key, order);
    env.storage().persistent().extend_ttl(
        &key,
        ORDER_PERSISTENT_LIFETIME_THRESHOLD,
        ORDER_PERSISTENT_BUMP_AMOUNT,
    );
}

/// Retrieve a limit order by id, refreshing its TTL on access.
pub fn get_limit_order(env: &Env, order_id: u64) -> Option<LimitOrder> {
    let key = DataKey::LimitOrder(order_id);
    let result: Option<LimitOrder> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage().persistent().extend_ttl(
            &key,
            ORDER_PERSISTENT_LIFETIME_THRESHOLD,
            ORDER_PERSISTENT_BUMP_AMOUNT,
        );
    }
    result
}

/// Remove a limit order's persistent storage entry (fill / cancel / refund).
pub fn remove_limit_order(env: &Env, order_id: u64) {
    env.storage().persistent().remove(&DataKey::LimitOrder(order_id));
}

/// Retrieve the list of open order ids for a call, refreshing TTL if non-empty.
pub fn get_open_order_ids_for_call(env: &Env, call_id: u64) -> Vec<u64> {
    let key = DataKey::OpenOrdersByCall(call_id);
    let result: Option<Vec<u64>> = env.storage().persistent().get(&key);
    match result {
        Some(ids) => {
            if !ids.is_empty() {
                env.storage().persistent().extend_ttl(
                    &key,
                    ORDER_PERSISTENT_LIFETIME_THRESHOLD,
                    ORDER_PERSISTENT_BUMP_AMOUNT,
                );
            }
            ids
        }
        None => Vec::new(env),
    }
}

/// Persist the list of open order ids for a call.
pub fn set_open_order_ids_for_call(env: &Env, call_id: u64, ids: &Vec<u64>) {
    let key = DataKey::OpenOrdersByCall(call_id);
    env.storage().persistent().set(&key, ids);
    env.storage().persistent().extend_ttl(
        &key,
        ORDER_PERSISTENT_LIFETIME_THRESHOLD,
        ORDER_PERSISTENT_BUMP_AMOUNT,
    );
}

/// Retrieve the list of order ids a user currently has open (entries are
/// removed as soon as an order fills, is cancelled, or is refunded),
/// refreshing TTL if non-empty.
pub fn get_user_order_ids(env: &Env, user: &Address) -> Vec<u64> {
    let key = DataKey::UserOrderIds(user.clone());
    let result: Option<Vec<u64>> = env.storage().persistent().get(&key);
    match result {
        Some(ids) => {
            if !ids.is_empty() {
                env.storage().persistent().extend_ttl(
                    &key,
                    ORDER_PERSISTENT_LIFETIME_THRESHOLD,
                    ORDER_PERSISTENT_BUMP_AMOUNT,
                );
            }
            ids
        }
        None => Vec::new(env),
    }
}

/// Persist the list of order ids belonging to a user.
pub fn set_user_order_ids(env: &Env, user: &Address, ids: &Vec<u64>) {
    let key = DataKey::UserOrderIds(user.clone());
    env.storage().persistent().set(&key, ids);
    env.storage().persistent().extend_ttl(
        &key,
        ORDER_PERSISTENT_LIFETIME_THRESHOLD,
        ORDER_PERSISTENT_BUMP_AMOUNT,
    );
}
