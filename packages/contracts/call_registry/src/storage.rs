use soroban_sdk::{Address, Env};
use crate::types::{Call, ContractConfig};

// Storage keys
const CONFIG_KEY: &str = "config";
const CALL_COUNTER_KEY: &str = "call_counter";
const CALL_PREFIX: &str = "call_";
const STAKER_CALLS_PREFIX: &str = "staker_calls_";

/// Store contract configuration
pub fn set_config(env: &Env, config: &ContractConfig) {
    env.storage().instance().set(&CONFIG_KEY, config);
}

/// Retrieve contract configuration
pub fn get_config(env: &Env) -> Option<ContractConfig> {
    env.storage().instance().get(&CONFIG_KEY)
}

/// Get the next call ID and increment counter
pub fn next_call_id(env: &Env) -> u64 {
    let counter: u64 = env
        .storage()
        .instance()
        .get(&CALL_COUNTER_KEY)
        .unwrap_or(0);
    
    let next_id = counter + 1;
    env.storage().instance().set(&CALL_COUNTER_KEY, &next_id);
    
    next_id
}

/// Store a call
pub fn set_call(env: &Env, call: &Call) {
    let key = format!("{}{}", CALL_PREFIX, call.id);
    env.storage().instance().set(&key, call);
}

/// Retrieve a call by ID
pub fn get_call(env: &Env, call_id: u64) -> Option<Call> {
    let key = format!("{}{}", CALL_PREFIX, call_id);
    env.storage().instance().get(&key)
}

/// Check if a call exists
pub fn call_exists(env: &Env, call_id: u64) -> bool {
    let key = format!("{}{}", CALL_PREFIX, call_id);
    env.storage().instance().has(&key)
}

/// Track which calls a staker has participated in
pub fn add_staker_call(env: &Env, staker: &Address, call_id: u64) {
    let key = format!("{}{}", STAKER_CALLS_PREFIX, staker);
    
    let mut call_ids: soroban_sdk::Vec<u64> = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));
    
    // Only add if not already present
    if !call_ids.iter().any(|id| id == call_id) {
        call_ids.push_back(call_id);
        env.storage().instance().set(&key, &call_ids);
    }
}

/// Get all calls a staker has participated in
pub fn get_staker_calls(env: &Env, staker: &Address) -> soroban_sdk::Vec<u64> {
    let key = format!("{}{}", STAKER_CALLS_PREFIX, staker);
    env.storage()
        .instance()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env))
}

/// Get current call counter
pub fn get_call_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&CALL_COUNTER_KEY)
        .unwrap_or(0)
}

/// Extend contract storage lifetime (for long-term persistence)
pub fn extend_storage_ttl(env: &Env) {
    // Extend storage for 1 year (approximately 31,536,000 ledgers at ~5 second blocks)
    env.storage().instance().extend_ttl(31_536_000, 31_536_000);
}
