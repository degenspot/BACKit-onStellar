#![no_std]

use soroban_sdk::{contract, contractimpl, token, Address, Bytes, Env, Map, Vec};

mod admin;
mod errors;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

use backit_shared::{is_valid_outcome, OUTCOME_DOWN, OUTCOME_UP};
use errors::CallRegistryError;
use events::*;
use storage::*;
use types::*;

const MAX_CALL_PAGE_SIZE: u32 = 20;

/// CallRegistry contract implementation.
/// Manages prediction calls and staking on market outcomes.
#[contract]
pub struct CallRegistry;

fn evaluate_condition_impl(condition: &ConditionType, start_price: i128, end_price: i128) -> bool {
    match condition {
        ConditionType::TargetAbove(target) => end_price > *target,
        ConditionType::TargetBelow(target) => end_price < *target,
        ConditionType::PercentUp(percent) => {
            if start_price <= 0 {
                return false;
            }
            end_price * 100 >= start_price * (100 + *percent as i128)
        }
        ConditionType::PercentDown(percent) => {
            if start_price <= 0 {
                return false;
            }
            end_price * 100 <= start_price * (100 - *percent as i128)
        }
        ConditionType::Range(min, max) => {
            if min > max {
                return false;
            }
            end_price >= *min && end_price <= *max
        }
    }
}

#[contractimpl]
impl CallRegistry {
    /// Initialise the contract with an admin and an outcome manager.
    /// # Errors
    /// * [`CallRegistryError::AlreadyInitialized`] – called more than once.
    pub fn initialize(
        env: Env,
        admin: Address,
        outcome_manager: Address,
        min_stake: i128,
    ) -> Result<(), CallRegistryError> {
        if get_config(&env).is_some() {
            return Err(CallRegistryError::AlreadyInitialized);
        }

        admin.require_auth();

        let config = ContractConfig {
            admin: admin.clone(),
            outcome_manager: outcome_manager.clone(),
            fee_bps: 0,
            max_stake_per_user: 0,
            whitelisted_tokens: Map::new(&env),
            min_stake,
            metadata_version: 0,
        };

        set_config(&env, &config);
        extend_storage_ttl(&env);

        env.events()
            .publish(("call_registry", "initialized"), (admin, outcome_manager));

        Ok(())
    }

    /// Create a new prediction call.
    /// # Errors
    /// * [`CallRegistryError::InvalidStakeAmount`] – `stake_amount` ≤ 0.
    /// * [`CallRegistryError::InvalidEndTime`] – `end_ts` is not in the future.
    pub fn create_call(
        env: Env,
        creator: Address,
        stake_token: Address,
        stake_amount: i128,
        end_ts: u64,
        token_address: Address,
        pair_id: Bytes,
        ipfs_cid: Bytes,
        condition: ConditionType,
    ) -> Result<Call, CallRegistryError> {
        creator.require_auth();

        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        if stake_amount < config.min_stake || stake_amount <= 0 {
            return Err(CallRegistryError::InvalidStakeAmount);
        }

        let current_timestamp = env.ledger().timestamp();
        if end_ts <= current_timestamp {
            return Err(CallRegistryError::InvalidEndTime);
        }

        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        if !config
            .whitelisted_tokens
            .get(stake_token.clone())
            .unwrap_or(false)
        {
            panic!("stake token not whitelisted");
        }
        let call_id = next_call_id(&env);

        let call = Call {
            id: call_id,
            creator: creator.clone(),
            stake_token: stake_token.clone(),
            stake_amount,
            end_ts,
            token_address: token_address.clone(),
            pair_id: pair_id.clone(),
            ipfs_cid: ipfs_cid.clone(),
            total_up_stake: 0,
            total_down_stake: 0,
            up_stakes: soroban_sdk::Map::new(&env),
            down_stakes: soroban_sdk::Map::new(&env),
            outcome: 0,
            start_price: 0,
            end_price: 0,
            condition,
            settled: false,
            created_at: current_timestamp,
            cancelled: false,
            metadata_version: 0,
        };

        set_call(&env, &call);
        record_call_created(&env);
        extend_storage_ttl(&env);

        emit_call_created(
            &env,
            call_id,
            &creator,
            &stake_token,
            stake_amount,
            end_ts,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        Ok(call)
    }

    pub fn update_call_metadata(
        env: Env,
        creator: Address,
        call_id: u64,
        new_ipfs_cid: Bytes,
    ) -> Result<(), CallRegistryError> {
        creator.require_auth();
        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        if call.creator != creator {
            panic!("not the call creator");
        }
        if call.settled || call.cancelled {
            panic!("call is ended or cancelled");
        }
        let current_ts = env.ledger().timestamp();
        if current_ts >= call.end_ts {
            panic!("call has expired");
        }

        let old_cid = call.ipfs_cid.clone();
        call.ipfs_cid = new_ipfs_cid.clone();
        call.metadata_version += 1;

        set_call(&env, &call);
        emit_call_metadata_updated(
            &env,
            call_id,
            &creator,
            &old_cid,
            &new_ipfs_cid,
            call.metadata_version,
        );
        Ok(())
    }
    /// Extend the TTL of a specific call's persistent storage entry.
    /// Anyone may call this to prevent an active call from being archived.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn extend_call_ttl(env: Env, call_id: u64) -> Result<(), CallRegistryError> {
        let key = storage::DataKey::Call(call_id);
        if !env.storage().persistent().has(&key) {
            return Err(CallRegistryError::CallNotFound);
        }
        env.storage().persistent().extend_ttl(
            &key,
            storage::PERSISTENT_LIFETIME_THRESHOLD,
            storage::PERSISTENT_BUMP_AMOUNT,
        );
        Ok(())
    }

