use crate::types::{Call, ContractConfig, GlobalStats};
use soroban_sdk::{contracttype, Address, Env};

// ~120 days in ledgers (5s per ledger): 120 * 24 * 3600 / 5 = 2_073_600
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = 1_036_800; // ~60 days
pub const PERSISTENT_BUMP_AMOUNT: u32 = 2_073_600; // ~120 days

// Instance TTL: ~7 days (instance storage is cheaper, refresh frequently)
const INSTANCE_LIFETIME_THRESHOLD: u32 = 60_480; // ~3.5 days
const INSTANCE_BUMP_AMOUNT: u32 = 120_960; // ~7 days

#[contracttype]
pub enum DataKey {
    Config,
    CallCounter,
    GlobalStats,
    GlobalStakerSeen(Address),
    Call(u64),
    StakerCalls(Address),
}

/// Store contract configuration
pub fn set_config(env: &Env, config: &ContractConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

/// Retrieve contract configuration
pub fn get_config(env: &Env) -> Option<ContractConfig> {
    env.storage().instance().get(&DataKey::Config)
}

/// Get the next call ID and increment counter
pub fn next_call_id(env: &Env) -> u64 {
    let counter: u64 = env
        .storage()
        .instance()
        .get(&DataKey::CallCounter)
        .unwrap_or(0);

    let next_id = counter + 1;
    env.storage()
        .instance()
        .set(&DataKey::CallCounter, &next_id);

    next_id
}

/// Store a call in persistent storage
pub fn set_call(env: &Env, call: &Call) {
    let key = DataKey::Call(call.id);
    env.storage().persistent().set(&key, call);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Retrieve a call by ID from persistent storage, refreshing its TTL on access
pub fn get_call(env: &Env, call_id: u64) -> Option<Call> {
    let key = DataKey::Call(call_id);
    let result: Option<Call> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
    result
}

/// Check whether a call exists in persistent storage
pub fn call_exists(env: &Env, call_id: u64) -> bool {
    env.storage().persistent().has(&DataKey::Call(call_id))
}

/// Track which calls a staker has participated in
pub fn add_staker_call(env: &Env, staker: &Address, call_id: u64) {
    let key = DataKey::StakerCalls(staker.clone());

    let mut call_ids: soroban_sdk::Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));

    if !call_ids.iter().any(|id| id == call_id) {
        call_ids.push_back(call_id);
        env.storage().persistent().set(&key, &call_ids);
    }
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Retrieve all call IDs a staker has participated in, refreshing TTL if non-empty
pub fn get_staker_calls(env: &Env, staker: &Address) -> soroban_sdk::Vec<u64> {
    let key = DataKey::StakerCalls(staker.clone());
    let result = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));
    if !result.is_empty() {
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
    result
}

pub fn get_global_stats(env: &Env) -> GlobalStats {
    env.storage()
        .instance()
        .get(&DataKey::GlobalStats)
        .unwrap_or(GlobalStats {
            total_calls: 0,
            total_stake_volume: 0,
            total_unique_stakers: 0,
        })
}

pub fn record_call_created(env: &Env) {
    let mut stats = get_global_stats(env);
    stats.total_calls += 1;
    env.storage().instance().set(&DataKey::GlobalStats, &stats);
}

pub fn record_stake(env: &Env, staker: &Address, amount: i128) {
    let mut stats = get_global_stats(env);
    stats.total_stake_volume += amount;

    let seen_key = DataKey::GlobalStakerSeen(staker.clone());
    if !env.storage().persistent().has(&seen_key) {
        env.storage().persistent().set(&seen_key, &true);
        stats.total_unique_stakers += 1;
    }

    env.storage().instance().set(&DataKey::GlobalStats, &stats);
}

/// Get current call counter
pub fn get_call_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::CallCounter)
        .unwrap_or(0)
}

/// Extend contract storage lifetime (for long-term persistence)
pub fn extend_storage_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}
