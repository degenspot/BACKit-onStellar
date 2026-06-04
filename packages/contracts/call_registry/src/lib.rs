#![no_std]

use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env, Map, Symbol, Vec};

mod admin;
mod errors;
mod events;
mod storage;
mod types;
#[cfg(test)]
mod test;
#[cfg(test)]
mod fuzz_tests;

use backit_shared::{is_valid_outcome, OUTCOME_DOWN, OUTCOME_UP};
use errors::CallRegistryError;
use events::*;
use storage::*;
use types::*;

const MAX_CALL_PAGE_SIZE: u32 = 20;
pub const CONTRACT_VERSION: u32 = 1;

/// CallRegistry contract implementation.
/// Manages prediction calls and staking on market outcomes.
#[contract]
pub struct CallRegistry;

fn build_start_price_message(env: &Env, call_id: u64, price: i128) -> Bytes {
    let mut raw = Bytes::from_slice(env, b"start_price:");
    raw.append(&Bytes::from_slice(env, &call_id.to_be_bytes()));
    raw.append(&Bytes::from_slice(env, &price.to_be_bytes()));
    raw
}

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
            paused: false,
            staking_cutoff_secs: 300,
        };

        set_config(&env, &config);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &CONTRACT_VERSION);
        // Track the 'version' instance key (Config key tracked inside set_config)
        inc_instance_entry_count(&env, 1);
        extend_storage_ttl(&env);

        env.events()
            .publish(("call_registry", "initialized"), (admin, outcome_manager));

        Ok(())
    }

    /// Create a new prediction call.
    /// # Errors
    /// * [`CallRegistryError::InvalidStakeAmount`] – `stake_amount` ≤ 0.
    /// * [`CallRegistryError::InvalidEndTime`] – `end_ts` is not in the future.
    /// * [`CallRegistryError::InvalidOutcomeCount`] – `outcome_count` < 2.
    pub fn create_call(
        env: Env,
        creator: Address,
        stake_token: Address,
        stake_amount: i128,
        start_price: i128,
        end_ts: u64,
        token_address: Address,
        pair_id: Bytes,
        ipfs_cid: Bytes,
        condition: ConditionType,
        outcome_count: u32,
    ) -> Result<Call, CallRegistryError> {
        creator.require_auth();

        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        assert!(!config.paused, "Contract is paused");
        if stake_amount < config.min_stake || stake_amount <= 0 {
            return Err(CallRegistryError::InvalidStakeAmount);
        }
        if start_price <= 0 {
            return Err(CallRegistryError::InvalidStakeAmount);
        }

        if outcome_count < 2 {
            return Err(CallRegistryError::InvalidOutcomeCount);
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

        let mut outcome_stakes = Map::new(&env);
        let mut stakes = Map::new(&env);

        // Initialize maps for each outcome
        for i in 1..=outcome_count {
            outcome_stakes.set(i, 0);
            stakes.set(i, Map::new(&env));
        }

        let call = Call {
            id: call_id,
            creator: creator.clone(),
            stake_token: stake_token.clone(),
            stake_amount,
            end_ts,
            token_address: token_address.clone(),
            pair_id: pair_id.clone(),
            ipfs_cid: ipfs_cid.clone(),
            outcome_count,
            outcome_stakes,
            stakes,
            outcome: 0,
            start_price,
            end_price: 0,
            condition,
            settled: false,
            voided: false,
            created_at: current_timestamp,
            cancelled: false,
            metadata_version: 0,
        };

        set_call(&env, &call);
        record_call_created(&env);
        
        // Track creator reputation: increment total_created
        let mut creator_stats = get_creator_stats(&env, &creator);
        creator_stats.total_created += 1;
        set_creator_stats(&env, &creator, &creator_stats);
        
        extend_storage_ttl(&env);

        emit_call_created(
            &env,
            call_id,
            &creator,
            &stake_token,
            stake_amount,
            start_price,
            end_ts,
            &token_address,
            &pair_id,
            &ipfs_cid,
            outcome_count,
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
    /// * [`CallRegistryError::InvalidPosition`]     – `position` ∉ [1, outcome_count].
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
        assert!(!config.paused, "Contract is paused");
        if amount < config.min_stake {
            panic!("stake below minimum");
        }

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        let current_timestamp = env.ledger().timestamp();
        if current_timestamp >= call.end_ts {
            return Err(CallRegistryError::CallEnded);
        }

        // Staking cutoff: reject stakes within `staking_cutoff_secs` of end_ts.
        let cutoff = config.staking_cutoff_secs;
        if cutoff > 0 && call.end_ts > cutoff && current_timestamp >= call.end_ts - cutoff {
            return Err(CallRegistryError::StakingCutoffActive);
        }

        if call.settled {
            return Err(CallRegistryError::CallSettled);
        }

        if call.cancelled {
            panic!("Call has been cancelled");
        }

        if call.voided {
            panic!("Call has been voided");
        }

        // Validate position is within valid range
        if position < 1 || position > call.outcome_count {
            return Err(CallRegistryError::InvalidPosition);
        }

        // Per-user stake cap
        let config = get_config(&env).expect("Contract not initialized");
        let current_stake = get_user_stake(&env, call_id, &staker, position);
        if config.max_stake_per_user > 0 && current_stake + amount > config.max_stake_per_user {
            panic!("Stake exceeds max_stake_per_user cap");
        }

        let token_client = token::Client::new(&env, &call.stake_token);
        token_client.transfer(&staker, &env.current_contract_address(), &amount);

        // Update stake maps with generalized position support
        let current_total = call.outcome_stakes.get(position).unwrap_or(0);
        call.outcome_stakes.set(position, current_total + amount);

        let mut outcome_stakers = call.stakes.get(position).unwrap_or_else(|| Map::new(&env));
        let current_staker_stake = outcome_stakers.get(staker.clone()).unwrap_or(0);
        outcome_stakers.set(staker.clone(), current_staker_stake + amount);
        call.stakes.set(position, outcome_stakers);

        add_call_staker(&env, call_id, &staker);
        set_user_stake(&env, call_id, &staker, position, current_staker_stake + amount);

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

    /// Pause the contract (admin only).
    pub fn pause(env: Env) {
        admin::pause(env);
    }

    /// Unpause the contract (admin only).
    pub fn unpause(env: Env) {
        admin::unpause(env);
    }

    /// Set the staking cutoff window in seconds before `end_ts` (admin only).
    /// Staking is blocked when `current_timestamp >= call.end_ts - new_cutoff`.
    /// Pass `0` to disable the cutoff.
    pub fn set_staking_cutoff(env: Env, new_cutoff: u64) {
        admin::set_staking_cutoff(env, new_cutoff);
    }

    /// Resolve a call with an outcome (outcome_manager only).
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] – contract not initialised.
    /// * [`CallRegistryError::CallNotFound`]   – `call_id` does not exist.
    /// * [`CallRegistryError::InvalidOutcome`] – `outcome` ∉ [1, outcome_count].
    /// * [`CallRegistryError::CallNotEnded`]   – `end_ts` has not yet passed.
    pub fn resolve_call(
        env: Env,
        call_id: u64,
        outcome: u32,
        end_price: i128,
    ) -> Result<Call, CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        assert!(!config.paused, "Contract is paused");
        config.outcome_manager.require_auth();

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        // Validate outcome is within valid range
        if outcome < 1 || outcome > call.outcome_count {
            return Err(CallRegistryError::InvalidOutcome);
        }

        let current_timestamp = env.ledger().timestamp();
        if current_timestamp < call.end_ts {
            return Err(CallRegistryError::CallNotEnded);
        }

        if call.voided {
            panic!("Call has been voided");
        }

        call.outcome = outcome;
        call.end_price = end_price;

        // Track creator reputation: increment total_resolved and conditionally total_correct
        let mut creator_stats = get_creator_stats(&env, &call.creator);
        creator_stats.total_resolved += 1;
        
        // Check if creator staked on the winning position
        let creator_winning_stake = match outcome {
            OUTCOME_UP => get_user_stake(&env, call.id, &call.creator, 1),
            OUTCOME_DOWN => get_user_stake(&env, call.id, &call.creator, 2),
            _ => 0,
        };
        
        if creator_winning_stake > 0 {
            creator_stats.total_correct += 1;
        }
        
        set_creator_stats(&env, &call.creator, &creator_stats);

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

        let mut outcome_stake_counts = Map::new(&env);
        let mut total_stakes = 0;

        for i in 1..=call.outcome_count {
            let outcome_stakers = call.stakes.get(i).unwrap_or_else(|| Map::new(&env));
            let count = outcome_stakers.len();
            outcome_stake_counts.set(i, count);
            total_stakes += count;
        }

        Ok(CallStats {
            outcome_stakes: call.outcome_stakes,
            outcome_stake_counts,
            total_stakes,
        })
    }

    /// Get creator reputation statistics
    pub fn get_creator_stats_view(env: Env, creator: Address) -> CreatorStats {
        get_creator_stats(&env, &creator)
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

    /// Get all stakers that have participated in a call.
    pub fn get_call_stakers(env: Env, call_id: u64) -> Result<Vec<Address>, CallRegistryError> {
        get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        Ok(storage::get_call_stakers(&env, call_id))
    }

    /// Get the number of unique stakers that have participated in a call.
    pub fn get_call_staker_count(env: Env, call_id: u64) -> Result<u32, CallRegistryError> {
        get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        Ok(storage::get_call_stakers(&env, call_id).len() as u32)
    }

    /// Get the stake amount a staker has on a specific call position.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`]    – `call_id` does not exist.
    /// * [`CallRegistryError::InvalidPosition`] – `position` ∉ [1, outcome_count].
    pub fn get_staker_stake(
        env: Env,
        call_id: u64,
        staker: Address,
        position: u32,
    ) -> Result<i128, CallRegistryError> {
        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        if position < 1 || position > call.outcome_count {
            return Err(CallRegistryError::InvalidPosition);
        }

        let outcome_stakers = call.stakes.get(position).unwrap_or_else(|| Map::new(&env));
        Ok(outcome_stakers.get(staker).unwrap_or(0))
    }

    /// Get the total stakes for each outcome of a call.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn get_outcome_stakes(env: Env, call_id: u64) -> Result<Map<u32, i128>, CallRegistryError> {
        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        Ok(call.outcome_stakes)
    }

    /// Get total number of calls created.
    pub fn get_call_count(env: Env) -> u64 {
        get_call_counter(&env)
    }

    /// Get contract-wide aggregated statistics.
    pub fn get_global_stats(env: Env) -> GlobalStats {
        storage::get_global_stats(&env)
    }

    /// Set or correct a call's start price using an oracle-signed payload.
    pub fn set_start_price(
        env: Env,
        call_id: u64,
        price: i128,
        oracle_pubkey: BytesN<32>,
        signature: BytesN<64>,
    ) -> Result<Call, CallRegistryError> {
        if price <= 0 {
            return Err(CallRegistryError::InvalidStakeAmount);
        }

        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        config.outcome_manager.require_auth();

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        if call.settled {
            return Err(CallRegistryError::CallSettled);
        }
        if call.cancelled {
            panic!("Call has been cancelled");
        }
        if call.voided {
            panic!("Call has been voided");
        }

        let message = build_start_price_message(&env, call_id, price);
        env.crypto()
            .ed25519_verify(&oracle_pubkey, &message, &signature);

        call.start_price = price;
        set_call(&env, &call);
        extend_storage_ttl(&env);

        Ok(call)
    }

    /// Return the number of entries currently tracked in instance storage.
    pub fn get_instance_entry_count(env: Env) -> u32 {
        storage::get_instance_entry_count(&env)
    }

    /// Return a storage utilisation snapshot.
    /// Emits `StorageWarning` if instance entries exceed the threshold.
    pub fn get_storage_stats(env: Env) -> StorageStats {
        let stats = storage::get_storage_stats(&env);
        if stats.instance_entry_count >= INSTANCE_ENTRY_WARNING_THRESHOLD {
            events::emit_storage_warning(&env, stats.instance_entry_count, stats.estimated_instance_bytes);
        }
        stats
    }

    /// Return the current contract version.
    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "version"))
            .unwrap_or(CONTRACT_VERSION)
    }

    /// Upgrade the contract WASM to a new hash (admin only).
    ///
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] -- contract not initialised.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        config.admin.require_auth();

        let old_version: u32 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "version"))
            .unwrap_or(CONTRACT_VERSION);
        let new_version = old_version + 1;

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &new_version);

        emit_contract_upgraded(&env, old_version, new_version, &config.admin);

        Ok(())
    }

    /// Void a call (admin only). Can be called at any time.
    /// Once voided, no new stakes or resolutions are accepted.
    /// Emits CallVoided.
    pub fn void_call(env: Env, call_id: u64) {
        let config = get_config(&env).expect("Not initialized");
        config.admin.require_auth();

        let mut call = get_call(&env, call_id).expect("Call not found");

        if call.voided {
            panic!("Call already voided");
        }

        if call.settled {
            panic!("Call already settled");
        }

        call.voided = true;
        set_call(&env, &call);
        extend_storage_ttl(&env);

        emit_call_voided(&env, call_id, &config.admin);
    }

    /// Claim a full refund for a voided call.
    /// Refunds the exact stake the caller placed (up + down combined).
    /// Emits VoidRefundClaimed.
    pub fn claim_void_refund(env: Env, staker: Address, call_id: u64) {
        staker.require_auth();

        let call = get_call(&env, call_id).expect("Call not found");

        if !call.voided {
            panic!("Call is not voided");
        }

        if is_void_refund_claimed(&env, call_id, &staker) {
            panic!("Refund already claimed");
        }

        let up_stake = get_user_stake(&env, call_id, &staker, 1);
        let down_stake = get_user_stake(&env, call_id, &staker, 2);
        let total_refund = up_stake + down_stake;

        if total_refund <= 0 {
            panic!("No stake to refund");
        }

        set_void_refund_claimed(&env, call_id, &staker);
        extend_storage_ttl(&env);

        let token_client = token::Client::new(&env, &call.stake_token);
        token_client.transfer(&env.current_contract_address(), &staker, &total_refund);

        emit_void_refund_claimed(&env, call_id, &staker, total_refund);
    }
}