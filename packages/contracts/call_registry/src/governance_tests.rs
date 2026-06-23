#![cfg(test)]

use crate::types::{CallInitArgs, ConditionType, ProposalStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Bytes, BytesN, Env, IntoVal, Symbol, Val,
};

fn setup_env() -> (Env, Address, Address, crate::CallRegistry) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, crate::CallRegistry);
    let client = crate::CallRegistry::new(&env, &contract_id);
    // use client for calls
    let admin = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    (env, admin, outcome_manager, client)
}

#[test]
fn test_propose_and_vote_and_execute() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, crate::CallRegistry);
    let admin = Address::generate(&env);
    let outcome_manager = Address::generate(&env);

    env.as_contract(&contract_id, || {
        use crate::storage::*;
        use crate::types::*;
        use soroban_sdk::Map;

        // Init config with governance defaults
        let config = ContractConfig {
            admin: admin.clone(),
            outcome_manager: outcome_manager.clone(),
            fee_bps: 0,
            max_stake_per_user: 0,
            whitelisted_tokens: Map::new(&env),
            min_stake: 1,
            metadata_version: 0,
            paused: false,
            staking_cutoff_secs: 0,
            share_wasm_hash: None,
            proposal_threshold: 0,
            governance_quorum_bps: 500,
            voting_period_ledgers: 1000,
        };
        set_config(&env, &config);

        // Give a staker some stake volume
        let staker = Address::generate(&env);
        accumulate_user_stake_volume(&env, &staker, 10_000_000);
        // total_stake_volume in global stats
        let mut gs = get_global_stats(&env);
        gs.total_stake_volume = 10_000_000;
        env.storage().instance().set(&DataKey::GlobalStats, &gs);

        let current_ledger = env.ledger().sequence();
        let voting_end = current_ledger + 2000;

        // propose_change
        let new_val: Val = 200u32.into_val(&env);
        let result = crate::governance::propose_change(
            &env,
            staker.clone(),
            Symbol::new(&env, "fee_bps"),
            new_val,
            voting_end,
        );
        assert!(result.is_ok());
        let proposal_id = result.unwrap();
        assert_eq!(proposal_id, 1);

        // vote yes
        let vote_result = crate::governance::vote(&env, staker.clone(), proposal_id, true);
        assert!(vote_result.is_ok());

        // Cannot vote twice
        let dupe = crate::governance::vote(&env, staker.clone(), proposal_id, true);
        assert_eq!(dupe, Err(crate::errors::CallRegistryError::AlreadyVoted));

        // Cannot execute before deadline
        let early = crate::governance::execute_proposal(&env, proposal_id);
        assert_eq!(
            early,
            Err(crate::errors::CallRegistryError::VotingNotEnded)
        );

        // Advance ledger past voting_end
        env.ledger().set(LedgerInfo {
            timestamp: 0,
            protocol_version: 22,
            sequence_number: voting_end + 1,
            network_id: [0u8; 32],
            base_reserve: 5_000_000,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        let exec_result = crate::governance::execute_proposal(&env, proposal_id);
        assert!(exec_result.is_ok());

        // Verify config was updated
        let updated_config = get_config(&env).unwrap();
        assert_eq!(updated_config.fee_bps, 200);

        // Proposal status should be Executed
        let proposal = get_proposal(&env, proposal_id).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Executed);
    });
}

#[test]
fn test_proposal_rejected_insufficient_votes() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, crate::CallRegistry);
    let admin = Address::generate(&env);
    let outcome_manager = Address::generate(&env);

    env.as_contract(&contract_id, || {
        use crate::storage::*;
        use crate::types::*;
        use soroban_sdk::Map;

        let config = ContractConfig {
            admin: admin.clone(),
            outcome_manager: outcome_manager.clone(),
            fee_bps: 0,
            max_stake_per_user: 0,
            whitelisted_tokens: Map::new(&env),
            min_stake: 1,
            metadata_version: 0,
            paused: false,
            staking_cutoff_secs: 0,
            share_wasm_hash: None,
            proposal_threshold: 0,
            governance_quorum_bps: 5000, // 50% quorum — very hard to reach
            voting_period_ledgers: 1000,
        };
        set_config(&env, &config);

        let proposer = Address::generate(&env);
        accumulate_user_stake_volume(&env, &proposer, 100);
        let mut gs = get_global_stats(&env);
        gs.total_stake_volume = 1_000_000; // proposer's 100 is way below 50% quorum
        env.storage().instance().set(&DataKey::GlobalStats, &gs);

        let current_ledger = env.ledger().sequence();
        let voting_end = current_ledger + 2000;

        let new_val: Val = 300u32.into_val(&env);
        let proposal_id = crate::governance::propose_change(
            &env,
            proposer.clone(),
            Symbol::new(&env, "fee_bps"),
            new_val,
            voting_end,
        )
        .unwrap();

        // vote yes with tiny power — well below quorum
        crate::governance::vote(&env, proposer.clone(), proposal_id, true).unwrap();

        // Advance ledger
        env.ledger().set(LedgerInfo {
            timestamp: 0,
            protocol_version: 22,
            sequence_number: voting_end + 1,
            network_id: [0u8; 32],
            base_reserve: 5_000_000,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        let exec_result = crate::governance::execute_proposal(&env, proposal_id);
        assert_eq!(exec_result, Err(crate::errors::CallRegistryError::QuorumNotMet));

        let proposal = get_proposal(&env, proposal_id).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Rejected);
    });
}

