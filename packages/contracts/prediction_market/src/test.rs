#![cfg(test)]

extern crate std;

use crate::{
    errors::MarketError,
    types::{ConditionType, MarketInitArgs},
    PredictionMarket, PredictionMarketClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, BytesN, Env,
};

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let sac = token.address();
    StellarAssetClient::new(env, &sac).mint(admin, &100_000_000_000);
    sac
}

/// #465: shared market-deployment helper for the limit-order test suite.
/// Uses a low `min_stake` (default 1) so hand-computed implied-probability
/// examples can use small, easy-to-verify numbers.
fn setup_market(
    env: &Env,
    creator: &Address,
    outcome_manager: &Address,
    factory: &Address,
    token: &Address,
    call_id: u64,
    min_stake: i128,
    max_stake_per_user: i128,
    outcome_count: u32,
) -> Address {
    let end_ts = env.ledger().timestamp() + 1_000_000;
    let args = MarketInitArgs {
        stake_token: token.clone(),
        stake_amount: min_stake,
        start_price: 100_000_000,
        end_ts,
        token_address: token.clone(),
        pair_id: Bytes::from_slice(env, b"PAIR"),
        metadata_hash: BytesN::from_array(env, &[7u8; 32]),
        condition: ConditionType::TargetAbove(105_000_000),
        outcome_count,
    };

    env.register(
        PredictionMarket,
        (
            call_id,
            creator.clone(),
            outcome_manager.clone(),
            factory.clone(),
            min_stake,
            max_stake_per_user,
            0u64,
            args,
        ),
    )
}

#[test]
fn market_constructor_and_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let staker = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let factory = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let end_ts = env.ledger().timestamp() + 3600;
    let args = MarketInitArgs {
        stake_token: token.clone(),
        stake_amount: 1_000_000,
        start_price: 100_000_000,
        end_ts,
        token_address: token.clone(),
        pair_id: Bytes::from_slice(&env, b"PAIR"),
        metadata_hash: BytesN::from_array(&env, &[2u8; 32]),
        condition: ConditionType::TargetAbove(105_000_000),
        outcome_count: 2,
    };

    let market_id = env.register(
        PredictionMarket,
        (
            1u64,
            creator.clone(),
            outcome_manager,
            factory,
            100_000i128,
            0i128,
            300u64,
            args,
        ),
    );
    let market = PredictionMarketClient::new(&env, &market_id);

    TokenClient::new(&env, &token).transfer(&admin, &staker, &5_000_000);
    market.stake_on_call(&staker, &1u64, &2_000_000, &1u32);

    let stakes = market.get_outcome_stakes(&1u64);
    assert_eq!(stakes.get(1u32).unwrap(), 2_000_000);
    assert_eq!(market.get_staker_stake(&1u64, &staker, &1u32), 2_000_000);
}

#[test]
fn market_resolve_requires_outcome_manager() {
    let env = Env::default();
    env.mock_all_auths();

    let creator = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let factory = Address::generate(&env);
    let token = setup_token(&env, &creator);

    let end_ts = env.ledger().timestamp() + 100;
    let args = MarketInitArgs {
        stake_token: token,
        stake_amount: 1_000_000,
        start_price: 100_000_000,
        end_ts,
        token_address: Address::generate(&env),
        pair_id: Bytes::from_slice(&env, b"P"),
        metadata_hash: BytesN::from_array(&env, &[3u8; 32]),
        condition: ConditionType::PercentUp(1),
        outcome_count: 2,
    };

    let market_id = env.register(
        PredictionMarket,
        (
            42u64,
            creator,
            outcome_manager.clone(),
            factory,
            100_000i128,
            0i128,
            0u64,
            args,
        ),
    );
    let market = PredictionMarketClient::new(&env, &market_id);

    env.ledger().set_timestamp(end_ts + 1);
    let result = market.try_resolve_call(&42u64, &1u32, &110_000_000);
    // With mock_all_auths, resolution succeeds when outcome_manager auth is mocked.
    assert!(result.is_ok());
}

