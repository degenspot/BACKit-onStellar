use soroban_sdk::{Address, Bytes, Env};

/// Emitted when a new call is created
pub fn emit_call_created(
    env: &Env,
    call_id: u64,
    creator: &Address,
    stake_token: &Address,
    stake_amount: i128,
    end_ts: u64,
    token_address: &Address,
    pair_id: &Bytes,
    ipfs_cid: &Bytes,
) {
    env.events().publish(
        ("call_registry", "call_created"),
        (call_id, creator.clone(), stake_token.clone(), stake_amount, end_ts, token_address.clone(), pair_id.clone(), ipfs_cid.clone()),
    );
}

/// Emitted when a staker adds stake to a call
pub fn emit_stake_added(
    env: &Env,
    call_id: u64,
    staker: &Address,
    amount: i128,
    position: u32,
) {
    env.events().publish(
        ("call_registry", "stake_added"),
        (call_id, staker.clone(), amount, position),
    );
}

/// Emitted when a call is resolved with an outcome
pub fn emit_call_resolved(
    env: &Env,
    call_id: u64,
    outcome: u32,
    end_price: i128,
) {
    env.events().publish(
        ("call_registry", "call_resolved"),
        (call_id, outcome, end_price),
    );
}

/// Emitted when a call is settled and winners are determined
pub fn emit_call_settled(
    env: &Env,
    call_id: u64,
    winner_count: u64,
) {
    env.events().publish(
        ("call_registry", "call_settled"),
        (call_id, winner_count),
    );
}

/// Emitted when admin changes
pub fn emit_admin_changed(
    env: &Env,
    old_admin: &Address,
    new_admin: &Address,
) {
    env.events().publish(
        ("call_registry", "admin_changed"),
        (old_admin.clone(), new_admin.clone()),
    );
}

/// Emitted when outcome manager changes
pub fn emit_outcome_manager_changed(
    env: &Env,
    old_manager: &Address,
    new_manager: &Address,
) {
    env.events().publish(
        ("call_registry", "outcome_manager_changed"),
        (old_manager.clone(), new_manager.clone()),
    );
}
