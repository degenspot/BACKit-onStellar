// SPDX-License-Identifier: MIT
#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};

mod timelock;
mod storage;

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn propose_withdrawal(env: Env, token: Address, amount: u64, recipient: Address) -> u64 {
        timelock::propose_withdrawal(env, token, amount, recipient)
    }
    
    pub fn execute_withdrawal(env: Env, proposal_id: u64) {
        timelock::execute_withdrawal(env, proposal_id)
    }
    
    pub fn cancel_withdrawal(env: Env, proposal_id: u64) {
        timelock::cancel_withdrawal(env, proposal_id)
    }
}

mod tests {
    #![cfg(test)]
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env};
    
    #[test]
    fn test_timelock_enforcement() {
        let env = Env::default();
        let contract_id = env.register_contract(None, GovernanceContract);
        let client = GovernanceContractClient::new(&env, &contract_id);
        
        let token = Address::random(&env);
        let recipient = Address::random(&env);
        let amount = 1000;
        
        let proposal_id = client.propose_withdrawal(&token, &amount, &recipient);
        
        // Should fail if executed before timelock
        let result = std::panic::catch_unwind(|| {
            client.execute_withdrawal(&proposal_id);
        });
        assert!(result.is_err());
    }
}
