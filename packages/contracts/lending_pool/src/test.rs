#![cfg(test)]

extern crate std;

use crate::types::AllocationOutcome;
use crate::{LendingPool, LendingPoolClient};
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
                 cd packages/contracts/prediction_market && cargo build --release --target wasm32v1-none"
            )
        });

    let wasm_bytes = std::fs::read(wasm_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", wasm_path.display()));
    env.deployer().upload_contract_wasm(wasm_bytes.as_slice())
}

fn default_market_args(
    env: &Env,
    stake_token: &Address,
    end_ts: u64,
    outcome_count: u32,
) -> MarketInitArgs {
    MarketInitArgs {
        stake_token: stake_token.clone(),
        stake_amount: 1_000,
        start_price: 100_000_000,
        end_ts,
        token_address: stake_token.clone(),
        pair_id: Bytes::from_slice(env, b"XLM-USDC"),
        metadata_hash: BytesN::from_array(env, &[1u8; 32]),
        condition: ConditionType::PercentUp(5),
        outcome_count,
    }
}

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let sac = token.address();
    let stellar = StellarAssetClient::new(env, &sac);
    stellar.mint(admin, &1_000_000_000_000);
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
    treasury: Address,
    token: Address,
    factory: PredictionMarketFactoryClient<'a>,
    outcome_mgr: OutcomeManagerClient<'a>,
    pool: LendingPoolClient<'a>,
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
    let treasury = Address::generate(&env);
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

    // quorum=1, dispute_window_secs=0, fee_bps=100 (1%): a single oracle
    // submission finalizes immediately, matching parlay_betting's own
    // reference test setup.
    outcome_mgr.initialize(&admin, &oracles, &1u32, &fee_collector, &100u32, &0u64);
    factory.initialize(&admin, &outcome_id, &market_wasm, &1_000);
    factory.whitelist_token(&token);
    outcome_mgr.set_factory(&factory_id);

    let pool_id = env.register(LendingPool, ());
    let pool = LendingPoolClient::new(&env, &pool_id);
    pool.initialize(
        &admin,
        &treasury,
        &token,
        &factory_id,
        &outcome_id,
        &100_000i128,      // min_deposit
        &1_000_000_000i128, // max_pool_size
        &1_000_000i128,     // min_allocation_pool_size
    );

    let token_client = TokenClient::new(&env, &token);
    token_client.transfer(&admin, &user, &100_000_000);
    token_client.transfer(&admin, &counterparty, &100_000_000);

    TestSetup {
        env,
        creator,
        user,
        counterparty,
        treasury,
        token,
        factory,
        outcome_mgr,
        pool,
        oracle_secret,
        oracle_pubkey,
    }
}

/// Deploy a market and have `counterparty` stake `counter_stake` on
/// `counter_position`, so the market's `outcome_stakes` reflect a
/// non-trivial (and, for our test numbers, deliberately lopsided) implied
/// probability before the pool ever looks at it.
fn deploy_market_with_counter_stake(
    setup: &TestSetup,
    end_ts: u64,
    counter_stake: i128,
    counter_position: u32,
    outcome_count: u32,
) -> (Address, u64) {
    let env = &setup.env;
    let args = default_market_args(env, &setup.token, end_ts, outcome_count);
    let market_addr = setup.factory.deploy_market(&setup.creator, &args);
    let market = PredictionMarketClient::new(env, &market_addr);
    let call_id = market.get_call_id();
    market.stake_on_call(&setup.counterparty, &call_id, &counter_stake, &counter_position);
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
    setup.outcome_mgr.submit_outcome_for_market(&signed, &end_ts);
}

// ─── Deposit / withdraw cycle ────────────────────────────────────────────────

#[test]
fn first_deposit_mints_shares_one_to_one() {
    let setup = setup_full_stack();
    let token = TokenClient::new(&setup.env, &setup.token);

    let minted = setup.pool.deposit(&setup.user, &10_000_000i128);
    assert_eq!(minted, 10_000_000);
    assert_eq!(setup.pool.get_user_lp_shares(&setup.user), 10_000_000);

    let stats = setup.pool.get_pool_stats();
    assert_eq!(stats.total_lp_shares, 10_000_000);
    assert_eq!(stats.total_deposited, 10_000_000);
    assert_eq!(stats.total_value_locked, 10_000_000);
    assert_eq!(stats.liquid_balance, 10_000_000);
    assert_eq!(token.balance(&setup.pool.address), 10_000_000);
}

