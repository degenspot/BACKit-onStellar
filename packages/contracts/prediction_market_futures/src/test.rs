#![cfg(test)]

extern crate std;

use crate::{
    FuturesError, FuturesStatus, PredictionMarketFutures, PredictionMarketFuturesClient,
};
use prediction_market::{
    ConditionType, MarketInitArgs,
    PredictionMarket, PredictionMarketClient,
};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, BytesN, Env,
};

// Mock Factory that implements get_market
#[contract]
pub struct MockFactory;

#[contractimpl]
impl MockFactory {
    pub fn get_market(env: Env, call_id: u64) -> Address {
        env.storage().instance().get(&call_id).unwrap()
    }
}

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let sac = token.address();
    StellarAssetClient::new(env, &sac).mint(admin, &100_000_000_000);
    sac
}

struct TestSetup<'a> {
    env: Env,
    admin: Address,
    creator: Address,
    counterparty: Address,
    outcome_manager: Address,
    token: Address,
    token_client: TokenClient<'a>,
    factory_id: Address,
    market_id: Address,
    market_client: PredictionMarketClient<'a>,
    futures_id: Address,
    futures_client: PredictionMarketFuturesClient<'a>,
    call_id: u64,
}

fn setup_all<'a>(env: &'a Env, outcome_count: u32, initial_stakes: &[i128]) -> TestSetup<'a> {
    env.mock_all_auths();

    let admin = Address::generate(env);
    let creator = Address::generate(env);
    let counterparty = Address::generate(env);
    let outcome_manager = Address::generate(env);
    let token = setup_token(env, &admin);
    let token_client = TokenClient::new(env, &token);

    // Register Mock Factory
    let factory_id = env.register(MockFactory, ());

    // Register real PredictionMarket
    let call_id = 42u64;
    let end_ts = env.ledger().timestamp() + 100_000;
    let init_args = MarketInitArgs {
        stake_token: token.clone(),
        stake_amount: 1_000_000,
        start_price: 100_000_000,
        end_ts,
        token_address: token.clone(),
        pair_id: Bytes::from_slice(env, b"PAIR"),
        metadata_hash: BytesN::from_array(env, &[1u8; 32]),
        condition: ConditionType::TargetAbove(105_000_000),
        outcome_count,
    };

    let market_id = env.register(
        PredictionMarket,
        (
            call_id,
            creator.clone(),
            outcome_manager.clone(),
            factory_id.clone(),
            1i128, // min_stake
            0i128, // max_stake_per_user
            0u64,  // staking_cutoff
            init_args,
        ),
    );
    let market_client = PredictionMarketClient::new(env, &market_id);

    // Bind call_id in MockFactory to market_id
    env.as_contract(&factory_id, || {
        env.storage().instance().set(&call_id, &market_id);
    });

    // Deploy and initialize PredictionMarketFutures
    let futures_id = env.register(PredictionMarketFutures, ());
    let futures_client = PredictionMarketFuturesClient::new(env, &futures_id);
    futures_client.initialize(&factory_id);

    // Fund creator & counterparty
    token_client.transfer(&admin, &creator, &1_000_000);
    token_client.transfer(&admin, &counterparty, &1_000_000);

    // Apply initial stakes to shape pool ratio / implied probabilities
    for (i, &stake) in initial_stakes.iter().enumerate() {
        let position = (i + 1) as u32;
        if stake > 0 {
            let staker = Address::generate(env);
            token_client.transfer(&admin, &staker, &stake);
            market_client.stake_on_call(&staker, &call_id, &stake, &position);
        }
    }

    TestSetup {
        env: env.clone(),
        admin,
        creator,
        counterparty,
        outcome_manager,
        token,
        token_client,
        factory_id,
        market_id,
        market_client,
        futures_id,
        futures_client,
        call_id,
    }
}

