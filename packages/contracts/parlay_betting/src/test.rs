#![cfg(test)]

extern crate std;

use crate::types::{ParlayLeg, ParlayStatus};
use crate::{ParlayBetting, ParlayBettingClient};
use backit_shared::{build_message, OUTCOME_DOWN, OUTCOME_UP};
use outcome_manager::{OutcomeManager, OutcomeManagerClient, SignedOutcome};
use prediction_market::{ConditionType, MarketInitArgs, PredictionMarketClient};
use prediction_market_factory::{PredictionMarketFactory, PredictionMarketFactoryClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, BytesN, Env, Vec,
};

fn install_market_wasm(env: &Env) -> BytesN<32> {
    let workspace_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let release_v1 = workspace_root.join("target/wasm32v1-none/release");
    let release_unknown = workspace_root.join("target/wasm32-unknown-unknown/release");
    let candidates = [
        release_v1.join("prediction_market.optimized.wasm"),
        release_v1.join("prediction_market.wasm"),
        release_unknown.join("prediction_market.optimized.wasm"),
    ];

    let wasm_path = candidates
        .iter()
        .find(|path| path.exists())
        .unwrap_or_else(|| {
            panic!(
                "missing Soroban-compatible prediction_market WASM — run:\n  \
                 cd packages/contracts/prediction_market && stellar contract build"
            )
        });

    let wasm_bytes = std::fs::read(wasm_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", wasm_path.display()));
    env.deployer().upload_contract_wasm(wasm_bytes.as_slice())
}

fn default_market_args(env: &Env, stake_token: &Address, end_ts: u64) -> MarketInitArgs {
    MarketInitArgs {
        stake_token: stake_token.clone(),
        stake_amount: 1_000_000,
        start_price: 100_000_000,
        end_ts,
        token_address: stake_token.clone(),
        pair_id: Bytes::from_slice(env, b"XLM-USDC"),
        metadata_hash: BytesN::from_array(env, &[1u8; 32]),
        condition: ConditionType::PercentUp(5),
        outcome_count: 2,
    }
}

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let sac = token.address();
    let stellar = StellarAssetClient::new(env, &sac);
    stellar.mint(admin, &100_000_000_000);
    sac
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
    use ed25519_dalek::{Signer, SigningKey};

    let msg = build_message(env, call_id, outcome, price, timestamp);
    let mut msg_bytes = [0u8; 128];
    let msg_len = msg.len() as usize;
    msg.copy_into_slice(&mut msg_bytes[..msg_len]);
    let signing_key = SigningKey::from_bytes(&secret.to_array());
    let signature = signing_key.sign(&msg_bytes[..msg_len]);
    BytesN::from_array(env, &signature.to_bytes())
}

struct TestSetup<'a> {
    env: Env,
    creator: Address,
    user: Address,
    counterparty: Address,
    token: Address,
    factory: PredictionMarketFactoryClient<'a>,
    outcome_mgr: OutcomeManagerClient<'a>,
    parlay: ParlayBettingClient<'a>,
    oracle_secret: BytesN<32>,
    oracle_pubkey: BytesN<32>,
}

fn setup_full_stack<'a>() -> TestSetup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let user = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let market_wasm = install_market_wasm(&env);
    let factory_id = env.register(PredictionMarketFactory, ());
    let factory = PredictionMarketFactoryClient::new(&env, &factory_id);

    let (oracle_secret, oracle_pubkey) = gen_keypair(&env);
    let outcome_id = env.register(OutcomeManager, ());
    let outcome_mgr = OutcomeManagerClient::new(&env, &outcome_id);
    let fee_collector = Address::generate(&env);

    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey.clone());

    // quorum=1, dispute_window_secs=0: a single oracle submission finalizes
    // immediately, matching prediction_market_factory's own test setup.
    outcome_mgr.initialize(&admin, &oracles, &1u32, &fee_collector, &100u32, &0u64);
    factory.initialize(&admin, &outcome_id, &market_wasm, &100_000);
    factory.whitelist_token(&token);
    outcome_mgr.set_factory(&factory_id);

    let parlay_id = env.register(ParlayBetting, ());
    let parlay = ParlayBettingClient::new(&env, &parlay_id);
    parlay.initialize(&admin, &outcome_id);

    let token_client = TokenClient::new(&env, &token);
    token_client.transfer(&admin, &user, &10_000_000);
    token_client.transfer(&admin, &counterparty, &10_000_000);

    TestSetup {
        env,
        creator,
        user,
        counterparty,
        token,
        factory,
        outcome_mgr,
        parlay,
        oracle_secret,
        oracle_pubkey,
    }
}

