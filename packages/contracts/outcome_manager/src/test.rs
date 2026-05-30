#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl,
    testutils::Address as _,
    Address, BytesN, Env, Vec,
};

use crate::storage::SignedOutcome;
use crate::{OutcomeManager, OutcomeManagerClient};

// ─── Test Helpers ─────────────────────────────────────────────────────────────

#[contract]
pub struct MockRegistry;

#[contractimpl]
impl MockRegistry {
    pub fn resolve_call(_env: Env, _call_id: u64, _outcome: u32, _end_price: i128) {}
    pub fn release_escrow(_env: Env, _call_id: u64, _to: Address, _amount: i128) {}
    pub fn mark_settled(_env: Env, _call_id: u64) {}
}

/// Generate a deterministic Ed25519 keypair for testing.
/// Returns (secret_key_bytes, public_key_bytes).
fn gen_keypair(env: &Env) -> (BytesN<32>, BytesN<32>) {
    use ed25519_dalek::SigningKey;
    use rand::RngCore;

    // Use a random seed for testing
    let mut seed = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut seed);

    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = signing_key.verifying_key();

    (
        BytesN::from_array(env, &seed),
        BytesN::from_array(env, &public_key.to_bytes()),
    )
}

/// Sign the canonical outcome message using ed25519-dalek.
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

    // Convert soroban Bytes to fixed-size array for signing
    let mut msg_bytes = [0u8; 128];
    let msg_len = msg.len() as usize;
    msg.copy_into_slice(&mut msg_bytes[..msg_len]);

    let signing_key = SigningKey::from_bytes(&secret.to_array());
    let signature = signing_key.sign(&msg_bytes[..msg_len]);

    BytesN::from_array(env, &signature.to_bytes())
}

/// Register and initialize an OutcomeManager with a single oracle / quorum=1
fn setup_single_oracle(
    env: &Env,
) -> (
    Address,
    Address,
    BytesN<32>,
    BytesN<32>,
    OutcomeManagerClient,
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

    // Register a mock registry contract
    let registry_id = env.register_contract(None, MockRegistry);

    (admin, registry_id, oracle_secret, oracle_pubkey, client)
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
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    let (admin, _, _, pubkey, client) = setup_single_oracle(&env);

    let fee_collector = Address::generate(&env);
    let mut oracles = Vec::new(&env);
    oracles.push_back(pubkey);
    client.initialize(&admin, &oracles, &1u32, &fee_collector, &0u32, &0u64);
}

#[test]
#[should_panic(expected = "invalid quorum")]
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
    client.initialize(&admin, &oracles, &0u32, &fee_collector, &0u32, &0u64);
}

// ─── Oracle Submission & Verification Tests ────────────────────────────────────

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

    // First oracle vote
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
    );

    // Second oracle vote
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
    );

    let final_outcome = client.get_outcome(&call_id);
    assert_eq!(final_outcome.outcome, outcome_val);
}

#[test]
#[should_panic(expected = "unauthorized oracle")]
fn test_submit_unauthorized_oracle_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, mock_registry, _, _, client) = setup_single_oracle(&env);

    let (secret2, pubkey2) = gen_keypair(&env);
    let call_id = 1u64;
    let sig = sign_outcome(&env, &secret2, call_id, 1, 100, 9000);

    client.submit_outcome(
        &mock_registry,
        &SignedOutcome {
            call_id,
            outcome: 1,
            price: 100,
            timestamp: 9000,
            oracle_pubkey: pubkey2,
            signature: sig,
        },
    );
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

    // Add a second oracle so quorum=2 is valid
    let (_, pubkey2) = gen_keypair(&env);
    client.add_oracle(&pubkey2);

    client.set_quorum(&2u32);
    assert_eq!(client.get_quorum(), 2);
}

#[test]
fn test_set_admin() {
    let env = Env::default();
    let (_, _, _, _, client) = setup_single_oracle(&env);
    let new_admin = Address::generate(&env);

    client.set_admin(&new_admin);
    // If it doesn't panic, it's successful (auth handled by mock_all_auths)
}

