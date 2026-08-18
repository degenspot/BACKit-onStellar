#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env, Vec,
};

use backit_shared::OUTCOME_UP;
use call_registry::types::{CallInitArgs, ConditionType};
use call_registry::{CallRegistry, CallRegistryClient};
use outcome_manager::{OutcomeManager, OutcomeManagerClient};

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

#[test]
#[should_panic]
fn test_age_gate_blocks_new_account() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let staker = Address::generate(&env);

    let token_id = env.register_contract(None, MockToken);
    let registry_id = env.register_contract(None, CallRegistry);
    let registry_client = CallRegistryClient::new(&env, &registry_id);

    let outcome_id = env.register_contract(None, OutcomeManager);
    let outcome_client = OutcomeManagerClient::new(&env, &outcome_id);
    let fee_collector = Address::generate(&env);
    let oracle_pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey);
    registry_client.initialize(&admin, &outcome_id, &1_000_000_i128);
    outcome_client.initialize(&admin, &oracles, &1u32, &fee_collector, &100u32, &3600u64);
    registry_client.whitelist_token(&token_id);

    // Set global gate: min account age = 1 ledger
    registry_client.set_global_gate(
        &Some(call_registry::types::GATE_MIN_ACCOUNT_AGE),
        &1u32,
        &0i128,
        &0u32,
        &None,
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
        ipfs_cid: Bytes::from_slice(&env, b"QmTestGates"),
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

    // New staker should be blocked by min_account_age gate (first_seen == current)
    registry_client.stake_on_call(&staker, &1u64, &50_000_000_i128, &OUTCOME_UP);
}

#[test]
#[should_panic]
fn test_min_xlm_balance_blocks_new_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let staker = Address::generate(&env);

    let token_id = env.register_contract(None, MockToken);
    let registry_id = env.register_contract(None, CallRegistry);
    let registry_client = CallRegistryClient::new(&env, &registry_id);

    let outcome_id = env.register_contract(None, OutcomeManager);
    let outcome_client = OutcomeManagerClient::new(&env, &outcome_id);
    let fee_collector = Address::generate(&env);
    let oracle_pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey);
    registry_client.initialize(&admin, &outcome_id, &1_000_000_i128);
    outcome_client.initialize(&admin, &oracles, &1u32, &fee_collector, &100u32, &3600u64);
    registry_client.whitelist_token(&token_id);
    registry_client.set_xlm_sac_address(&token_id);

    // Require more XLM than MockToken.balance() provides
    registry_client.set_global_gate(
        &Some(call_registry::types::GATE_MIN_XLM_BALANCE),
        &0u32,
        &2_000_000_000i128,
        &0u32,
        &None,
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
        ipfs_cid: Bytes::from_slice(&env, b"QmTestGates"),
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

    // This should panic due to insufficient XLM balance
    registry_client.stake_on_call(&staker, &1u64, &50_000_000_i128, &OUTCOME_UP);
}

#[test]
fn test_holds_badge_allows_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let staker = Address::generate(&env);

    let token_id = env.register_contract(None, MockToken);
    let registry_id = env.register_contract(None, CallRegistry);
    let registry_client = CallRegistryClient::new(&env, &registry_id);

    let outcome_id = env.register_contract(None, OutcomeManager);
    let outcome_client = OutcomeManagerClient::new(&env, &outcome_id);
    let fee_collector = Address::generate(&env);
    let oracle_pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey);
    registry_client.initialize(&admin, &outcome_id, &1_000_000_i128);
    outcome_client.initialize(&admin, &oracles, &1u32, &fee_collector, &100u32, &3600u64);
    registry_client.whitelist_token(&token_id);

    // Register a badge contract (reuse MockToken which returns non-zero balance)
    let badge_id = env.register_contract(None, MockToken);
    // Set global gate to HoldsBadge and assign badge contract
    registry_client.set_global_gate(
        &Some(call_registry::types::GATE_HOLDS_BADGE),
        &0u32,
        &0i128,
        &0u32,
        &Some(badge_id.clone()),
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
        ipfs_cid: Bytes::from_slice(&env, b"QmTestGates"),
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

    // Should succeed because MockToken.balance() > 0 for badge contract
    let res = registry_client.stake_on_call(&staker, &1u64, &50_000_000_i128, &OUTCOME_UP);
    assert_eq!(
        res.outcome_stakes.get(OUTCOME_UP).unwrap_or(0),
        50_000_000_i128
    );
}