    pub fn whitelist_token(env: Env, token_address: Address) {
        admin::whitelist_token(env, token_address);
    }

    pub fn remove_token(env: Env, token_address: Address) {
        admin::remove_token(env, token_address);
    }

    pub fn is_token_whitelisted(env: Env, token_address: Address) -> bool {
        let config = get_config(&env).expect("not initialized");
        config
            .whitelisted_tokens
            .get(token_address)
            .unwrap_or(false)
    }

    /// Add stake to an existing call.
    /// # Errors
    /// * [`CallRegistryError::InvalidStakeAmount`] – `amount` ≤ 0.
    /// * [`CallRegistryError::CallNotFound`]        – `call_id` does not exist.
    /// * [`CallRegistryError::CallEnded`]           – call's `end_ts` has passed.
    /// * [`CallRegistryError::CallSettled`]         – call is already settled.
    /// * [`CallRegistryError::InvalidPosition`]     – `position` ∉ {1, 2}.
    pub fn stake_on_call(
        env: Env,
        staker: Address,
        call_id: u64,
        amount: i128,
        position: u32,
    ) -> Result<Call, CallRegistryError> {
        staker.require_auth();

        if amount <= 0 {
            return Err(CallRegistryError::InvalidStakeAmount);
        }

        let config = get_config(&env).expect("not initialized");
        if amount < config.min_stake {
            panic!("stake below minimum");
        }

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        let current_timestamp = env.ledger().timestamp();
        if current_timestamp >= call.end_ts {
            return Err(CallRegistryError::CallEnded);
        }

        if call.settled {
            return Err(CallRegistryError::CallSettled);
        }

        if call.cancelled {
            panic!("Call has been cancelled");
        }

        let stake_position =
            StakePosition::from_u32(position).ok_or(CallRegistryError::InvalidPosition)?;

        // Per-user stake cap
        let config = get_config(&env).expect("Contract not initialized");
        if config.max_stake_per_user > 0 {
            let existing = match stake_position {
                StakePosition::Up => call.up_stakes.get(staker.clone()).unwrap_or(0),
                StakePosition::Down => call.down_stakes.get(staker.clone()).unwrap_or(0),
            };
            if existing + amount > config.max_stake_per_user {
                panic!("Stake exceeds max_stake_per_user cap");
            }
        }

        let token_client = token::Client::new(&env, &call.stake_token);
        token_client.transfer(&staker, &env.current_contract_address(), &amount);

        match stake_position {
            StakePosition::Up => {
                let current_stake = call.up_stakes.get(staker.clone()).unwrap_or(0);
                call.up_stakes.set(staker.clone(), current_stake + amount);
                call.total_up_stake += amount;
            }
            StakePosition::Down => {
                let current_stake = call.down_stakes.get(staker.clone()).unwrap_or(0);
                call.down_stakes.set(staker.clone(), current_stake + amount);
                call.total_down_stake += amount;
            }
        }

        set_call(&env, &call);
        add_staker_call(&env, &staker, call_id);
        record_stake(&env, &staker, amount);
        extend_storage_ttl(&env);

        emit_stake_added(&env, call_id, &staker, amount, position);

        Ok(call)
    }

