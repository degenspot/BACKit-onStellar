#![allow(deprecated)]

use soroban_sdk::{Address, Env};

pub fn emit_charity_call_created(
    env: &Env,
    call_id: u64,
    creator: &Address,
    charity_address: &Address,
    charity_split_bps: u32,
    stake_amount: i128,
) {
    env.events().publish(
        ("charity_markets", "call_created"),
        (
            call_id,
            creator.clone(),
            charity_address.clone(),
            charity_split_bps,
            stake_amount,
        ),
    );
}

pub fn emit_charity_call_resolved(
    env: &Env,
    call_id: u64,
    final_outcome: u32,
    creator_won: bool,
) {
    env.events().publish(
        ("charity_markets", "resolved"),
        (call_id, final_outcome, creator_won),
    );
}

pub fn emit_charity_donation(
    env: &Env,
    donor: &Address,
    charity: &Address,
    amount: i128,
) {
    env.events().publish(
        ("charity_markets", "donation"),
        (donor.clone(), charity.clone(), amount),
    );
}

pub fn emit_stake_added(
    env: &Env,
    call_id: u64,
    staker: &Address,
    amount: i128,
    outcome: u32,
) {
    env.events().publish(
        ("charity_markets", "stake_added"),
        (call_id, staker.clone(), amount, outcome),
    );
}
