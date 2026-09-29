// SPDX-License-Identifier: Apache-2.0
use soroban_sdk::{contractimport, Env, Symbol, Vec, contracttype, contractimpl, map, token, Address, Bytes, contracterror, IntoVal, String, try_invariant, Val, contractmetadata, contractmethod, contractevent, contractstorage, contractstate, contracttype, contractimpl, contractmethod, contractstorage, contractstate};

#[contractimport]
pub mod governance {
    pub enum PauseFlags {
        PAUSE_CREATION,
        PAUSE_STAKING,
        PAUSE_SETTLEMENT,
        PAUSE_ALL,
    }
    
    pub fn is_paused(env: Env, flag: PauseFlags) -> bool;
}

#[contractmethod]
pub fn when_not_paused(env: Env, flag: PauseFlags) {
    if governance::is_paused(&env, flag) {
        env.bail("Operation is paused");
    }
}

#[contractmethod]
pub fn when_withdrawal(env: Env) {
    // Withdrawals are always allowed
}