/// Deploy a market and have `counterparty` stake on the *opposite* outcome,
/// so the pool has real winning/losing pots to split.
fn deploy_market_with_counter_stake(
    setup: &TestSetup,
    end_ts: u64,
    counter_stake: i128,
) -> (Address, u64) {
    let env = &setup.env;
    let args = default_market_args(env, &setup.token, end_ts);
    let market_addr = setup.factory.deploy_market(&setup.creator, &args);
    let market = PredictionMarketClient::new(env, &market_addr);
    let call_id = market.get_call_id();
    market.stake_on_call(&setup.counterparty, &call_id, &counter_stake, &OUTCOME_DOWN);
    (market_addr, call_id)
}

fn resolve_market(setup: &TestSetup, call_id: u64, outcome: u32, end_ts: u64) {
    let env = &setup.env;
    env.ledger().set_timestamp(end_ts + 1);
    let signed = SignedOutcome {
        call_id,
        outcome,
        price: 110_000_000,
        timestamp: end_ts + 1,
        oracle_pubkey: setup.oracle_pubkey.clone(),
        signature: sign_outcome(
            env,
            &setup.oracle_secret,
            call_id,
            outcome,
            110_000_000,
            end_ts + 1,
        ),
    };
    setup
        .outcome_mgr
        .submit_outcome_for_market(&signed, &end_ts);
}

#[test]
fn two_leg_parlay_both_win() {
    let setup = setup_full_stack();
    let env = &setup.env;
    let token = TokenClient::new(env, &setup.token);

    let end_ts_1 = env.ledger().timestamp() + 3600;
    let end_ts_2 = end_ts_1 + 3600;
    let (market_1, call_1) = deploy_market_with_counter_stake(&setup, end_ts_1, 3_000_000);
    let (market_2, call_2) = deploy_market_with_counter_stake(&setup, end_ts_2, 3_000_000);

    let mut legs = Vec::new(env);
    legs.push_back(ParlayLeg {
        call_id: call_1,
        market_address: market_1,
        outcome: OUTCOME_UP,
    });
    legs.push_back(ParlayLeg {
        call_id: call_2,
        market_address: market_2,
        outcome: OUTCOME_UP,
    });

    let user_balance_before = token.balance(&setup.user);
    let parlay_id = setup.parlay.create_parlay(&setup.user, &legs, &1_000_000);
    assert_eq!(token.balance(&setup.user), user_balance_before - 1_000_000);

    resolve_market(&setup, call_1, OUTCOME_UP, end_ts_1);
    setup.parlay.advance_parlay(&parlay_id);

    let mid_parlay = setup.parlay.get_parlay(&parlay_id);
    assert_eq!(mid_parlay.status, ParlayStatus::Active);
    assert_eq!(mid_parlay.active_leg_index, 1);
    // leg 1: 1,000,000 staked of 4,000,000 winning pot vs 3,000,000 losing
    // pot, 1% fee -> net_losing = 2,970,000, prize_share = 2,970,000 (all of
    // the winning stake, since we're the sole winner), payout = 3,970,000.
    assert_eq!(mid_parlay.total_escrowed, 3_970_000);

    resolve_market(&setup, call_2, OUTCOME_UP, end_ts_2);
    setup.parlay.advance_parlay(&parlay_id);

    let final_parlay = setup.parlay.get_parlay(&parlay_id);
    assert_eq!(final_parlay.status, ParlayStatus::Won);
    assert_eq!(final_parlay.total_escrowed, 0);

    // leg 2: 3,970,000 staked of (3,970,000 + 3,000,000) winning pot vs
    // 3,000,000 losing, 1% fee -> net_losing = 2,970,000, payout =
    // 3,970,000 + 2,970,000 = 6,940,000.
    assert_eq!(
        token.balance(&setup.user),
        user_balance_before - 1_000_000 + 6_940_000
    );

    let user_parlays = setup.parlay.get_user_parlays(&setup.user);
    assert_eq!(user_parlays.len(), 1);
    assert_eq!(user_parlays.get(0).unwrap(), parlay_id);
}

