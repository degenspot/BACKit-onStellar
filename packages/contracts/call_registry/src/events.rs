use soroban_sdk::symbol_short;
use soroban_sdk::{Address, Bytes, Env, Symbol};

pub const PARAM_MAX_STAKE_PER_USER: &str = "max_stake_per_user";
pub const PARAM_MIN_STAKE: &str = "min_stake";
pub const PARAM_STAKING_CUTOFF: &str = "staking_cutoff_secs";

/// Emitted when a new call is created
pub fn emit_call_created(
    env: &Env,
    call_id: u64,
    creator: &Address,
    stake_token: &Address,
    stake_amount: i128,
    start_price: i128,
    end_ts: u64,
    token_address: &Address,
    pair_id: &Bytes,
    ipfs_cid: &Bytes,
    outcome_count: u32,
) {
    env.events().publish(
        ("call_registry", "call_created"),
        (
            call_id,
            creator.clone(),
            stake_token.clone(),
            stake_amount,
            start_price,
            end_ts,
            token_address.clone(),
            pair_id.clone(),
            ipfs_cid.clone(),
            outcome_count,
        ),
    );
}

/// Emitted when a staker adds stake to a call
pub fn emit_stake_added(env: &Env, call_id: u64, staker: &Address, amount: i128, position: u32) {
    env.events().publish(
        ("call_registry", "stake_added"),
        (call_id, staker.clone(), amount, position),
    );
}

/// Emitted when a call is resolved with an outcome
pub fn emit_call_resolved(env: &Env, call_id: u64, outcome: u32, end_price: i128) {
    env.events().publish(
        ("call_registry", "call_resolved"),
        (call_id, outcome, end_price),
    );
}

/// Emitted when a call is settled and winners are determined
pub fn emit_call_settled(env: &Env, call_id: u64, winner_count: u64) {
    env.events()
        .publish(("call_registry", "call_settled"), (call_id, winner_count));
}

// ── Admin param events ────────────────────────────────────────────────────────

/// Discriminant passed as the `param` field so the indexer can tell which
/// field changed without decoding the full payload.
pub const PARAM_ADMIN: &str = "admin";
pub const PARAM_OUTCOME_MANAGER: &str = "outcome_manager";
pub const PARAM_FEE_BPS: &str = "fee_bps";

/// Unified event emitted whenever **any** admin-controlled parameter changes.
///
/// Topic  : `("call_registry", "admin_params_changed")`
/// Payload: `(param: Symbol, changed_by: Address, old_value: Val, new_value: Val)`
///
/// The indexer subscribes to a single topic and uses `param` to route
/// each mutation to the correct handler.
pub fn emit_admin_params_changed_address(
    env: &Env,
    param: &str,
    changed_by: &Address,
    old_value: &Address,
    new_value: &Address,
) {
    env.events().publish(
        ("call_registry", "admin_params_changed"),
        (
            Symbol::new(env, param),
            changed_by.clone(),
            old_value.clone(),
            new_value.clone(),
        ),
    );
}

pub fn emit_admin_params_changed_u32(
    env: &Env,
    param: &str,
    changed_by: &Address,
    old_value: u32,
    new_value: u32,
) {
    env.events().publish(
        ("call_registry", "admin_params_changed"),
        (
            Symbol::new(env, param),
            changed_by.clone(),
            old_value,
            new_value,
        ),
    );
}

/// Emitted when a creator cancels their call and reclaims their stake
pub fn emit_call_cancelled(env: &Env, call_id: u64, creator: &Address, refunded_amount: i128) {
    env.events().publish(
        ("call_registry", "call_cancelled"),
        (call_id, creator.clone(), refunded_amount),
    );
}

pub fn emit_admin_params_changed_i128(
    env: &Env,
    param: &str,
    changed_by: &Address,
    old_value: i128,
    new_value: i128,
) {
    env.events().publish(
        ("call_registry", "admin_params_changed"),
        (
            Symbol::new(env, param),
            changed_by.clone(),
            old_value,
            new_value,
        ),
    );
}

pub fn emit_admin_params_changed_u64(
    env: &Env,
    param: &str,
    changed_by: &Address,
    old_value: u64,
    new_value: u64,
) {
    env.events().publish(
        ("call_registry", "admin_params_changed"),
        (
            Symbol::new(env, param),
            changed_by.clone(),
            old_value,
            new_value,
        ),
    );
}
pub fn emit_token_whitelisted(env: &Env, token: &Address) {
    env.events()
        .publish(("call_registry", "token_whitelisted"), token.clone());
}

pub fn emit_token_delisted(env: &Env, token: &Address) {
    env.events()
        .publish(("call_registry", "token_delisted"), token.clone());
}

/// Emitted when the admin pauses the contract.
pub fn emit_contract_paused(env: &Env, admin: &Address) {
    env.events()
        .publish(("call_registry", "contract_paused"), admin.clone());
}

/// Emitted when the admin unpauses the contract.
pub fn emit_contract_unpaused(env: &Env, admin: &Address) {
    env.events()
        .publish(("call_registry", "contract_unpaused"), admin.clone());
}

pub fn emit_call_metadata_updated(
    env: &Env,
    call_id: u64,
    creator: &Address,
    old_cid: &Bytes,
    new_cid: &Bytes,
    version: u32,
) {
    env.events().publish(
        (symbol_short!("call"), symbol_short!("meta_upd")),
        (
            call_id,
            creator.clone(),
            old_cid.clone(),
            new_cid.clone(),
            version,
        ),
    );
}

/// Emitted when the contract WASM is upgraded
pub fn emit_contract_upgraded(env: &Env, old_version: u32, new_version: u32, admin: &Address) {
    env.events().publish(
        ("call_registry", "contract_upgraded"),
        (old_version, new_version, admin.clone()),
    );
}

// ── Void events ───────────────────────────────────────────────────────────────

/// Emitted when an admin voids a call
pub fn emit_call_voided(env: &Env, call_id: u64, voided_by: &Address) {
    env.events().publish(
        ("call_registry", "call_voided"),
        (call_id, voided_by.clone()),
    );
}

/// Emitted when a staker claims a void refund
pub fn emit_void_refund_claimed(env: &Env, call_id: u64, staker: &Address, amount: i128) {
    env.events().publish(
        ("call_registry", "void_refund_claimed"),
        (call_id, staker.clone(), amount),
    );
}

/// Emitted when instance entry count exceeds the warning threshold.
pub fn emit_storage_warning(env: &Env, entry_count: u32, estimated_bytes: u32) {
    env.events().publish(
        ("call_registry", "storage_warning"),
        (entry_count, estimated_bytes),
    );
}
