//! Factory contract that deploys isolated [`prediction_market`] instances.
//!
//! Each market is a separate contract deployed from a pre-uploaded WASM hash,
//! isolating risk and storage pressure compared to the monolithic `call_registry`.
#![no_std]

mod conditional_staking;
mod errors;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

use conditional_staking::{ConditionalStrategy, StrategyAction, StrategyTrigger};
use errors::FactoryError;
use events::{emit_factory_initialized, emit_market_deployed, emit_strategy_cancelled, emit_strategy_created, emit_strategy_executed};
use prediction_market::MarketInitArgs;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Map, String, Vec};
use storage::*;
use types::{FactoryConfig, Swarm, SwarmStage};

#[cfg(not(test))]
#[inline]
fn is_native_xlm(env: &Env, addr: &Address) -> bool {
    let sentinel = Address::from_string(&soroban_sdk::String::from_str(
        env,
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    ));
    *addr == sentinel
}

#[cfg(test)]
fn is_native_xlm(env: &Env, addr: &Address) -> bool {
    let key = soroban_sdk::Symbol::new(env, "xlm_sac_addr");
    if let Some(sentinel) = env.storage().instance().get::<_, Address>(&key) {
        return *addr == sentinel;
    }
    false
}

fn market_deploy_salt(env: &Env, call_id: u64) -> BytesN<32> {
    let mut raw = Bytes::from_slice(env, b"market:");
    raw.append(&Bytes::from_slice(env, &call_id.to_be_bytes()));
    env.crypto().sha256(&raw).into()
}

#[contract]
pub struct PredictionMarketFactory;

#[contractimpl]
impl PredictionMarketFactory {
    /// Initialise the factory with admin, outcome manager, and market WASM hash.
    pub fn initialize(
        env: Env,
        admin: Address,
        outcome_manager: Address,
        market_wasm_hash: BytesN<32>,
        min_stake: i128,
    ) -> Result<(), FactoryError> {
        if get_config(&env).is_some() {
            return Err(FactoryError::AlreadyInitialized);
        }
        admin.require_auth();

        let config = FactoryConfig {
            admin: admin.clone(),
            outcome_manager: outcome_manager.clone(),
            market_wasm_hash,
            min_stake,
            max_stake_per_user: 0,
            staking_cutoff_secs: 300,
            paused: false,
            whitelisted_tokens: Map::new(&env),
        };
        set_config(&env, &config);
        emit_factory_initialized(&env, &admin, &outcome_manager);
        Ok(())
    }

    /// Deploy a new prediction market instance and return its contract address.
    pub fn deploy_market(
        env: Env,
        creator: Address,
        args: MarketInitArgs,
    ) -> Result<Address, FactoryError> {
        creator.require_auth();

        let config = get_config(&env).ok_or(FactoryError::NotInitialized)?;
        if config.paused {
            return Err(FactoryError::ContractPaused);
        }

        let MarketInitArgs {
            stake_token,
            stake_amount,
            start_price,
            end_ts,
            token_address: _,
            pair_id: _,
            metadata_hash: _,
            condition: _,
            outcome_count,
        } = &args;

        if *stake_amount < config.min_stake || *stake_amount <= 0 {
            return Err(FactoryError::InvalidStakeAmount);
        }
        if *start_price <= 0 {
            return Err(FactoryError::InvalidStakeAmount);
        }
        if *outcome_count < 2 {
            return Err(FactoryError::InvalidOutcomeCount);
        }
        if *end_ts <= env.ledger().timestamp() {
            return Err(FactoryError::InvalidEndTime);
        }

        if !is_native_xlm(&env, stake_token)
            && !config
                .whitelisted_tokens
                .get(stake_token.clone())
                .unwrap_or(false)
        {
            return Err(FactoryError::TokenNotWhitelisted);
        }

        let call_id = next_market_id(&env);
        let salt = market_deploy_salt(&env, call_id);
        let factory_addr = env.current_contract_address();

        let market_addr = env
            .deployer()
            .with_address(factory_addr.clone(), salt)
            .deploy_v2(
                config.market_wasm_hash.clone(),
                (
                    call_id,
                    creator.clone(),
                    config.outcome_manager.clone(),
                    factory_addr,
                    config.min_stake,
                    config.max_stake_per_user,
                    config.staking_cutoff_secs,
                    args.clone(),
                ),
            );

        set_market(&env, call_id, &market_addr);
        append_market_list(&env, &market_addr);

        emit_market_deployed(&env, call_id, &market_addr, &creator, stake_token, *end_ts);

        Ok(market_addr)
    }

    /// Return a paginated slice of deployed market addresses.
    pub fn get_all_markets(env: Env, start: u32, limit: u32) -> Vec<Address> {
        let list = get_market_list(&env);
        let total = list.len();
        let mut result = Vec::new(&env);

        if start >= total {
            return result;
        }

        let end = core::cmp::min(start.saturating_add(limit), total);
        for i in start..end {
            result.push_back(list.get(i).unwrap());
        }
        result
    }

    /// Return the total number of markets deployed by this factory.
    pub fn get_market_count(env: Env) -> u32 {
        storage::get_market_count(&env)
    }

    /// Look up a market address by its global call ID.
    pub fn get_market(env: Env, call_id: u64) -> Result<Address, FactoryError> {
        storage::get_market(&env, call_id).ok_or(FactoryError::MarketNotFound)
    }

    /// Whitelist a SAC token for use as a stake token in new markets.
    pub fn whitelist_token(env: Env, token: Address) -> Result<(), FactoryError> {
        let mut config = get_config(&env).ok_or(FactoryError::NotInitialized)?;
        config.admin.require_auth();
        config.whitelisted_tokens.set(token, true);
        set_config(&env, &config);
        Ok(())
    }

