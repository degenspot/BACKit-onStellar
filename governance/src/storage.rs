//! Storage utilities for treasury

use soroban_sdk::{contract, contractimpl, symbol, vec, Address, Env, Symbol, Vec};
use crate::treasury::FeeSplit;

pub const SPLIT_RATIOS_KEY: &[u8; 4] = b"SPLT";
pub const ADMIN_KEY: &[u8; 4] = b"ADMN";
pub const SAC_BURN_INTERFACE: TokenClient = TokenClient::new(&Env::default(), &Address::from_string("SAC_BURN_ADDRESS"));

pub fn get_split_ratios(e: &Env) -> Result<FeeSplit, Error> {
    e.storage()
        .get(SPLIT_RATIOS_KEY)
        .ok_or(Error::InvalidSplitRatios)
}

pub fn set_split_ratios(e: &Env, ratios: &FeeSplit) {
    e.storage().set(SPLIT_RATIOS_KEY, ratios);
}

pub fn get_admin(e: &Env) -> Result<Address, Error> {
    e.storage()
        .get(ADMIN_KEY)
        .ok_or(Error::Unauthorized)
}

// Placeholder for TokenClient (actual implementation depends on Soroban SDK)
pub struct TokenClient;

impl TokenClient {
    pub fn new(_e: &Env, _addr: &Address) -> Self {
        Self
    }
    pub fn burn(&self, _e: &Env, _from: &Address, _amount: &u128) -> Result<(), Error> {
        Ok(())
    }
}
