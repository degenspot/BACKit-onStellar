// SPDX-License-Identifier: Apache-2.0
// This file is part of the BACKit-onStellar project.

#![no_std]

use soroban_sdk::{contract, contractimpl, symbol, vec, Env, Symbol, Vec};
use soroban_sdk::storage::{Instance, Persistent};

const LEDGERS_PER_YEAR: u32 = 6_300_000;

#[contract]
pub struct CallRegistryContract;

#[contractimpl]
impl CallRegistryContract {
    /// Initializes the contract storage
    pub fn initialize(env: Env) {
        // Bump instance TTL to LEDGERS_PER_YEAR
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
    }

    /// Records a new call with automatic TTL management
    pub fn record_call(env: Env, caller: Symbol, callee: Symbol, data: Vec<u8>) {
        let key = (caller, callee);
        // Bump instance TTL
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        // Store call data with extended TTL
        env.storage().persistent().set(&key, &data);
        env.storage().persistent().extend_ttl(&key, LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
    }

    /// Retrieves call data and extends TTL
    pub fn get_call(env: Env, caller: Symbol, callee: Symbol) -> Option<Vec<u8>> {
        let key = (caller, callee);
        // Bump instance TTL
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        
        if let Some(data) = env.storage().persistent().get(&key) {
            // Extend TTL on read
            env.storage().persistent().extend_ttl(&key, LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
            Some(data)
        } else {
            None
        }
    }

    /// Cleans up temporary storage entries
    pub fn cleanup_temporary(env: Env, temp_key: Symbol) {
        env.storage().instance().extend_ttl(LEDGERS_PER_YEAR, LEDGERS_PER_YEAR);
        env.storage().temporary().remove(&temp_key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn test_ttl_management() {
        let env = Env::default();
        let contract_id = Address::generate(&env);
        env.register_contract(&contract_id, CallRegistryContract);

        let client = CallRegistryContractClient::new(&env, &contract_id);
        
        // Initialize should set instance TTL
        client.initialize(&env);
        
        // Record call should extend TTL
        let caller = symbol!("caller");
        let callee = symbol!("callee");
        let data = vec![&env, 1, 2, 3];
        client.record_call(&env, &caller, &callee, &data);
        
        // Get call should extend TTL on read
        let retrieved = client.get_call(&env, &caller, &callee);
        assert!(retrieved.is_some());
        
        // Cleanup temporary should remove entry
        let temp_key = symbol!("temp");
        env.storage().temporary().set(&temp_key, &vec![&env]);
        client.cleanup_temporary(&env, &temp_key);
        assert!(env.storage().temporary().get(&temp_key).is_none());
    }
}
