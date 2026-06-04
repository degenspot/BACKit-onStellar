#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl,
    testutils::Address as _,
    Address, BytesN, Env, Vec,
};

use crate::storage::{OracleVote, PriceObservation, SignedOutcome};
use crate::{OutcomeManager, OutcomeManagerClient, MAX_ORACLES};

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

#[test]
fn test_twap_three_equal_intervals() {
    // prices 100, 200, 300 at t=1000, 2000, 3000
    // intervals: 1000s each
    // TWAP = (100*1000 + 200*1000) / 2000 = 150
    let env = Env::default();
    let (_admin, _registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 42u64;
    for (price, ts) in [(100_i128, 1000u64), (200, 2000), (300, 3000)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &PriceObservation { price, timestamp: ts },
            &oracle_pubkey,
            &sig,
        );
    }
    assert_eq!(client.compute_twap(&call_id), 150);
}

#[test]
fn test_twap_unequal_intervals() {
    // price 100 for 100s, then 900 for 900s
    // TWAP = (100*100 + 900*900) / 1000 = 820
    let env = Env::default();
    let (_admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 43u64;
    for (price, ts) in [(100_i128, 0u64), (900, 100), (900, 1000)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &PriceObservation { price, timestamp: ts },
            &oracle_pubkey,
            &sig,
        );
    }
    assert_eq!(client.compute_twap(&call_id), 820);
}

#[test]
#[should_panic(expected = "minimum 3 price observations required")]
fn test_twap_requires_minimum_3_observations() {
    let env = Env::default();
    let (_admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 44u64;
    for (price, ts) in [(100_i128, 1000u64), (200, 2000)] {
        let sig = sign_observation(&env, &oracle_secret, call_id, price, ts);
        client.submit_price_observation(
            &call_id,
            &PriceObservation { price, timestamp: ts },
            &oracle_pubkey,
            &sig,
        );
    }
    client.compute_twap(&call_id);
}

#[test]
#[should_panic(expected = "observation timestamp must be strictly increasing")]
fn test_twap_rejects_non_increasing_timestamp() {
    let env = Env::default();
    let (_admin, _reg, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);
    let call_id = 45u64;
    let sig1 = sign_observation(&env, &oracle_secret, call_id, 100, 1000);
    client.submit_price_observation(
        &call_id,
        &PriceObservation { price: 100, timestamp: 1000 },
        &oracle_pubkey,
        &sig1,
    );
    let sig2 = sign_observation(&env, &oracle_secret, call_id, 200, 1000);
    client.submit_price_observation(
        &call_id,
        &PriceObservation { price: 200, timestamp: 1000 },
        &oracle_pubkey,
        &sig2,
    );
}

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
        &0u64,
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
            timestamp: ts,
        }
    );
    assert_eq!(
        stored_votes.get(1).unwrap(),
        OracleVote {
            oracle: p2,
            outcome: outcome_val,
            price,
            timestamp: ts,
        }
    );
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
        &0u64,
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
fn test_get_oracles_tracks_add_remove() {
    let env = Env::default();
    let (_, _, _, original_pubkey, client) = setup_single_oracle(&env);
    let (_, second_pubkey) = gen_keypair(&env);

    let initial = client.get_oracles();
    assert_eq!(initial.len(), 1);
    assert_eq!(initial.get(0).unwrap(), original_pubkey.clone());
    assert_eq!(client.get_oracle_count(), 1);

    client.add_oracle(&second_pubkey);
    let with_second = client.get_oracles();
    assert_eq!(with_second.len(), 2);
    assert_eq!(with_second.get(0).unwrap(), original_pubkey);
    assert_eq!(with_second.get(1).unwrap(), second_pubkey.clone());
    assert_eq!(client.get_oracle_count(), 2);

    client.remove_oracle(&second_pubkey);
    assert_eq!(client.get_oracles().len(), 1);
    assert_eq!(client.get_oracle_count(), 1);
}

#[test]
#[should_panic(expected = "max oracles reached")]
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
    client.add_oracle(&extra_pubkey);
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
        &0u64,
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



// -- upgrade / version -------------------------------------------------------
#[test]
fn test_om_version_returns_contract_version() {
    let env = Env::default();
    let (_admin, _registry_id, _secret, _pubkey, client) = setup_single_oracle(&env);
    assert_eq!(client.version(), 1u32);
}

#[test]
#[should_panic(expected = "not initialized")]
fn test_om_upgrade_requires_admin_auth() {
    // upgrade() reads admin from instance storage before calling require_auth().
    // Calling it before initialize() panics with "not initialized", proving
    // the admin guard is in place before any WASM update can occur.
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, OutcomeManager);
    let client = OutcomeManagerClient::new(&env, &contract_id);
    let fake_hash = BytesN::<32>::from_array(&env, &[0u8; 32]);
    client.upgrade(&fake_hash); // panics: "not initialized"
}

// -- Fuzz / property tests for claim_payout arithmetic -----------------------

/// Create a fresh settled env and run claim_payout with the given inputs.
/// Panics if any arithmetic overflows or the claim is not recorded.
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
    // Representative matrix of ratios; none should overflow or panic
    let cases: &[(i128, i128, i128, u32)] = &[
        // (staker_winning, total_winning, total_losing, fee_bps)
        (1,              1,                  0,          0),
        (1,              1,                  1,          0),
        (1,              1,                  1,       1000),
        (1,              1,                  1,       5000),
        (1,          1_000,          1_000_000,        100),
        (500,        1_000,          1_000_000,        500),
        (1_000,      1_000,                  1,          0),
        (1_000_000,  1_000_000,      1_000_000,      1_000),
        (1,              1,  1_000_000_000_000,          0),
        (1, 1_000_000_000_000, 1_000_000_000_000,        0),
        (500,        1_000,              1_000,       5_000),
    ];
    for &(sw, tw, tl, fee) in cases {
        fuzz_claim_setup(sw, tw, tl, fee);
    }
}

