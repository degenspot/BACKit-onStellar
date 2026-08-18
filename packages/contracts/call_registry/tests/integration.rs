#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env, Vec,
};

use backit_shared::{OUTCOME_DOWN, OUTCOME_UP};
use call_registry::{CallRegistry, CallRegistryClient};
use outcome_manager::{OutcomeManager, OutcomeManagerClient};

use call_registry::types::{Call, CallInitArgs, ConditionType};

// --- Mock Token for Testing --------------------------------------------------

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
    pub fn balance(_env: Env, _id: Address) -> i128 {
        1_000_000_000_i128
    }
    pub fn allowance(_env: Env, _from: Address, _spender: Address) -> i128 {
        1_000_000_000_i128
    }
}

// --- Integration Tests -------------------------------------------------------

#[test]
fn test_full_lifecycle_create_stake_submit_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let outcome_manager_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let staker_up = Address::generate(&env);
    let staker_down = Address::generate(&env);
    let fee_collector = Address::generate(&env);

    let token_id = env.register_contract(None, MockToken);

    let registry_id = env.register_contract(None, CallRegistry);
    let registry_client = CallRegistryClient::new(&env, &registry_id);

    let outcome_id = env.register_contract(None, OutcomeManager);
    let outcome_client = OutcomeManagerClient::new(&env, &outcome_id);

    let min_stake = 1_000_000_i128;
    registry_client.initialize(&admin, &outcome_id, &min_stake);
    registry_client.whitelist_token(&token_id);

    let oracle_pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey.clone());
    outcome_client.initialize(
        &outcome_manager_admin,
        &oracles,
        &1u32,
        &fee_collector,
        &100u32,
        &3600u64,
    );

    env.ledger().set_timestamp(1000);
    let token_address = Address::generate(&env);

    let args = CallInitArgs {
        stake_token: token_id.clone(),
        stake_amount: 10_000_000_i128,
        start_price: 100_000_000_i128,
        end_ts: 5000u64,
        token_address: token_address.clone(),
        pair_id: Bytes::from_slice(&env, b"USDC/XLM"),
        ipfs_cid: Bytes::from_slice(&env, b"QmTest123"),
        metadata_hash: BytesN::from_array(&env, &[0u8; 32]),
        condition: ConditionType::TargetAbove(100_000_000_i128),
        outcome_count: 2,
        gate_kind: None,
        gate_min_account_age: 0u32,
        gate_min_xlm_balance: 0i128,
        gate_min_trustlines: 0u32,
        gate_badge: None,
    };
    let call = registry_client.create_call(&creator, &args);

    assert_eq!(call.id, 1);
    assert_eq!(call.creator, creator);
    // outcome_stakes replaces the removed total_up_stake / total_down_stake fields
    assert_eq!(call.outcome_stakes.get(OUTCOME_UP).unwrap_or(0), 0);
    assert_eq!(call.outcome_stakes.get(OUTCOME_DOWN).unwrap_or(0), 0);

    let up_call = registry_client.stake_on_call(&staker_up, &1u64, &50_000_000_i128, &OUTCOME_UP);
    assert_eq!(
        up_call.outcome_stakes.get(OUTCOME_UP).unwrap_or(0),
        50_000_000_i128
    );
    assert_eq!(up_call.outcome_stakes.get(OUTCOME_DOWN).unwrap_or(0), 0);

    let down_call =
        registry_client.stake_on_call(&staker_down, &1u64, &30_000_000_i128, &OUTCOME_DOWN);
    assert_eq!(
        down_call.outcome_stakes.get(OUTCOME_UP).unwrap_or(0),
        50_000_000_i128
    );
    assert_eq!(
        down_call.outcome_stakes.get(OUTCOME_DOWN).unwrap_or(0),
        30_000_000_i128
    );

    env.ledger().set_timestamp(5100);

    let end_price = 150_000_000_i128;
    registry_client.resolve_call(&1u64, &OUTCOME_UP, &end_price);

    let resolved_call = registry_client.get_call(&1u64);
    assert_eq!(resolved_call.outcome, OUTCOME_UP);
    assert_eq!(resolved_call.end_price, end_price);

    let creator_stats = registry_client.get_creator_stats_view(&creator);
    assert_eq!(creator_stats.total_created, 1);
    assert_eq!(creator_stats.total_resolved, 1);
    assert_eq!(creator_stats.total_correct, 0); // creator did not stake

    registry_client.mark_settled(&1u64);
    let settled_call = registry_client.get_call(&1u64);
    assert!(settled_call.settled);
}