#[test]
fn test_non_staker_cannot_propose() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, crate::CallRegistry);
    let admin = Address::generate(&env);
    let outcome_manager = Address::generate(&env);

    env.as_contract(&contract_id, || {
        use crate::storage::*;
        use crate::types::*;
        use soroban_sdk::Map;

        let config = ContractConfig {
            admin: admin.clone(),
            outcome_manager: outcome_manager.clone(),
            fee_bps: 0,
            max_stake_per_user: 0,
            whitelisted_tokens: Map::new(&env),
            min_stake: 1,
            metadata_version: 0,
            paused: false,
            staking_cutoff_secs: 0,
            share_wasm_hash: None,
            proposal_threshold: 1_000, // requires at least 1000 stake volume
            governance_quorum_bps: 500,
            voting_period_ledgers: 1000,
        };
        set_config(&env, &config);

        let non_staker = Address::generate(&env);
        // non_staker has 0 stake volume

        let current_ledger = env.ledger().sequence();
        let voting_end = current_ledger + 2000;
        let new_val: Val = 100u32.into_val(&env);
        let result = crate::governance::propose_change(
            &env,
            non_staker,
            Symbol::new(&env, "fee_bps"),
            new_val,
            voting_end,
        );
        assert_eq!(result, Err(crate::errors::CallRegistryError::InsufficientStake));
    });
}

#[test]
fn test_non_staker_cannot_vote() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, crate::CallRegistry);
    let admin = Address::generate(&env);
    let outcome_manager = Address::generate(&env);

    env.as_contract(&contract_id, || {
        use crate::storage::*;
        use crate::types::*;
        use soroban_sdk::Map;

        let config = ContractConfig {
            admin: admin.clone(),
            outcome_manager: outcome_manager.clone(),
            fee_bps: 0,
            max_stake_per_user: 0,
            whitelisted_tokens: Map::new(&env),
            min_stake: 1,
            metadata_version: 0,
            paused: false,
            staking_cutoff_secs: 0,
            share_wasm_hash: None,
            proposal_threshold: 0,
            governance_quorum_bps: 500,
            voting_period_ledgers: 1000,
        };
        set_config(&env, &config);

        let proposer = Address::generate(&env);
        accumulate_user_stake_volume(&env, &proposer, 10_000);
        let mut gs = get_global_stats(&env);
        gs.total_stake_volume = 10_000;
        env.storage().instance().set(&DataKey::GlobalStats, &gs);

        let current_ledger = env.ledger().sequence();
        let voting_end = current_ledger + 2000;
        let new_val: Val = 50u32.into_val(&env);
        let proposal_id = crate::governance::propose_change(
            &env,
            proposer,
            Symbol::new(&env, "fee_bps"),
            new_val,
            voting_end,
        )
        .unwrap();

        let non_staker = Address::generate(&env);
        let result = crate::governance::vote(&env, non_staker, proposal_id, true);
        assert_eq!(result, Err(crate::errors::CallRegistryError::InsufficientStake));
    });
}

#[test]
fn test_get_active_proposals() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, crate::CallRegistry);
    let admin = Address::generate(&env);
    let outcome_manager = Address::generate(&env);

    env.as_contract(&contract_id, || {
        use crate::storage::*;
        use crate::types::*;
        use soroban_sdk::Map;

        let config = ContractConfig {
            admin: admin.clone(),
            outcome_manager: outcome_manager.clone(),
            fee_bps: 0,
            max_stake_per_user: 0,
            whitelisted_tokens: Map::new(&env),
            min_stake: 1,
            metadata_version: 0,
            paused: false,
            staking_cutoff_secs: 0,
            share_wasm_hash: None,
            proposal_threshold: 0,
            governance_quorum_bps: 500,
            voting_period_ledgers: 1000,
        };
        set_config(&env, &config);

        let proposer = Address::generate(&env);
        accumulate_user_stake_volume(&env, &proposer, 10_000);
        let mut gs = get_global_stats(&env);
        gs.total_stake_volume = 10_000;
        env.storage().instance().set(&DataKey::GlobalStats, &gs);

        let current_ledger = env.ledger().sequence();
        let voting_end = current_ledger + 2000;

        let val1: Val = 100u32.into_val(&env);
        let val2: Val = 200u32.into_val(&env);
        crate::governance::propose_change(
            &env,
            proposer.clone(),
            Symbol::new(&env, "fee_bps"),
            val1,
            voting_end,
        )
        .unwrap();
        crate::governance::propose_change(
            &env,
            proposer.clone(),
            Symbol::new(&env, "min_stake"),
            val2,
            voting_end,
        )
        .unwrap();

        let active = crate::governance::get_active_proposals(&env);
        assert_eq!(active.len(), 2);
    });
}
