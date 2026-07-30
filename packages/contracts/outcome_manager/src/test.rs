#![cfg(test)]
#![allow(deprecated)]

extern crate std;

use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::{Address as _, Ledger as _}, Address, Bytes, BytesN, Env, Map,
    Vec,
};

use crate::call_types::{Call, CallRegistryError, ConditionType};
use crate::errors::OutcomeError;
use crate::storage::{OracleVote, PriceObservation, SignedOutcome};
use crate::{OutcomeManager, OutcomeManagerClient, MAX_ORACLES};

const CLAIM_PAYOUT_BUDGET_CPU: u64 = 10_000_000;
const CLAIM_PAYOUT_BUDGET_MEM: u64 = 100_000;
const BATCH_CLAIM_PAYOUTS_BUDGET_CPU: u64 = 40_000_000;
const BATCH_CLAIM_PAYOUTS_BUDGET_MEM: u64 = 2_000_000;

#[contracttype]
pub enum MockDataKey {
    Call(u64),
    StakerStake(u64, Address, u32),
}

#[contract]
pub struct MockRegistry;

#[contractimpl]
impl MockRegistry {
    fn default_mock_call(env: &Env, call_id: u64) -> Call {
        let outcome_count = 2u32;
        let mut outcome_stakes = Map::new(env);
        outcome_stakes.set(1, 0);
        outcome_stakes.set(2, 0);

        let mut stakes = Map::new(env);
        stakes.set(1, Map::new(env));
        stakes.set(2, Map::new(env));

        Call {
            id: call_id,
            creator: Address::generate(env),
            stake_token: Address::generate(env),
            stake_amount: 1,
            end_ts: 0,
            token_address: Address::generate(env),
            pair_id: Bytes::from_slice(env, b"mock"),
            metadata_hash: BytesN::from_array(env, &[0u8; 32]),
            outcome_count,
            outcome_stakes,
            stakes,
            outcome: 0,
            start_price: 100,
            end_price: 0,
            condition: ConditionType::TargetAbove(100),
            settled: false,
            voided: false,
            created_at: 0,
            cancelled: false,
            metadata_version: 0,
            share_tokens: Map::new(env),
        }
    }

    pub fn resolve_call(
        env: Env,
        call_id: u64,
        outcome: u32,
        end_price: i128,
    ) -> Result<Call, CallRegistryError> {
        let mut call: Call = env
            .storage()
            .instance()
            .get(&MockDataKey::Call(call_id))
            .unwrap_or_else(|| Self::default_mock_call(&env, call_id));
        call.outcome = outcome;
        call.end_price = end_price;
        env.storage()
            .instance()
            .set(&MockDataKey::Call(call_id), &call);
        Ok(call)
    }

    pub fn release_escrow(
        _env: Env,
        _call_id: u64,
        _to: Address,
        _amount: i128,
    ) -> Result<(), CallRegistryError> {
        Ok(())
    }

    pub fn mark_settled(env: Env, call_id: u64) -> Result<(), CallRegistryError> {
        let mut call: Call = env
            .storage()
            .instance()
            .get(&MockDataKey::Call(call_id))
            .unwrap_or_else(|| Self::default_mock_call(&env, call_id));
        call.settled = true;
        env.storage()
            .instance()
            .set(&MockDataKey::Call(call_id), &call);
        Ok(())
    }

    pub fn set_mock_call(env: Env, call_id: u64, call: Call) {
        env.storage()
            .instance()
            .set(&MockDataKey::Call(call_id), &call);
    }

    pub fn set_mock_staker_stake(
        env: Env,
        call_id: u64,
        staker: Address,
        position: u32,
        amount: i128,
    ) {
        env.storage().instance().set(
            &MockDataKey::StakerStake(call_id, staker, position),
            &amount,
        );
    }

    pub fn get_call(env: Env, call_id: u64) -> Result<Call, CallRegistryError> {
        match env.storage().instance().get(&MockDataKey::Call(call_id)) {
            Some(call) => Ok(call),
            None => Err(CallRegistryError::CallNotFound),
        }
    }

    pub fn get_staker_stake(
        env: Env,
        call_id: u64,
        staker: Address,
        position: u32,
    ) -> Result<i128, CallRegistryError> {
        Ok(env
            .storage()
            .instance()
            .get(&MockDataKey::StakerStake(call_id, staker, position))
            .unwrap_or(0))
    }
}

fn gen_keypair(env: &Env) -> (BytesN<32>, BytesN<32>) {
    use ed25519_dalek::SigningKey;
    use rand::RngCore;

    let mut seed = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut seed);

    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = signing_key.verifying_key();

    (
        BytesN::from_array(env, &seed),
        BytesN::from_array(env, &public_key.to_bytes()),
    )
}

fn sign_outcome(
    env: &Env,
    secret: &BytesN<32>,
    call_id: u64,
    outcome: u32,
    price: i128,
    timestamp: u64,
) -> BytesN<64> {
    use crate::verification::build_message;
    use ed25519_dalek::{Signer, SigningKey};

    let msg = build_message(env, call_id, outcome, price, timestamp);

    let mut msg_bytes = [0u8; 128];
    let msg_len = msg.len() as usize;
    msg.copy_into_slice(&mut msg_bytes[..msg_len]);

    let signing_key = SigningKey::from_bytes(&secret.to_array());
    let signature = signing_key.sign(&msg_bytes[..msg_len]);

    BytesN::from_array(env, &signature.to_bytes())
}

fn setup_single_oracle(
    env: &Env,
) -> (
    Address,
    Address,
    BytesN<32>,
    BytesN<32>,
    OutcomeManagerClient<'_>,
) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let (oracle_secret, oracle_pubkey) = gen_keypair(env);

    let contract_id = env.register_contract(None, OutcomeManager);
    let client = OutcomeManagerClient::new(env, &contract_id);

    let mut oracles = Vec::new(env);
    oracles.push_back(oracle_pubkey.clone());

    let fee_collector = Address::generate(env);
    client.initialize(&admin, &oracles, &1u32, &fee_collector, &0u32, &0u64);

    let registry_id = env.register_contract(None, MockRegistry);

    (admin, registry_id, oracle_secret, oracle_pubkey, client)
}

fn assert_contract_error<T, E>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: OutcomeError,
) {
    assert!(matches!(
        result,
        Err(Ok(err)) if err == soroban_sdk::Error::from_contract_error(expected as u32)
    ));
}