#[test]
fn deposit_below_minimum_is_rejected() {
    let setup = setup_full_stack();
    let result = setup.pool.try_deposit(&setup.user, &1_000i128);
    assert!(result.is_err());
}

#[test]
fn deposit_above_max_pool_size_is_rejected() {
    let setup = setup_full_stack();
    // max_pool_size is 1_000_000_000 — a single deposit that would exceed it
    // outright must be rejected rather than silently truncated.
    let result = setup.pool.try_deposit(&setup.user, &2_000_000_000i128);
    assert!(result.is_err());
}

#[test]
fn withdraw_full_cycle_returns_principal_1_to_1_before_any_yield() {
    let setup = setup_full_stack();
    let token = TokenClient::new(&setup.env, &setup.token);
    let balance_before = token.balance(&setup.user);

    let minted = setup.pool.deposit(&setup.user, &5_000_000i128);
    let out = setup.pool.withdraw(&setup.user, &minted);

    assert_eq!(out, 5_000_000);
    assert_eq!(token.balance(&setup.user), balance_before);
    assert_eq!(setup.pool.get_user_lp_shares(&setup.user), 0);
    assert_eq!(setup.pool.get_pool_stats().total_lp_shares, 0);
}

#[test]
fn withdraw_more_shares_than_owned_is_rejected() {
    let setup = setup_full_stack();
    let minted = setup.pool.deposit(&setup.user, &1_000_000i128);
    let result = setup.pool.try_withdraw(&setup.user, &(minted + 1));
    assert!(result.is_err());
}

#[test]
fn withdraw_blocked_while_capital_is_locked_in_open_market() {
    let setup = setup_full_stack();
    let env = &setup.env;
    setup.pool.deposit(&setup.user, &10_000_000i128);

    let end_ts = env.ledger().timestamp() + 3600;
    let (_market, call_id) =
        deploy_market_with_counter_stake(&setup, end_ts, 3_000_000, OUTCOME_DOWN, 2);

    let mut markets = Vec::new(env);
    markets.push_back(crate::types::MarketAllocationInput {
        call_id,
        oracle_probability_bps: 5_000,
    });
    setup.pool.allocate_capital(&markets);

    // 5% of the 10,000,000 TVL (500,000) is now locked in the open market,
    // leaving 9,500,000 liquid. Withdrawing all 10,000,000 worth of shares
    // must fail; withdrawing an amount within the liquid balance succeeds.
    let stats = setup.pool.get_pool_stats();
    assert_eq!(stats.total_allocated_locked, 500_000);
    assert_eq!(stats.liquid_balance, 9_500_000);

    let result = setup.pool.try_withdraw(&setup.user, &10_000_000i128);
    assert!(result.is_err());

    let out = setup.pool.withdraw(&setup.user, &9_000_000i128);
    assert_eq!(out, 9_000_000);
}

// ─── Capital allocation: Kelly-edge math across multiple markets ────────────

/// Builds the shared two-market fixture used by the allocation/harvest tests
/// below. Hand-computed math (TVL = 10,000,000 throughout allocation):
///
/// - call_1: counterparty stakes 3,000,000 on DOWN, nobody on UP yet, so
///   `market_implied_bps(UP) = 0`. `oracle_probability_bps = 5,000` ⇒
///   `edge = 5,000` (50%), well above the 100-bps default threshold. The
///   pool favors UP (oracle > implied). `raw_alloc = 10,000,000 * 5,000 /
///   10,000 = 5,000,000`, capped at `max_allocation_bps_per_market` (default
///   500 = 5%): `cap = 10,000,000 * 500 / 10,000 = 500,000`. Allocated:
///   500,000 on position 1.
/// - call_2: counterparty stakes 1,000,000 on UP, so
///   `market_implied_bps(UP) = 10,000`. Same `oracle_probability_bps =
///   5,000` ⇒ `edge = 5,000`, but now oracle < implied so the pool favors
///   DOWN. Same cap math ⇒ 500,000 allocated on position 2.
fn setup_two_market_scenario<'a>() -> (TestSetup<'a>, u64, u64, u64, u64) {
    let setup = setup_full_stack();
    let env = &setup.env;

    setup.pool.deposit(&setup.user, &10_000_000i128);

    let end_ts_1 = env.ledger().timestamp() + 3600;
    let end_ts_2 = end_ts_1 + 3600;
    let (_market_1, call_1) =
        deploy_market_with_counter_stake(&setup, end_ts_1, 3_000_000, OUTCOME_DOWN, 2);
    let (_market_2, call_2) =
        deploy_market_with_counter_stake(&setup, end_ts_2, 1_000_000, OUTCOME_UP, 2);

    let mut markets = Vec::new(env);
    markets.push_back(crate::types::MarketAllocationInput {
        call_id: call_1,
        oracle_probability_bps: 5_000,
    });
    markets.push_back(crate::types::MarketAllocationInput {
        call_id: call_2,
        oracle_probability_bps: 5_000,
    });
    let results = setup.pool.allocate_capital(&markets);

    assert_eq!(results.len(), 2);
    assert_eq!(
        results.get(0).unwrap(),
        AllocationOutcome::Allocated(500_000, OUTCOME_UP)
    );
    assert_eq!(
        results.get(1).unwrap(),
        AllocationOutcome::Allocated(500_000, OUTCOME_DOWN)
    );

    (setup, call_1, call_2, end_ts_1, end_ts_2)
}