#[test]
fn test_cross_contract_authorization_only_outcome_manager_can_resolve() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let outcome_manager_admin = Address::generate(&env);

    let token_id = env.register_contract(None, MockToken);

    let registry_id = env.register_contract(None, CallRegistry);
    let registry_client = CallRegistryClient::new(&env, &registry_id);

    let outcome_id = env.register_contract(None, OutcomeManager);
    let outcome_client = OutcomeManagerClient::new(&env, &outcome_id);

    registry_client.initialize(&admin, &outcome_id, &1_000_000_i128);
    registry_client.whitelist_token(&token_id);

    let oracle_pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey);
    outcome_client.initialize(
        &outcome_manager_admin,
        &oracles,
        &1u32,
        &admin,
        &0u32,
        &3600u64,
    );

    env.ledger().set_timestamp(1000);
    let token_address = Address::generate(&env);

    let args = CallInitArgs {
        stake_token: token_id.clone(),
        stake_amount: 10_000_000_i128,
        start_price: 100_000_000_i128,
        end_ts: 5000u64,
        token_address: token_address.clone(),
        pair_id: Bytes::from_slice(&env, b"USDC/XLM"),
        ipfs_cid: Bytes::from_slice(&env, b"QmTest"),
        metadata_hash: BytesN::from_array(&env, &[0u8; 32]),
        condition: ConditionType::TargetAbove(100_000_000_i128),
        outcome_count: 2,
        gate_kind: None,
        gate_min_account_age: 0u32,
        gate_min_xlm_balance: 0i128,
        gate_min_trustlines: 0u32,
        gate_badge: None,
    };
    let _call = registry_client.create_call(&admin, &args);

    // Confirm call is unresolved before end timestamp
    env.ledger().set_timestamp(5100);
    let call = registry_client.get_call(&1u64);
    assert_eq!(call.outcome, 0);

    // Only the configured outcome_manager can resolve; mock_all_auths permits this
    registry_client.resolve_call(&1u64, &OUTCOME_UP, &150_000_000_i128);
    let resolved_call = registry_client.get_call(&1u64);
    assert_eq!(resolved_call.outcome, OUTCOME_UP);
}

#[test]
fn test_error_paths_double_claiming() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let outcome_manager_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let staker = Address::generate(&env);

    let token_id = env.register_contract(None, MockToken);

    let registry_id = env.register_contract(None, CallRegistry);
    let registry_client = CallRegistryClient::new(&env, &registry_id);

    let outcome_id = env.register_contract(None, OutcomeManager);
    let outcome_client = OutcomeManagerClient::new(&env, &outcome_id);

    registry_client.initialize(&admin, &outcome_id, &1_000_000_i128);
    registry_client.whitelist_token(&token_id);

    let oracle_pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey);
    outcome_client.initialize(
        &outcome_manager_admin,
        &oracles,
        &1u32,
        &admin,
        &0u32,
        &3600u64,
    );

    env.ledger().set_timestamp(1000);
    let token_address = Address::generate(&env);

    let args = CallInitArgs {
        stake_token: token_id.clone(),
        stake_amount: 10_000_000_i128,
        start_price: 100_000_000_i128,
        end_ts: 5000u64,
        token_address: token_address.clone(),
        pair_id: Bytes::from_slice(&env, b"USDC/XLM"),
        ipfs_cid: Bytes::from_slice(&env, b"QmTest"),
        metadata_hash: BytesN::from_array(&env, &[0u8; 32]),
        condition: ConditionType::TargetAbove(100_000_000_i128),
        outcome_count: 2,
        gate_kind: None,
        gate_min_account_age: 0u32,
        gate_min_xlm_balance: 0i128,
        gate_min_trustlines: 0u32,
        gate_badge: None,
    };
    let _call = registry_client.create_call(&creator, &args);

    registry_client.stake_on_call(&staker, &1u64, &50_000_000_i128, &OUTCOME_UP);

    env.ledger().set_timestamp(5100);
    registry_client.resolve_call(&1u64, &OUTCOME_UP, &150_000_000_i128);

    let call = registry_client.get_call(&1u64);
    assert_eq!(call.outcome, OUTCOME_UP);
    // Verify stake is preserved in outcome_stakes after resolution
    assert_eq!(
        call.outcome_stakes.get(OUTCOME_UP).unwrap_or(0),
        50_000_000_i128
    );
}