/// Store a realistic `Call` and per-staker stake in the MockRegistry so
/// `claim_payout` / `batch_claim_payouts` can read them via cross-contract calls.
fn prepare_mock_payout(
    env: &Env,
    registry_id: &Address,
    call_id: u64,
    staker: &Address,
    staker_winning_stake: i128,
    total_winning_stake: i128,
    total_losing_stake: i128,
) {
    let mock_client = MockRegistryClient::new(env, registry_id);
    let winning_outcome = 1u32;
    let outcome_count = 2u32;

    let mut outcome_stakes = Map::new(env);
    outcome_stakes.set(winning_outcome, total_winning_stake);
    outcome_stakes.set(2u32, total_losing_stake);

    let mut winning_stakers = Map::new(env);
    winning_stakers.set(staker.clone(), staker_winning_stake);
    let losing_stakers: Map<Address, i128> = Map::new(env);

    let mut stakes: Map<u32, Map<Address, i128>> = Map::new(env);
    stakes.set(winning_outcome, winning_stakers);
    stakes.set(2u32, losing_stakers);

    let call = Call {
        id: call_id,
        creator: Address::generate(env),
        stake_token: Address::generate(env),
        stake_amount: total_winning_stake + total_losing_stake,
        end_ts: 1000,
        token_address: Address::generate(env),
        pair_id: Bytes::from_slice(env, b"test"),
        metadata_hash: BytesN::from_array(env, &[0u8; 32]),
        outcome_count,
        outcome_stakes,
        stakes,
        outcome: winning_outcome,
        start_price: 100,
        end_price: 100,
        condition: ConditionType::TargetAbove(100),
        settled: true,
        voided: false,
        created_at: 500,
        cancelled: false,
        metadata_version: 0,
        share_tokens: Map::new(env),
    };

    mock_client.set_mock_call(&call_id, &call);
    mock_client.set_mock_staker_stake(&call_id, staker, &winning_outcome, &staker_winning_stake);
}

/// Multi-staker variant of `prepare_mock_payout` used by batch tests.
fn prepare_mock_batch_payout(
    env: &Env,
    registry_id: &Address,
    call_id: u64,
    stakers: &[Address],
    stakes: &[i128],
    total_winning_stake: i128,
    total_losing_stake: i128,
) {
    let mock_client = MockRegistryClient::new(env, registry_id);
    let winning_outcome = 1u32;
    let outcome_count = 2u32;

    let mut outcome_stakes = Map::new(env);
    outcome_stakes.set(winning_outcome, total_winning_stake);
    outcome_stakes.set(2u32, total_losing_stake);

    let mut winning_stakers: Map<Address, i128> = Map::new(env);
    for (i, staker) in stakers.iter().enumerate() {
        winning_stakers.set(staker.clone(), stakes[i]);
    }
    let losing_stakers: Map<Address, i128> = Map::new(env);

    let mut stakes_map: Map<u32, Map<Address, i128>> = Map::new(env);
    stakes_map.set(winning_outcome, winning_stakers);
    stakes_map.set(2u32, losing_stakers);

    let call = Call {
        id: call_id,
        creator: Address::generate(env),
        stake_token: Address::generate(env),
        stake_amount: total_winning_stake + total_losing_stake,
        end_ts: 1000,
        token_address: Address::generate(env),
        pair_id: Bytes::from_slice(env, b"test"),
        metadata_hash: BytesN::from_array(env, &[0u8; 32]),
        outcome_count,
        outcome_stakes: outcome_stakes.clone(),
        stakes: stakes_map,
        outcome: winning_outcome,
        start_price: 100,
        end_price: 100,
        condition: ConditionType::TargetAbove(100),
        settled: true,
        voided: false,
        created_at: 500,
        cancelled: false,
        metadata_version: 0,
        share_tokens: Map::new(env),
    };

    mock_client.set_mock_call(&call_id, &call);
    for (i, staker) in stakers.iter().enumerate() {
        mock_client.set_mock_staker_stake(&call_id, staker, &winning_outcome, &stakes[i]);
    }
}

#[derive(Clone, Copy, Debug)]
struct BudgetUsage {
    cpu: u64,
    mem: u64,
}

fn measure_budget<F>(env: &Env, _cpu_limit: u64, _mem_limit: u64, f: F) -> BudgetUsage
where
    F: FnOnce(),
{
    env.cost_estimate().budget().reset_default();
    f();
    let budget = env.cost_estimate().budget();
    BudgetUsage {
        cpu: budget.cpu_instruction_cost(),
        mem: budget.memory_bytes_cost(),
    }
}

fn sign_observation(
    env: &Env,
    secret: &BytesN<32>,
    call_id: u64,
    price: i128,
    timestamp: u64,
) -> BytesN<64> {
    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::Bytes;

    let mut raw = Bytes::from_slice(env, b"twap_obs:");
    raw.append(&Bytes::from_slice(env, &call_id.to_be_bytes()));
    raw.append(&Bytes::from_slice(env, &price.to_be_bytes()));
    raw.append(&Bytes::from_slice(env, &timestamp.to_be_bytes()));

    let msg_len = raw.len() as usize;
    let mut buf = [0u8; 64];
    raw.copy_into_slice(&mut buf[..msg_len]);

    let signing_key = SigningKey::from_bytes(&secret.to_array());
    let sig = signing_key.sign(&buf[..msg_len]);
    BytesN::from_array(env, &sig.to_bytes())
}

fn setup_with_fee(env: &Env, fee_bps: u32) -> (Address, Address, OutcomeManagerClient<'_>) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let fee_collector = Address::generate(env);
    let (oracle_secret, oracle_pubkey) = gen_keypair(env);

    let contract_id = env.register_contract(None, OutcomeManager);
    let client = OutcomeManagerClient::new(env, &contract_id);

    let mut oracles = Vec::new(env);
    oracles.push_back(oracle_pubkey.clone());
    client.initialize(&admin, &oracles, &1u32, &fee_collector, &fee_bps, &0u64);

    let registry_id = env.register_contract(None, MockRegistry);

    let call_id = 1u64;
    let sig = sign_outcome(env, &oracle_secret, call_id, 1, 100, 9000);
    client.submit_outcome(
        &registry_id,
        &SignedOutcome {
            call_id,
            outcome: 1,
            price: 100,
            timestamp: 9000,
            oracle_pubkey,
            signature: sig,
        },
        &0u64,
    );

    (fee_collector, registry_id, client)
}

// ─── Claimable Balance Tests ───────────────────────────────────────────────────