// ─── #465: Non-custodial limit orders ─────────────────────────────────────

#[test]
fn limit_order_created_escrows_tokens_and_is_listed() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let factory = Address::generate(&env);
    let orderer = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let market_id = setup_market(&env, &creator, &outcome_manager, &factory, &token, 1, 1, 0, 2);
    let market = PredictionMarketClient::new(&env, &market_id);
    let token_client = TokenClient::new(&env, &token);

    token_client.transfer(&admin, &orderer, &5_000);
    assert_eq!(token_client.balance(&orderer), 5_000);

    let order_id = market.create_limit_order(&orderer, &1u64, &1u32, &2_000i128, &3_000u32, &3600u64);
    assert_eq!(order_id, 1);

    // Escrow transferred out of the orderer's wallet into the contract.
    assert_eq!(token_client.balance(&orderer), 3_000);
    assert_eq!(token_client.balance(&market_id), 2_000);

    let open = market.get_open_orders(&1u64);
    assert_eq!(open.len(), 1);
    let order = open.get(0).unwrap();
    assert_eq!(order.id, 1);
    assert_eq!(order.user, orderer);
    assert_eq!(order.call_id, 1);
    assert_eq!(order.outcome, 1);
    assert_eq!(order.amount, 2_000);
    assert_eq!(order.target_probability_bps, 3_000);

    let user_orders = market.get_user_orders(&orderer);
    assert_eq!(user_orders.len(), 1);
    assert_eq!(user_orders.get(0).unwrap().id, 1);
}

#[test]
fn limit_order_rejects_invalid_target_and_ttl() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let factory = Address::generate(&env);
    let orderer = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let market_id = setup_market(&env, &creator, &outcome_manager, &factory, &token, 1, 1, 0, 2);
    let market = PredictionMarketClient::new(&env, &market_id);
    TokenClient::new(&env, &token).transfer(&admin, &orderer, &10_000);

    // target_implied_probability_bps > 10_000 is invalid.
    let result = market.try_create_limit_order(&orderer, &1u64, &1u32, &1_000i128, &10_001u32, &3600u64);
    assert_eq!(result, Err(Ok(MarketError::InvalidTargetProbability)));

    // ttl_secs == 0 is invalid.
    let result = market.try_create_limit_order(&orderer, &1u64, &1u32, &1_000i128, &3_000u32, &0u64);
    assert_eq!(result, Err(Ok(MarketError::InvalidOrderTTL)));

    // ttl_secs beyond MAX_ORDER_TTL_SECS (7 days) is invalid.
    let result = market.try_create_limit_order(
        &orderer,
        &1u64,
        &1u32,
        &1_000i128,
        &3_000u32,
        &(7 * 24 * 3600 + 1),
    );
    assert_eq!(result, Err(Ok(MarketError::InvalidOrderTTL)));

    // No tokens should have moved for any of the rejected orders.
    assert_eq!(TokenClient::new(&env, &token).balance(&orderer), 10_000);
}