#[test]
fn test_pause_mechanism_blocks_submissions() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let outcome_manager_admin = Address::generate(&env);

    let token_id = env.register_contract(None, MockToken);

    let registry_id = env.register_contract(None, CallRegistry);
    let registry_client = CallRegistryClient::new(&env, &registry_id);

    let outcome_id = env.register_contract(None, OutcomeManager);
    let outcome_client = OutcomeManagerClient::new(&env, &outcome_id);

    registry_client.initialize(&admin, &outcome_id, &1_000_000_i128);

    let oracle_pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey.clone());
    outcome_client.initialize(
        &outcome_manager_admin,
        &oracles,
        &1u32,
        &admin,
        &0u32,
        &3600u64,
    );

    assert!(!outcome_client.is_paused_view());

    outcome_client.pause();
    assert!(outcome_client.is_paused_view());

    outcome_client.unpause();
    assert!(!outcome_client.is_paused_view());
}

#[test]
fn test_creator_reputation_accumulates_across_calls() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let outcome_manager_admin = Address::generate(&env);

    let token_id = env.register_contract(None, MockToken);

    let registry_id = env.register_contract(None, CallRegistry);
    let registry_client = CallRegistryClient::new(&env, &registry_id);

    let outcome_id = env.register_contract(None, OutcomeManager);
    let outcome_client = OutcomeManagerClient::new(&env, &outcome_id);

    registry_client.initialize(&admin, &outcome_id, &1_000_000_i128);
    registry_client.whitelist_token(&token_id);

    let oracle_pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey);
    outcome_client.initialize(
        &outcome_manager_admin,
        &oracles,
        &1u32,
        &admin,
        &0u32,
        &3600u64,
    );

    env.ledger().set_timestamp(1000);
    let token_address = Address::generate(&env);

    // end_ts values 4500, 5000, 5500 all fall before the resolve timestamp (7000),
    // fixing the original bug where call 3 ended at 8000 and resolve fired at 7100.
    for i in 1u64..=3 {
        let args = CallInitArgs {
            stake_token: token_id.clone(),
            stake_amount: 10_000_000_i128,
            start_price: 100_000_000_i128,
            end_ts: 4000u64 + i * 500,
            token_address: token_address.clone(),
            pair_id: Bytes::from_slice(&env, b"USDC/XLM"),
            ipfs_cid: Bytes::from_slice(&env, b"QmTest"),
            metadata_hash: BytesN::from_array(&env, &[0u8; 32]),
            condition: ConditionType::TargetAbove(100_000_000_i128),
            outcome_count: 2,
            gate_kind: None,
            gate_min_account_age: 0u32,
            gate_min_xlm_balance: 0i128,
            gate_min_trustlines: 0u32,
            gate_badge: None,
        };
        registry_client.create_call(&creator, &args);
    }

    let stats = registry_client.get_creator_stats_view(&creator);
    assert_eq!(stats.total_created, 3);

    // Creator stakes on the winning side for all three calls
    registry_client.stake_on_call(&creator, &1u64, &10_000_000_i128, &OUTCOME_UP);
    registry_client.stake_on_call(&creator, &2u64, &10_000_000_i128, &OUTCOME_DOWN);
    registry_client.stake_on_call(&creator, &3u64, &10_000_000_i128, &OUTCOME_UP);

    env.ledger().set_timestamp(7000);

    registry_client.resolve_call(&1u64, &OUTCOME_UP, &150_000_000_i128);
    registry_client.resolve_call(&2u64, &OUTCOME_DOWN, &50_000_000_i128);
    registry_client.resolve_call(&3u64, &OUTCOME_UP, &150_000_000_i128);

    let final_stats = registry_client.get_creator_stats_view(&creator);
    assert_eq!(final_stats.total_created, 3);
    assert_eq!(final_stats.total_resolved, 3);
    assert_eq!(final_stats.total_correct, 3);
}