#[test]
fn test_create_and_accept_futures() {
    let env = Env::default();
    let setup = setup_all(&env, 2, &[5_000, 5_000]);

    let expiry_ts = env.ledger().timestamp() + 5_000;
    let margin = 10_000i128;
    let contract_id = setup.futures_client.create_futures_contract(
        &setup.creator,
        &setup.call_id,
        &1u32,
        &5_000u32, // strike probability 50%
        &expiry_ts,
        &margin,
    );

    assert_eq!(contract_id, 1);

    // Verify creator margin locked
    assert_eq!(setup.token_client.balance(&setup.creator), 1_000_000 - margin);
    assert_eq!(setup.token_client.balance(&setup.futures_id), margin);

    let position = setup.futures_client.get_futures_position(&contract_id);
    assert_eq!(position.contract_id, 1);
    assert_eq!(position.creator, setup.creator);
    assert_eq!(position.counterparty, None);
    assert_eq!(position.is_settled, false);
    assert!(matches!(position.status, FuturesStatus::Pending));

    // Accept by counterparty
    setup.futures_client.accept_futures_counterparty(&setup.counterparty, &contract_id);

    // Verify counterparty margin locked
    assert_eq!(setup.token_client.balance(&setup.counterparty), 1_000_000 - margin);
    assert_eq!(setup.token_client.balance(&setup.futures_id), margin * 2);

    let position = setup.futures_client.get_futures_position(&contract_id);
    assert_eq!(position.counterparty, Some(setup.counterparty.clone()));
    assert!(matches!(position.status, FuturesStatus::Active));
}

#[test]
fn test_buyer_wins() {
    let env = Env::default();
    // Start with 5,000 on both outcomes (implied 50%)
    let setup = setup_all(&env, 2, &[5_000, 5_000]);

    let expiry_ts = env.ledger().timestamp() + 5_000;
    let margin = 10_000i128;
    // Creator is Long Outcome 1 at 5,000 bps strike (50%)
    let contract_id = setup.futures_client.create_futures_contract(
        &setup.creator,
        &setup.call_id,
        &1u32,
        &5_000u32,
        &expiry_ts,
        &margin,
    );
    setup.futures_client.accept_futures_counterparty(&setup.counterparty, &contract_id);

    // Odds move in creator (buyer)'s favor: stake more on outcome 1
    // Outcome 1: 5,000 + 15_000 = 20_000. Outcome 2: 5,000. Total: 25_000
    // Implied: 20_000 * 10_000 / 25_000 = 8_000 bps (80%)
    let extra_staker = Address::generate(&env);
    setup.token_client.transfer(&setup.admin, &extra_staker, &15_000);
    setup.market_client.stake_on_call(&extra_staker, &setup.call_id, &15_000, &1u32);

    // Advance time to expiry
    env.ledger().set_timestamp(expiry_ts + 1);

    // Settle futures
    setup.futures_client.settle_futures(&contract_id);

    // Math Verification:
    // strike_bps = 5_000
    // current_bps = 8_000
    // diff = 3_000
    // payout_delta = margin * 3_000 / 10_000 = 10_000 * 3_000 / 10_000 = 3_000
    // buyer_payout = margin + 3_000 = 13_000
    // seller_payout = margin - 3_000 = 7_000
    assert_eq!(setup.token_client.balance(&setup.creator), 1_000_000 - margin + 13_000);
    assert_eq!(setup.token_client.balance(&setup.counterparty), 1_000_000 - margin + 7_000);
    assert_eq!(setup.token_client.balance(&setup.futures_id), 0);

    let position = setup.futures_client.get_futures_position(&contract_id);
    assert_eq!(position.is_settled, true);
    assert!(matches!(position.status, FuturesStatus::Settled));
}

#[test]
fn test_seller_wins() {
    let env = Env::default();
    // Start with 5,000 on both outcomes (implied 50%)
    let setup = setup_all(&env, 2, &[5_000, 5_000]);

    let expiry_ts = env.ledger().timestamp() + 5_000;
    let margin = 10_000i128;
    // Creator is Long Outcome 1 at 5,000 bps strike (50%)
    let contract_id = setup.futures_client.create_futures_contract(
        &setup.creator,
        &setup.call_id,
        &1u32,
        &5_000u32,
        &expiry_ts,
        &margin,
    );
    setup.futures_client.accept_futures_counterparty(&setup.counterparty, &contract_id);

    // Odds move against creator (seller wins): stake more on outcome 2
    // Outcome 1: 5,000. Outcome 2: 5,000 + 15_000 = 20_000. Total: 25_000
    // Implied Outcome 1: 5_000 * 10_000 / 25_000 = 2_000 bps (20%)
    let extra_staker = Address::generate(&env);
    setup.token_client.transfer(&setup.admin, &extra_staker, &15_000);
    setup.market_client.stake_on_call(&extra_staker, &setup.call_id, &15_000, &2u32);

    // Advance time to expiry
    env.ledger().set_timestamp(expiry_ts + 1);

    // Settle futures
    setup.futures_client.settle_futures(&contract_id);

    // Math Verification:
    // strike_bps = 5_000
    // current_bps = 2_000
    // diff = 3_000
    // payout_delta = margin * 3_000 / 10_000 = 10_000 * 3_000 / 10_000 = 3_000
    // seller_payout = margin + 3_000 = 13_000
    // buyer_payout = margin - 3_000 = 7_000
    assert_eq!(setup.token_client.balance(&setup.creator), 1_000_000 - margin + 7_000);
    assert_eq!(setup.token_client.balance(&setup.counterparty), 1_000_000 - margin + 13_000);
    assert_eq!(setup.token_client.balance(&setup.futures_id), 0);

    let position = setup.futures_client.get_futures_position(&contract_id);
    assert_eq!(position.is_settled, true);
}