    /// Set the maximum individual stake per user per position per call (admin only).
    /// Pass `0` to remove the cap.
    pub fn set_max_stake_per_user(env: Env, new_max: i128) {
        admin::set_max_stake_per_user(env, new_max);
    }

    pub fn set_min_stake(env: Env, new_min_stake: i128) {
        admin::set_min_stake(env, new_min_stake);
    }

    /// Resolve a call with an outcome (outcome_manager only).
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] – contract not initialised.
    /// * [`CallRegistryError::CallNotFound`]   – `call_id` does not exist.
    /// * [`CallRegistryError::InvalidOutcome`] – `outcome` ∉ {1, 2}.
    /// * [`CallRegistryError::CallNotEnded`]   – `end_ts` has not yet passed.
    pub fn resolve_call(
        env: Env,
        call_id: u64,
        outcome: u32,
        end_price: i128,
    ) -> Result<Call, CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        config.outcome_manager.require_auth();

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        if !is_valid_outcome(outcome) {
            return Err(CallRegistryError::InvalidOutcome);
        }

        let current_timestamp = env.ledger().timestamp();
        if current_timestamp < call.end_ts {
            return Err(CallRegistryError::CallNotEnded);
        }

        call.outcome = outcome;
        call.end_price = end_price;

        set_call(&env, &call);
        extend_storage_ttl(&env);

        emit_call_resolved(&env, call_id, outcome, end_price);

        Ok(call)
    }

    /// Mark a call as settled (outcome_manager only).
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] – contract not initialised.
    /// * [`CallRegistryError::CallNotFound`]   – `call_id` does not exist.
    /// * [`CallRegistryError::CallSettled`]     – call is already settled.
    pub fn mark_settled(env: Env, call_id: u64) -> Result<(), CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        config.outcome_manager.require_auth();

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        if call.settled {
            return Err(CallRegistryError::CallSettled);
        }

        call.settled = true;
        set_call(&env, &call);

        Ok(())
    }

    /// Release escrowed tokens to a recipient (outcome_manager only).
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] – contract not initialised.
    /// * [`CallRegistryError::CallNotFound`]   – `call_id` does not exist.
    pub fn release_escrow(
        env: Env,
        call_id: u64,
        to: Address,
        amount: i128,
    ) -> Result<(), CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        config.outcome_manager.require_auth();

        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        let token_client = token::Client::new(&env, &call.stake_token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        Ok(())
    }

    /// Transfer admin privileges to a new address (admin only).
    /// # Errors
    /// Propagates errors from [`admin::set_admin`].
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), CallRegistryError> {
        admin::set_admin(env, new_admin)
    }

    /// Replace the outcome manager (admin only).
    /// # Errors
    /// Propagates errors from [`admin::set_outcome_manager`].
    pub fn set_outcome_manager(env: Env, new_manager: Address) -> Result<(), CallRegistryError> {
        admin::set_outcome_manager(env, new_manager)
    }

    /// Set the protocol fee in basis points, e.g. 100 = 1 % (admin only).
    /// # Errors
    /// Propagates errors from [`admin::set_fee`].
    pub fn set_fee(env: Env, new_fee_bps: u32) -> Result<(), CallRegistryError> {
        admin::set_fee(env, new_fee_bps)
    }

    /// Get current contract configuration.
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] – contract not initialised.
    pub fn get_config(env: Env) -> Result<ContractConfig, CallRegistryError> {
        get_config(&env).ok_or(CallRegistryError::NotInitialized)
    }

    /// Get call data by ID.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn get_call(env: Env, call_id: u64) -> Result<Call, CallRegistryError> {
        get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)
    }

    /// Get the condition type for a specific call.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn get_condition(env: Env, call_id: u64) -> Result<ConditionType, CallRegistryError> {
        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        Ok(call.condition)
    }

    /// Evaluate whether price movement satisfies the supplied condition.
    pub fn evaluate_condition(
        _env: Env,
        condition: ConditionType,
        start_price: i128,
        end_price: i128,
    ) -> bool {
        evaluate_condition_impl(&condition, start_price, end_price)
    }

    /// Get all calls created by a specific address (unbounded scan — prefer paginated variant).
    pub fn get_calls_by_creator(env: Env, creator: Address) -> Vec<Call> {
        let mut calls = Vec::new(&env);
        let total_calls = get_call_counter(&env);

        for i in 1..=total_calls {
            if let Some(call) = get_call(&env, i) {
                if call.creator == creator {
                    calls.push_back(call);
                }
            }
        }

        calls
    }

    /// Get a paginated slice of calls starting at `start_id`.
    /// Returns at most [`MAX_CALL_PAGE_SIZE`] calls.
    pub fn get_calls_paginated(env: Env, start_id: u64, limit: u32) -> Vec<Call> {
        let mut calls = Vec::new(&env);
        let total_calls = get_call_counter(&env);
        let page_size = limit.min(MAX_CALL_PAGE_SIZE);

        if page_size == 0 {
            return calls;
        }

        let mut count = 0;
        let mut current = if start_id < 1 { 1 } else { start_id };

        while count < page_size && current <= total_calls {
            if let Some(call) = get_call(&env, current) {
                calls.push_back(call);
                count += 1;
            }
            current += 1;
        }

        calls
    }

    /// Get a paginated slice of calls created by a specific address.
    /// Returns at most [`MAX_CALL_PAGE_SIZE`] calls starting from `start_id`.
    pub fn get_calls_by_creator_paginated(
        env: Env,
        creator: Address,
        start_id: u64,
        limit: u32,
    ) -> Vec<Call> {
        let mut calls = Vec::new(&env);
        let total_calls = get_call_counter(&env);
        let page_size = limit.min(MAX_CALL_PAGE_SIZE);

        if page_size == 0 {
            return calls;
        }

        let mut count = 0;
        let mut current = if start_id < 1 { 1 } else { start_id };

        while count < page_size && current <= total_calls {
            if let Some(call) = get_call(&env, current) {
                if call.creator == creator {
                    calls.push_back(call);
                    count += 1;
                }
            }
            current += 1;
        }

        calls
    }

    /// Get statistics for a specific call.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn get_call_stats(env: Env, call_id: u64) -> Result<CallStats, CallRegistryError> {
        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        Ok(CallStats {
            total_up_stake: call.total_up_stake,
            total_down_stake: call.total_down_stake,
            total_stakes: call.up_stakes.len() + call.down_stakes.len(),
            up_stake_count: call.up_stakes.len(),
            down_stake_count: call.down_stakes.len(),
        })
    }

    /// Get all calls a staker has participated in.
    pub fn get_staker_calls(env: Env, staker: Address) -> Vec<Call> {
        let call_ids = get_staker_calls(&env, &staker);
        let mut calls = Vec::new(&env);

        for call_id in call_ids.iter() {
            if let Some(call) = get_call(&env, call_id) {
                calls.push_back(call);
            }
        }

        calls
    }

    /// Get the stake amount a staker has on a specific call position.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`]    – `call_id` does not exist.
    /// * [`CallRegistryError::InvalidPosition`] – `position` ∉ {1, 2}.
    pub fn get_staker_stake(
        env: Env,
        call_id: u64,
        staker: Address,
        position: u32,
    ) -> Result<i128, CallRegistryError> {
        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        match position {
            OUTCOME_UP => Ok(call.up_stakes.get(staker).unwrap_or(0)),
            OUTCOME_DOWN => Ok(call.down_stakes.get(staker).unwrap_or(0)),
            _ => Err(CallRegistryError::InvalidPosition),
        }
    }

    /// Get total number of calls created.
    pub fn get_call_count(env: Env) -> u64 {
        get_call_counter(&env)
    }

    /// Get contract-wide aggregated statistics.
    pub fn get_global_stats(env: Env) -> GlobalStats {
        storage::get_global_stats(&env)
    }
}