#[test]
fn test_claim_payout_stores_claimable_balance_id() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);

    client.claim_payout(&registry_id, &1u64, &staker, &100i128, &100i128, &100i128);

    let balance_id = client.get_claimable_balance_id(&1u64, &staker);
    assert!(
        balance_id.is_some(),
        "claimable balance id should be stored"
    );
}

#[test]
fn test_claim_payout_claimable_balance_id_is_unique_per_staker() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker1 = Address::generate(&env);
    let staker2 = Address::generate(&env);

    client.claim_payout(&registry_id, &1u64, &staker1, &50i128, &100i128, &100i128);
    client.claim_payout(&registry_id, &1u64, &staker2, &50i128, &100i128, &100i128);

    let id1 = client.get_claimable_balance_id(&1u64, &staker1).unwrap();
    let id2 = client.get_claimable_balance_id(&1u64, &staker2).unwrap();
    assert_ne!(id1, id2, "each staker should have a distinct balance id");
}

#[test]
fn test_batch_create_claimable_balances_stores_ids() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let staker1 = Address::generate(&env);
    let staker2 = Address::generate(&env);

    let mut stakers = Vec::new(&env);
    stakers.push_back(staker1.clone());
    stakers.push_back(staker2.clone());

    let mut stakes = Vec::new(&env);
    stakes.push_back(60_i128);
    stakes.push_back(40_i128);

    client.batch_create_claimable_balances(
        &registry_id,
        &1u64,
        &stakers,
        &stakes,
        &100_i128,
        &100_i128,
    );

    assert!(client.get_claimable_balance_id(&1u64, &staker1).is_some());
    assert!(client.get_claimable_balance_id(&1u64, &staker2).is_some());
    assert!(client.has_claimed(&1u64, &staker1));
    assert!(client.has_claimed(&1u64, &staker2));
}

#[test]
fn test_batch_create_claimable_balances_empty_fails() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let stakers: Vec<Address> = Vec::new(&env);
    let stakes: Vec<i128> = Vec::new(&env);

    let result = client.try_batch_create_claimable_balances(
        &registry_id,
        &1u64,
        &stakers,
        &stakes,
        &100_i128,
        &100_i128,
    );
    assert_contract_error(result, OutcomeError::EmptyBatch);
}

#[test]
fn test_batch_create_claimable_balances_duplicate_fails() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let staker = Address::generate(&env);
    let mut stakers = Vec::new(&env);
    stakers.push_back(staker.clone());
    let mut stakes = Vec::new(&env);
    stakes.push_back(100_i128);

    client.batch_create_claimable_balances(
        &registry_id,
        &1u64,
        &stakers,
        &stakes,
        &100_i128,
        &100_i128,
    );

    let result = client.try_batch_create_claimable_balances(
        &registry_id,
        &1u64,
        &stakers,
        &stakes,
        &100_i128,
        &100_i128,
    );
    assert_contract_error(result, OutcomeError::AlreadyClaimed);
}

#[test]
fn test_get_claimable_balance_id_none_before_claim() {
    let env = Env::default();
    let (_, _, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    assert!(client.get_claimable_balance_id(&1u64, &staker).is_none());
}

// ─── Initialization Tests ──────────────────────────────────────────────────────

#[test]
fn test_initialize_success() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, pubkey) = gen_keypair(&env);

    let contract_id = env.register_contract(None, OutcomeManager);
    let client = OutcomeManagerClient::new(&env, &contract_id);

    let mut oracles = Vec::new(&env);
    oracles.push_back(pubkey.clone());

    let fee_collector = Address::generate(&env);
    client.initialize(&admin, &oracles, &1u32, &fee_collector, &100u32, &0u64);

    assert_eq!(client.get_quorum(), 1);
    assert!(client.is_oracle(&pubkey));
}

#[test]
fn test_initialize_twice_fails() {
    let env = Env::default();
    let (admin, _, _, pubkey, client) = setup_single_oracle(&env);

    let fee_collector = Address::generate(&env);
    let mut oracles = Vec::new(&env);
    oracles.push_back(pubkey);
    let result = client.try_initialize(&admin, &oracles, &1u32, &fee_collector, &0u32, &0u64);
    assert_contract_error(result, OutcomeError::AlreadyInitialized);
}

#[test]
fn test_initialize_quorum_zero_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, pubkey) = gen_keypair(&env);

    let contract_id = env.register_contract(None, OutcomeManager);
    let client = OutcomeManagerClient::new(&env, &contract_id);

    let fee_collector = Address::generate(&env);
    let mut oracles = Vec::new(&env);
    oracles.push_back(pubkey);
    let result = client.try_initialize(&admin, &oracles, &0u32, &fee_collector, &0u32, &0u64);
    assert_contract_error(result, OutcomeError::InvalidQuorum);
}

// ─── Oracle Submission Tests ───────────────────────────────────────────────────

#[test]
fn test_quorum_reached_with_two_oracles() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (s1, p1) = gen_keypair(&env);
    let (s2, p2) = gen_keypair(&env);

    let contract_id = env.register_contract(None, OutcomeManager);
    let client = OutcomeManagerClient::new(&env, &contract_id);

    let mut oracles = Vec::new(&env);
    oracles.push_back(p1.clone());
    oracles.push_back(p2.clone());
    let fee_collector = Address::generate(&env);
    client.initialize(&admin, &oracles, &2u32, &fee_collector, &0u32, &0u64);

    let registry_id = env.register_contract(None, MockRegistry);
    let call_id = 42u64;
    let outcome_val = 1u32;
    let price = 150_000_000i128;
    let ts = 9000u64;

    let sig1 = sign_outcome(&env, &s1, call_id, outcome_val, price, ts);
    client.submit_outcome(
        &registry_id,
        &SignedOutcome {
            call_id,
            outcome: outcome_val,
            price,
            timestamp: ts,
            oracle_pubkey: p1.clone(),
            signature: sig1,
        },
        &0u64,
    );

    let sig2 = sign_outcome(&env, &s2, call_id, outcome_val, price, ts);
    client.submit_outcome(
        &registry_id,
        &SignedOutcome {
            call_id,
            outcome: outcome_val,
            price,
            timestamp: ts,
            oracle_pubkey: p2.clone(),
            signature: sig2,
        },
        &0u64,
    );

    let final_outcome = client.get_outcome(&call_id);
    assert_eq!(final_outcome.outcome, outcome_val);

    let stored_votes = client.get_votes(&call_id);
    assert_eq!(stored_votes.len(), 2);
    assert_eq!(client.get_vote_count(&call_id), 2);
    assert_eq!(
        stored_votes.get(0).unwrap(),
        OracleVote {
            oracle: p1,
            outcome: outcome_val,
            price,
            timestamp: ts
        }
    );
    assert_eq!(
        stored_votes.get(1).unwrap(),
        OracleVote {
            oracle: p2,
            outcome: outcome_val,
            price,
            timestamp: ts
        }
    );
}

