#![no_std]

use soroban_sdk::{contract, contractimpl, token, Address, Bytes, Env, Vec};

mod admin;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

use events::*;
use storage::*;
use types::*;

const MAX_CALL_PAGE_SIZE: u32 = 20;

/// CallRegistry contract implementation
/// Manages prediction calls and staking on market outcomes
#[contract]
pub struct CallRegistry;

#[contractimpl]
impl CallRegistry {
    /// Initialize the contract with admin and outcome manager
    pub fn initialize(env: Env, admin: Address, outcome_manager: Address) {
        if let Some(_) = get_config(&env) {
            panic!("Contract already initialized");
        }

        admin.require_auth();

        let config = ContractConfig {
            admin: admin.clone(),
            outcome_manager: outcome_manager.clone(),
            fee_bps: 0,
            resolution_grace_period: 604800,
        };

        set_config(&env, &config);
        extend_storage_ttl(&env);

        env.events()
            .publish(("call_registry", "initialized"), (admin, outcome_manager));
    }

    /// Create a new prediction call
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
        creator.require_auth();

        if stake_amount <= 0 {
            panic!("Stake amount must be positive");
        }

        let current_timestamp = env.ledger().timestamp();
        if end_ts <= current_timestamp {
            panic!("End timestamp must be in the future");
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
            settled: false,
            created_at: current_timestamp,
        };

        set_call(&env, &call);
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

        call
    }

    /// Add stake to an existing call
    pub fn stake_on_call(
        env: Env,
        staker: Address,
        call_id: u64,
        amount: i128,
        position: u32,
    ) -> Call {
        staker.require_auth();

        if amount <= 0 {
            panic!("Stake amount must be positive");
        }

        let mut call = match get_call(&env, call_id) {
            Some(c) => c,
            None => panic!("Call does not exist"),
        };

        let current_timestamp = env.ledger().timestamp();
        if current_timestamp >= call.end_ts {
            panic!("Call has ended");
        }

        if call.settled {
            panic!("Call has been settled");
        }

        let stake_position = match StakePosition::from_u32(position) {
            Some(p) => p,
            None => panic!("Invalid position: must be 1 (UP) or 2 (DOWN)"),
        };

        let token_client = token::Client::new(&env, &call.stake_token);
        token_client.transfer(&staker, &env.current_contract_address(), &amount);

        // We rely on events for attribution. The indexer already handles this.
        // Hence call.up_stakes.set(...) / call.down_stakes.set(...) are commented out;
        // uncomment in the future if the rule changes.
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
        extend_storage_ttl(&env);

        emit_stake_added(&env, call_id, &staker, amount, position);

        call
    }

    /// Get call data by ID
    pub fn get_call(env: Env, call_id: u64) -> Call {
        match get_call(&env, call_id) {
            Some(call) => call,
            None => panic!("Call does not exist"),
        }
    }

    /// Get all calls created by a specific address
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
    /// Returns up to `limit` calls and enforces a maximum page size.
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
    /// Returns up to `limit` calls starting from `start_id`.
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

    /// Get statistics for a specific call
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

    /// Resolve a call with an outcome (outcome_manager only)
    pub fn resolve_call(env: Env, call_id: u64, outcome: u32, end_price: i128) -> Call {
        let config = match get_config(&env) {
            Some(c) => c,
            None => panic!("Contract not initialized"),
        };

        config.outcome_manager.require_auth();

        let mut call = match get_call(&env, call_id) {
            Some(c) => c,
            None => panic!("Call does not exist"),
        };

        if outcome != 1 && outcome != 2 {
            panic!("Invalid outcome: must be 1 (UP) or 2 (DOWN)");
        }

        let current_timestamp = env.ledger().timestamp();
        if current_timestamp < call.end_ts {
            panic!("Call has not ended yet");
        }

        call.outcome = outcome;
        call.end_price = end_price;

        set_call(&env, &call);
        extend_storage_ttl(&env);

        emit_call_resolved(&env, call_id, outcome, end_price);

        call
    }

    /// Transfer admin privileges to a new address (admin only).
    /// Emits AdminParamsChanged { param: "admin", ... }.
    pub fn set_admin(env: Env, new_admin: Address) {
        admin::set_admin(env, new_admin);
    }

    /// Replace the outcome manager (admin only).
    /// Emits AdminParamsChanged { param: "outcome_manager", ... }.
    pub fn set_outcome_manager(env: Env, new_manager: Address) {
        admin::set_outcome_manager(env, new_manager);
    }

    /// Set the protocol fee in basis points, e.g. 100 = 1 % (admin only).
    /// Emits AdminParamsChanged { param: "fee_bps", ... }.
    ///
    /// # Panics
    /// * `new_fee_bps` > 10_000
    pub fn set_fee(env: Env, new_fee_bps: u32) {
        admin::set_fee(env, new_fee_bps);
    }

    /// Allows a staker to reclaim their stake if the call has expired and past the grace period without resolution.
    pub fn claim_expired_refund(env: Env, staker: Address, call_id: u64, position: u32) {
        staker.require_auth();

        let config = match get_config(&env) {
            Some(c) => c,
            None => panic!("Contract not initialized"),
        };

        // 1. Fetch the call
        let mut call = match get_call(&env, call_id) {
            Some(c) => c,
            None => panic!("Call does not exist"),
        };

        // 2. Check if already settled
        if call.settled {
            panic!("Call is already settled");
        }

        // 3. Time check: current time > end_ts + resolution_grace_period
        let current_timestamp = env.ledger().timestamp();
        let grace_deadline = call.end_ts + config.resolution_grace_period;
        
        if current_timestamp <= grace_deadline {
            panic!("Grace period has not yet expired");
        }

        // 4. Validate Position & Load Stake
        let stake_position = match StakePosition::from_u32(position) {
            Some(p) => p,
            None => panic!("Invalid position"),
        };

        let current_stake = match stake_position {
            StakePosition::Up => call.up_stakes.get(staker.clone()).unwrap_or(0),
            StakePosition::Down => call.down_stakes.get(staker.clone()).unwrap_or(0),
        };

        if current_stake <= 0 {
            panic!("No active stake found for this position");
        }

        // 5. Update State (Zero out the stake to prevent double claims)
        match stake_position {
            StakePosition::Up => {
                call.up_stakes.set(staker.clone(), 0);
                call.total_up_stake -= current_stake;
            }
            StakePosition::Down => {
                call.down_stakes.set(staker.clone(), 0);
                call.total_down_stake -= current_stake;
            }
        }
        
        // Save the updated call state
        set_call(&env, &call);

        // 6. Execute Transfer
        let token_client = token::Client::new(&env, &call.stake_token);
        token_client.transfer(&env.current_contract_address(), &staker, &current_stake);

        // 7. Emit Event
        emit_expired_refund_claimed(&env, call_id, &staker, current_stake);
    }

    /// Get current contract configuration
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

    pub fn release_escrow(env: Env, call_id: u64, to: Address, amount: i128) {
        let config = get_config(&env).expect("Not initialized");
        config.outcome_manager.require_auth();

        let call = get_call(&env, call_id).expect("Call not found");

        let token_client = token::Client::new(&env, &call.stake_token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);
    }

    pub fn mark_settled(env: Env, call_id: u64) {
        let config = get_config(&env).expect("Not initialized");
        config.outcome_manager.require_auth();

        let mut call = get_call(&env, call_id).expect("Call not found");

        if call.settled {
            panic!("Already settled");
        }

        call.settled = true;
        set_call(&env, &call);
    }
}