//! Governance contract with treasury module

#![no_std]

use soroban_sdk::{contract, contractimpl, symbol, vec, Address, Env, Symbol, Vec};

mod treasury;
mod storage;

pub use treasury::{FeeSplit, distribute_fees, update_split_ratios, Error};

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn distribute(e: Env, amount: u128) -> Result<(), Error> {
        treasury::distribute_fees(&e, amount)
    }

    pub fn update_ratios(e: Env, caller: Address, new_ratios: FeeSplit) -> Result<(), Error> {
        treasury::update_split_ratios(&e, caller, new_ratios)
    }
}

#[cfg(test)]
mod tests;