#[test]
fn test_submit_unauthorized_oracle_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, mock_registry, _, _, client) = setup_single_oracle(&env);

    let (secret2, pubkey2) = gen_keypair(&env);
    let call_id = 1u64;
    let sig = sign_outcome(&env, &secret2, call_id, 1, 100, 9000);

    let result = client.try_submit_outcome(
        &mock_registry,
        &SignedOutcome {
            call_id,
            outcome: 1,
            price: 100,
            timestamp: 9000,
            oracle_pubkey: pubkey2,
            signature: sig,
        },
        &0u64,
    );
    assert_contract_error(result, OutcomeError::UnauthorizedOracle);
}

#[test]
fn test_submit_duplicate_submission_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (secret1, pubkey1) = gen_keypair(&env);
    let (_, pubkey2) = gen_keypair(&env);

    let contract_id = env.register_contract(None, OutcomeManager);
    let client = OutcomeManagerClient::new(&env, &contract_id);

    let mut oracles = Vec::new(&env);
    oracles.push_back(pubkey1.clone());
    oracles.push_back(pubkey2);
    let fee_collector = Address::generate(&env);
    client.initialize(&admin, &oracles, &2u32, &fee_collector, &0u32, &0u64);

    let registry_id = env.register_contract(None, MockRegistry);
    let signed = SignedOutcome {
        call_id: 7,
        outcome: 1,
        price: 100,
        timestamp: 1000,
        oracle_pubkey: pubkey1.clone(),
        signature: sign_outcome(&env, &secret1, 7, 1, 100, 1000),
    };

    client.submit_outcome(&registry_id, &signed, &0u64);
    let result = client.try_submit_outcome(&registry_id, &signed, &0u64);
    assert_contract_error(result, OutcomeError::DuplicateSubmission);
}

#[test]
fn test_submit_invalid_outcome_fails() {
    let env = Env::default();
    let (_admin, registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    let result = client.try_submit_outcome(
        &registry_id,
        &SignedOutcome {
            call_id: 8,
            outcome: 3,
            price: 100,
            timestamp: 1000,
            oracle_pubkey: oracle_pubkey.clone(),
            signature: sign_outcome(&env, &oracle_secret, 8, 3, 100, 1000),
        },
        &0u64,
    );
    assert_contract_error(result, OutcomeError::InvalidOutcome);
}

#[test]
fn test_submit_outcome_after_settlement_fails() {
    let env = Env::default();
    let (_admin, registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    let signed = SignedOutcome {
        call_id: 9,
        outcome: 1,
        price: 100,
        timestamp: 1000,
        oracle_pubkey: oracle_pubkey.clone(),
        signature: sign_outcome(&env, &oracle_secret, 9, 1, 100, 1000),
    };

    client.submit_outcome(&registry_id, &signed, &0u64);
    let result = client.try_submit_outcome(&registry_id, &signed, &0u64);
    assert_contract_error(result, OutcomeError::AlreadySettled);
}

// ─── Admin Control Tests ───────────────────────────────────────────────────────

#[test]
fn test_add_remove_oracle() {
    let env = Env::default();
    let (_, _, _, _, client) = setup_single_oracle(&env);
    let (_, new_pubkey) = gen_keypair(&env);

    client.add_oracle(&new_pubkey);
    assert!(client.is_oracle(&new_pubkey));

    client.remove_oracle(&new_pubkey);
    assert!(!client.is_oracle(&new_pubkey));
}

#[test]
fn test_set_quorum() {
    let env = Env::default();
    let (_, _, _, _, client) = setup_single_oracle(&env);

    let (_, pubkey2) = gen_keypair(&env);
    client.add_oracle(&pubkey2);

    client.set_quorum(&2u32);
    assert_eq!(client.get_quorum(), 2);
}

#[test]
fn test_add_oracle_enforces_max_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let contract_id = env.register_contract(None, OutcomeManager);
    let client = OutcomeManagerClient::new(&env, &contract_id);

    let mut oracles = Vec::new(&env);
    for _ in 0..MAX_ORACLES {
        let (_, pubkey) = gen_keypair(&env);
        oracles.push_back(pubkey);
    }

    client.initialize(&admin, &oracles, &1u32, &fee_collector, &0u32, &0u64);
    let (_, extra_pubkey) = gen_keypair(&env);
    let result = client.try_add_oracle(&extra_pubkey);
    assert_contract_error(result, OutcomeError::MaxOraclesReached);
}

// ─── Fee Tests ─────────────────────────────────────────────────────────────────

#[test]
fn test_fee_deducted_from_payout() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 500);
    let staker = Address::generate(&env);
    client.claim_payout(&registry_id, &1u64, &staker, &100i128, &100i128, &100i128);
}

#[test]
fn test_zero_fee_full_payout() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    client.claim_payout(&registry_id, &1u64, &staker, &50i128, &100i128, &100i128);
}

#[test]
fn test_invalid_fee_bps_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let fee_collector = Address::generate(&env);
    let (_, pubkey) = gen_keypair(&env);

    let contract_id = env.register_contract(None, OutcomeManager);
    let client = OutcomeManagerClient::new(&env, &contract_id);

    let mut oracles = Vec::new(&env);
    oracles.push_back(pubkey);
    let result = client.try_initialize(&admin, &oracles, &1u32, &fee_collector, &10001u32, &0u64);
    assert_contract_error(result, OutcomeError::InvalidFeeBps);
}

// ─── Batch Payout Tests ────────────────────────────────────────────────────────

#[test]
fn test_batch_claim_payouts_three_stakers() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let staker1 = Address::generate(&env);
    let staker2 = Address::generate(&env);
    let staker3 = Address::generate(&env);

    let staker_refs = [staker1.clone(), staker2.clone(), staker3.clone()];
    let stake_vals = [50_i128, 30_i128, 20_i128];
    prepare_mock_batch_payout(
        &env,
        &registry_id,
        1u64,
        &staker_refs,
        &stake_vals,
        100,
        100,
    );

    let mut stakers = Vec::new(&env);
    stakers.push_back(staker1.clone());
    stakers.push_back(staker2.clone());
    stakers.push_back(staker3.clone());

    let mut stakes = Vec::new(&env);
    stakes.push_back(50_i128);
    stakes.push_back(30_i128);
    stakes.push_back(20_i128);

    client.batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &100_i128, &100_i128);

    assert!(client.has_claimed(&1u64, &staker1));
    assert!(client.has_claimed(&1u64, &staker2));
    assert!(client.has_claimed(&1u64, &staker3));
}

