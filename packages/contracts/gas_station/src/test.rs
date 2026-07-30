#![cfg(test)]

extern crate std;

use crate::errors::GasStationError;
use crate::{GasStation, GasStationClient};
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
        release_unknown.join("prediction_market.wasm"),
    ];

    let wasm_path = candidates
        .iter()
        .find(|path| path.exists())
        .expect("missing prediction_market WASM");

    let wasm_bytes = std::fs::read(wasm_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", wasm_path.display()));
    env.deployer().upload_contract_wasm(wasm_bytes.as_slice())
}

fn default_market_args(env: &Env, stake_token: &Address, end_ts: u64) -> MarketInitArgs {
    MarketInitArgs {
        stake_token: stake_token.clone(),
        stake_amount: 100,
        start_price: 100_000_000,
        end_ts,
        token_address: stake_token.clone(),
        pair_id: Bytes::from_slice(env, b"XLM-USDC"),
        metadata_hash: BytesN::from_array(env, &[9u8; 32]),
        condition: ConditionType::PercentUp(5),
        outcome_count: 2,
    }
}

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let sac = token.address();
    StellarAssetClient::new(env, &sac).mint(admin, &100_000_000_000);
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
    admin: Address,
    creator: Address,
    token: Address,
    factory: PredictionMarketFactoryClient<'a>,
    outcome_mgr: OutcomeManagerClient<'a>,
    outcome_mgr_id: Address,
    gas_station: GasStationClient<'a>,
    oracle_secret: BytesN<32>,
    oracle_pubkey: BytesN<32>,
}

/// Full real-contract stack: `prediction_market_factory` + `outcome_manager`
/// + `gas_station`, wired together exactly like production. `fee_bps = 0` on
/// the outcome manager so the protocol fee doesn't complicate the payout
/// arithmetic this test suite is actually about (the gas station's cut).
fn setup_full_stack<'a>() -> TestSetup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let market_wasm = install_market_wasm(&env);
    let factory_id = env.register(PredictionMarketFactory, ());
    let factory = PredictionMarketFactoryClient::new(&env, &factory_id);

    let (oracle_secret, oracle_pubkey) = gen_keypair(&env);
    let outcome_mgr_id = env.register(OutcomeManager, ());
    let outcome_mgr = OutcomeManagerClient::new(&env, &outcome_mgr_id);
    let fee_collector = Address::generate(&env);

    let mut oracles = Vec::new(&env);
    oracles.push_back(oracle_pubkey.clone());

    // quorum=1, dispute_window_secs=0, fee_bps=0: a single oracle submission
    // finalizes immediately with no protocol fee skimmed off.
    outcome_mgr.initialize(&admin, &oracles, &1u32, &fee_collector, &0u32, &0u64);
    factory.initialize(&admin, &outcome_mgr_id, &market_wasm, &100i128);
    factory.whitelist_token(&token);
    outcome_mgr.set_factory(&factory_id);

    let gas_station_id = env.register(GasStation, ());
    let gas_station = GasStationClient::new(&env, &gas_station_id);
    gas_station.initialize(&admin, &token);

    TestSetup {
        env,
        admin,
        creator,
        token,
        factory,
        outcome_mgr,
        outcome_mgr_id,
        gas_station,
        oracle_secret,
        oracle_pubkey,
    }
}

/// Deploy a fresh market and fund `stakers` with plenty of the stake token.
fn deploy_market(setup: &TestSetup, end_ts: u64) -> (Address, u64) {
    let env = &setup.env;
    let args = default_market_args(env, &setup.token, end_ts);
    let market_addr = setup.factory.deploy_market(&setup.creator, &args);
    let market = PredictionMarketClient::new(env, &market_addr);
    let call_id = market.get_call_id();
    (market_addr, call_id)
}

fn fund(setup: &TestSetup, who: &Address, amount: i128) {
    TokenClient::new(&setup.env, &setup.token).transfer(&setup.admin, who, &amount);
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
    setup.outcome_mgr.submit_outcome_for_market(&signed, &end_ts);
}

fn assert_contract_error<T, E>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: GasStationError,
) {
    assert!(matches!(
        result,
        Err(Ok(err)) if err == soroban_sdk::Error::from_contract_error(expected as u32)
    ));
}

// ─── sponsor_transaction / registration ────────────────────────────────────────

