#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Bytes, Env, Symbol, Vec as SorobanVec};
use soroban_token_sdk::TokenClient;

mod events;
mod storage;
mod types;

use events::*;
use storage::*;
use types::*;

/// CallRegistry contract implementation
/// Manages prediction calls and staking on market outcomes
#[contract]
pub struct CallRegistry;

#[contractimpl]
impl CallRegistry {
    /// Initialize the contract with admin and outcome manager
    ///
    /// # Arguments
    /// * `admin` - Address with administrative privileges
    /// * `outcome_manager` - Address authorized to submit call outcomes
    ///
    /// # Panics
    /// If the contract has already been initialized
    pub fn initialize(env: Env, admin: Address, outcome_manager: Address) {
        // Check if already initialized
        if let Some(_) = get_config(&env) {
            panic!("Contract already initialized");
        }

        // Validate addresses
        admin.require_auth();

        // Store configuration
        let config = ContractConfig {
            admin: admin.clone(),
            outcome_manager: outcome_manager.clone(),
        };

        set_config(&env, &config);
        extend_storage_ttl(&env);

        env.events().publish(
            ("call_registry", "initialized"),
            (admin, outcome_manager),
        );
    }

    /// Create a new prediction call
    ///
    /// # Arguments
    /// * `creator` - Address creating the call (must authorize)
    /// * `stake_token` - Token address for staking
    /// * `stake_amount` - Minimum stake amount for participants
    /// * `end_ts` - Timestamp when the call ends
    /// * `token_address` - Asset being predicted
    /// * `pair_id` - DexScreener pair ID for price data
    /// * `ipfs_cid` - IPFS content hash for call metadata
    ///
    /// # Returns
    /// The created Call struct
    ///
    /// # Panics
    /// If creator hasn't authorized, stake_amount is invalid, or end_ts is in past
    pub fn create_call(
        env: Env,
        creator: Address,
        stake_token: Address,
        stake_amount: i128,
        end_ts: u64,
        token_address: Address,
        pair_id: Bytes,
        ipfs_cid: Bytes,
    ) -> Call {
        // Require authorization
        creator.require_auth();

        // Validate parameters
        if stake_amount <= 0 {
            panic!("Stake amount must be positive");
        }

        let current_timestamp = env.ledger().timestamp();
        if end_ts <= current_timestamp {
            panic!("End timestamp must be in the future");
        }

        // Get next call ID
        let call_id = next_call_id(&env);

        // Create call instance
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
            outcome: 0, // 0 = unresolved
            start_price: 0,
            end_price: 0,
            settled: false,
            created_at: current_timestamp,
        };

        // Store the call
        set_call(&env, &call);
        extend_storage_ttl(&env);

        // Emit event
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

