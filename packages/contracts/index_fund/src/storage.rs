use crate::types::IndexConstituent;
use soroban_sdk::{contracttype, Address, Env, Vec};

#[contracttype]
pub enum DataKey {
    Config,
    TotalIndexSupply,
    TotalUsdcInPool,
    Constituents,
    UserIndexBalance(Address),
    Constituent(u64),
    LastRebalanceTimestamp,
    Initialized,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct IndexConfig {
    pub admin: Address,
    pub stake_token: Address,
    pub prediction_market_factory: Address,
    pub rebalance_interval_secs: u64,
    pub deposit_fee_bps: u32,
    pub withdraw_fee_bps: u32,
    pub top_n: u32,
    pub keeper_reward_bps: u32,
}

// ─── Initialized flag ────────────────────────────────────────────────────────

pub fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&DataKey::Initialized, &true);
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Initialized)
        .unwrap_or(false)
}

// ─── Config ──────────────────────────────────────────────────────────────────

pub fn set_config(env: &Env, config: &IndexConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_config(env: &Env) -> Option<IndexConfig> {
    env.storage().instance().get(&DataKey::Config)
}

// ─── Total index token supply ────────────────────────────────────────────────

pub fn get_total_index_supply(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalIndexSupply)
        .unwrap_or(0)
}

pub fn set_total_index_supply(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalIndexSupply, &amount);
}

// ─── Total USDC in pool ─────────────────────────────────────────────────────

pub fn get_total_usdc_in_pool(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalUsdcInPool)
        .unwrap_or(0)
}

pub fn set_total_usdc_in_pool(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalUsdcInPool, &amount);
}

// ─── User index token balance ────────────────────────────────────────────────

pub fn get_user_index_balance(env: &Env, user: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::UserIndexBalance(user.clone()))
        .unwrap_or(0)
}

pub fn set_user_index_balance(env: &Env, user: &Address, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::UserIndexBalance(user.clone()), &amount);
}

// ─── Constituents ────────────────────────────────────────────────────────────

pub fn get_constituents(env: &Env) -> Vec<IndexConstituent> {
    env.storage()
        .instance()
        .get(&DataKey::Constituents)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_constituents(env: &Env, constituents: &Vec<IndexConstituent>) {
    env.storage()
        .instance()
        .set(&DataKey::Constituents, constituents);
}

pub fn get_constituent(env: &Env, call_id: u64) -> Option<IndexConstituent> {
    env.storage()
        .instance()
        .get(&DataKey::Constituent(call_id))
}

pub fn set_constituent(env: &Env, constituent: &IndexConstituent) {
    env.storage()
        .instance()
        .set(&DataKey::Constituent(constituent.call_id), constituent);
}

pub fn remove_constituent(env: &Env, call_id: u64) {
    env.storage()
        .instance()
        .remove(&DataKey::Constituent(call_id));
}

// ─── Last rebalance timestamp ────────────────────────────────────────────────

pub fn get_last_rebalance_timestamp(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::LastRebalanceTimestamp)
        .unwrap_or(0)
}

pub fn set_last_rebalance_timestamp(env: &Env, ts: u64) {
    env.storage()
        .instance()
        .set(&DataKey::LastRebalanceTimestamp, &ts);
}