#[test]
fn sponsor_transaction_registers_user_and_updates_metrics() {
    let setup = setup_full_stack();
    let user = Address::generate(&setup.env);

    setup.gas_station.sponsor_transaction(&user, &50i128, &300u32);

    let info = setup.gas_station.get_sponsorship(&user).unwrap();
    assert_eq!(info.max_gas_xlm, 50);
    assert_eq!(info.winning_cut_bps, 300);
    assert!(info.active);
    assert!(setup.gas_station.is_sponsored(&user));

    let metrics = setup.gas_station.get_metrics();
    assert_eq!(metrics.total_transactions_sponsored, 1);
    assert_eq!(metrics.total_xlm_spent, 50);
    assert_eq!(metrics.total_winnings_collected, 0);
    assert_eq!(metrics.net_profit_loss, -50);
}

#[test]
fn sponsor_transaction_rejects_invalid_cut_bps() {
    let setup = setup_full_stack();
    let user = Address::generate(&setup.env);

    let result = setup
        .gas_station
        .try_sponsor_transaction(&user, &50i128, &10_001u32);
    assert_contract_error(result, GasStationError::InvalidWinningCutBps);
}

#[test]
fn sponsor_transaction_rejects_non_positive_gas() {
    let setup = setup_full_stack();
    let user = Address::generate(&setup.env);

    let result = setup
        .gas_station
        .try_sponsor_transaction(&user, &0i128, &300u32);
    assert_contract_error(result, GasStationError::InvalidGasAmount);
}

#[test]
fn revoke_sponsorship_deactivates_without_erasing_history() {
    let setup = setup_full_stack();
    let user = Address::generate(&setup.env);
    setup.gas_station.sponsor_transaction(&user, &50i128, &300u32);

    setup.gas_station.revoke_sponsorship(&user);

    assert!(!setup.gas_station.is_sponsored(&user));
    let info = setup.gas_station.get_sponsorship(&user).unwrap();
    assert_eq!(info.max_gas_xlm, 50); // history preserved, just inactive
}

#[test]
fn compute_effective_stake_matches_formula() {
    let setup = setup_full_stack();
    assert_eq!(setup.gas_station.compute_effective_stake(&1_000i128, &50i128), 950);
}

#[test]
fn compute_effective_stake_rejects_gas_exceeding_stake() {
    let setup = setup_full_stack();
    let result = setup
        .gas_station
        .try_compute_effective_stake(&50i128, &1_000i128);
    assert_contract_error(result, GasStationError::InvalidGasAmount);
}

// ─── claim_sponsored_payout: win path ──────────────────────────────────────────

#[test]
fn sponsored_stake_win_gas_station_earns_cut_and_user_gets_remainder() {
    let setup = setup_full_stack();
    let env = &setup.env;
    let token = TokenClient::new(env, &setup.token);

    let user = Address::generate(env);
    let counterparty = Address::generate(env);
    fund(&setup, &user, 10_000);
    fund(&setup, &counterparty, 10_000);

    let end_ts = env.ledger().timestamp() + 3600;
    let (market_addr, call_id) = deploy_market(&setup, end_ts);
    let market = PredictionMarketClient::new(env, &market_addr);

    // Sponsor the user for up to 50 stroops of gas at a 3% winning cut.
    setup.gas_station.sponsor_transaction(&user, &50i128, &300u32);

    // The user stakes directly, as themselves (the gas station only ever
    // relays the fee off-chain — see module docs — it never becomes an
    // intermediary staker).
    market.stake_on_call(&user, &call_id, &1_000i128, &OUTCOME_UP);
    market.stake_on_call(&counterparty, &call_id, &3_000i128, &OUTCOME_DOWN);

    resolve_market(&setup, call_id, OUTCOME_UP, end_ts);

    let user_balance_before_claim = token.balance(&user);
    let gas_station_balance_before = setup.gas_station.get_gas_station_balance();
    assert_eq!(gas_station_balance_before, 0);

    // winning_stake = 1,000 (sole winner), losing_stake = 3,000, fee_bps=0.
    // payout = 1,000 + 3,000 = 4,000. cut = 4,000 * 300 / 10,000 = 120.
    // user receives 4,000 - 120 = 3,880.
    setup.gas_station.claim_sponsored_payout(
        &market_addr,
        &setup.outcome_mgr_id,
        &call_id,
        &user,
        &1_000i128,
        &1_000i128,
        &3_000i128,
    );

    assert_eq!(token.balance(&user), user_balance_before_claim + 3_880);
    assert_eq!(setup.gas_station.get_gas_station_balance(), 120);

    let metrics = setup.gas_station.get_metrics();
    assert_eq!(metrics.total_winnings_collected, 120);
    // total_xlm_spent was booked at sponsor time (50); net = 120 - 50 = 70.
    assert_eq!(metrics.net_profit_loss, 70);
}

