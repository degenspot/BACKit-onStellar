// SPDX-License-Identifier: Apache-2.0
// This file is part of the BACKit-onStellar project.

#![no_std]

use soroban_sdk::{contract, contractimpl, symbol, vec, Env, Symbol, Vec};
use soroban_sdk::storage::{Instance, Persistent};

const LEDGERS_PER_YEAR: u32 = 6_300_000;

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    /// Initializes the contract storage
    pub fn initialize(env: Env) {
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
    }

    /// Assigns a role with automatic TTL management
    pub fn assign_role(env: Env, user: Symbol, role: Symbol) {
        let key = (user, role);
        // Bump instance TTL
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        
        // Store role assignment with extended TTL
        env.storage().persistent().set(&key, &vec![&env, 1]);
        env.storage().persistent().extend_ttl(&key, LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
    }

    /// Checks if a user has a role and extends TTL
    pub fn has_role(env: Env, user: Symbol, role: Symbol) -> bool {
        let key = (user, role);
        // Bump instance TTL
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        
        if let Some(_) = env.storage().persistent().get(&key) {
            // Extend TTL on read
            env.storage().persistent().extend_ttl(&key, LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
            true
        } else {
            false
        }
    }

    /// Removes a role and cleans up storage
    pub fn remove_role(env: Env, user: Symbol, role: Symbol) {
        let key = (user, role);
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        env.storage().persistent().remove(&key);
    }

    /// Records a stake with automatic TTL management
    pub fn stake(env: Env, user: Symbol, amount: u64) {
        let key = (user, symbol!("stake"));
        // Bump instance TTL
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        
        // Store stake with extended TTL
        env.storage().persistent().set(&key, &amount);
        env.storage().persistent().extend_ttl(&key, LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
    }

    /// Retrieves stake amount and extends TTL
    pub fn get_stake(env: Env, user: Symbol) -> Option<u64> {
        let key = (user, symbol!("stake"));
        // Bump instance TTL
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        
        env.storage().persistent().get(&key)
            .map(|val| {
                // Extend TTL on read
                env.storage().persistent().extend_ttl(&key, LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
                val
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn test_governance_ttl_management() {
        let env = Env::default();
        let contract_id = Address::generate(&env);
        env.register_contract(&contract_id, GovernanceContract);

        let client = GovernanceContractClient::new(&env, &contract_id);
        
        // Initialize should set instance TTL
        client.initialize(&env);
        
        // Assign role should extend TTL
        let user = symbol!("user1");
        let role = symbol!("admin");
        client.assign_role(&env, &user, &role);
        
        // Has role should extend TTL on read
        assert!(client.has_role(&env, &user, &role));
        
        // Stake should extend TTL
        client.stake(&env, &user, 100);
        
        // Get stake should extend TTL on read
        assert_eq!(client.get_stake(&env, &user), Some(100));
        
        // Remove role should clean up storage
        client.remove_role(&env, &user, &role);
        assert!(!client.has_role(&env, &user, &role));
    }
}
