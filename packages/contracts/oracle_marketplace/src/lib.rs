#![no_std]

mod errors;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use types::{MarketplaceConfig, OracleProvider, OracleRating};

use errors::OracleMarketplaceError;
use events::{emit_oracle_deregistered, emit_oracle_rated, emit_oracle_registered, emit_oracle_selected};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Map, Vec};
use storage::*;

#[contract]
pub struct OracleMarketplace;

#[contractimpl]
impl OracleMarketplace {
    pub fn initialize(
        env: Env,
        admin: Address,
        cooldown_secs: u64,
        default_fee_bps: u32,
    ) -> Result<(), OracleMarketplaceError> {
        if get_config(&env).is_some() {
            return Err(OracleMarketplaceError::AlreadyInitialized);
        }
        admin.require_auth();

        let config = MarketplaceConfig {
            admin,
            cooldown_secs,
            default_fee_bps,
        };
        set_config(&env, &config);
        Ok(())
    }

    pub fn register_oracle(
        env: Env,
        provider: Address,
        pubkey: BytesN<32>,
        fee_bps: u32,
        min_stake: i128,
    ) -> Result<(), OracleMarketplaceError> {
        provider.require_auth();

        if get_oracle(&env, &pubkey).is_some() {
            return Err(OracleMarketplaceError::OracleAlreadyRegistered);
        }
        if fee_bps > 10000 {
            return Err(OracleMarketplaceError::InvalidFee);
        }

        let oracle = OracleProvider {
            pubkey: pubkey.clone(),
            address: provider.clone(),
            fee_bps,
            min_stake,
            staked_amount: min_stake,
            total_resolved: 0,
            total_disputes: 0,
            is_active: true,
            registered_at: env.ledger().timestamp(),
            deregister_after: None,
        };

        set_oracle(&env, &pubkey, &oracle);
        add_to_oracle_list(&env, &pubkey);
        emit_oracle_registered(&env, &provider, &pubkey, fee_bps);

        Ok(())
    }

    pub fn deregister_oracle(
        env: Env,
        provider: Address,
        pubkey: BytesN<32>,
    ) -> Result<(), OracleMarketplaceError> {
        provider.require_auth();
        let config = get_config(&env).ok_or(OracleMarketplaceError::NotInitialized)?;
        let oracle = get_oracle(&env, &pubkey).ok_or(OracleMarketplaceError::OracleNotFound)?;

        if !oracle.is_active {
            return Err(OracleMarketplaceError::OracleNotActive);
        }

        if let Some(deregister_after) = oracle.deregister_after {
            if env.ledger().timestamp() < deregister_after {
                return Err(OracleMarketplaceError::CooldownActive);
            }
        }

        let mut updated = oracle;
        updated.is_active = false;
        updated.deregister_after = Some(env.ledger().timestamp() + config.cooldown_secs);
        set_oracle(&env, &pubkey, &updated);
        remove_from_oracle_list(&env, &pubkey);

        emit_oracle_deregistered(&env, &provider, &pubkey);
        Ok(())
    }

    pub fn get_available_oracles(env: Env) -> Vec<OracleProvider> {
        let list = get_oracle_list(&env);
        let mut result = Vec::new(&env);
        for i in 0..list.len() {
            let pubkey = list.get(i).unwrap();
            if let Some(oracle) = get_oracle(&env, &pubkey) {
                if oracle.is_active {
                    result.push_back(oracle);
                }
            }
        }
        result
    }

    pub fn select_oracle_for_call(
        env: Env,
        call_id: u64,
        oracle_pubkey: BytesN<32>,
    ) -> Result<(), OracleMarketplaceError> {
        let oracle = get_oracle(&env, &oracle_pubkey).ok_or(OracleMarketplaceError::OracleNotFound)?;
        if !oracle.is_active {
            return Err(OracleMarketplaceError::OracleNotActive);
        }

        set_call_oracle(&env, call_id, &oracle_pubkey);
        emit_oracle_selected(&env, call_id, &oracle_pubkey);
        Ok(())
    }

    pub fn get_call_oracle(env: Env, call_id: u64) -> Option<BytesN<32>> {
        get_call_oracle(&env, call_id)
    }

    pub fn rate_oracle(
        env: Env,
        user: Address,
        oracle_pubkey: BytesN<32>,
        satisfied: bool,
    ) -> Result<(), OracleMarketplaceError> {
        user.require_auth();
        let _oracle = get_oracle(&env, &oracle_pubkey).ok_or(OracleMarketplaceError::OracleNotFound)?;

        let mut ratings = get_oracle_ratings(&env, &oracle_pubkey);
        if ratings.contains_key(user.clone()) {
            return Err(OracleMarketplaceError::AlreadyRated);
        }

        ratings.set(user.clone(), satisfied);
        set_oracle_ratings(&env, &oracle_pubkey, &ratings);

        emit_oracle_rated(&env, &oracle_pubkey, &user, satisfied);
        Ok(())
    }

    pub fn get_oracle_metrics(
        env: Env,
        oracle_pubkey: BytesN<32>,
    ) -> Result<(u64, u64), OracleMarketplaceError> {
        let oracle = get_oracle(&env, &oracle_pubkey).ok_or(OracleMarketplaceError::OracleNotFound)?;
        Ok((oracle.total_resolved, oracle.total_disputes))
    }

    pub fn get_config_view(env: Env) -> Result<MarketplaceConfig, OracleMarketplaceError> {
        get_config(&env).ok_or(OracleMarketplaceError::NotInitialized)
    }
}
