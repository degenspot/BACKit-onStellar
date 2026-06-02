use crate::types::{Call, ContractConfig, GlobalStats, CreatorStats, StorageStats};
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
    CallStakers(u64),
    StakerCalls(Address),
    CreatorStats(Address),
    UserStake(u64, Address, u32),
    UpStakerCount(u64),
    DownStakerCount(u64),
    VoidRefundClaimed(u64, Address),
    InstanceEntryCount,
}

/// Store contract configuration
pub fn set_config(env: &Env, config: &ContractConfig) {
    let is_new = !env.storage().instance().has(&DataKey::Config);
    env.storage().instance().set(&DataKey::Config, config);
    if is_new {
        inc_instance_entry_count(env, 1);
    }
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
    if counter == 0 {
        // First write of CallCounter key
        inc_instance_entry_count(env, 1);
    }
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

pub fn add_call_staker(env: &Env, call_id: u64, staker: &Address) {
    let key = DataKey::CallStakers(call_id);
    let mut stakers: soroban_sdk::Vec<Address> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));

    if !stakers.iter().any(|existing| existing == *staker) {
        stakers.push_back(staker.clone());
        env.storage().persistent().set(&key, &stakers);
    }

    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

pub fn get_call_stakers(env: &Env, call_id: u64) -> soroban_sdk::Vec<Address> {
    let key = DataKey::CallStakers(call_id);
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
    let is_new = !env.storage().instance().has(&DataKey::GlobalStats);
    let mut stats = get_global_stats(env);
    stats.total_calls += 1;
    env.storage().instance().set(&DataKey::GlobalStats, &stats);
    if is_new {
        inc_instance_entry_count(env, 1);
    }
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

/// Store user stake
pub fn set_user_stake(env: &Env, call_id: u64, staker: &Address, position: u32, amount: i128) {
    let key = DataKey::UserStake(call_id, staker.clone(), position);
    env.storage().persistent().set(&key, &amount);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Retrieve user stake
pub fn get_user_stake(env: &Env, call_id: u64, staker: &Address, position: u32) -> i128 {
    let key = DataKey::UserStake(call_id, staker.clone(), position);
    let result: Option<i128> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
    result.unwrap_or(0)
}

/// Get up staker count for a call
pub fn get_up_staker_count(env: &Env, call_id: u64) -> u32 {
    let key = DataKey::UpStakerCount(call_id);
    env.storage().persistent().get(&key).unwrap_or(0)
}

/// Set up staker count for a call
pub fn set_up_staker_count(env: &Env, call_id: u64, count: u32) {
    let key = DataKey::UpStakerCount(call_id);
    env.storage().persistent().set(&key, &count);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Get down staker count for a call
pub fn get_down_staker_count(env: &Env, call_id: u64) -> u32 {
    let key = DataKey::DownStakerCount(call_id);
    env.storage().persistent().get(&key).unwrap_or(0)
}

/// Set down staker count for a call
pub fn set_down_staker_count(env: &Env, call_id: u64, count: u32) {
    let key = DataKey::DownStakerCount(call_id);
    env.storage().persistent().set(&key, &count);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Extend contract storage lifetime (for long-term persistence)
pub fn extend_storage_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

/// Get creator reputation stats, initializing if not found
pub fn get_creator_stats(env: &Env, creator: &Address) -> CreatorStats {
    let key = DataKey::CreatorStats(creator.clone());
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or(CreatorStats {
            total_created: 0,
            total_resolved: 0,
            total_correct: 0,
        })
}

/// Store creator reputation stats in persistent storage
pub fn set_creator_stats(env: &Env, creator: &Address, stats: &CreatorStats) {
    let key = DataKey::CreatorStats(creator.clone());
    env.storage().persistent().set(&key, stats);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Mark that a staker has claimed their void refund for a call
pub fn set_void_refund_claimed(env: &Env, call_id: u64, staker: &Address) {
    let key = DataKey::VoidRefundClaimed(call_id, staker.clone());
    let is_new = !env.storage().instance().has(&key);
    env.storage().instance().set(&key, &true);
    if is_new {
        inc_instance_entry_count(env, 1);
    }
}

/// Check whether a staker has already claimed their void refund
pub fn is_void_refund_claimed(env: &Env, call_id: u64, staker: &Address) -> bool {
    env.storage()
        .instance()
        .has(&DataKey::VoidRefundClaimed(call_id, staker.clone()))
}

// ── Instance entry counter ────────────────────────────────────────────────────

/// Increment the instance entry counter by `delta` (call when adding new instance keys).
pub fn inc_instance_entry_count(env: &Env, delta: u32) {
    let current: u32 = env
        .storage()
        .instance()
        .get(&DataKey::InstanceEntryCount)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::InstanceEntryCount, &(current + delta));
}

/// Return the number of tracked instance storage entries.
pub fn get_instance_entry_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::InstanceEntryCount)
        .unwrap_or(0)
}

/// Return a storage utilisation snapshot.
pub fn get_storage_stats(env: &Env) -> StorageStats {
    let instance_entry_count = get_instance_entry_count(env);
    StorageStats {
        call_count: get_call_counter(env),
        instance_entry_count,
        estimated_instance_bytes: instance_entry_count * 128,
    }
}