        call
    }

    /// Add stake to an existing call
    ///
    /// # Arguments
    /// * `staker` - Address adding stake (must authorize)
    /// * `call_id` - ID of the call to stake on
    /// * `amount` - Amount to stake
    /// * `position` - 1 for UP, 2 for DOWN
    ///
    /// # Returns
    /// Updated Call struct
    ///
    /// # Panics
    /// If call doesn't exist, has ended, amount is invalid, or position is invalid
    pub fn stake_on_call(
        env: Env,
        staker: Address,
        call_id: u64,
        amount: i128,
        position: u32,
    ) -> Call {
        // Require authorization
        staker.require_auth();

        // Validate amount
        if amount <= 0 {
            panic!("Stake amount must be positive");
        }

        // Get the call
        let mut call = match get_call(&env, call_id) {
            Some(c) => c,
            None => panic!("Call does not exist"),
        };

        // Check if call has ended
        let current_timestamp = env.ledger().timestamp();
        if current_timestamp >= call.end_ts {
            panic!("Call has ended");
        }

        // Check if call is already settled
        if call.settled {
            panic!("Call has been settled");
        }

        // Validate position
        let stake_position = match StakePosition::from_u32(position) {
            Some(p) => p,
            None => panic!("Invalid position: must be 1 (UP) or 2 (DOWN)"),
        };

        // Transfer tokens from staker to contract
        let token_client = TokenClient::new(&env, &call.stake_token);
        token_client.transfer(&staker, &env.current_contract_address(), &amount);

        // Update stakes
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

        // Store updated call
        set_call(&env, &call);
        add_staker_call(&env, &staker, call_id);
        extend_storage_ttl(&env);

        // Emit event
        emit_stake_added(&env, call_id, &staker, amount, position);

        call
    }

    /// Get call data by ID
    ///
    /// # Arguments
    /// * `call_id` - ID of the call to retrieve
    ///
    /// # Returns
    /// The Call struct if it exists, panics otherwise
    pub fn get_call(env: Env, call_id: u64) -> Call {
        match get_call(&env, call_id) {
            Some(call) => call,
            None => panic!("Call does not exist"),
        }
    }

    /// Get all calls created by a specific address
    ///
    /// # Arguments
    /// * `creator` - Address to filter calls by
    ///
    /// # Returns
    /// Vector of calls created by the address
    pub fn get_calls_by_creator(env: Env, creator: Address) -> SorobanVec<Call> {
        let mut calls = SorobanVec::new(&env);
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

    /// Get statistics for a specific call
    ///
    /// # Arguments
    /// * `call_id` - ID of the call
    ///
    /// # Returns
    /// CallStats struct with aggregated data
    pub fn get_call_stats(env: Env, call_id: u64) -> CallStats {
        let call = match get_call(&env, call_id) {
            Some(c) => c,
            None => panic!("Call does not exist"),
        };

        CallStats {
            total_up_stake: call.total_up_stake,
            total_down_stake: call.total_down_stake,
            total_stakes: call.up_stakes.len() + call.down_stakes.len(),
            up_stake_count: call.up_stakes.len(),
            down_stake_count: call.down_stakes.len(),
        }
    }

    /// Get all calls a staker has participated in
    ///
    /// # Arguments
    /// * `staker` - Address to get calls for
    ///
    /// # Returns
    /// Vector of Call structs
    pub fn get_staker_calls(env: Env, staker: Address) -> SorobanVec<Call> {
        let call_ids = get_staker_calls(&env, &staker);
        let mut calls = SorobanVec::new(&env);

        for call_id in call_ids.iter() {
            if let Some(call) = get_call(&env, call_id) {
                calls.push_back(call);
            }
        }

        calls
    }

    /// Resolve a call with an outcome (admin only)
    ///
    /// # Arguments
    /// * `call_id` - ID of the call to resolve
    /// * `outcome` - 1 for UP, 2 for DOWN
    /// * `end_price` - Final price for the asset
    ///
    /// # Panics
    /// If caller is not outcome_manager or call doesn't exist
    pub fn resolve_call(env: Env, call_id: u64, outcome: u32, end_price: i128) -> Call {
        let config = match get_config(&env) {
            Some(c) => c,
            None => panic!("Contract not initialized"),
        };

        // Require authorization from outcome manager
        config.outcome_manager.require_auth();

        // Get the call
        let mut call = match get_call(&env, call_id) {
            Some(c) => c,
            None => panic!("Call does not exist"),
        };

        // Validate outcome
        if outcome != 1 && outcome != 2 {
            panic!("Invalid outcome: must be 1 (UP) or 2 (DOWN)");
        }

        // Check that call has ended
        let current_timestamp = env.ledger().timestamp();
        if current_timestamp < call.end_ts {
            panic!("Call has not ended yet");
        }

        // Update call
        call.outcome = outcome;
        call.end_price = end_price;

        // Store updated call
        set_call(&env, &call);
        extend_storage_ttl(&env);

        // Emit event
        emit_call_resolved(&env, call_id, outcome, end_price);

        call
    }

    /// Update admin (current admin only)
    ///
    /// # Arguments
    /// * `new_admin` - New admin address
    pub fn set_admin(env: Env, new_admin: Address) {
        let mut config = match get_config(&env) {
            Some(c) => c,
            None => panic!("Contract not initialized"),
        };

        // Require authorization from current admin
        config.admin.require_auth();

        let old_admin = config.admin.clone();
        config.admin = new_admin.clone();

        set_config(&env, &config);
        extend_storage_ttl(&env);

        emit_admin_changed(&env, &old_admin, &new_admin);
    }

    /// Update outcome manager (admin only)
    ///
    /// # Arguments
    /// * `new_manager` - New outcome manager address
    pub fn set_outcome_manager(env: Env, new_manager: Address) {
        let config = match get_config(&env) {
            Some(c) => c,
            None => panic!("Contract not initialized"),
        };

        // Require authorization from admin
        config.admin.require_auth();

        let mut new_config = config.clone();
        let old_manager = new_config.outcome_manager.clone();
        new_config.outcome_manager = new_manager.clone();

        set_config(&env, &new_config);
        extend_storage_ttl(&env);

        emit_outcome_manager_changed(&env, &old_manager, &new_manager);
    }

    /// Get current contract configuration
    ///
    /// # Returns
    /// ContractConfig struct
    pub fn get_config(env: Env) -> ContractConfig {
        match get_config(&env) {
            Some(c) => c,
            None => panic!("Contract not initialized"),
        }
    }

    /// Get total number of calls created
    pub fn get_call_count(env: Env) -> u64 {
        get_call_counter(&env)
    }

    /// Get staker's stake amount on a specific call for a position
    ///
    /// # Arguments
    /// * `call_id` - ID of the call
    /// * `staker` - Address of the staker
    /// * `position` - 1 for UP, 2 for DOWN
    ///
    /// # Returns
    /// Amount staked, or 0 if no stake
    pub fn get_staker_stake(env: Env, call_id: u64, staker: Address, position: u32) -> i128 {
        let call = match get_call(&env, call_id) {
            Some(c) => c,
            None => panic!("Call does not exist"),
        };

        match position {
            1 => call.up_stakes.get(staker).unwrap_or(0),
            2 => call.down_stakes.get(staker).unwrap_or(0),
            _ => panic!("Invalid position"),
        }
    }
}
