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
            voided: false,
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

        if call.voided {
            panic!("Call has been voided");
        }

        let stake_position = match StakePosition::from_u32(position) {
            Some(p) => p,
            None => panic!("Invalid position: must be 1 (UP) or 2 (DOWN)"),
        };

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

        if call.voided {
            panic!("Call has been voided");
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

        let up_stake = call.up_stakes.get(staker.clone()).unwrap_or(0);
        let down_stake = call.down_stakes.get(staker.clone()).unwrap_or(0);
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