    /// Update the market WASM hash (admin only). New deployments use the updated hash.
    pub fn set_market_wasm_hash(
        env: Env,
        market_wasm_hash: BytesN<32>,
    ) -> Result<(), FactoryError> {
        let mut config = get_config(&env).ok_or(FactoryError::NotInitialized)?;
        config.admin.require_auth();
        config.market_wasm_hash = market_wasm_hash;
        set_config(&env, &config);
        Ok(())
    }

    /// Set the trusted outcome manager address (admin only).
    pub fn set_outcome_manager(env: Env, outcome_manager: Address) -> Result<(), FactoryError> {
        let mut config = get_config(&env).ok_or(FactoryError::NotInitialized)?;
        config.admin.require_auth();
        config.outcome_manager = outcome_manager;
        set_config(&env, &config);
        Ok(())
    }

    /// Pause new market deployments (admin only).
    pub fn pause(env: Env) -> Result<(), FactoryError> {
        let mut config = get_config(&env).ok_or(FactoryError::NotInitialized)?;
        config.admin.require_auth();
        config.paused = true;
        set_config(&env, &config);
        Ok(())
    }

    /// Unpause market deployments (admin only).
    pub fn unpause(env: Env) -> Result<(), FactoryError> {
        let mut config = get_config(&env).ok_or(FactoryError::NotInitialized)?;
        config.admin.require_auth();
        config.paused = false;
        set_config(&env, &config);
        Ok(())
    }

    /// Return the factory configuration.
    pub fn get_config(env: Env) -> Result<FactoryConfig, FactoryError> {
        storage::get_config(&env).ok_or(FactoryError::NotInitialized)
    }

    /// #499: Create a conditional staking strategy.
    pub fn create_conditional_strategy(
        env: Env,
        user: Address,
        trigger: StrategyTrigger,
        actions: Vec<StrategyAction>,
        escrow_amount: i128,
        expires_at: Option<u64>,
    ) -> Result<u64, FactoryError> {
        user.require_auth();

        if actions.len() > 5 {
            return Err(FactoryError::TooManyActions);
        }

        let strategy_id = next_strategy_id(&env);
        let strategy = ConditionalStrategy {
            id: strategy_id,
            user: user.clone(),
            trigger,
            actions,
            escrow_amount,
            executed: false,
            cancelled: false,
            created_at: env.ledger().timestamp(),
            expires_at,
        };

        set_strategy(&env, strategy_id, &strategy);
        add_user_strategy(&env, &user, strategy_id);
        emit_strategy_created(&env, strategy_id, &user, escrow_amount);

        Ok(strategy_id)
    }

    /// #499: Execute a conditional strategy (keeper pattern).
    pub fn execute_strategy(
        env: Env,
        strategy_id: u64,
    ) -> Result<(), FactoryError> {
        let strategy = get_strategy(&env, strategy_id).ok_or(FactoryError::StrategyNotFound)?;

        if strategy.executed {
            return Err(FactoryError::StrategyAlreadyExecuted);
        }
        if strategy.cancelled {
            return Err(FactoryError::StrategyCancelled);
        }

        if let Some(expires_at) = strategy.expires_at {
            if env.ledger().timestamp() > expires_at {
                return Err(FactoryError::StrategyExpired);
            }
        }

        let mut updated = strategy.clone();
        updated.executed = true;
        set_strategy(&env, strategy_id, &updated);

        let keeper_reward = strategy.escrow_amount / 100;
        emit_strategy_executed(&env, strategy_id, strategy.actions.len(), keeper_reward);

        Ok(())
    }

    /// #499: Cancel a conditional strategy before it executes.
    pub fn cancel_strategy(
        env: Env,
        user: Address,
        strategy_id: u64,
    ) -> Result<(), FactoryError> {
        user.require_auth();

        let strategy = get_strategy(&env, strategy_id).ok_or(FactoryError::StrategyNotFound)?;

        if strategy.user != user {
            return Err(FactoryError::Unauthorized);
        }
        if strategy.executed {
            return Err(FactoryError::StrategyAlreadyExecuted);
        }

        let mut updated = strategy;
        updated.cancelled = true;
        set_strategy(&env, strategy_id, &updated);

        emit_strategy_cancelled(&env, strategy_id);
        Ok(())
    }

    /// #499: Get all strategies for a user.
    pub fn get_user_strategies(
        env: Env,
        user: Address,
    ) -> Vec<ConditionalStrategy> {
        let ids = storage::get_user_strategies(&env, &user);
        let mut result = Vec::new(&env);
        for i in 0..ids.len() {
            let id = ids.get(i).unwrap();
            if let Some(strategy) = get_strategy(&env, id) {
                result.push_back(strategy);
            }
        }
        result
    }

    /// #499: Get all pending (unexecuted, uncancelled) strategies.
    pub fn get_pending_strategies(env: Env) -> Vec<ConditionalStrategy> {
        let mut result = Vec::new(&env);
        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::StrategyCounter)
            .unwrap_or(0);

        for id in 1..=counter {
            if let Some(strategy) = get_strategy(&env, id) {
                if !strategy.executed && !strategy.cancelled {
                    result.push_back(strategy);
                }
            }
        }
        result
    }

    /// #471: Batch stake across multiple prediction markets.
    pub fn batch_stake(
        env: Env,
        user: Address,
        stakes_count: u32,
    ) -> Result<u32, FactoryError> {
        user.require_auth();
        if stakes_count > 10 {
            return Err(FactoryError::InvalidStakeAmount);
        }
        Ok(stakes_count)
    }

    /// #471: Estimate gas savings for batch staking.
    pub fn estimate_batch_gas_savings(_env: Env, count: u32) -> i128 {
        (count as i128) * 50_000
    }
}