/// Hand-computed fill scenario matching the worked example in
/// `create_limit_order`'s doc comment:
///   - outcome 1 has 3_000 staked, outcome 2 has 7_000 staked (total 10_000)
///     => implied_probability_bps(1) = 3_000 * 10_000 / 10_000 = 3_000 (30%).
///   - A limit order on outcome 1 with target 2_000 bps (20%) does NOT fill
///     yet, since 3_000 > 2_000.
///   - After 15_000 more is staked on outcome 2 (new total 25_000), outcome 1's
///     share becomes implied_probability_bps(1) = 3_000 * 10_000 / 25_000 =
///     1_200 (12%), which is <= 2_000, so the order fills at 1_200 bps.
#[test]
fn limit_order_fills_when_target_probability_reached() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let factory = Address::generate(&env);
    let staker1 = Address::generate(&env);
    let staker2 = Address::generate(&env);
    let staker3 = Address::generate(&env);
    let orderer = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let market_id = setup_market(&env, &creator, &outcome_manager, &factory, &token, 1, 1, 0, 2);
    let market = PredictionMarketClient::new(&env, &market_id);
    let token_client = TokenClient::new(&env, &token);

    for s in [&staker1, &staker2, &staker3, &orderer] {
        token_client.transfer(&admin, s, &50_000);
    }

    market.stake_on_call(&staker1, &1u64, &3_000i128, &1u32);
    market.stake_on_call(&staker2, &1u64, &7_000i128, &2u32);

    // Pool is 3_000 / 7_000 (30% on outcome 1). Order wants <= 20% — must not
    // fill immediately, and creation only escrows, it never matches itself.
    let order_id = market.create_limit_order(&orderer, &1u64, &1u32, &1_000i128, &2_000u32, &3600u64);
    assert_eq!(market.get_staker_stake(&1u64, &orderer, &1u32), 0);
    assert_eq!(market.get_open_orders(&1u64).len(), 1);

    // Push outcome 2 up by 15_000 (new total 25_000) -> implied(1) = 3_000 *
    // 10_000 / 25_000 = 1_200 bps (12%), which is <= 2_000, so the matching
    // loop inside this very stake_on_call call should fill the order.
    market.stake_on_call(&staker3, &1u64, &15_000i128, &2u32);

    // Order filled: escrowed 1_000 applied to outcome 1 for `orderer`.
    assert_eq!(market.get_staker_stake(&1u64, &orderer, &1u32), 1_000);
    let stakes = market.get_outcome_stakes(&1u64);
    assert_eq!(stakes.get(1u32).unwrap(), 3_000 + 1_000);
    assert_eq!(stakes.get(2u32).unwrap(), 7_000 + 15_000);

    // Order removed from both indices.
    assert_eq!(market.get_open_orders(&1u64).len(), 0);
    assert_eq!(market.get_user_orders(&orderer).len(), 0);

    // Escrow was consumed by the fill, not refunded — orderer's wallet
    // reflects the original transfer-out at order-creation time only.
    assert_eq!(token_client.balance(&orderer), 50_000 - 1_000);
    let _ = order_id;
}

#[test]
fn limit_order_cancelled_before_fill_refunds_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let factory = Address::generate(&env);
    let orderer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let market_id = setup_market(&env, &creator, &outcome_manager, &factory, &token, 1, 1, 0, 2);
    let market = PredictionMarketClient::new(&env, &market_id);
    let token_client = TokenClient::new(&env, &token);
    token_client.transfer(&admin, &orderer, &10_000);

    let order_id = market.create_limit_order(&orderer, &1u64, &1u32, &4_000i128, &3_000u32, &3600u64);
    assert_eq!(token_client.balance(&orderer), 6_000);

    // Only the owner may cancel.
    let result = market.try_cancel_limit_order(&stranger, &order_id);
    assert_eq!(result, Err(Ok(MarketError::NotOrderOwner)));

    market.cancel_limit_order(&orderer, &order_id);
    assert_eq!(token_client.balance(&orderer), 10_000);
    assert_eq!(market.get_open_orders(&1u64).len(), 0);
    assert_eq!(market.get_user_orders(&orderer).len(), 0);

    // Cancelling again fails: the order no longer exists.
    let result = market.try_cancel_limit_order(&orderer, &order_id);
    assert_eq!(result, Err(Ok(MarketError::OrderNotFound)));
}

