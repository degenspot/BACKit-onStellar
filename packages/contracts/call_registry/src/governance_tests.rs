#![cfg(test)]

use crate::types::ProposalStatus;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, Symbol,
};

fn setup_env() -> (Env, Address, Address, crate::CallRegistryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, crate::CallRegistry);
    let client = crate::CallRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    (env, admin, outcome_manager, client)
}

fn override_config(env: &Env, admin: &Address, outcome_manager: &Address, quorum_bps: u32, threshold: i128) {
    use crate::storage::*;
    use crate::types::*;
    use soroban_sdk::Map;

    let config = ContractConfig {
        admin: admin.clone(),
        outcome_manager: outcome_manager.clone(),
        fee_bps: 0,
        max_stake_per_user: 0,
        whitelisted_tokens: Map::new(env),
        min_stake: 1,
        metadata_version: 0,
        paused: false,
        staking_cutoff_secs: 0,
        share_wasm_hash: None,
        proposal_threshold: threshold,
        governance_quorum_bps: quorum_bps,
        voting_period_ledgers: 1000,
        resolution_grace_period: 0,
    };
    set_config(env, &config);
}

fn init_stake_volume(env: &Env, user: &Address, user_volume: i128, total_volume: i128) {
    crate::storage::accumulate_user_stake_volume(env, user, user_volume);
    let mut gs = crate::storage::get_global_stats(env);
    gs.total_stake_volume = total_volume;
    env.storage().instance().set(&crate::storage::DataKey::GlobalStats, &gs);
}

#[test]
fn test_propose_and_vote_and_execute() {
    let (env, admin, outcome_manager, client) = setup_env();
    client.initialize(&admin, &outcome_manager, &1);
    override_config(&env, &admin, &outcome_manager, 500, 0);

    let staker = Address::generate(&env);
    init_stake_volume(&env, &staker, 10_000_000, 10_000_000);

    let current_ledger = env.ledger().sequence();
    let voting_end = current_ledger + 2000;

    let proposal_id = client.propose_change(
        &staker,
        &Symbol::new(&env, "fee_bps"),
        &200i128,
        &voting_end,
    );
    assert_eq!(proposal_id, 1);

    client.vote(&staker, &proposal_id, &true);

    let dupe = client.try_vote(&staker, &proposal_id, &true);
    assert_eq!(dupe, Err(Ok(crate::errors::CallRegistryError::AlreadyVoted)));

    let early = client.try_execute_proposal(&proposal_id);
    assert_eq!(early, Err(Ok(crate::errors::CallRegistryError::VotingNotEnded)));

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

    let exec_result = client.try_execute_proposal(&proposal_id);
    assert!(exec_result.is_ok());

    let updated_config = client.get_config().unwrap();
    assert_eq!(updated_config.fee_bps, 200);

    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Executed);
}

#[test]
fn test_proposal_rejected_insufficient_votes() {
    let (env, admin, outcome_manager, client) = setup_env();
    client.initialize(&admin, &outcome_manager, &1);
    override_config(&env, &admin, &outcome_manager, 5000, 0);

    let proposer = Address::generate(&env);
    init_stake_volume(&env, &proposer, 100, 1_000_000);

    let current_ledger = env.ledger().sequence();
    let voting_end = current_ledger + 2000;

    let proposal_id = client.propose_change(
        &proposer,
        &Symbol::new(&env, "fee_bps"),
        &300i128,
        &voting_end,
    );

    client.vote(&proposer, &proposal_id, &true);

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

    let exec_result = client.try_execute_proposal(&proposal_id);
    assert_eq!(exec_result, Err(Ok(crate::errors::CallRegistryError::QuorumNotMet)));

    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Rejected);
}

#[test]
fn test_non_staker_cannot_propose() {
    let (env, admin, outcome_manager, client) = setup_env();
    client.initialize(&admin, &outcome_manager, &1);
    override_config(&env, &admin, &outcome_manager, 500, 1_000);

    let non_staker = Address::generate(&env);

    let current_ledger = env.ledger().sequence();
    let voting_end = current_ledger + 2000;

    let result = client.try_propose_change(
        &non_staker,
        &Symbol::new(&env, "fee_bps"),
        &100i128,
        &voting_end,
    );
    assert_eq!(result, Err(Ok(crate::errors::CallRegistryError::InsufficientStake)));
}

#[test]
fn test_non_staker_cannot_vote() {
    let (env, admin, outcome_manager, client) = setup_env();
    client.initialize(&admin, &outcome_manager, &1);
    override_config(&env, &admin, &outcome_manager, 500, 0);

    let proposer = Address::generate(&env);
    init_stake_volume(&env, &proposer, 10_000, 10_000);

    let current_ledger = env.ledger().sequence();
    let voting_end = current_ledger + 2000;

    let proposal_id = client.propose_change(
        &proposer,
        &Symbol::new(&env, "fee_bps"),
        &50i128,
        &voting_end,
    );

    let non_staker = Address::generate(&env);
    let result = client.try_vote(&non_staker, &proposal_id, &true);
    assert_eq!(result, Err(Ok(crate::errors::CallRegistryError::InsufficientStake)));
}

#[test]
fn test_get_active_proposals() {
    let (env, admin, outcome_manager, client) = setup_env();
    client.initialize(&admin, &outcome_manager, &1);
    override_config(&env, &admin, &outcome_manager, 500, 0);

    let proposer = Address::generate(&env);
    init_stake_volume(&env, &proposer, 10_000, 10_000);

    let current_ledger = env.ledger().sequence();
    let voting_end = current_ledger + 2000;

    client.propose_change(
        &proposer,
        &Symbol::new(&env, "fee_bps"),
        &100i128,
        &voting_end,
    );
    client.propose_change(
        &proposer,
        &Symbol::new(&env, "min_stake"),
        &200i128,
        &voting_end,
    );

    let active = client.get_active_proposals();
    assert_eq!(active.len(), 2);
}
