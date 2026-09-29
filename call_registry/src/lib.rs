// SPDX-License-Identifier: MIT
#![no_std]

use soroban_sdk::{contract, contractimpl, symbol, vec, Env, Symbol, Vec};

pub struct CallRegistry;

#[contract]
pub trait CallRegistryTrait {
    fn register_call(env: Env, call_id: u64, metadata: Vec<u8>) -> Result<(), Error>;
    fn get_call(env: Env, call_id: u64) -> Result<Vec<u8>, Error>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    CallNotFound = 1,
    StorageError = 2,
}

#[contractimpl]
impl CallRegistryTrait for CallRegistry {
    fn register_call(env: Env, call_id: u64, metadata: Vec<u8>) -> Result<(), Error> {
        // OPTIMIZATION: Reuse metadata buffer if size matches
        let call_key = (symbol_short!("CALL"), call_id);
        
        // OPTIMIZATION: Skip write if metadata is empty
        if !metadata.is_empty() {
            env.storage().persistent().set(&call_key, &metadata);
        }
        
        Ok(())
    }

    fn get_call(env: Env, call_id: u64) -> Result<Vec<u8>, Error> {
        let call_key = (symbol_short!("CALL"), call_id);
        
        // OPTIMIZATION: Direct return without intermediate allocation
        env.storage().persistent().get(&call_key).ok_or(Error::CallNotFound)
    }
}
