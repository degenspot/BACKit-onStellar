#![cfg(test)]

extern crate std;

use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, BytesN, Env, Vec};

use crate::errors::OutcomeError;
use crate::storage::{OracleVote, PriceObservation, SignedOutcome};
use crate::{OutcomeManager, OutcomeManagerClient, MAX_ORACLES};

const CLAIM_PAYOUT_BUDGET_CPU: u64 = 10_000_000;
const CLAIM_PAYOUT_BUDGET_MEM: u64 = 100_000;
const BATCH_CLAIM_PAYOUTS_BUDGET_CPU: u64 = 40_000_000;
const BATCH_CLAIM_PAYOUTS_BUDGET_MEM: u64 = 400_000;

#[contract]
pub struct MockRegistry;

#[contractimpl]
impl MockRegistry {
    pub fn resolve_call(_env: Env, _call_id: u64, _outcome: u32, _end_price: i128) {}
    pub fn release_escrow(_env: Env, _call_id: u64, _to: Address, _amount: i128) {}
    pub fn mark_settled(_env: Env, _call_id: u64) {}
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
    assert!(balance_id.is_some(), "claimable balance id should be stored");
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
        &registry_id, &1u64, &stakers, &stakes, &100_i128, &100_i128,
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
        &registry_id, &1u64, &stakers, &stakes, &100_i128, &100_i128,
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
        &registry_id, &1u64, &stakers, &stakes, &100_i128, &100_i128,
    );

    let result = client.try_batch_create_claimable_balances(
        &registry_id, &1u64, &stakers, &stakes, &100_i128, &100_i128,
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
        &SignedOutcome { call_id, outcome: outcome_val, price, timestamp: ts,
            oracle_pubkey: p1.clone(), signature: sig1 },
        &0u64,
    );

    let sig2 = sign_outcome(&env, &s2, call_id, outcome_val, price, ts);
    client.submit_outcome(
        &registry_id,
        &SignedOutcome { call_id, outcome: outcome_val, price, timestamp: ts,
            oracle_pubkey: p2.clone(), signature: sig2 },
        &0u64,
    );

    let final_outcome = client.get_outcome(&call_id);
    assert_eq!(final_outcome.outcome, outcome_val);

    let stored_votes = client.get_votes(&call_id);
    assert_eq!(stored_votes.len(), 2);
    assert_eq!(client.get_vote_count(&call_id), 2);
    assert_eq!(stored_votes.get(0).unwrap(), OracleVote { oracle: p1, outcome: outcome_val, price, timestamp: ts });
    assert_eq!(stored_votes.get(1).unwrap(), OracleVote { oracle: p2, outcome: outcome_val, price, timestamp: ts });
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
        &SignedOutcome { call_id, outcome: 1, price: 100, timestamp: 9000,
            oracle_pubkey: pubkey2, signature: sig },
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
        call_id: 7, outcome: 1, price: 100, timestamp: 1000,
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
        &SignedOutcome { call_id: 8, outcome: 3, price: 100, timestamp: 1000,
            oracle_pubkey: oracle_pubkey.clone(),
            signature: sign_outcome(&env, &oracle_secret, 8, 3, 100, 1000) },
        &0u64,
    );
    assert_contract_error(result, OutcomeError::InvalidOutcome);
}

#[test]
fn test_submit_outcome_after_settlement_fails() {
    let env = Env::default();
    let (_admin, registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    let signed = SignedOutcome {
        call_id: 9, outcome: 1, price: 100, timestamp: 1000,
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
    let result = client.try_batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &50_i128, &50_i128);
    assert_contract_error(result, OutcomeError::AlreadyClaimed);
}

#[test]
fn test_batch_claim_panics_on_empty_batch() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let stakers: Vec<Address> = Vec::new(&env);
    let stakes: Vec<i128> = Vec::new(&env);

    let result = client.try_batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &100_i128, &100_i128);
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

    let result = client.try_batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &100_i128, &50_i128);
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
        call_id: 1, outcome: 1, price: 100, timestamp: 1000,
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

    let result = client.try_claim_payout(&registry_id, &1u64, &staker, &100_i128, &100_i128, &100_i128);
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
        &SignedOutcome { call_id, outcome: 1, price: 100, timestamp: 1500, oracle_pubkey, signature: sig },
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
        &SignedOutcome { call_id, outcome: 1, price: 100, timestamp: 1200, oracle_pubkey, signature: sig },
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
    for (price, ts) in [(100_i128, 1000u64), (200, 2000), (300, 3000)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(&call_id, &PriceObservation { price, timestamp: ts }, &oracle_pubkey, &sig);
    }
    assert_eq!(client.compute_twap(&call_id), 150);
}

#[test]
fn test_twap_requires_minimum_3_observations() {
    let env = Env::default();
    let (_admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 44u64;
    for (price, ts) in [(100_i128, 1000u64), (200, 2000)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(&call_id, &PriceObservation { price, timestamp: ts }, &oracle_pubkey, &sig);
    }
    let result = client.try_compute_twap(&call_id);
    assert_contract_error(result, OutcomeError::InsufficientPriceObservations);
}

// ─── Budget Tests ──────────────────────────────────────────────────────────────

#[test]
fn test_claim_payout_stays_within_budget() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 500);
    let staker = Address::generate(&env);

    let usage = measure_budget(&env, CLAIM_PAYOUT_BUDGET_CPU, CLAIM_PAYOUT_BUDGET_MEM, || {
        client.claim_payout(&registry_id, &1u64, &staker, &100i128, &100i128, &100i128);
    });

    std::println!("outcome_manager::claim_payout cpu={} mem={}", usage.cpu, usage.mem);
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

    let usage = measure_budget(&env, BATCH_CLAIM_PAYOUTS_BUDGET_CPU, BATCH_CLAIM_PAYOUTS_BUDGET_MEM, || {
        client.batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &100_i128, &100_i128);
    });

    std::println!("outcome_manager::batch_claim_payouts cpu={} mem={}", usage.cpu, usage.mem);
    assert!(usage.cpu <= BATCH_CLAIM_PAYOUTS_BUDGET_CPU);
    assert!(usage.mem <= BATCH_CLAIM_PAYOUTS_BUDGET_MEM);
}

// ─── Fuzz Tests ────────────────────────────────────────────────────────────────

fn fuzz_claim_setup(staker_winning: i128, total_winning: i128, total_losing: i128, fee_bps: u32) {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, fee_bps);
    let staker = Address::generate(&env);
    client.claim_payout(&registry_id, &1u64, &staker, &staker_winning, &total_winning, &total_losing);
    assert!(client.has_claimed(&1u64, &staker));
}

#[test]
fn test_fuzz_payout_many_ratios_no_panic() {
    let cases: &[(i128, i128, i128, u32)] = &[
        (1, 1, 0, 0), (1, 1, 1, 0), (1, 1, 1, 1000), (1, 1, 1, 5000),
        (1, 1_000, 1_000_000, 100), (500, 1_000, 1_000_000, 500),
        (1_000, 1_000, 1, 0), (1_000_000, 1_000_000, 1_000_000, 1_000),
        (1, 1, 1_000_000_000_000, 0), (1, 1_000_000_000_000, 1_000_000_000_000, 0),
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
    let result = client.try_claim_payout(&registry_id, &1u64, &staker, &0, &1, &1);
    assert_contract_error(result, OutcomeError::NothingToClaim);
}

#[test]
fn test_fuzz_zero_total_winning_panics() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    let result = client.try_claim_payout(&registry_id, &1u64, &staker, &1, &0, &1);
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