/// Hand-computed reward math for expired-order refunds:
///   amount = 4_000, default `expired_order_refund_bps` = 50 (0.5%)
///   reward = 4_000 * 50 / 10_000 = 20
///   refund_to_user = 4_000 - 20 = 3_980
#[test]
fn limit_order_expired_is_not_matched_and_is_refundable_with_reward() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let factory = Address::generate(&env);
    let orderer = Address::generate(&env);
    let refunder = Address::generate(&env);
    let staker = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let market_id = setup_market(&env, &creator, &outcome_manager, &factory, &token, 1, 1, 0, 2);
    let market = PredictionMarketClient::new(&env, &market_id);
    let token_client = TokenClient::new(&env, &token);
    token_client.transfer(&admin, &orderer, &10_000);
    token_client.transfer(&admin, &staker, &10_000);

    let now = env.ledger().timestamp();
    // Target of 10_000 bps (100%) always matches once any stake exists, so
    // if this order is NOT filled after expiry, that proves the matching
    // loop correctly skips expired orders rather than filling them.
    let order_id = market.create_limit_order(&orderer, &1u64, &1u32, &4_000i128, &10_000u32, &100u64);

    // Refunding before expiry must fail.
    let result = market.try_refund_expired_order(&refunder, &order_id);
    assert_eq!(result, Err(Ok(MarketError::OrderNotExpired)));

    env.ledger().set_timestamp(now + 101);

    // Trigger the matching loop; the order is expired so it must be skipped,
    // not filled, even though its target would otherwise always match.
    market.stake_on_call(&staker, &1u64, &500i128, &2u32);
    assert_eq!(market.get_staker_stake(&1u64, &orderer, &1u32), 0);
    assert_eq!(market.get_open_orders(&1u64).len(), 1);

    market.refund_expired_order(&refunder, &order_id);

    assert_eq!(token_client.balance(&refunder), 20);
    assert_eq!(token_client.balance(&orderer), 10_000 - 4_000 + 3_980);
    assert_eq!(market.get_open_orders(&1u64).len(), 0);
    assert_eq!(market.get_user_orders(&orderer).len(), 0);

    // Refunding twice fails: already removed.
    let result = market.try_refund_expired_order(&refunder, &order_id);
    assert_eq!(result, Err(Ok(MarketError::OrderNotFound)));
}