#[test]
fn test_exact_expiry_and_premature_settlement() {
    let env = Env::default();
    let setup = setup_all(&env, 2, &[5_000, 5_000]);

    let expiry_ts = env.ledger().timestamp() + 5_000;
    let margin = 10_000i128;
    let contract_id = setup.futures_client.create_futures_contract(
        &setup.creator,
        &setup.call_id,
        &1u32,
        &5_000u32,
        &expiry_ts,
        &margin,
    );
    setup.futures_client.accept_futures_counterparty(&setup.counterparty, &contract_id);

    // Attempt premature settlement (must fail)
    let result = setup.futures_client.try_settle_futures(&contract_id);
    assert_eq!(result, Err(Ok(FuturesError::ContractNotExpired)));

    // Settle at exact expiry timestamp (must pass)
    env.ledger().set_timestamp(expiry_ts);
    let result = setup.futures_client.try_settle_futures(&contract_id);
    assert!(result.is_ok());
}

#[test]
fn test_zero_delta_settlement() {
    let env = Env::default();
    let setup = setup_all(&env, 2, &[5_000, 5_000]);

    let expiry_ts = env.ledger().timestamp() + 5_000;
    let margin = 10_000i128;
    let contract_id = setup.futures_client.create_futures_contract(
        &setup.creator,
        &setup.call_id,
        &1u32,
        &5_000u32, // strike probability 50%
        &expiry_ts,
        &margin,
    );
    setup.futures_client.accept_futures_counterparty(&setup.counterparty, &contract_id);

    env.ledger().set_timestamp(expiry_ts);
    setup.futures_client.settle_futures(&contract_id);

    // Both parties receive exact margin back
    assert_eq!(setup.token_client.balance(&setup.creator), 1_000_000);
    assert_eq!(setup.token_client.balance(&setup.counterparty), 1_000_000);
}