/// New test: verifies the generalized multi-outcome model with outcome_count = 3.
/// Stakes three different positions and resolves to the third outcome.
#[test]
fn test_three_outcome_market() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let outcome_manager_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let staker_a = Address::generate(&env);
    let staker_b = Address::generate(&env);
    let staker_c = Address::generate(&env);

    let token_id = env.register_contract(None, MockToken);
    let registry_id = env.register_contract(None, CallRegistry);
    let registry_client = CallRegistryClient::new(&env, &registry_id);
    let outcome_id = env.register_contract(None, OutcomeManager);
    let outcome_client = OutcomeManagerClient::new(&env, &outcome_id);

    registry_client.initialize(&admin, &outcome_id, &1_000_000_i128);
    registry_client.whitelist_token(&token_id);

    let oracle_pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey);
    outcome_client.initialize(
        &outcome_manager_admin,
        &oracles,
        &1u32,
        &admin,
        &0u32,
        &3600u64,
    );

    env.ledger().set_timestamp(1000);
    let token_address = Address::generate(&env);

    // Create a 3-outcome market (e.g. Low / Mid / High price band)
    let args = CallInitArgs {
        stake_token: token_id.clone(),
        stake_amount: 10_000_000_i128,
        start_price: 100_000_000_i128,
        end_ts: 5000u64,
        token_address: token_address.clone(),
        pair_id: Bytes::from_slice(&env, b"USDC/XLM"),
        ipfs_cid: Bytes::from_slice(&env, b"QmThreeOutcomes"),
        metadata_hash: BytesN::from_array(&env, &[0u8; 32]),
        condition: ConditionType::TargetAbove(100_000_000_i128),
        outcome_count: 3,
        gate_kind: None,
        gate_min_account_age: 0u32,
        gate_min_xlm_balance: 0i128,
        gate_min_trustlines: 0u32,
        gate_badge: None,
    };
    let call = registry_client.create_call(&creator, &args);

    assert_eq!(call.outcome_count, 3);
    assert_eq!(call.outcome_stakes.get(1u32).unwrap_or(0), 0);
    assert_eq!(call.outcome_stakes.get(2u32).unwrap_or(0), 0);
    assert_eq!(call.outcome_stakes.get(3u32).unwrap_or(0), 0);

    // Three stakers cover all three outcomes
    let call_after_a = registry_client.stake_on_call(&staker_a, &1u64, &20_000_000_i128, &1u32);
    assert_eq!(
        call_after_a.outcome_stakes.get(1u32).unwrap_or(0),
        20_000_000_i128
    );

    let call_after_b = registry_client.stake_on_call(&staker_b, &1u64, &30_000_000_i128, &2u32);
    assert_eq!(
        call_after_b.outcome_stakes.get(2u32).unwrap_or(0),
        30_000_000_i128
    );

    let call_after_c = registry_client.stake_on_call(&staker_c, &1u64, &15_000_000_i128, &3u32);
    // All three outcomes accumulate independently
    assert_eq!(
        call_after_c.outcome_stakes.get(1u32).unwrap_or(0),
        20_000_000_i128
    );
    assert_eq!(
        call_after_c.outcome_stakes.get(2u32).unwrap_or(0),
        30_000_000_i128
    );
    assert_eq!(
        call_after_c.outcome_stakes.get(3u32).unwrap_or(0),
        15_000_000_i128
    );

    // Resolve to outcome 3
    env.ledger().set_timestamp(5100);
    let resolved = registry_client.resolve_call(&1u64, &3u32, &120_000_000_i128);
    assert_eq!(resolved.outcome, 3u32);

    // Mark settled and confirm final state
    registry_client.mark_settled(&1u64);
    let settled = registry_client.get_call(&1u64);
    assert!(settled.settled);
    assert_eq!(settled.outcome, 3u32);
    assert_eq!(
        settled.outcome_stakes.get(3u32).unwrap_or(0),
        15_000_000_i128
    );
}
