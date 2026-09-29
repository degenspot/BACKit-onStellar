// SPDX-License-Identifier: MIT
use soroban_sdk::{contractimport, Address, Env, Symbol, Vec};

const TIMELOCK_DURATION: u64 = 48 * 60 * 60; // 48 hours in seconds

#[contractimport(file = "../storage.rs")]
mod storage {
    use soroban_sdk::{Address, Env, Vec};
    
    pub fn get_withdrawal_proposal(env: &Env, proposal_id: u64) -> Option<(Address, u64, Address, u64)>;
    pub fn set_withdrawal_proposal(env: &Env, proposal_id: u64, token: Address, amount: u64, recipient: Address, timestamp: u64);
    pub fn remove_withdrawal_proposal(env: &Env, proposal_id: u64);
    pub fn get_next_proposal_id(env: &Env) -> u64;
    pub fn increment_next_proposal_id(env: &Env);
    pub fn is_admin(env: &Env, address: Address) -> bool;
}

pub fn propose_withdrawal(env: Env, token: Address, amount: u64, recipient: Address) -> u64 {
    let admin = storage::is_admin(&env, env.current_contract_address());
    if !admin {
        panic!("Only admin can propose withdrawals");
    }
    
    let proposal_id = storage::get_next_proposal_id(&env);
    let timestamp = env.ledger().timestamp();
    
    storage::set_withdrawal_proposal(&env, proposal_id, token.clone(), amount, recipient.clone(), timestamp);
    storage::increment_next_proposal_id(&env);
    
    env.events().publish(
        (Symbol::new(&env, "WithdrawalProposed"), proposal_id),
        (token, amount, recipient, timestamp)
    );
    
    proposal_id
}

pub fn execute_withdrawal(env: Env, proposal_id: u64) {
    let (token, amount, recipient, timestamp) = storage::get_withdrawal_proposal(&env, proposal_id)
        .expect("Proposal not found");
    
    let current_time = env.ledger().timestamp();
    if current_time < timestamp + TIMELOCK_DURATION {
        panic!("Timelock not expired");
    }
    
    // Transfer logic would go here (pseudo-implementation)
    // In real implementation, use Soroban token contract
    
    storage::remove_withdrawal_proposal(&env, proposal_id);
    
    env.events().publish(
        (Symbol::new(&env, "WithdrawalExecuted"), proposal_id),
        (token, amount, recipient)
    );
}

pub fn cancel_withdrawal(env: Env, proposal_id: u64) {
    let admin = storage::is_admin(&env, env.current_contract_address());
    if !admin {
        panic!("Only admin can cancel withdrawals");
    }
    
    let (_, _, _, timestamp) = storage::get_withdrawal_proposal(&env, proposal_id)
        .expect("Proposal not found");
    
    let current_time = env.ledger().timestamp();
    if current_time > timestamp + TIMELOCK_DURATION {
        panic!("Cannot cancel after timelock expires");
    }
    
    storage::remove_withdrawal_proposal(&env, proposal_id);
}