#[test]
fn claim_sponsored_payout_cannot_be_processed_twice_for_same_call() {
    let setup = setup_full_stack();
    let env = &setup.env;

    let user = Address::generate(env);
    let counterparty = Address::generate(env);
    fund(&setup, &user, 10_000);
    fund(&setup, &counterparty, 10_000);

    let end_ts = env.ledger().timestamp() + 3600;
    let (market_addr, call_id) = deploy_market(&setup, end_ts);
    let market = PredictionMarketClient::new(env, &market_addr);

    setup.gas_station.sponsor_transaction(&user, &50i128, &300u32);
    market.stake_on_call(&user, &call_id, &1_000i128, &OUTCOME_UP);
    market.stake_on_call(&counterparty, &call_id, &3_000i128, &OUTCOME_DOWN);
    resolve_market(&setup, call_id, OUTCOME_UP, end_ts);

    setup.gas_station.claim_sponsored_payout(
        &market_addr,
        &setup.outcome_mgr_id,
        &call_id,
        &user,
        &1_000i128,
        &1_000i128,
        &3_000i128,
    );

    let result = setup.gas_station.try_claim_sponsored_payout(
        &market_addr,
        &setup.outcome_mgr_id,
        &call_id,
        &user,
        &1_000i128,
        &1_000i128,
        &3_000i128,
    );
    assert_contract_error(result, GasStationError::CallAlreadyProcessed);
}

#[test]
fn claim_sponsored_payout_rejects_unsponsored_user() {
    let setup = setup_full_stack();
    let env = &setup.env;

    let user = Address::generate(env);
    let counterparty = Address::generate(env);
    fund(&setup, &user, 10_000);
    fund(&setup, &counterparty, 10_000);

    let end_ts = env.ledger().timestamp() + 3600;
    let (market_addr, call_id) = deploy_market(&setup, end_ts);
    let market = PredictionMarketClient::new(env, &market_addr);

    // Note: no sponsor_transaction call for `user`.
    market.stake_on_call(&user, &call_id, &1_000i128, &OUTCOME_UP);
    market.stake_on_call(&counterparty, &call_id, &3_000i128, &OUTCOME_DOWN);
    resolve_market(&setup, call_id, OUTCOME_UP, end_ts);

    let result = setup.gas_station.try_claim_sponsored_payout(
        &market_addr,
        &setup.outcome_mgr_id,
        &call_id,
        &user,
        &1_000i128,
        &1_000i128,
        &3_000i128,
    );
    assert_contract_error(result, GasStationError::UserNotSponsored);
}

// ─── claim_sponsored_payout: loss path ─────────────────────────────────────────

#[test]
fn sponsored_stake_loss_gas_station_absorbs_cost_no_deduction() {
    let setup = setup_full_stack();
    let env = &setup.env;
    let token = TokenClient::new(env, &setup.token);

    let user = Address::generate(env);
    let counterparty = Address::generate(env);
    fund(&setup, &user, 10_000);
    fund(&setup, &counterparty, 10_000);

    let end_ts = env.ledger().timestamp() + 3600;
    let (market_addr, call_id) = deploy_market(&setup, end_ts);
    let market = PredictionMarketClient::new(env, &market_addr);

    setup.gas_station.sponsor_transaction(&user, &50i128, &300u32);

    let user_balance_after_stake_before_resolve;
    market.stake_on_call(&user, &call_id, &1_000i128, &OUTCOME_DOWN);
    market.stake_on_call(&counterparty, &call_id, &3_000i128, &OUTCOME_UP);
    user_balance_after_stake_before_resolve = token.balance(&user);

    // The market resolves UP — the sponsored user picked DOWN and lost.
    resolve_market(&setup, call_id, OUTCOME_UP, end_ts);

    // Nothing to claim: the user has zero winning stake. Attempting a claim
    // is rejected before any funds move.
    let result = setup.gas_station.try_claim_sponsored_payout(
        &market_addr,
        &setup.outcome_mgr_id,
        &call_id,
        &user,
        &0i128,
        &3_000i128,
        &1_000i128,
    );
    assert_contract_error(result, GasStationError::InvalidWinningStake);

    // The user's balance is unchanged since the (failed) claim attempt —
    // they simply don't get their stake back (as normal for prediction
    // markets), and no gas station cut is deducted from a non-existent
    // payout.
    assert_eq!(token.balance(&user), user_balance_after_stake_before_resolve);

    // The pool's on-chain balance is untouched by the loss — the estimated
    // gas cost was fronted off-chain (see module docs); what the gas
    // station "absorbs" is the accounting write-off, visible here as a
    // negative net_profit_loss with total_xlm_spent already booked at
    // sponsor time and never recovered.
    assert_eq!(setup.gas_station.get_gas_station_balance(), 0);

    let metrics = setup.gas_station.get_metrics();
    assert_eq!(metrics.total_transactions_sponsored, 1);
    assert_eq!(metrics.total_xlm_spent, 50);
    assert_eq!(metrics.total_winnings_collected, 0);
    assert_eq!(metrics.net_profit_loss, -50);
}