#[test]
fn test_margin_cap_logic() {
    let env = Env::default();
    // Outcome 1 has 1,000 and Outcome 2 has 9,000 (total 10,000 -> implied 10%)
    let setup = setup_all(&env, 2, &[1_000, 9_000]);

    let expiry_ts = env.ledger().timestamp() + 5_000;
    let margin = 10_000i128;
    // Creator is Long Outcome 1 at 1,000 bps strike (10%)
    let contract_id = setup.futures_client.create_futures_contract(
        &setup.creator,
        &setup.call_id,
        &1u32,
        &1_000u32,
        &expiry_ts,
        &margin,
    );
    setup.futures_client.accept_futures_counterparty(&setup.counterparty, &contract_id);

    // Extreme shift: Outcome 1: 1,000 + 99_000 = 100_000. Outcome 2: 9_000. Total: 109_000
    // Implied Outcome 1: 100_000 * 10_000 / 109_000 = 9_174 bps (91.74%)
    // Diff = 9_174 - 1_000 = 8_174 bps.
    // Uncapped payout_delta = 10_000 * 8_174 / 10_000 = 8_174
    // But let's verify if we make current_bps move so much that diff exceeds 10,000.
    // Or we can set the strike at 1,000 and odds move to 100% (implied 10,000 bps).
    // Let's stake a massive amount on outcome 1: 9_999_000
    // Total stake = 10,000,000. Outcome 1 stake = 1,000 + 9_999_000 = 10,000,000 (effectively 100% implied bps).
    let extra_staker = Address::generate(&env);
    setup.token_client.transfer(&setup.admin, &extra_staker, &10_000_000);
    setup.market_client.stake_on_call(&extra_staker, &setup.call_id, &9_999_000, &1u32);

    env.ledger().set_timestamp(expiry_ts);
    setup.futures_client.settle_futures(&contract_id);

    // Mathematical cap check:
    // strike_bps = 1_000
    // current_bps = 10_000 (after rounding/division)
    // diff = 9_000
    // payout_delta = margin * 9_000 / 10_000 = 9_000.
    // Let's test with strike_bps = 0 and current_bps = 10_000 => diff = 10_000 => payout_delta = 10,000
    // Let's test what happens if strike_bps is 1_000 and margin is 5,000.
    // If margin is 5,000, diff = 9,000 => payout_delta = 5,000 * 9,000 / 10_000 = 4,500.
    // Let's verify that the payout delta is capped at `margin` (i.e. seller gets 0, buyer gets 2 * margin).
    // In our test, margin is 10,000. payout_delta is 8,991, which is < margin. So buyer gets 18,991, seller gets 1,009.
    assert_eq!(setup.token_client.balance(&setup.creator), 1_000_000 - margin + 18_991);
    assert_eq!(setup.token_client.balance(&setup.counterparty), 1_000_000 - margin + 1_009);

    // Let's do another check with strike = 1000 and current = 0 (Outcome 2 becomes 100% implied bps)
    // To do this, let's create another contract with a margin of 500 and a future expiry timestamp.
    let expiry_ts_2 = env.ledger().timestamp() + 5_000;
    let margin_2 = 500i128;
    let contract_id_2 = setup.futures_client.create_futures_contract(
        &setup.creator,
        &setup.call_id,
        &1u32,
        &1_000u32,
        &expiry_ts_2,
        &margin_2,
    );
    setup.futures_client.accept_futures_counterparty(&setup.counterparty, &contract_id_2);

    let balance_creator_before_settle_2 = setup.token_client.balance(&setup.creator);
    let balance_counterparty_before_settle_2 = setup.token_client.balance(&setup.counterparty);

    // Stake heavily on Outcome 2 to push Outcome 1 implied bps to effectively 0
    let extra_staker_2 = Address::generate(&env);
    setup.token_client.transfer(&setup.admin, &extra_staker_2, &10_000_000);
    setup.market_client.stake_on_call(&extra_staker_2, &setup.call_id, &10_000_000, &2u32);

    // Total stake = 10,009_000 + 10,000_000 = 20_009_000
    // Outcome 1 stake = 10,000_000
    // Implied Outcome 1 bps = 10,000_000 * 10,000 / 20_009_000 = 4_997 bps (49.97%)
    // Let's stake 1,000,000,000 on Outcome 2 to make it extremely large.
    let massive_staker = Address::generate(&env);
    setup.token_client.transfer(&setup.admin, &massive_staker, &1_000_000_000);
    setup.market_client.stake_on_call(&massive_staker, &setup.call_id, &1_000_000_000, &2u32);

    // Now total stake is ~1,020,000,000. Outcome 1 is 10,000,000 => implied outcome 1 is ~98 bps.
    // Strike is 1,000. Diff = 1,000 - 98 = 902.
    // payout_delta = 500 * 902 / 10000 = 45.1 => 45.
    env.ledger().set_timestamp(expiry_ts_2);
    setup.futures_client.settle_futures(&contract_id_2);

    // Seller (counterparty) receives margin_2 + payout_delta = 500 + 45 = 545
    // Buyer (creator) receives margin_2 - payout_delta = 500 - 45 = 455
    assert_eq!(setup.token_client.balance(&setup.creator), balance_creator_before_settle_2 + 455);
    assert_eq!(setup.token_client.balance(&setup.counterparty), balance_counterparty_before_settle_2 + 545);
}

#[test]
fn test_trading_and_transfer() {
    let env = Env::default();
    let setup = setup_all(&env, 2, &[5_000, 5_000]);

    let expiry_ts = env.ledger().timestamp() + 5_000;
    let margin = 10_000i128;
    let contract_id = setup.futures_client.create_futures_contract(
        &setup.creator,
        &setup.call_id,
        &1u32,
        &5_000u32,
        &expiry_ts,
        &margin,
    );
    setup.futures_client.accept_futures_counterparty(&setup.counterparty, &contract_id);

    let new_long = Address::generate(&env);
    let new_short = Address::generate(&env);

    // Transfer long position
    setup.futures_client.transfer_long_position(&contract_id, &new_long);

    // Transfer short position
    setup.futures_client.transfer_short_position(&contract_id, &new_short);

    let position = setup.futures_client.get_futures_position(&contract_id);
    assert_eq!(position.creator, new_long);
    assert_eq!(position.counterparty, Some(new_short.clone()));

    // Verify settlement pays out to the new owners
    env.ledger().set_timestamp(expiry_ts);
    setup.futures_client.settle_futures(&contract_id);

    assert_eq!(setup.token_client.balance(&new_long), 10_000);
    assert_eq!(setup.token_client.balance(&new_short), 10_000);
}
