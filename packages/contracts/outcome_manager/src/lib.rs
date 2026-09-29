// SPDX-License-Identifier: Apache-2.0
// This file is part of the BACKit-onStellar project.

#![no_std]

use soroban_sdk::{contract, contractimpl, symbol, vec, Env, Symbol, Vec};
use soroban_sdk::storage::{Instance, Persistent};

const LEDGERS_PER_YEAR: u32 = 6_300_000;

#[contract]
pub struct OutcomeManagerContract;

#[contractimpl]
impl OutcomeManagerContract {
    /// Initializes the contract storage
    pub fn initialize(env: Env) {
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
    }

    /// Records an outcome with automatic TTL management
    pub fn record_outcome(env: Env, market_id: Symbol, outcome_data: Vec<u8>) {
        // Bump instance TTL
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        
        // Store outcome data with extended TTL
        env.storage().persistent().set(&market_id, &outcome_data);
        env.storage().persistent().extend_ttl(&market_id, LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
    }

    /// Retrieves outcome data and extends TTL
    pub fn get_outcome(env: Env, market_id: Symbol) -> Option<Vec<u8>> {
        // Bump instance TTL
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        
        if let Some(data) = env.storage().persistent().get(&market_id) {
            // Extend TTL on read
            env.storage().persistent().extend_ttl(&market_id, LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
            Some(data)
        } else {
            None
        }
    }

    /// Settles a market and cleans up temporary storage
    pub fn settle_market(env: Env, market_id: Symbol, temp_key: Symbol) {
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        
        // Clean up temporary storage
        env.storage().temporary().remove(&temp_key);
        
        // Mark market as settled (persistent storage)
        let settled_key = (market_id, symbol!("settled"));
        env.storage().persistent().set(&settled_key, &vec![&env, 1]);
        env.storage().persistent().extend_ttl(&settled_key, LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn test_outcome_ttl_management() {
        let env = Env::default();
        let contract_id = Address::generate(&env);
        env.register_contract(&contract_id, OutcomeManagerContract);

        let client = OutcomeManagerContractClient::new(&env, &contract_id);
        
        // Initialize should set instance TTL
        client.initialize(&env);
        
        // Record outcome should extend TTL
        let market_id = symbol!("market1");
        let data = vec![&env, 1, 2, 3];
        client.record_outcome(&env, &market_id, &data);
        
        // Get outcome should extend TTL on read
        let retrieved = client.get_outcome(&env, &market_id);
        assert!(retrieved.is_some());
        
        // Settle market should clean up temporary storage
        let temp_key = symbol!("temp");
        env.storage().temporary().set(&temp_key, &vec![&env]);
        client.settle_market(&env, &market_id, &temp_key);
        assert!(env.storage().temporary().get(&temp_key).is_none());
    }
}