// ─── pool refilling ─────────────────────────────────────────────────────────────

#[test]
fn refill_gas_pool_increases_balance() {
    let setup = setup_full_stack();

    assert_eq!(setup.gas_station.get_gas_station_balance(), 0);
    setup.gas_station.refill_gas_pool(&setup.admin, &10_000i128);
    assert_eq!(setup.gas_station.get_gas_station_balance(), 10_000);

    setup.gas_station.refill_gas_pool(&setup.admin, &5_000i128);
    assert_eq!(setup.gas_station.get_gas_station_balance(), 15_000);
}

#[test]
fn refill_gas_pool_rejects_non_positive_amount() {
    let setup = setup_full_stack();
    let result = setup.gas_station.try_refill_gas_pool(&setup.admin, &0i128);
    assert_contract_error(result, GasStationError::InvalidRefillAmount);
}

#[test]
fn winning_cuts_flow_back_into_the_same_pool_refill_grows() {
    let setup = setup_full_stack();
    let env = &setup.env;

    let user = Address::generate(env);
    let counterparty = Address::generate(env);
    fund(&setup, &user, 10_000);
    fund(&setup, &counterparty, 10_000);

    setup.gas_station.refill_gas_pool(&setup.admin, &1_000i128);
    assert_eq!(setup.gas_station.get_gas_station_balance(), 1_000);

    let end_ts = env.ledger().timestamp() + 3600;
    let (market_addr, call_id) = deploy_market(&setup, end_ts);
    let market = PredictionMarketClient::new(env, &market_addr);

    setup.gas_station.sponsor_transaction(&user, &50i128, &1_000u32); // 10%
    market.stake_on_call(&user, &call_id, &1_000i128, &OUTCOME_UP);
    market.stake_on_call(&counterparty, &call_id, &1_000i128, &OUTCOME_DOWN);
    resolve_market(&setup, call_id, OUTCOME_UP, end_ts);

    // payout = 1,000 + 1,000 = 2,000; cut = 200 (10%).
    setup.gas_station.claim_sponsored_payout(
        &market_addr,
        &setup.outcome_mgr_id,
        &call_id,
        &user,
        &1_000i128,
        &1_000i128,
        &1_000i128,
    );

    // Pool started at 1,000 (refill) and grew by the 200 cut.
    assert_eq!(setup.gas_station.get_gas_station_balance(), 1_200);
}

// ─── admin controls ─────────────────────────────────────────────────────────────

#[test]
fn refill_gas_pool_rejects_mismatched_admin() {
    let setup = setup_full_stack();
    let not_admin = Address::generate(&setup.env);
    fund(&setup, &not_admin, 10_000);

    let result = setup
        .gas_station
        .try_refill_gas_pool(&not_admin, &1_000i128);
    assert_contract_error(result, GasStationError::Unauthorized);
}

#[test]
fn set_admin_transfers_admin_rights() {
    let setup = setup_full_stack();
    let new_admin = Address::generate(&setup.env);
    fund(&setup, &new_admin, 10_000);

    setup.gas_station.set_admin(&new_admin);
    assert_eq!(setup.gas_station.get_admin(), new_admin);

    // The old admin address is no longer accepted by refill_gas_pool's
    // explicit address check.
    let result = setup
        .gas_station
        .try_refill_gas_pool(&setup.admin, &1_000i128);
    assert_contract_error(result, GasStationError::Unauthorized);

    // The new admin works.
    setup.gas_station.refill_gas_pool(&new_admin, &1_000i128);
    assert_eq!(setup.gas_station.get_gas_station_balance(), 1_000);
}

#[test]
fn initialize_cannot_be_called_twice() {
    let setup = setup_full_stack();
    let result = setup
        .gas_station
        .try_initialize(&setup.admin, &setup.token);
    assert_contract_error(result, GasStationError::AlreadyInitialized);
}
