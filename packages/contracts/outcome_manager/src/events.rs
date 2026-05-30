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