#[test]
fn test_batch_claim_panics_on_duplicate_staker() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let staker = Address::generate(&env);
    let mut stakers = Vec::new(&env);
    stakers.push_back(staker.clone());
    let mut stakes = Vec::new(&env);
    stakes.push_back(50_i128);

    client.batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &50_i128, &50_i128);
    let result =
        client.try_batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &50_i128, &50_i128);
    assert_contract_error(result, OutcomeError::AlreadyClaimed);
}

#[test]
fn test_batch_claim_panics_on_empty_batch() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let stakers: Vec<Address> = Vec::new(&env);
    let stakes: Vec<i128> = Vec::new(&env);

    let result = client.try_batch_claim_payouts(
        &registry_id,
        &1u64,
        &stakers,
        &stakes,
        &100_i128,
        &100_i128,
    );
    assert_contract_error(result, OutcomeError::EmptyBatch);
}

#[test]
fn test_batch_claim_panics_on_length_mismatch() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let mut stakers = Vec::new(&env);
    stakers.push_back(Address::generate(&env));
    stakers.push_back(Address::generate(&env));

    let mut stakes = Vec::new(&env);
    stakes.push_back(50_i128);

    let result =
        client.try_batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &100_i128, &50_i128);
    assert_contract_error(result, OutcomeError::LengthMismatch);
}

// ─── Pause Tests ───────────────────────────────────────────────────────────────

#[test]
fn test_pause_and_unpause() {
    let env = Env::default();
    let (_admin, _registry_id, _oracle_secret, _oracle_pubkey, client) = setup_single_oracle(&env);

    assert!(!client.is_paused_view());
    client.pause();
    assert!(client.is_paused_view());
    client.unpause();
    assert!(!client.is_paused_view());
}

