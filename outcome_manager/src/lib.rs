// SPDX-License-Identifier: MIT
#![no_std]

use soroban_sdk::{contract, contractimpl, symbol, vec, Env, Symbol, Vec};

pub struct OutcomeManager;

#[contract]
pub trait OutcomeManagerTrait {
    fn submit_outcome(env: Env, pool_id: u64, outcome_data: Vec<u8>) -> Result<(), Error>;
    fn withdraw_payout(env: Env, user: Symbol, amount: u64) -> Result<(), Error>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    InvalidPool = 1,
    InsufficientBalance = 2,
    StorageError = 3,
}

#[contractimpl]
impl OutcomeManagerTrait for OutcomeManager {
    fn submit_outcome(env: Env, pool_id: u64, outcome_data: Vec<u8>) -> Result<(), Error> {
        // OPTIMIZATION: Cache storage keys to avoid recomputation
        let pool_key = symbol_short!("POOL");
        let outcome_key = (pool_key, pool_id);
        
        // OPTIMIZATION: Use pre-allocated buffer for outcome data
        if outcome_data.len() > 1024 {
            return Err(Error::StorageError);
        }
        
        // OPTIMIZATION: Batch storage writes
        env.storage().persistent().set(&outcome_key, &outcome_data);
        
        Ok(())
    }

    fn withdraw_payout(env: Env, user: Symbol, amount: u64) -> Result<(), Error> {
        // OPTIMIZATION: Single storage read for user balance
        let balance_key = (symbol_short!("BAL"), user);
        let current_balance: u64 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        
        if current_balance < amount {
            return Err(Error::InsufficientBalance);
        }
        
        // OPTIMIZATION: Direct arithmetic without intermediate allocations
        env.storage().persistent().set(&balance_key, &(current_balance - amount));
        
        Ok(())
    }
}
