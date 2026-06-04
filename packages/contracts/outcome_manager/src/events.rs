use soroban_sdk::{symbol_short, Env};

/// Emitted when a new oracle outcome report is accepted (before quorum)
pub fn emit_outcome_submitted(
    env: &Env,
    call_id: u64,
    oracle: &soroban_sdk::BytesN<32>,
    outcome: u32,
) {
    env.events().publish(
        (symbol_short!("outcome"), symbol_short!("submitted")),
        (call_id, oracle.clone(), outcome),
    );
}

/// Emitted when quorum is reached and the call is finalized
pub fn emit_outcome_finalized(env: &Env, call_id: u64, outcome: u32, price: i128) {
    env.events().publish(
        (symbol_short!("outcome"), symbol_short!("finalized")),
        (call_id, outcome, price),
    );
}

/// Emitted when a winning staker claims their payout
pub fn emit_payout_claimed(env: &Env, call_id: u64, staker: &soroban_sdk::Address, amount: i128) {
    env.events().publish(
        (symbol_short!("payout"), symbol_short!("claimed")),
        (call_id, staker.clone(), amount),
    );
}

/// Emitted when the protocol fee is collected during payout settlement
pub fn emit_fee_collected(
    env: &Env,
    call_id: u64,
    fee_amount: i128,
    fee_collector: &soroban_sdk::Address,
) {
    env.events().publish(
        (symbol_short!("fee"), symbol_short!("collected")),
        (call_id, fee_amount, fee_collector.clone()),
    );
}

/// Emitted once at the start of a batch settlement
pub fn emit_batch_payout_started(env: &Env, call_id: u64, staker_count: u32) {
    env.events().publish(
        (symbol_short!("payout"), symbol_short!("batch")),
        (call_id, staker_count),
    );
}

pub fn emit_outcome_disputed(env: &Env, call_id: u64, new_outcome: u32, new_price: i128) {
    env.events().publish(
        (symbol_short!("outcome"), symbol_short!("disputed")),
        (call_id, new_outcome, new_price),
    );
}

pub fn emit_contract_paused(env: &Env) {
    env.events().publish(
        (symbol_short!("contract"), symbol_short!("paused")),
        (),
    );
}

pub fn emit_contract_unpaused(env: &Env) {
    env.events().publish(
        (symbol_short!("contract"), symbol_short!("unpaused")),
        (),
    );
}

/// Emitted when the contract WASM is upgraded
pub fn emit_contract_upgraded(
    env: &Env,
    old_version: u32,
    new_version: u32,
    admin: &soroban_sdk::Address,
) {
    env.events().publish(
        ("outcome_manager", "contract_upgraded"),
        (old_version, new_version, admin.clone()),
    );
}

/// Emitted when an admin updates a contract configuration parameter
pub fn emit_admin_params_changed(env: &Env, new_max_submission_delay: u64) {
    env.events().publish(
        ("admin", "params_changed"),
        new_max_submission_delay,
    );
}

/// Emitted when an oracle submits a price observation for TWAP
pub fn emit_price_observation_submitted(
    env: &Env,
    call_id: u64,
    oracle: &soroban_sdk::BytesN<32>,
    price: i128,
    timestamp: u64,
) {
    env.events().publish(
        (symbol_short!("twap"), symbol_short!("obs_sub")),
        (call_id, oracle.clone(), price, timestamp),
    );
}