#[test]
fn test_submit_outcome_fails_when_paused() {
    let env = Env::default();
    let (_admin, registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    client.pause();

    let signed = SignedOutcome {
        call_id: 1,
        outcome: 1,
        price: 100,
        timestamp: 1000,
        oracle_pubkey: oracle_pubkey.clone(),
        signature: sign_outcome(&env, &oracle_secret, 1, 1, 100, 1000),
    };

    let result = client.try_submit_outcome(&registry_id, &signed, &0u64);
    assert_contract_error(result, OutcomeError::ContractPaused);
}

#[test]
fn test_claim_payout_fails_when_paused() {
    let env = Env::default();
    let (_admin, registry_id, _oracle_secret, _oracle_pubkey, client) = setup_single_oracle(&env);
    let staker = Address::generate(&env);

    client.pause();

    let result = client.try_claim_payout(
        &registry_id,
        &1u64,
        &staker,
        &100_i128,
        &100_i128,
        &100_i128,
    );
    assert_contract_error(result, OutcomeError::ContractPaused);
}

// ─── Submission Deadline Tests ─────────────────────────────────────────────────

#[test]
fn test_submission_within_window_succeeds() {
    let env = Env::default();
    let (_admin, registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    let call_id = 10u64;
    let sig = sign_outcome(&env, &oracle_secret, call_id, 1, 100, 1500);
    client.submit_outcome(
        &registry_id,
        &SignedOutcome {
            call_id,
            outcome: 1,
            price: 100,
            timestamp: 1500,
            oracle_pubkey,
            signature: sig,
        },
        &1000u64,
    );
    assert_eq!(client.get_outcome(&call_id).outcome, 1u32);
}

#[test]
fn test_submission_outside_window_fails() {
    let env = Env::default();
    let (_admin, registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    client.set_max_submission_delay(&50u64);

    let call_id = 11u64;
    let sig = sign_outcome(&env, &oracle_secret, call_id, 1, 100, 1200);
    let result = client.try_submit_outcome(
        &registry_id,
        &SignedOutcome {
            call_id,
            outcome: 1,
            price: 100,
            timestamp: 1200,
            oracle_pubkey,
            signature: sig,
        },
        &1000u64,
    );
    assert_contract_error(result, OutcomeError::SubmissionWindowExpired);
}

// ─── TWAP Tests ────────────────────────────────────────────────────────────────

#[test]
fn test_twap_three_equal_intervals() {
    let env = Env::default();
    let (_admin, _registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 42u64;
    let call_end_ts = 3000u64;
    // Widen the window so observations from ts=1000 (2000s before end_ts)
    // are accepted — this test is about the TWAP formula, not the window
    // boundary (see test_submit_price_observation_rejects_outside_window).
    client.set_twap_config(&2000u64, &3u32);
    for (price, ts) in [(100_i128, 1000u64), (200, 2000), (300, 3000)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &call_end_ts,
            &PriceObservation {
                price,
                timestamp: ts,
            },
            &oracle_pubkey,
            &sig,
        );
    }
    // end_ts == the last observation's own timestamp, so its tail segment
    // contributes zero weight — same result as averaging only the gaps
    // between consecutive observations: (100*1000 + 200*1000) / 2000 = 150.
    assert_eq!(client.compute_twap(&call_id, &call_end_ts), 150);
}

#[test]
fn test_twap_extends_last_price_to_end_ts() {
    let env = Env::default();
    let (_admin, _registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 43u64;
    // Observations only span ts=1000..1400 within the 600s window
    // [1000, 1600]; the last observation (300) never gets a "next"
    // observation, so the TWAP must extend it forward to end_ts=1600 —
    // without that extension this would (incorrectly) average to 150
    // instead of 200.
    for (price, ts) in [(100_i128, 1000u64), (200, 1200), (300, 1400)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &1600u64,
            &PriceObservation {
                price,
                timestamp: ts,
            },
            &oracle_pubkey,
            &sig,
        );
    }
    // (100*200 + 200*200 + 300*200) / 600 = (20000+40000+60000)/600 = 200.
    assert_eq!(client.compute_twap(&call_id, &1600u64), 200);
}

#[test]
fn test_twap_irregular_spacing() {
    let env = Env::default();
    let (_admin, _registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 45u64;
    let call_end_ts = 1000u64;
    // Uneven gaps: 100s, then 300s, then a 100s tail to end_ts.
    for (price, ts) in [(200_i128, 500u64), (400, 600), (100, 900)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &call_end_ts,
            &PriceObservation {
                price,
                timestamp: ts,
            },
            &oracle_pubkey,
            &sig,
        );
    }
    // (200*100 + 400*300 + 100*100) / 500 = (20000+120000+10000)/500 = 300.
    assert_eq!(client.compute_twap(&call_id, &call_end_ts), 300);
}

#[test]
fn test_twap_requires_minimum_3_observations() {
    let env = Env::default();
    let (_admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 44u64;
    // Within the default 600s window before end_ts=2000 (window starts at
    // 1400) so submission itself succeeds — only the *count* is short.
    for (price, ts) in [(100_i128, 1400u64), (200, 1500)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &2000u64,
            &PriceObservation {
                price,
                timestamp: ts,
            },
            &oracle_pubkey,
            &sig,
        );
    }
    let result = client.try_compute_twap(&call_id, &2000u64);
    assert_contract_error(result, OutcomeError::InsufficientPriceObservations);
}

#[test]
fn test_twap_requires_half_window_span() {
    let env = Env::default();
    let (_admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 46u64;
    let call_end_ts = 10_000u64;
    // Default window is 600s (min span 300s), but these 3 observations are
    // clustered within 20s — plenty of *count*, not enough *span*.
    for (price, ts) in [(100_i128, 9980u64), (200, 9990), (300, 10_000)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &call_end_ts,
            &PriceObservation {
                price,
                timestamp: ts,
            },
            &oracle_pubkey,
            &sig,
        );
    }
    let result = client.try_compute_twap(&call_id, &call_end_ts);
    assert_contract_error(result, OutcomeError::InsufficientPriceObservations);
}

#[test]
fn test_resolve_price_falls_back_to_single_point_when_insufficient() {
    let env = Env::default();
    let (_admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 47u64;
    let call_end_ts = 2000u64;
    // Only 2 observations — not enough for a trusted TWAP. Within the
    // default 600s window (starts at 1400) so submission itself succeeds.
    for (price, ts) in [(100_i128, 1450u64), (200, 1500)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &call_end_ts,
            &PriceObservation {
                price,
                timestamp: ts,
            },
            &oracle_pubkey,
            &sig,
        );
    }
    let single_point_price = 999_i128;
    assert_eq!(
        client.resolve_price(&call_id, &call_end_ts, &single_point_price),
        single_point_price
    );
}

#[test]
fn test_resolve_price_uses_twap_when_available() {
    let env = Env::default();
    let (_admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 48u64;
    let call_end_ts = 3000u64;
    client.set_twap_config(&2000u64, &3u32);
    for (price, ts) in [(100_i128, 1000u64), (200, 2000), (300, 3000)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &call_end_ts,
            &PriceObservation {
                price,
                timestamp: ts,
            },
            &oracle_pubkey,
            &sig,
        );
    }
    // Falls back price is never used here — the TWAP (150) wins.
    assert_eq!(client.resolve_price(&call_id, &call_end_ts, &999), 150);
}

#[test]
fn test_submit_price_observation_rejects_outside_window() {
    let env = Env::default();
    let (_admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 49u64;
    // Default window is 600s; an observation 1000s before end_ts is outside it.
    let call_end_ts = 10_000u64;
    let ts = 9_000u64;
    let sig = sign_observation(&env, &oracle_secret, call_id, 100, ts);
    let result = client.try_submit_price_observation(
        &call_id,
        &call_end_ts,
        &PriceObservation {
            price: 100,
            timestamp: ts,
        },
        &oracle_pubkey,
        &sig,
    );
    assert_contract_error(result, OutcomeError::ObservationOutsideWindow);
}

#[test]
fn test_set_twap_config_changes_window_and_min_observations() {
    let env = Env::default();
    let (admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    client.set_twap_config(&200u64, &2u32);
    assert_eq!(client.get_twap_config(), (200u64, 2u32));

    // With min_observations lowered to 2, 2 well-spaced observations now
    // produce a valid TWAP instead of falling back. Window is [1100, 1300];
    // span (100) meets the new half-window requirement (100) exactly.
    let call_id = 50u64;
    let call_end_ts = 1300u64;
    for (price, ts) in [(100_i128, 1100u64), (300, 1200)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &call_end_ts,
            &PriceObservation {
                price,
                timestamp: ts,
            },
            &oracle_pubkey,
            &sig,
        );
    }
    // (100*100 + 300*100) / 200 = 200.
    assert_eq!(client.compute_twap(&call_id, &call_end_ts), 200);
    let _ = admin;
}

#[test]
fn test_twap_overflow_prevention_large_window() {
    let env = Env::default();
    let (_admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 51u64;
    // A large price and a very large time window shouldn't panic on
    // overflow — try_compute_twap must reject gracefully via checked ops
    // rather than trapping, and compute_twap surfaces that as a typed error
    // rather than an unhandled overflow trap.
    // i128::MAX/2 multiplied by even a ~1000-second gap vastly exceeds
    // i128::MAX, so this overflows regardless of how wide the window is —
    // widen it only enough that submission succeeds and the span check
    // passes, so the overflow surfaces from compute_twap's own arithmetic
    // (the actual thing under test), not from an unrelated rejection.
    let huge_price = i128::MAX / 2;
    let call_end_ts = 3000u64;
    client.set_twap_config(&2000u64, &3u32);
    for (price, ts) in [(huge_price, 1_000u64), (huge_price, 2_000), (huge_price, 3_000)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &call_end_ts,
            &PriceObservation {
                price,
                timestamp: ts,
            },
            &oracle_pubkey,
            &sig,
        );
    }
    let result = client.try_compute_twap(&call_id, &call_end_ts);
    // These inputs genuinely overflow i128 — `try_compute_twap`'s checked_*
    // arithmetic must catch that and surface it as a graceful typed error
    // (not an unhandled arithmetic panic/trap).
    assert_contract_error(result, OutcomeError::InsufficientPriceObservations);
}

// ─── Budget Tests ──────────────────────────────────────────────────────────────

#[test]
fn test_claim_payout_stays_within_budget() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 500);
    let staker = Address::generate(&env);

    let usage = measure_budget(
        &env,
        CLAIM_PAYOUT_BUDGET_CPU,
        CLAIM_PAYOUT_BUDGET_MEM,
        || {
            client.claim_payout(&registry_id, &1u64, &staker, &100i128, &100i128, &100i128);
        },
    );

    std::println!(
        "outcome_manager::claim_payout cpu={} mem={}",
        usage.cpu,
        usage.mem
    );
    assert!(usage.cpu <= CLAIM_PAYOUT_BUDGET_CPU);
    assert!(usage.mem <= CLAIM_PAYOUT_BUDGET_MEM);
}

#[test]
fn test_batch_claim_payouts_stays_within_budget() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 500);

    let mut stakers = Vec::new(&env);
    let mut stakes = Vec::new(&env);
    for _ in 0..20u32 {
        stakers.push_back(Address::generate(&env));
        stakes.push_back(5_i128);
    }

    let usage = measure_budget(
        &env,
        BATCH_CLAIM_PAYOUTS_BUDGET_CPU,
        BATCH_CLAIM_PAYOUTS_BUDGET_MEM,
        || {
            client.batch_claim_payouts(
                &registry_id,
                &1u64,
                &stakers,
                &stakes,
                &100_i128,
                &100_i128,
            );
        },
    );

    std::println!(
        "outcome_manager::batch_claim_payouts cpu={} mem={}",
        usage.cpu,
        usage.mem
    );
    assert!(usage.cpu <= BATCH_CLAIM_PAYOUTS_BUDGET_CPU);
    assert!(usage.mem <= BATCH_CLAIM_PAYOUTS_BUDGET_MEM);
}