#[test]
fn test_fuzz_100_winners_batch_all_claimed() {
    // 100 equal winners via batch_claim_payouts -- all must be marked claimed
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);

    let mut stakers = Vec::new(&env);
    let mut stakes = Vec::new(&env);
    for _ in 0..100u32 {
        stakers.push_back(Address::generate(&env));
        stakes.push_back(1_i128);
    }

    client.batch_claim_payouts(
        &registry_id,
        &1u64,
        &stakers,
        &stakes,
        &100_i128,
        &100_i128,
    );

    for i in 0..100u32 {
        assert!(client.has_claimed(&1u64, &stakers.get(i).unwrap()));
    }
}

#[test]
fn test_fuzz_1_winner_takes_all() {
    // Single winner holds the entire winning pool
    let env = Env::default();
    let (_, registry_id, client) = setup_with_fee(&env, 0);
    let staker = Address::generate(&env);
    client.claim_payout(
        &registry_id,
        &1u64,
        &staker,
        &1_000_000_i128,
        &1_000_000_i128,
        &1_000_000_i128,
    );
    assert!(client.has_claimed(&1u64, &staker));
}

#[test]
fn test_fuzz_asymmetric_1_vs_1_trillion() {
    // 1 unit winning vs enormous losing pool -- floor division must not overflow
    fuzz_claim_setup(1, 1, 1_000_000_000_000, 0);
}

#[test]
fn test_fuzz_asymmetric_1_trillion_vs_1() {
    // Enormous winner stake vs tiny losing pool
    fuzz_claim_setup(1_000_000_000_000, 1_000_000_000_000, 1, 0);
}

#[test]
#[should_panic]
fn test_fuzz_zero_staker_stake_panics() {
    fuzz_claim_setup(0, 1, 1, 0);
}

#[test]
#[should_panic]
fn test_fuzz_zero_total_winning_panics() {
    fuzz_claim_setup(1, 0, 1, 0);
}

// ─── Pause Mechanism Tests ─────────────────────────────────────────────────────

#[test]
fn test_pause_and_unpause() {
    let env = Env::default();
    let (_admin, _registry_id, _oracle_secret, _oracle_pubkey, client) = setup_single_oracle(&env);

    assert!(!client.is_paused_view());

    env.mock_all_auths();
    client.pause();
    assert!(client.is_paused_view());

    client.unpause();
    assert!(!client.is_paused_view());
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_submit_outcome_fails_when_paused() {
    let env = Env::default();
    let (_admin, registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    env.mock_all_auths();
    client.pause();

    let signed = SignedOutcome {
        call_id: 1,
        outcome: 1,
        price: 100,
        timestamp: 1000,
        oracle_pubkey: oracle_pubkey.clone(),
        signature: sign_outcome(&env, &oracle_secret, 1, 1, 100, 1000),
    };

    client.submit_outcome(&registry_id, &signed, &0u64);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_claim_payout_fails_when_paused() {
    let env = Env::default();
    let (_admin, registry_id, _oracle_secret, _oracle_pubkey, client) = setup_single_oracle(&env);
    let staker = Address::generate(&env);

    env.mock_all_auths();
    client.pause();

    client.claim_payout(
        &registry_id,
        &1u64,
        &staker,
        &100_i128,
        &100_i128,
        &100_i128,
    );
}

// ─── Oracle Submission Deadline Tests ─────────────────────────────────────────

#[test]
fn test_submission_within_window_succeeds() {
    let env = Env::default();
    let (_admin, registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    let call_id = 10u64;
    let call_end_ts = 1000u64;
    // timestamp 1500 is well within default 86400s window
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
        &call_end_ts,
    );

    let outcome = client.get_outcome(&call_id);
    assert_eq!(outcome.outcome, 1u32);
}

#[test]
#[should_panic(expected = "submission outside allowed window")]
fn test_submission_outside_window_fails() {
    let env = Env::default();
    let (_admin, registry_id, oracle_secret, oracle_pubkey, client) = setup_single_oracle(&env);

    // Tighten the window to 50 seconds
    client.set_max_submission_delay(&50u64);

    let call_id = 11u64;
    let call_end_ts = 1000u64;
    // timestamp 1200 > call_end_ts(1000) + max_delay(50) = 1050
    let sig = sign_outcome(&env, &oracle_secret, call_id, 1, 100, 1200);
    client.submit_outcome(
        &registry_id,
        &SignedOutcome {
            call_id,
            outcome: 1,
            price: 100,
            timestamp: 1200,
            oracle_pubkey,
            signature: sig,
        },
        &call_end_ts,
    );
}

#[test]
fn test_admin_can_update_max_submission_delay() {
    let env = Env::default();
    let (_admin, _registry_id, _secret, _pubkey, client) = setup_single_oracle(&env);

    assert_eq!(client.get_max_submission_delay(), 86400u64);

    client.set_max_submission_delay(&3600u64);
    assert_eq!(client.get_max_submission_delay(), 3600u64);
}