#[test]
fn three_leg_parlay_all_win() {
    let setup = setup_full_stack();
    let env = &setup.env;
    let token = TokenClient::new(env, &setup.token);

    let end_ts_1 = env.ledger().timestamp() + 3600;
    let end_ts_2 = end_ts_1 + 3600;
    let end_ts_3 = end_ts_2 + 3600;
    let (market_1, call_1) = deploy_market_with_counter_stake(&setup, end_ts_1, 1_000_000);
    let (market_2, call_2) = deploy_market_with_counter_stake(&setup, end_ts_2, 1_000_000);
    let (market_3, call_3) = deploy_market_with_counter_stake(&setup, end_ts_3, 1_000_000);

    let mut legs = Vec::new(env);
    legs.push_back(ParlayLeg {
        call_id: call_1,
        market_address: market_1,
        outcome: OUTCOME_UP,
    });
    legs.push_back(ParlayLeg {
        call_id: call_2,
        market_address: market_2,
        outcome: OUTCOME_UP,
    });
    legs.push_back(ParlayLeg {
        call_id: call_3,
        market_address: market_3,
        outcome: OUTCOME_UP,
    });

    let parlay_id = setup.parlay.create_parlay(&setup.user, &legs, &500_000);

    resolve_market(&setup, call_1, OUTCOME_UP, end_ts_1);
    setup.parlay.advance_parlay(&parlay_id);
    assert_eq!(
        setup.parlay.get_parlay(&parlay_id).active_leg_index,
        1
    );

    resolve_market(&setup, call_2, OUTCOME_UP, end_ts_2);
    setup.parlay.advance_parlay(&parlay_id);
    assert_eq!(
        setup.parlay.get_parlay(&parlay_id).active_leg_index,
        2
    );

    resolve_market(&setup, call_3, OUTCOME_UP, end_ts_3);
    setup.parlay.advance_parlay(&parlay_id);

    let final_parlay = setup.parlay.get_parlay(&parlay_id);
    assert_eq!(final_parlay.status, ParlayStatus::Won);
    assert!(token.balance(&setup.user) > 0);
}

#[test]
fn parlay_loses_on_leg_1() {
    let setup = setup_full_stack();
    let env = &setup.env;
    let token = TokenClient::new(env, &setup.token);

    let end_ts_1 = env.ledger().timestamp() + 3600;
    let end_ts_2 = end_ts_1 + 3600;
    let (market_1, call_1) = deploy_market_with_counter_stake(&setup, end_ts_1, 3_000_000);
    let (market_2, call_2) = deploy_market_with_counter_stake(&setup, end_ts_2, 3_000_000);

    let mut legs = Vec::new(env);
    legs.push_back(ParlayLeg {
        call_id: call_1,
        market_address: market_1,
        outcome: OUTCOME_UP,
    });
    legs.push_back(ParlayLeg {
        call_id: call_2,
        market_address: market_2,
        outcome: OUTCOME_UP,
    });

    let user_balance_before = token.balance(&setup.user);
    let parlay_id = setup.parlay.create_parlay(&setup.user, &legs, &1_000_000);

    // Leg 1 resolves DOWN — opposite of the parlay's predicted UP.
    resolve_market(&setup, call_1, OUTCOME_DOWN, end_ts_1);
    setup.parlay.advance_parlay(&parlay_id);

    let final_parlay = setup.parlay.get_parlay(&parlay_id);
    assert_eq!(final_parlay.status, ParlayStatus::Lost);
    assert_eq!(final_parlay.total_escrowed, 0);
    // The initial stake was lost to the pool — no refund.
    assert_eq!(
        token.balance(&setup.user),
        user_balance_before - 1_000_000
    );
}