/// "Multiple orders matching in sequence": three orders with progressively
/// tighter target thresholds fill one at a time as the pool ratio for
/// outcome 1 is pushed down across successive `stake_on_call` calls.
#[test]
fn limit_order_multiple_orders_fill_in_sequence() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let factory = Address::generate(&env);
    let seed_staker = Address::generate(&env);
    let pusher = Address::generate(&env);
    let order_a = Address::generate(&env);
    let order_b = Address::generate(&env);
    let order_c = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let market_id = setup_market(&env, &creator, &outcome_manager, &factory, &token, 1, 1, 0, 2);
    let market = PredictionMarketClient::new(&env, &market_id);
    let token_client = TokenClient::new(&env, &token);
    for a in [&seed_staker, &pusher, &order_a, &order_b, &order_c] {
        token_client.transfer(&admin, a, &1_000_000);
    }

    // Seed: outcome1 = 5_000, outcome2 = 5_000 => implied(1) = 5_000 bps (50%).
    market.stake_on_call(&seed_staker, &1u64, &5_000i128, &1u32);
    market.stake_on_call(&seed_staker, &1u64, &5_000i128, &2u32);

    // Three orders on outcome 1 wanting progressively better (lower) odds.
    let id_a = market.create_limit_order(&order_a, &1u64, &1u32, &100i128, &4_000u32, &3600u64); // fills once implied <= 40%
    let id_b = market.create_limit_order(&order_b, &1u64, &1u32, &100i128, &2_000u32, &3600u64); // fills once implied <= 20%
    let id_c = market.create_limit_order(&order_c, &1u64, &1u32, &100i128, &1_000u32, &3600u64); // fills once implied <= 10%

    // Push outcome 2 to 15_000 (total 20_000) => implied(1) = 5_000/20_000 =
    // 2_500 bps (25%). Only order_a (target 40%) should fill; b (20%) and
    // c (10%) must remain open since 25% > 20% and 25% > 10%.
    market.stake_on_call(&pusher, &1u64, &10_000i128, &2u32);
    assert_eq!(market.get_staker_stake(&1u64, &order_a, &1u32), 100);
    assert_eq!(market.get_staker_stake(&1u64, &order_b, &1u32), 0);
    assert_eq!(market.get_staker_stake(&1u64, &order_c, &1u32), 0);
    assert_eq!(market.get_open_orders(&1u64).len(), 2);

    // Push outcome 2 further: total becomes 20_000 (existing) + 100 (order_a
    // fill already applied) + new stake. Current state: outcome1 = 5_100,
    // outcome2 = 15_000. Add 14_900 more to outcome2 => outcome2 = 29_900,
    // total = 35_000. implied(1) = 5_100 * 10_000 / 35_000 = 1_457 bps
    // (~14.57%), which is <= 20% (order_b) but > 10% (order_c): only b fills.
    market.stake_on_call(&pusher, &1u64, &14_900i128, &2u32);
    assert_eq!(market.get_staker_stake(&1u64, &order_b, &1u32), 100);
    assert_eq!(market.get_staker_stake(&1u64, &order_c, &1u32), 0);
    assert_eq!(market.get_open_orders(&1u64).len(), 1);

    // Push outcome 2 hard: outcome1 = 5_200, outcome2 currently 29_900; add
    // enough that outcome1's share drops under 10%. Need total >= 5_200 *
    // 10_000 / 1_000 = 52_000, so outcome2 must reach >= 46_800. Add 20_000
    // more (outcome2 = 49_900, total = 55_100): implied(1) = 5_200 * 10_000 /
    // 55_100 = 943 bps (~9.43%) <= 10% -> order_c fills.
    market.stake_on_call(&pusher, &1u64, &20_000i128, &2u32);
    assert_eq!(market.get_staker_stake(&1u64, &order_c, &1u32), 100);
    assert_eq!(market.get_open_orders(&1u64).len(), 0);

    let _ = (id_a, id_b, id_c);
}

/// Per-call iteration cap: with `MAX_ORDERS_MATCHED_PER_STAKE` = 20, if 25
/// always-eligible orders are open on one call, a single `stake_on_call`
/// only fills the first 20 (FIFO by creation order); the remaining 5 stay
/// open until a subsequent `stake_on_call` picks them up. This is this
/// implementation's chosen interpretation of "partial fill" (see the doc
/// comment on `stake_on_call`): batches beyond the per-call budget remain
/// open rather than the single order itself being fractionally filled.
#[test]
fn limit_order_matching_cap_leaves_excess_orders_open_for_next_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let factory = Address::generate(&env);
    let seed_staker = Address::generate(&env);
    let trigger_staker = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let market_id = setup_market(&env, &creator, &outcome_manager, &factory, &token, 1, 1, 0, 2);
    let market = PredictionMarketClient::new(&env, &market_id);
    let token_client = TokenClient::new(&env, &token);
    token_client.transfer(&admin, &seed_staker, &1_000_000);
    token_client.transfer(&admin, &trigger_staker, &1_000_000);

    // Seed a non-zero pool so implied-probability division is well-defined.
    market.stake_on_call(&seed_staker, &1u64, &1_000i128, &2u32);

    // 25 orders, each with target = 10_000 bps (100%), so every one of them
    // is always eligible to fill regardless of the exact pool ratio.
    let mut orderers = std::vec::Vec::new();
    for _ in 0..25 {
        let orderer = Address::generate(&env);
        token_client.transfer(&admin, &orderer, &10);
        market.create_limit_order(&orderer, &1u64, &1u32, &1i128, &10_000u32, &3600u64);
        orderers.push(orderer);
    }
    assert_eq!(market.get_open_orders(&1u64).len(), 25);

    // First triggering stake: only 20 of the 25 open orders should fill.
    market.stake_on_call(&trigger_staker, &1u64, &1i128, &2u32);
    assert_eq!(market.get_open_orders(&1u64).len(), 5);

    let mut filled_count = 0u32;
    for o in orderers.iter() {
        if market.get_staker_stake(&1u64, o, &1u32) == 1 {
            filled_count += 1;
        }
    }
    assert_eq!(filled_count, 20);

    // Second triggering stake: the remaining 5 orders fill.
    market.stake_on_call(&trigger_staker, &1u64, &1i128, &2u32);
    assert_eq!(market.get_open_orders(&1u64).len(), 0);

    let mut total_filled = 0u32;
    for o in orderers.iter() {
        if market.get_staker_stake(&1u64, o, &1u32) == 1 {
            total_filled += 1;
        }
    }
    assert_eq!(total_filled, 25);
}

