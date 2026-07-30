#![allow(deprecated)]
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{Address, Bytes, BytesN, Env};

pub fn emit_market_initialized(
    env: &Env,
    call_id: u64,
    creator: &Address,
    stake_token: &Address,
    end_ts: u64,
) {
    env.events().publish(
        ("prediction_market", "initialized"),
        (call_id, creator.clone(), stake_token.clone(), end_ts),
    );
}

pub fn emit_stake_added(env: &Env, call_id: u64, staker: &Address, amount: i128, position: u32) {
    env.events().publish(
        ("prediction_market", "stake_added"),
        (call_id, staker.clone(), amount, position),
    );
}

pub fn emit_call_resolved(env: &Env, call_id: u64, outcome: u32, end_price: i128) {
    env.events().publish(
        ("prediction_market", "resolved"),
        (call_id, outcome, end_price),
    );
}

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
    metadata_hash: &BytesN<32>,
    outcome_count: u32,
) {
    env.events().publish(
        ("prediction_market", "created"),
        (
            call_id,
            creator.clone(),
            stake_token.clone(),
            stake_amount,
            start_price,
            end_ts,
            token_address.clone(),
            pair_id.clone(),
            metadata_hash.clone(),
            outcome_count,
        ),
    );
}

pub fn emit_reserve_verification(
    env: &Env,
    call_id: u64,
    balance_on_chain: i128,
    total_staked: i128,
    is_fully_reserved: bool,
) {
    env.events().publish(
        ("prediction_market", "reserve_verification"),
        (call_id, balance_on_chain, total_staked, is_fully_reserved),
    );
}

pub fn emit_reserve_discrepancy(env: &Env, call_id: u64, discrepancy: i128) {
    env.events().publish(
        ("prediction_market", "reserve_discrepancy"),
        (call_id, discrepancy),
    );
}

pub fn emit_early_staker_bonus(
    env: &Env,
    call_id: u64,
    staker: &Address,
    bonus: i128,
) {
    env.events().publish(
        ("prediction_market", "early_staker_bonus"),
        (call_id, staker.clone(), bonus),
    );
}

/// #465: A limit order was created and its tokens escrowed.
pub fn emit_limit_order_created(
    env: &Env,
    order_id: u64,
    call_id: u64,
    user: &Address,
    outcome: u32,
    amount: i128,
    target_probability_bps: u32,
    expires_at: u64,
) {
    env.events().publish(
        ("prediction_market", "limit_order_created"),
        (
            order_id,
            call_id,
            user.clone(),
            outcome,
            amount,
            target_probability_bps,
            expires_at,
        ),
    );
}

/// #465: `LimitOrderFilled(order_id, call_id, user, outcome, amount, filled_price)`
/// per the issue's specified event shape. `filled_price` is the implied
/// probability (bps) of the position at the moment the order filled.
pub fn emit_limit_order_filled(
    env: &Env,
    order_id: u64,
    call_id: u64,
    user: &Address,
    outcome: u32,
    amount: i128,
    filled_price: u32,
) {
    env.events().publish(
        ("prediction_market", "limit_order_filled"),
        (order_id, call_id, user.clone(), outcome, amount, filled_price),
    );
}

/// #465: A limit order was cancelled by its owner and its escrow refunded.
pub fn emit_limit_order_cancelled(
    env: &Env,
    order_id: u64,
    call_id: u64,
    user: &Address,
    refunded_amount: i128,
) {
    env.events().publish(
        ("prediction_market", "limit_order_cancelled"),
        (order_id, call_id, user.clone(), refunded_amount),
    );
}

/// #465: An expired limit order was force-refunded by `caller`, who
/// received `reward_amount` and the order's owner received `refunded_amount`.
pub fn emit_limit_order_expired_refunded(
    env: &Env,
    order_id: u64,
    call_id: u64,
    user: &Address,
    refunded_amount: i128,
    reward_amount: i128,
    caller: &Address,
) {
    env.events().publish(
        ("prediction_market", "limit_order_expired_refunded"),
        (
            order_id,
            call_id,
            user.clone(),
            refunded_amount,
            reward_amount,
            caller.clone(),
        ),
    );
}