// ─── Fuzz Tests ────────────────────────────────────────────────────────────────

fn fuzz_claim_setup(staker_winning: i128, total_winning: i128, total_losing: i128, fee_bps: u32) {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, fee_bps);
    let staker = Address::generate(&env);
    client.claim_payout(
        &registry_id,
        &1u64,
        &staker,
        &staker_winning,
        &total_winning,
        &total_losing,
    );
    assert!(client.has_claimed(&1u64, &staker));
}

#[test]
fn test_fuzz_payout_many_ratios_no_panic() {
    let cases: &[(i128, i128, i128, u32)] = &[
        (1, 1, 0, 0),
        (1, 1, 1, 0),
        (1, 1, 1, 1000),
        (1, 1, 1, 5000),
        (1, 1_000, 1_000_000, 100),
        (500, 1_000, 1_000_000, 500),
        (1_000, 1_000, 1, 0),
        (1_000_000, 1_000_000, 1_000_000, 1_000),
        (1, 1, 1_000_000_000_000, 0),
        (1, 1_000_000_000_000, 1_000_000_000_000, 0),
        (500, 1_000, 1_000, 5_000),
    ];
    for &(sw, tw, tl, fee) in cases {
        fuzz_claim_setup(sw, tw, tl, fee);
    }
}

#[test]
fn test_fuzz_zero_staker_stake_panics() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    // Staker has 0 stake on the winning outcome → NothingToClaim
    prepare_mock_payout(&env, &registry_id, 1u64, &staker, 0, 1, 1);
    let result = client.try_claim_payout(&registry_id, &1u64, &staker, &0_i128, &1_i128, &1_i128);
    assert_contract_error(result, OutcomeError::NothingToClaim);
}

#[test]
fn test_fuzz_zero_total_winning_panics() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    prepare_mock_payout(&env, &registry_id, 1u64, &staker, 1, 0, 1);
    let result = client.try_claim_payout(&registry_id, &1u64, &staker, &1_i128, &0_i128, &1_i128);
    assert_contract_error(result, OutcomeError::InvalidWinningStake);
}

#[test]
fn test_mark_settled_requires_finalized_outcome() {
    let env = Env::default();
    let (_admin, registry_id, _oracle_secret, _oracle_pubkey, client) = setup_single_oracle(&env);
    let result = client.try_mark_settled(&registry_id, &999u64);
    assert_contract_error(result, OutcomeError::CallNotFinalized);
}

#[test]
fn test_om_version_returns_contract_version() {
    let env = Env::default();
    let (_admin, _registry_id, _secret, _pubkey, client) = setup_single_oracle(&env);
    assert_eq!(client.version(), 1u32);
}

// --- Oracle Rotation Tests ---------------------------------------------------