#[test]
fn allocate_capital_stakes_kelly_edge_across_multiple_markets() {
    let (setup, call_1, call_2, _end_ts_1, _end_ts_2) = setup_two_market_scenario();

    let alloc_1 = setup.pool.get_allocation(&call_1).unwrap();
    assert_eq!(alloc_1.position, OUTCOME_UP);
    assert_eq!(alloc_1.amount, 500_000);
    assert!(!alloc_1.settled);

    let alloc_2 = setup.pool.get_allocation(&call_2).unwrap();
    assert_eq!(alloc_2.position, OUTCOME_DOWN);
    assert_eq!(alloc_2.amount, 500_000);
    assert!(!alloc_2.settled);

    // Staking doesn't change TVL — it just moves capital from "liquid" to
    // "locked", so LP share price is untouched by allocation alone.
    let stats = setup.pool.get_pool_stats();
    assert_eq!(stats.total_value_locked, 10_000_000);
    assert_eq!(stats.total_allocated_locked, 1_000_000);
    assert_eq!(stats.liquid_balance, 9_000_000);
    assert_eq!(stats.open_market_count, 2);
}

#[test]
fn allocate_capital_below_min_pool_size_is_rejected() {
    let setup = setup_full_stack();
    let env = &setup.env;
    // Below the 1,000,000 min_allocation_pool_size configured in setup.
    setup.pool.deposit(&setup.user, &500_000i128);

    let end_ts = env.ledger().timestamp() + 3600;
    let (_market, call_id) =
        deploy_market_with_counter_stake(&setup, end_ts, 3_000_000, OUTCOME_DOWN, 2);

    let mut markets = Vec::new(env);
    markets.push_back(crate::types::MarketAllocationInput {
        call_id,
        oracle_probability_bps: 5_000,
    });
    let result = setup.pool.try_allocate_capital(&markets);
    assert!(result.is_err());
}

#[test]
fn allocate_capital_skips_non_binary_and_small_edge_markets() {
    let setup = setup_full_stack();
    let env = &setup.env;
    setup.pool.deposit(&setup.user, &10_000_000i128);

    // A 3-outcome market: this pool's Kelly-edge math only supports binary
    // markets, so it must be skipped rather than mis-handled.
    let end_ts_1 = env.ledger().timestamp() + 3600;
    let (_market_1, call_1) =
        deploy_market_with_counter_stake(&setup, end_ts_1, 1_000_000, 1, 3);

    // A binary market whose implied probability already matches the oracle
    // estimate exactly — zero edge, below the default 100-bps threshold.
    let end_ts_2 = end_ts_1 + 3600;
    let (_market_2, call_2) =
        deploy_market_with_counter_stake(&setup, end_ts_2, 1_000_000, OUTCOME_UP, 2);
    // market_implied_bps(UP) = 10,000 (all stakes on UP so far); an oracle
    // estimate that agrees exactly produces edge = 0.

    let mut markets = Vec::new(env);
    markets.push_back(crate::types::MarketAllocationInput {
        call_id: call_1,
        oracle_probability_bps: 5_000,
    });
    markets.push_back(crate::types::MarketAllocationInput {
        call_id: call_2,
        oracle_probability_bps: 10_000,
    });
    let results = setup.pool.allocate_capital(&markets);

    assert_eq!(results.get(0).unwrap(), AllocationOutcome::SkippedNotBinary);
    assert_eq!(results.get(1).unwrap(), AllocationOutcome::SkippedEdgeTooSmall);

    // Nothing was actually staked.
    let stats = setup.pool.get_pool_stats();
    assert_eq!(stats.total_allocated_locked, 0);
    assert_eq!(stats.liquid_balance, 10_000_000);
}

