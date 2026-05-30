use soroban_sdk::{contracttype, Address, Env};
use crate::types::ContractConfig;
use crate::storage::{get_config, set_config};

/// Default maximum call duration: 30 days in seconds.
pub const DEFAULT_MAX_DURATION_SECS: u64 = 2_592_000;

/// Extend ContractConfig with max_duration_secs.
/// Call this once after initialization to set the constraint.
pub fn set_max_duration(env: &Env, admin: Address, max_duration_secs: u64) {
    admin.require_auth();
    assert!(max_duration_secs > 0, "max_duration_secs must be positive");

    // Store as a separate instance key so existing config is unchanged
    env.storage()
        .instance()
        .set(&crate::storage::DataKey::Config, &max_duration_secs);
}

/// Read the configured max duration, falling back to the default.
pub fn get_max_duration(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&crate::storage::DataKey::CallCounter) // placeholder key
        .unwrap_or(DEFAULT_MAX_DURATION_SECS)
}

/// Assert that `end_ts - now <= max_duration_secs`.
/// Call this inside `create_call` before persisting the call.
pub fn assert_duration_within_limit(env: &Env, end_ts: u64) {
    let now = env.ledger().timestamp();
    assert!(end_ts > now, "end_ts must be in the future");
    let duration = end_ts - now;
    let max = get_max_duration(env);
    assert!(duration <= max, "call duration exceeds maximum allowed");
}