#![allow(deprecated)]

use crate::types::DisputeResult;
use soroban_sdk::{Address, BytesN, Env};

pub fn emit_dispute_opened(
    env: &Env,
    dispute_id: u64,
    call_id: u64,
    disputer: &Address,
    original_outcome: u32,
    disputed_outcome: u32,
    bond_amount: i128,
    commit_deadline: u64,
    reveal_deadline: u64,
) {
    env.events().publish(
        ("schelling_oracle", "dispute_opened"),
        (
            dispute_id,
            call_id,
            disputer.clone(),
            original_outcome,
            disputed_outcome,
            bond_amount,
            commit_deadline,
            reveal_deadline,
        ),
    );
}

pub fn emit_vote_committed(
    env: &Env,
    dispute_id: u64,
    voter: &Address,
    commitment_hash: &BytesN<32>,
    stake_amount: i128,
) {
    env.events().publish(
        ("schelling_oracle", "vote_committed"),
        (dispute_id, voter.clone(), commitment_hash.clone(), stake_amount),
    );
}

pub fn emit_vote_revealed(
    env: &Env,
    dispute_id: u64,
    voter: &Address,
    vote_outcome: u32,
    stake_amount: i128,
) {
    env.events().publish(
        ("schelling_oracle", "vote_revealed"),
        (dispute_id, voter.clone(), vote_outcome, stake_amount),
    );
}

pub fn emit_dispute_resolved(
    env: &Env,
    dispute_id: u64,
    result: DisputeResult,
    winning_pool_distributed: i128,
) {
    let result_str = match result {
        DisputeResult::DisputerWon => "disputer_won",
        DisputeResult::DisputerLost => "disputer_lost",
        DisputeResult::Void => "void",
        DisputeResult::Pending => "pending",
    };
    env.events().publish(
        ("schelling_oracle", "dispute_resolved"),
        (
            dispute_id,
            soroban_sdk::Symbol::new(env, result_str),
            winning_pool_distributed,
        ),
    );
}