#[test]
fn parlay_loses_on_leg_2() {
    let setup = setup_full_stack();
    let env = &setup.env;

    let end_ts_1 = env.ledger().timestamp() + 3600;
    let end_ts_2 = end_ts_1 + 3600;
    let (market_1, call_1) = deploy_market_with_counter_stake(&setup, end_ts_1, 3_000_000);
    let (market_2, call_2) = deploy_market_with_counter_stake(&setup, end_ts_2, 3_000_000);

    let mut legs = Vec::new(env);
    legs.push_back(ParlayLeg {
        call_id: call_1,
        market_address: market_1,
        outcome: OUTCOME_UP,
    });
    legs.push_back(ParlayLeg {
        call_id: call_2,
        market_address: market_2,
        outcome: OUTCOME_UP,
    });

    let parlay_id = setup.parlay.create_parlay(&setup.user, &legs, &1_000_000);

    resolve_market(&setup, call_1, OUTCOME_UP, end_ts_1);
    setup.parlay.advance_parlay(&parlay_id);
    assert_eq!(
        setup.parlay.get_parlay(&parlay_id).status,
        ParlayStatus::Active
    );

    // Leg 2 resolves DOWN — the parlay loses everything it auto-staked.
    resolve_market(&setup, call_2, OUTCOME_DOWN, end_ts_2);
    setup.parlay.advance_parlay(&parlay_id);

    let final_parlay = setup.parlay.get_parlay(&parlay_id);
    assert_eq!(final_parlay.status, ParlayStatus::Lost);
    assert_eq!(final_parlay.total_escrowed, 0);
}

#[test]
fn parlay_voided_when_next_market_expired() {
    let setup = setup_full_stack();
    let env = &setup.env;
    let token = TokenClient::new(env, &setup.token);

    let end_ts_1 = env.ledger().timestamp() + 3600;
    // Leg 2's market closes almost immediately — by the time leg 1 resolves
    // (at end_ts_1 + 1) leg 2's staking window has already passed.
    let end_ts_2 = env.ledger().timestamp() + 10;
    let (market_1, call_1) = deploy_market_with_counter_stake(&setup, end_ts_1, 3_000_000);
    let (market_2, call_2) = deploy_market_with_counter_stake(&setup, end_ts_2, 3_000_000);

    let mut legs = Vec::new(env);
    legs.push_back(ParlayLeg {
        call_id: call_1,
        market_address: market_1,
        outcome: OUTCOME_UP,
    });
    legs.push_back(ParlayLeg {
        call_id: call_2,
        market_address: market_2,
        outcome: OUTCOME_UP,
    });

    let user_balance_before = token.balance(&setup.user);
    let parlay_id = setup.parlay.create_parlay(&setup.user, &legs, &1_000_000);

    resolve_market(&setup, call_1, OUTCOME_UP, end_ts_1);
    setup.parlay.advance_parlay(&parlay_id);

    let final_parlay = setup.parlay.get_parlay(&parlay_id);
    assert_eq!(final_parlay.status, ParlayStatus::Voided);
    assert_eq!(final_parlay.total_escrowed, 0);
    // Leg 1's winnings (3,970,000, see two_leg_parlay_both_win's math) are
    // refunded in full since leg 2 never got staked.
    assert_eq!(
        token.balance(&setup.user),
        user_balance_before - 1_000_000 + 3_970_000
    );
}

#[test]
fn payout_calculation_accuracy() {
    let setup = setup_full_stack();
    let env = &setup.env;

    let end_ts_1 = env.ledger().timestamp() + 3600;
    let end_ts_2 = end_ts_1 + 3600;
    let (market_1, call_1) = deploy_market_with_counter_stake(&setup, end_ts_1, 4_000_000);
    // Leg 2's market just needs to still be open when leg 1 resolves — its
    // own pool doesn't matter for this test, which only checks leg 1's payout.
    let (market_2, call_2) = deploy_market_with_counter_stake(&setup, end_ts_2, 1_000_000);

    let mut legs = Vec::new(env);
    legs.push_back(ParlayLeg {
        call_id: call_1,
        market_address: market_1,
        outcome: OUTCOME_UP,
    });
    legs.push_back(ParlayLeg {
        call_id: call_2,
        market_address: market_2,
        outcome: OUTCOME_UP,
    });

    let parlay_id = setup.parlay.create_parlay(&setup.user, &legs, &2_000_000);

    resolve_market(&setup, call_1, OUTCOME_UP, end_ts_1);
    setup.parlay.advance_parlay(&parlay_id);

    // winning_stake = 2,000,000, losing_stake = 4,000,000, fee_bps = 100.
    // total_fee = 4,000,000 * 100 / 10000 = 40,000.
    // net_losing = 4,000,000 - 40,000 = 3,960,000.
    // prize_share = 2,000,000 * 3,960,000 / 2,000,000 = 3,960,000.
    // payout = 2,000,000 + 3,960,000 = 5,960,000.
    let mid_parlay = setup.parlay.get_parlay(&parlay_id);
    assert_eq!(mid_parlay.status, ParlayStatus::Active);
    assert_eq!(mid_parlay.total_escrowed, 5_960_000);
}
