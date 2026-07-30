#![allow(deprecated)]

use soroban_sdk::{Address, Env, String};

pub fn emit_tournament_created(
    env: &Env,
    tournament_id: u64,
    admin: &Address,
    name: &String,
    start_ts: u64,
    end_ts: u64,
    prize_pool: i128,
) {
    env.events().publish(
        ("tournament", "created"),
        (
            tournament_id,
            admin.clone(),
            name.clone(),
            start_ts,
            end_ts,
            prize_pool,
        ),
    );
}

pub fn emit_market_entered(
    env: &Env,
    tournament_id: u64,
    creator: &Address,
    call_id: u64,
) {
    env.events().publish(
        ("tournament", "market_entered"),
        (tournament_id, creator.clone(), call_id),
    );
}

pub fn emit_tournament_finalized(
    env: &Env,
    tournament_id: u64,
    winner: &Address,
    total_prize: i128,
    participant_count: u32,
) {
    env.events().publish(
        ("tournament", "finalized"),
        (
            tournament_id,
            winner.clone(),
            total_prize,
            participant_count,
        ),
    );
}