// ─── Yield harvesting: win/loss, protocol fee, APY, LP share price growth ───

#[test]
fn harvest_yield_on_a_win_applies_the_protocol_fee() {
    let (setup, call_1, _call_2, end_ts_1, _end_ts_2) = setup_two_market_scenario();

    // Market 1 resolves UP: the pool's 500,000 stake on position 1 is the
    // *sole* winning stake against a 3,000,000 losing pot (counterparty).
    // outcome_manager fee_bps = 100 (1%): total_fee = 3,000,000 * 100 /
    // 10,000 = 30,000; net_losing = 2,970,000; since the pool is the sole
    // winner, prize_share = 2,970,000 and payout = 500,000 + 2,970,000 =
    // 3,470,000. gross_change = 3,470,000 - 500,000 = 2,970,000. Lending
    // pool's own protocol_fee_bps = 1,000 (10%, default): fee = 297,000,
    // net_yield = 2,673,000.
    resolve_market(&setup, call_1, OUTCOME_UP, end_ts_1);
    let net_yield = setup.pool.harvest_yield(&call_1);
    assert_eq!(net_yield, 2_673_000);

    let token = TokenClient::new(&setup.env, &setup.token);
    assert_eq!(token.balance(&setup.treasury), 297_000);

    let alloc = setup.pool.get_allocation(&call_1).unwrap();
    assert!(alloc.settled);
    assert!(alloc.won);
    assert_eq!(alloc.payout, 3_470_000);

    let stats = setup.pool.get_pool_stats();
    assert_eq!(stats.total_yield_earned, 2_673_000);
    // call_2 (500,000) is still open.
    assert_eq!(stats.total_allocated_locked, 500_000);
}

#[test]
fn harvest_yield_on_a_loss_records_negative_yield_with_no_fee() {
    let (setup, _call_1, call_2, _end_ts_1, end_ts_2) = setup_two_market_scenario();

    // Market 2 resolves UP: the pool staked DOWN (500,000) and loses it
    // outright — nothing to claim, gross_change = 0 - 500,000 = -500,000,
    // and losses never incur the protocol fee.
    resolve_market(&setup, call_2, OUTCOME_UP, end_ts_2);
    let net_yield = setup.pool.harvest_yield(&call_2);
    assert_eq!(net_yield, -500_000);

    let token = TokenClient::new(&setup.env, &setup.token);
    assert_eq!(token.balance(&setup.treasury), 0);

    let alloc = setup.pool.get_allocation(&call_2).unwrap();
    assert!(alloc.settled);
    assert!(!alloc.won);
    assert_eq!(alloc.payout, 0);

    assert_eq!(setup.pool.get_pool_stats().total_yield_earned, -500_000);
}

#[test]
fn harvest_yield_twice_is_rejected() {
    let (setup, call_1, _call_2, end_ts_1, _end_ts_2) = setup_two_market_scenario();
    resolve_market(&setup, call_1, OUTCOME_UP, end_ts_1);
    setup.pool.harvest_yield(&call_1);

    let result = setup.pool.try_harvest_yield(&call_1);
    assert!(result.is_err());
}

#[test]
fn harvest_yield_before_resolution_is_rejected() {
    let (setup, call_1, _call_2, _end_ts_1, _end_ts_2) = setup_two_market_scenario();
    let result = setup.pool.try_harvest_yield(&call_1);
    assert!(result.is_err());
}