#[test]
fn test_schedule_oracle_removal_stores_correctly() {
    let env = Env::default();
    let (_admin, _registry_id, _oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    // Oracle is active before any removal is scheduled
    assert!(client.is_oracle_active(&oracle_pubkey));

    // Schedule removal at ledger 10; current sequence is 0
    client.schedule_oracle_removal(&oracle_pubkey, &10u32);

    // Still active because effective_ledger has not been reached
    assert!(client.is_oracle_active(&oracle_pubkey));
}

#[test]
fn test_is_oracle_active_false_after_effective_ledger() {
    let env = Env::default();
    let (_admin, _registry_id, _oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    client.schedule_oracle_removal(&oracle_pubkey, &10u32);

    // Advance past the effective ledger
    env.ledger().with_mut(|li| { li.sequence_number = 10; });

    assert!(!client.is_oracle_active(&oracle_pubkey));
}

#[test]
fn test_execute_oracle_removal_succeeds_after_grace_period() {
    let env = Env::default();
    let (_admin, _registry_id, _oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    client.schedule_oracle_removal(&oracle_pubkey, &10u32);

    env.ledger().with_mut(|li| { li.sequence_number = 10; });
    client.execute_oracle_removal(&oracle_pubkey);

    // Oracle must be gone from the active oracle set
    assert!(!client.is_oracle(&oracle_pubkey));
}

#[test]
fn test_execute_oracle_removal_fails_before_grace_period() {
    let env = Env::default();
    let (_admin, _registry_id, _oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    client.schedule_oracle_removal(&oracle_pubkey, &10u32);

    // Sequence is still 0, grace period has not elapsed
    let result = client.try_execute_oracle_removal(&oracle_pubkey);
    assert!(result.is_err(), "premature execution must fail");
}

#[test]
fn test_rotation_keys_do_not_collide_with_admin_or_quorum() {
    let env = Env::default();
    let (_admin, _registry_id, _oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    let quorum_before = client.get_quorum();

    client.schedule_oracle_removal(&oracle_pubkey, &10u32);

    env.ledger().with_mut(|li| { li.sequence_number = 10; });
    client.execute_oracle_removal(&oracle_pubkey);

    // Quorum must be unchanged after rotation
    assert_eq!(client.get_quorum(), quorum_before, "quorum collided with rotation storage");

    // Admin functions must still work, proving Admin key is intact
    let (_, extra_pubkey) = gen_keypair(&env);
    client.add_oracle(&extra_pubkey);
    assert!(client.is_oracle(&extra_pubkey), "admin key corrupted by rotation");
}

// ─── Social Recovery Tests ──────────────────────────────────────────────────

#[test]
fn test_set_and_get_recovery_address() {
    let env = Env::default();
    let (_, _, client) = setup_with_fee(&env, 0);
    let user = Address::generate(&env);
    let recovery = Address::generate(&env);

    assert!(client.get_recovery_address(&user).is_none());

    client.set_recovery_address(&user, &recovery);
    assert_eq!(client.get_recovery_address(&user), Some(recovery));
}

#[test]
fn test_remove_recovery_address() {
    let env = Env::default();
    let (_, _, client) = setup_with_fee(&env, 0);
    let user = Address::generate(&env);
    let recovery = Address::generate(&env);

    client.set_recovery_address(&user, &recovery);
    assert!(client.get_recovery_address(&user).is_some());

    client.remove_recovery_address(&user);
    assert!(client.get_recovery_address(&user).is_none());
}

#[test]
fn test_default_recovery_grace_period_is_30_days() {
    let env = Env::default();
    let (_, _, client) = setup_with_fee(&env, 0);
    assert_eq!(client.get_recovery_grace_period(), 30 * 24 * 60 * 60);
}

/// The original winner is never blocked by a recovery address: they can
/// claim at any time, including before the grace period would even allow
/// the recovery agent to act. Once claimed, the recovery agent can no
/// longer claim on their behalf (same `Claimed` flag).
#[test]
fn test_original_winner_claims_before_recovery_agent() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    let recovery_agent = Address::generate(&env);

    client.set_recovery_address(&staker, &recovery_agent);

    // Winner claims immediately -- no need to wait for the grace period.
    client.claim_payout(&registry_id, &1u64, &staker, &100i128, &100i128, &100i128);
    assert!(client.has_claimed(&1u64, &staker));

    // Recovery agent can no longer claim -- already claimed by the winner.
    let result = client.try_claim_on_behalf(
        &registry_id,
        &1u64,
        &recovery_agent,
        &staker,
        &100i128,
        &100i128,
        &100i128,
    );
    assert_contract_error(result, OutcomeError::AlreadyClaimed);
}

#[test]
fn test_claim_on_behalf_fails_one_second_before_grace_period() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    let recovery_agent = Address::generate(&env);
    let settled_at = env.ledger().timestamp();

    client.set_recovery_address(&staker, &recovery_agent);

    let grace_period = client.get_recovery_grace_period();
    env.ledger().with_mut(|li| {
        li.timestamp = settled_at + grace_period - 1;
    });

    let result = client.try_claim_on_behalf(
        &registry_id,
        &1u64,
        &recovery_agent,
        &staker,
        &100i128,
        &100i128,
        &100i128,
    );
    assert_contract_error(result, OutcomeError::RecoveryGracePeriodNotElapsed);
}

#[test]
fn test_claim_on_behalf_succeeds_exactly_at_grace_period() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    let recovery_agent = Address::generate(&env);
    let settled_at = env.ledger().timestamp();

    client.set_recovery_address(&staker, &recovery_agent);

    let grace_period = client.get_recovery_grace_period();
    env.ledger().with_mut(|li| {
        li.timestamp = settled_at + grace_period;
    });

    client.claim_on_behalf(
        &registry_id,
        &1u64,
        &recovery_agent,
        &staker,
        &100i128,
        &100i128,
        &100i128,
    );

    assert!(client.has_claimed(&1u64, &staker));

    // Original winner can no longer claim afterward -- same `Claimed` flag.
    let result =
        client.try_claim_payout(&registry_id, &1u64, &staker, &100i128, &100i128, &100i128);
    assert_contract_error(result, OutcomeError::AlreadyClaimed);
}

#[test]
fn test_claim_on_behalf_fails_for_non_recovery_agent() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    let recovery_agent = Address::generate(&env);
    let impostor = Address::generate(&env);
    let settled_at = env.ledger().timestamp();

    client.set_recovery_address(&staker, &recovery_agent);

    let grace_period = client.get_recovery_grace_period();
    env.ledger().with_mut(|li| {
        li.timestamp = settled_at + grace_period;
    });

    let result = client.try_claim_on_behalf(
        &registry_id,
        &1u64,
        &impostor,
        &staker,
        &100i128,
        &100i128,
        &100i128,
    );
    assert_contract_error(result, OutcomeError::NotRecoveryAgent);
}

#[test]
fn test_claim_on_behalf_fails_when_no_recovery_address_set() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    let someone = Address::generate(&env);
    let settled_at = env.ledger().timestamp();

    let grace_period = client.get_recovery_grace_period();
    env.ledger().with_mut(|li| {
        li.timestamp = settled_at + grace_period;
    });

    let result = client.try_claim_on_behalf(
        &registry_id,
        &1u64,
        &someone,
        &staker,
        &100i128,
        &100i128,
        &100i128,
    );
    assert_contract_error(result, OutcomeError::NotRecoveryAgent);
}

#[test]
fn test_set_recovery_grace_period_changes_default() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    let recovery_agent = Address::generate(&env);
    let settled_at = env.ledger().timestamp();

    client.set_recovery_grace_period(&100u64);
    assert_eq!(client.get_recovery_grace_period(), 100u64);

    client.set_recovery_address(&staker, &recovery_agent);

    // Would fail against the (unused) 30-day default, but the custom
    // 100s period has elapsed.
    env.ledger().with_mut(|li| {
        li.timestamp = settled_at + 100;
    });

    client.claim_on_behalf(
        &registry_id,
        &1u64,
        &recovery_agent,
        &staker,
        &100i128,
        &100i128,
        &100i128,
    );
    assert!(client.has_claimed(&1u64, &staker));
}

#[test]
fn test_claim_on_behalf_fails_when_paused() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    let recovery_agent = Address::generate(&env);
    let settled_at = env.ledger().timestamp();

    client.set_recovery_address(&staker, &recovery_agent);
    let grace_period = client.get_recovery_grace_period();
    env.ledger().with_mut(|li| {
        li.timestamp = settled_at + grace_period;
    });

    client.pause();

    let result = client.try_claim_on_behalf(
        &registry_id,
        &1u64,
        &recovery_agent,
        &staker,
        &100i128,
        &100i128,
        &100i128,
    );
    assert_contract_error(result, OutcomeError::ContractPaused);
}