/// If filling an order would push its owner over `max_stake_per_user`, the
/// matching loop must skip just that order (leaving it open) rather than
/// aborting the whole `stake_on_call` call for the unrelated staker who
/// triggered the match — this is the reentrancy/error-isolation design this
/// implementation relies on so one bad order can never roll back another
/// user's legitimate stake.
///
/// Setup: `max_stake_per_user` = 500. `capped_orderer` already has 400
/// staked directly on outcome 1, then creates two limit orders on outcome 1
/// (50 and 100), both individually passing the creation-time pre-check
/// (400+50<=500 and 400+100<=500, since neither order has filled yet so
/// `get_user_stake` still reads 400 for both checks). Both orders target
/// 10_000 bps (always eligible). When `trigger_staker` (an unrelated user)
/// stakes and triggers the matching loop, order 1 fills first (400+50=450
/// <= 500), then order 2 is attempted against the *now-updated* stake of
/// 450 (450+100=550 > 500) and is correctly skipped rather than filled —
/// and `trigger_staker`'s own stake still succeeds.
#[test]
fn limit_order_over_cap_is_skipped_without_aborting_triggering_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let factory = Address::generate(&env);
    let capped_orderer = Address::generate(&env);
    let trigger_staker = Address::generate(&env);
    let token = setup_token(&env, &admin);

    let market_id = setup_market(&env, &creator, &outcome_manager, &factory, &token, 1, 1, 500, 2);
    let market = PredictionMarketClient::new(&env, &market_id);
    let token_client = TokenClient::new(&env, &token);
    token_client.transfer(&admin, &capped_orderer, &10_000);
    token_client.transfer(&admin, &trigger_staker, &10_000);

    market.stake_on_call(&capped_orderer, &1u64, &400i128, &1u32);

    let order1 = market.create_limit_order(&capped_orderer, &1u64, &1u32, &50i128, &10_000u32, &3600u64);
    let order2 = market.create_limit_order(&capped_orderer, &1u64, &1u32, &100i128, &10_000u32, &3600u64);
    assert_eq!(market.get_open_orders(&1u64).len(), 2);

    // Trigger matching. trigger_staker is unrelated to capped_orderer's cap.
    let call = market.stake_on_call(&trigger_staker, &1u64, &10i128, &2u32);
    assert_eq!(call.outcome_stakes.get(2u32).unwrap(), 10);
    assert_eq!(market.get_staker_stake(&1u64, &trigger_staker, &2u32), 10);

    // order1 filled (400 + 50 = 450 <= 500 cap).
    assert_eq!(market.get_staker_stake(&1u64, &capped_orderer, &1u32), 450);

    // order2 skipped: 450 + 100 = 550 > 500 cap. It remains open.
    let open = market.get_open_orders(&1u64);
    assert_eq!(open.len(), 1);
    assert_eq!(open.get(0).unwrap().id, order2);
    assert_eq!(market.get_user_orders(&capped_orderer).len(), 1);

    let _ = order1;
}