#[test]
fn pool_apy_and_lp_share_price_grow_after_net_positive_yield() {
    let (setup, call_1, call_2, end_ts_1, end_ts_2) = setup_two_market_scenario();

    resolve_market(&setup, call_1, OUTCOME_UP, end_ts_1);
    setup.pool.harvest_yield(&call_1);
    resolve_market(&setup, call_2, OUTCOME_UP, end_ts_2);
    setup.pool.harvest_yield(&call_2);

    // Combined net yield: +2,673,000 (call_1 win) - 500,000 (call_2 loss)
    // = 2,173,000. TVL grows from 10,000,000 to 12,173,000 even though
    // total_lp_shares (10,000,000) hasn't changed — the LP share price
    // (tvl / total_lp_shares) has grown from 1.0 to 1.2173.
    let stats = setup.pool.get_pool_stats();
    assert_eq!(stats.total_yield_earned, 2_173_000);
    assert_eq!(stats.total_value_locked, 12_173_000);
    assert_eq!(stats.total_allocated_locked, 0);
    assert_eq!(stats.total_lp_shares, 10_000_000);
    // Rolling 7-day APY, annualized: 2,173,000 * 10,000 * 365 / (7 *
    // 12,173,000) = 93,080 bps (~930%, since both harvests landed within
    // the same hour of simulated time — see `compute_apy_bps`'s doc
    // comment on why a fast-realized profit produces an outsized figure).
    assert_eq!(stats.current_apy_bps, 93_080);

    // A brand-new deposit now must mint fewer shares per token than
    // `user`'s original 1:1 deposit did, proving the share price grew:
    // 1,217,300 * 10,000,000 / 12,173,000 = 1,000,000 shares exactly.
    // `counterparty` already holds tokens from `setup_full_stack`'s initial
    // funding and hasn't deposited into the pool yet, so it stands in here
    // as the "new depositor".
    let minted = setup.pool.deposit(&setup.counterparty, &1_217_300i128);
    assert_eq!(minted, 1_000_000);
    assert_eq!(setup.pool.get_user_lp_shares(&setup.counterparty), 1_000_000);
    assert_eq!(setup.pool.get_pool_stats().total_lp_shares, 11_000_000);
}

// ─── Configurable protocol fee ───────────────────────────────────────────────

#[test]
fn protocol_fee_bps_is_configurable_and_applied() {
    let setup = setup_full_stack();
    let env = &setup.env;

    // Bump the protocol's cut of profits from the 10% default to 20%.
    setup.pool.set_protocol_fee_bps(&2_000u32);
    assert_eq!(setup.pool.get_pool_stats().protocol_fee_bps, 2_000);

    setup.pool.deposit(&setup.user, &10_000_000i128);
    let end_ts = env.ledger().timestamp() + 3600;
    let (_market, call_id) =
        deploy_market_with_counter_stake(&setup, end_ts, 3_000_000, OUTCOME_DOWN, 2);

    let mut markets = Vec::new(env);
    markets.push_back(crate::types::MarketAllocationInput {
        call_id,
        oracle_probability_bps: 5_000,
    });
    setup.pool.allocate_capital(&markets);

    resolve_market(&setup, call_id, OUTCOME_UP, end_ts);
    // Same win math as before: gross_change = 2,970,000. At 20% protocol
    // fee: fee = 594,000, net_yield = 2,376,000.
    let net_yield = setup.pool.harvest_yield(&call_id);
    assert_eq!(net_yield, 2_376_000);

    let token = TokenClient::new(env, &setup.token);
    assert_eq!(token.balance(&setup.treasury), 594_000);
}

#[test]
fn max_allocation_bps_per_market_is_configurable() {
    let setup = setup_full_stack();
    let env = &setup.env;

    // Raise the per-market cap from the 5% default to 10%.
    setup.pool.set_max_alloc_bps_per_market(&1_000u32);
    setup.pool.deposit(&setup.user, &10_000_000i128);

    let end_ts = env.ledger().timestamp() + 3600;
    let (_market, call_id) =
        deploy_market_with_counter_stake(&setup, end_ts, 3_000_000, OUTCOME_DOWN, 2);

    let mut markets = Vec::new(env);
    markets.push_back(crate::types::MarketAllocationInput {
        call_id,
        oracle_probability_bps: 5_000,
    });
    let results = setup.pool.allocate_capital(&markets);

    // edge = 5,000 bps still implies raw_alloc = 5,000,000, but now the cap
    // is 10,000,000 * 1,000 / 10,000 = 1,000,000 — double the default-cap
    // test's 500,000.
    assert_eq!(
        results.get(0).unwrap(),
        AllocationOutcome::Allocated(1_000_000, OUTCOME_UP)
    );
}