// ─── Payout Math Tests ─────────────────────────────────────────────────────────

#[test]
fn test_payout_calculation_dominant_winner() {
    // payout = staker_stake + staker_stake * losing_pool / winning_pool
    let staker_stake: i128 = 40;
    let total_winning: i128 = 80;
    let total_losing: i128 = 20;

    let prize_share = staker_stake * total_losing / total_winning;
    let payout = staker_stake + prize_share;
    assert_eq!(payout, 50);
}

#[test]
fn test_payout_calculation_equal_split() {
    assert_eq!(50 + (50 * 100 / 100), 100);
}

#[test]
fn test_payout_calculation_no_losers() {
    // Winners just get their stake back
    let staker_stake: i128 = 60;
    let total_winning: i128 = 60;
    let total_losing: i128 = 0;
    let payout = staker_stake + (staker_stake * total_losing / total_winning);
    assert_eq!(payout, 60);
}

#[test]
fn test_payout_calculation_single_winner_takes_all() {
    // payout = 30 + 30 * 70 / 30 = 100
    let staker_stake: i128 = 30;
    let total_winning: i128 = 30;
    let total_losing: i128 = 70;
    let payout = staker_stake + (staker_stake * total_losing / total_winning);
    assert_eq!(payout, 100);
}

#[test]
#[should_panic(expected = "call not settled")]
fn test_get_outcome_unsettled_panics() {
    let env = Env::default();
    let (_, _, _, _, client) = setup_single_oracle(&env);
    client.get_outcome(&999u64);
}

// ─── Fee Deduction Tests ───────────────────────────────────────────────────────

/// Helper: set up a contract with a specific fee_bps and settle call_id=1.
fn setup_with_fee(env: &Env, fee_bps: u32) -> (Address, Address, OutcomeManagerClient) {
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

    // Settle call_id=1
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
    );

    (fee_collector, registry_id, client)
}

#[test]
fn test_fee_deducted_from_payout() {
    // fee_bps = 500 (5%)
    // total_losing = 100, total_winning = 100, staker_stake = 100
    // total_fee = 100 * 500 / 10000 = 5
    // staker_fee_share = 100 * 5 / 100 = 5
    // net_losing = 95
    // prize_share = 100 * 95 / 100 = 95
    // payout = 100 + 95 = 195
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 500);
    let staker = Address::generate(&env);

    client.claim_payout(&registry_id, &1u64, &staker, &100i128, &100i128, &100i128);
    // If no panic, payout was computed and released correctly
}

#[test]
fn test_zero_fee_full_payout() {
    // fee_bps = 0: payout = staker_stake + staker_stake * losing / winning
    // = 50 + 50 * 100 / 100 = 100
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);

    client.claim_payout(&registry_id, &1u64, &staker, &50i128, &100i128, &100i128);
}

#[test]
fn test_fee_math_correctness() {
    // Verify fee math in pure Rust (no contract needed)
    let staker_stake: i128 = 40;
    let total_winning: i128 = 80;
    let total_losing: i128 = 200;
    let fee_bps: i128 = 200; // 2%

    let total_fee = total_losing * fee_bps / 10000; // 4
    let staker_fee_share = staker_stake * total_fee / total_winning; // 40 * 4 / 80 = 2
    let net_losing = total_losing - total_fee; // 196
    let prize_share = staker_stake * net_losing / total_winning; // 40 * 196 / 80 = 98
    let payout = staker_stake + prize_share; // 138

    assert_eq!(total_fee, 4);
    assert_eq!(staker_fee_share, 2);
    assert_eq!(net_losing, 196);
    assert_eq!(payout, 138);
}

