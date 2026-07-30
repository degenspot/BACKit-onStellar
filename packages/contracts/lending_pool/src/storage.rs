use crate::types::{Allocation, PoolConfig, YieldEvent};
use soroban_sdk::{contracttype, Address, Env, Vec};

#[contracttype]
pub enum DataKey {
    Config,
    TotalLpShares,
    TotalDeposited,
    TotalYieldEarned,
    TotalFeesPaid,
    TotalAllocatedLocked,
    LpShares(Address),
    Allocation(u64),
    OpenCallIds,
    YieldEvents,
}

// ─── Config ──────────────────────────────────────────────────────────────────

pub fn set_config(env: &Env, config: &PoolConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_config(env: &Env) -> Option<PoolConfig> {
    env.storage().instance().get(&DataKey::Config)
}

// ─── LP share ledger ─────────────────────────────────────────────────────────

pub fn get_total_lp_shares(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalLpShares)
        .unwrap_or(0)
}

pub fn set_total_lp_shares(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::TotalLpShares, &amount);
}

pub fn get_lp_shares(env: &Env, user: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::LpShares(user.clone()))
        .unwrap_or(0)
}

pub fn set_lp_shares(env: &Env, user: &Address, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::LpShares(user.clone()), &amount);
}

// ─── Lifetime counters ───────────────────────────────────────────────────────

pub fn get_total_deposited(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalDeposited)
        .unwrap_or(0)
}

pub fn set_total_deposited(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::TotalDeposited, &amount);
}

pub fn get_total_yield_earned(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalYieldEarned)
        .unwrap_or(0)
}

pub fn set_total_yield_earned(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalYieldEarned, &amount);
}

pub fn get_total_fees_paid(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalFeesPaid)
        .unwrap_or(0)
}

pub fn set_total_fees_paid(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::TotalFeesPaid, &amount);
}

// ─── Allocated (locked) capital ──────────────────────────────────────────────

pub fn get_total_allocated_locked(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalAllocatedLocked)
        .unwrap_or(0)
}

pub fn set_total_allocated_locked(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalAllocatedLocked, &amount);
}

// ─── Allocations ─────────────────────────────────────────────────────────────

pub fn get_allocation(env: &Env, call_id: u64) -> Option<Allocation> {
    env.storage().instance().get(&DataKey::Allocation(call_id))
}

pub fn set_allocation(env: &Env, allocation: &Allocation) {
    env.storage()
        .instance()
        .set(&DataKey::Allocation(allocation.call_id), allocation);
}

pub fn get_open_call_ids(env: &Env) -> Vec<u64> {
    env.storage()
        .instance()
        .get(&DataKey::OpenCallIds)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_open_call_ids(env: &Env, ids: &Vec<u64>) {
    env.storage().instance().set(&DataKey::OpenCallIds, ids);
}

pub fn add_open_call_id(env: &Env, call_id: u64) {
    let mut ids = get_open_call_ids(env);
    ids.push_back(call_id);
    set_open_call_ids(env, &ids);
}

pub fn remove_open_call_id(env: &Env, call_id: u64) {
    let ids = get_open_call_ids(env);
    let mut filtered = Vec::new(env);
    for id in ids.iter() {
        if id != call_id {
            filtered.push_back(id);
        }
    }
    set_open_call_ids(env, &filtered);
}

// ─── Yield history (rolling APY window) ──────────────────────────────────────

pub fn get_yield_events(env: &Env) -> Vec<YieldEvent> {
    env.storage()
        .instance()
        .get(&DataKey::YieldEvents)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_yield_events(env: &Env, events: &Vec<YieldEvent>) {
    env.storage().instance().set(&DataKey::YieldEvents, events);
}
