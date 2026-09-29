// SPDX-License-Identifier: Apache-2.0
use soroban_sdk::{contractimport, Env, Symbol, Vec, contracttype, contractimpl, map, token, Address, Bytes, contracterror, IntoVal, String, try_invariant, Val, contractmetadata, contractmethod, contractevent, contractstorage, contractstate, contracttype, contractimpl, contractmethod, contractstorage, contractstate, contracttype, contractimpl, contractmethod, contractstorage, contractstate};

mod pause;

use pause::{PauseFlags, ContractError};

#[contractimport]
pub mod call_registry {
    pub fn when_not_paused(env: Env, flag: PauseFlags);
}

#[contractmetadata]
pub struct Metadata;

impl Metadata {
    pub fn metadata() -> Vec<Symbol> {
        vec![
            Symbol::new(&env, "name"),
            Symbol::new(&env, "BACKit Governance"),
            Symbol::new(&env, "description"),
            Symbol::new(&env, "Granular circuit breaker governance contract"),
            Symbol::new(&env, "version"),
            Symbol::new(&env, "1.0.0"),
        ]
    }
}