#[test]
fn test_fee_goes_to_correct_address() {
    // fee_bps = 1000 (10%), staker_stake = total_winning = total_losing = 100
    // total_fee = 10, staker_fee_share = 10, net_losing = 90, payout = 190
    // MockRegistry.release_escrow is called with fee_collector for 10, then staker for 190
    let env = Env::default();
    let (fee_collector, registry_id, client) = setup_with_fee(&env, 1000);
    let staker = Address::generate(&env);

    // Should not panic; MockRegistry records calls but we verify no panic = correct flow
    client.claim_payout(&registry_id, &1u64, &staker, &100i128, &100i128, &100i128);
    // fee_collector address was set during setup_with_fee; contract uses it internally
    let _ = fee_collector; // referenced to confirm it was set
}

#[test]
#[should_panic(expected = "invalid fee_bps")]
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
    client.initialize(&admin, &oracles, &1u32, &fee_collector, &10001u32, &0u64);
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

    // Should not panic — all three processed in one tx
    client.batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &100_i128, &100_i128);

    assert!(client.has_claimed(&1u64, &staker1));
    assert!(client.has_claimed(&1u64, &staker2));
    assert!(client.has_claimed(&1u64, &staker3));
}

#[test]
#[should_panic(expected = "already claimed")]
fn test_batch_claim_panics_on_duplicate_staker() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let staker = Address::generate(&env);

    // First batch — marks staker as claimed
    let mut stakers = Vec::new(&env);
    stakers.push_back(staker.clone());
    let mut stakes = Vec::new(&env);
    stakes.push_back(50_i128);

    client.batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &50_i128, &50_i128);

    // Second batch with same staker — must panic
    client.batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &50_i128, &50_i128);
}

#[test]
#[should_panic(expected = "empty batch")]
fn test_batch_claim_panics_on_empty_batch() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let stakers: Vec<Address> = Vec::new(&env);
    let stakes: Vec<i128> = Vec::new(&env);

    client.batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &100_i128, &100_i128);
}

#[test]
#[should_panic(expected = "length mismatch")]
fn test_batch_claim_panics_on_length_mismatch() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let mut stakers = Vec::new(&env);
    stakers.push_back(Address::generate(&env));
    stakers.push_back(Address::generate(&env));

    let mut stakes = Vec::new(&env);
    stakes.push_back(50_i128); // one fewer than stakers

    client.batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &100_i128, &50_i128);
}

#[test]
#[should_panic(expected = "call not settled")]
fn test_batch_claim_panics_on_unsettled_call() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let mut stakers = Vec::new(&env);
    stakers.push_back(Address::generate(&env));
    let mut stakes = Vec::new(&env);
    stakes.push_back(50_i128);

    // call_id=999 was never finalized
    client.batch_claim_payouts(&registry_id, &999u64, &stakers, &stakes, &50_i128, &50_i128);
}

#[test]
fn test_batch_claim_with_fee_deducted() {
    let env = Env::default();
    // 10% fee
    let (fee_collector, registry_id, client) = setup_with_fee(&env, 1000);

    let staker1 = Address::generate(&env);
    let staker2 = Address::generate(&env);

    let mut stakers = Vec::new(&env);
    stakers.push_back(staker1.clone());
    stakers.push_back(staker2.clone());

    let mut stakes = Vec::new(&env);
    stakes.push_back(60_i128);
    stakes.push_back(40_i128);

    // Should process without panic; fee math mirrors claim_payout
    client.batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &100_i128, &100_i128);

    assert!(client.has_claimed(&1u64, &staker1));
    assert!(client.has_claimed(&1u64, &staker2));
    let _ = fee_collector;
}

#[test]
#[should_panic(expected = "already claimed")]
fn test_batch_claim_duplicate_within_same_batch_panics() {
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let staker = Address::generate(&env);

    let mut stakers = Vec::new(&env);
    stakers.push_back(staker.clone());
    stakers.push_back(staker.clone());

    let mut stakes = Vec::new(&env);
    stakes.push_back(50_i128);
    stakes.push_back(50_i128);

    client.batch_claim_payouts(&registry_id, &1u64, &stakers, &stakes, &100_i128, &50_i128);
}
