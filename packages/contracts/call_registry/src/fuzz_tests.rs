#![cfg(test)]
#![allow(deprecated)]
#![allow(unused)]

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    Address, Bytes, BytesN, Env,
};

use crate::{types::ConditionType, CallRegistry, CallRegistryClient};

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
}

const TEST_MIN_STAKE: i128 = 1_000_000;
const TEST_START_PRICE: i128 = 100_000_000;

fn setup_fuzz_env() -> (Env, CallRegistryClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CallRegistry, ());
    let client = CallRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let outcome_manager = Address::generate(&env);
    let stake_token = env.register(MockToken, ());

    client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
    client.whitelist_token(&stake_token);

    (env, client, admin, outcome_manager, stake_token)
}

fn create_test_call(
    env: &Env,
    client: &CallRegistryClient,
    creator: &Address,
    stake_token: &Address,
    end_ts: u64,
) -> u64 {
    let token_address = Address::generate(env);
    let pair_id = Bytes::from_slice(env, b"USDC/XLM");
    let metadata_hash = BytesN::from_array(env, &[0u8; 32]);

    let call = client.create_call(
        creator,
        &crate::types::CallInitArgs {
            stake_token: stake_token.clone(),
            stake_amount: 100_000_000_i128,
            start_price: TEST_START_PRICE,
            end_ts: end_ts,
            token_address: token_address.clone(),
            pair_id: pair_id.clone(),
            ipfs_cid: Bytes::from_slice(env, b"QmXxxx"),
            metadata_hash: metadata_hash.clone(),
            condition: ConditionType::TargetAbove(100_000_000_i128),
            outcome_count: 2,
        },
    );

    call.id
}

#[test]
fn test_fuzz_stake_random_amounts_no_overflow() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    let test_amounts: &[i128] = &[
        1_000_000,
        10_000_000,
        100_000_000,
        1_000_000_000,
        10_000_000_000,
        100_000_000_000,
        1_000_000_000_000,
        10_000_000_000_000,
        100_000_000_000_000,
        1_000_000_000_000_000,
        10_000_000_000_000_000,
        100_000_000_000_000_000,
        1_000_000_000_000_000_000,
        i128::MAX / 2,
        i128::MAX / 4,
        i128::MAX / 8,
        i128::MAX / 16,
        i128::MAX / 32,
        i128::MAX / 64,
        i128::MAX / 128,
    ];

    for &amount in test_amounts {
        let staker = Address::generate(&env);
        let position = if amount % 2 == 0 { 1 } else { 2 };

        let result = client.try_stake_on_call(&staker, &call_id, &amount, &position);
        assert!(
            result.is_ok(),
            "stake with amount {} should not panic",
            amount
        );

        let updated_call = client.get_call(&call_id);
        if position == 1 {
            assert!(updated_call.outcome_stakes.get(1).unwrap_or(0) > 0);
        } else {
            assert!(updated_call.outcome_stakes.get(2).unwrap_or(0) > 0);
        }
    }
}

#[test]
fn test_fuzz_invariant_total_stake_equals_sum() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    let stakes: &[(i128, u32)] = &[
        (50_000_000, 1),
        (30_000_000, 1),
        (20_000_000, 2),
        (40_000_000, 2),
        (10_000_000, 1),
        (15_000_000, 2),
        (25_000_000, 1),
        (35_000_000, 2),
    ];

    let mut expected_up = 0i128;
    let mut expected_down = 0i128;
    let mut stakers = soroban_sdk::Vec::new(&env);

    for &(amount, position) in stakes {
        let staker = Address::generate(&env);
        stakers.push_back((staker.clone(), amount, position));

        client.stake_on_call(&staker, &call_id, &amount, &position);

        if position == 1 {
            expected_up += amount;
        } else {
            expected_down += amount;
        }
    }

    let call = client.get_call(&call_id);
    assert_eq!(
        call.outcome_stakes.get(1).unwrap_or(0),
        expected_up,
        "outcome 1 (up) should equal sum of all up stakes"
    );
    assert_eq!(
        call.outcome_stakes.get(2).unwrap_or(0),
        expected_down,
        "outcome 2 (down) should equal sum of all down stakes"
    );

    let mut verified_up = 0i128;
    let mut verified_down = 0i128;
    for (staker, amount, position) in stakers {
        let stake = client.get_staker_stake(&call_id, &staker, &position);
        assert_eq!(stake, amount, "individual stake should match");
        if position == 1 {
            verified_up += stake;
        } else {
            verified_down += stake;
        }
    }

    assert_eq!(verified_up, call.outcome_stakes.get(1).unwrap_or(0));
    assert_eq!(verified_down, call.outcome_stakes.get(2).unwrap_or(0));
}

#[test]
fn test_fuzz_multiple_concurrent_stakers() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    let staker_count = 10;
    let mut total_up = 0i128;
    let mut total_down = 0i128;

    for i in 0..staker_count {
        let staker = Address::generate(&env);
        let amount = (i as i128 + 1) * 10_000_000;
        let position = if i % 2 == 0 { 1 } else { 2 };

        client.stake_on_call(&staker, &call_id, &amount, &position);

        if position == 1 {
            total_up += amount;
        } else {
            total_down += amount;
        }
    }

    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_stakes.get(1).unwrap_or(0), total_up);
    assert_eq!(call.outcome_stakes.get(2).unwrap_or(0), total_down);
    assert_eq!(
        call.outcome_stakes.get(1).unwrap_or(0) + call.outcome_stakes.get(2).unwrap_or(0),
        total_up + total_down,
        "sum of totals should equal sum of all stakes"
    );
}

#[test]
fn test_fuzz_multiple_calls_independent_accounting() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id_1 = create_test_call(&env, &client, &creator, &stake_token, 5000);
    let call_id_2 = create_test_call(&env, &client, &creator, &stake_token, 6000);
    let call_id_3 = create_test_call(&env, &client, &creator, &stake_token, 7000);

    let staker1 = Address::generate(&env);
    let staker2 = Address::generate(&env);

    client.stake_on_call(&staker1, &call_id_1, &100_000_000, &1);
    client.stake_on_call(&staker1, &call_id_2, &200_000_000, &2);
    client.stake_on_call(&staker2, &call_id_1, &150_000_000, &2);
    client.stake_on_call(&staker2, &call_id_3, &300_000_000, &1);

    let call1 = client.get_call(&call_id_1);
    let call2 = client.get_call(&call_id_2);
    let call3 = client.get_call(&call_id_3);

    assert_eq!(call1.outcome_stakes.get(1).unwrap_or(0), 100_000_000);
    assert_eq!(call1.outcome_stakes.get(2).unwrap_or(0), 150_000_000);

    assert_eq!(call2.outcome_stakes.get(1).unwrap_or(0), 0);
    assert_eq!(call2.outcome_stakes.get(2).unwrap_or(0), 200_000_000);

    assert_eq!(call3.outcome_stakes.get(1).unwrap_or(0), 300_000_000);
    assert_eq!(call3.outcome_stakes.get(2).unwrap_or(0), 0);
}

#[test]
fn test_fuzz_same_staker_multiple_stakes_accumulate() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    let staker = Address::generate(&env);
    let stakes = [10_000_000, 20_000_000, 30_000_000, 40_000_000];

    let mut accumulated = 0i128;
    for &amount in &stakes {
        client.stake_on_call(&staker, &call_id, &amount, &1);
        accumulated += amount;

        let stake = client.get_staker_stake(&call_id, &staker, &1);
        assert_eq!(stake, accumulated, "stake should accumulate correctly");
    }

    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_stakes.get(1).unwrap_or(0), accumulated);
}

#[test]
fn test_fuzz_large_number_of_iterations() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 10000);

    let iterations = 100;
    let mut total_up = 0i128;
    let mut total_down = 0i128;

    for i in 0..iterations {
        let staker = Address::generate(&env);
        let amount = ((i % 50) as i128 + 1) * 1_000_000;
        let position = if i % 3 == 0 { 1 } else { 2 };

        client.stake_on_call(&staker, &call_id, &amount, &position);

        if position == 1 {
            total_up += amount;
        } else {
            total_down += amount;
        }
    }

    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_stakes.get(1).unwrap_or(0), total_up);
    assert_eq!(call.outcome_stakes.get(2).unwrap_or(0), total_down);
}

#[test]
fn test_fuzz_extreme_timestamp_near_max() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let token_address = Address::generate(&env);
    let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
    let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

    let extreme_timestamps = [u64::MAX - 1, u64::MAX - 100, u64::MAX - 1000, u64::MAX / 2];

    for &end_ts in &extreme_timestamps {
        let call = client.create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000,
                start_price: TEST_START_PRICE,
                end_ts,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: Bytes::from_slice(&env, b"QmXxxx"),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000),
                outcome_count: 2,
            },
        );

        let staker = Address::generate(&env);
        client.stake_on_call(&staker, &call.id, &50_000_000, &1);

        let retrieved = client.get_call(&call.id);
        assert_eq!(retrieved.end_ts, end_ts);
        assert_eq!(retrieved.outcome_stakes.get(1).unwrap_or(0), 50_000_000);
    }
}

#[test]
fn test_fuzz_invariant_no_negative_stakes() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    for i in 0..50 {
        let staker = Address::generate(&env);
        let amount = (i as i128 + 1) * 5_000_000;
        let position = if i % 2 == 0 { 1 } else { 2 };

        client.stake_on_call(&staker, &call_id, &amount, &position);

        let call = client.get_call(&call_id);
        assert!(
            call.outcome_stakes.get(1).unwrap_or(0) >= 0,
            "up stakes must never be negative"
        );
        assert!(
            call.outcome_stakes.get(2).unwrap_or(0) >= 0,
            "down stakes must never be negative"
        );

        let stake = client.get_staker_stake(&call_id, &staker, &position);
        assert!(stake >= 0, "individual stake must never be negative");
    }
}

#[test]
fn test_fuzz_zero_stake_always_fails() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    let staker = Address::generate(&env);
    let result = client.try_stake_on_call(&staker, &call_id, &0, &1);

    assert!(result.is_err(), "staking zero should fail");
}

#[test]
fn test_fuzz_negative_stake_always_fails() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    let negative_amounts = [-1, -100, -1_000_000, -i128::MAX];

    for &amount in &negative_amounts {
        let staker = Address::generate(&env);
        let result = client.try_stake_on_call(&staker, &call_id, &amount, &1);
        assert!(
            result.is_err(),
            "staking negative amount {} should fail",
            amount
        );
    }
}

#[test]
fn test_fuzz_mixed_positions_independent() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    let staker = Address::generate(&env);

    client.stake_on_call(&staker, &call_id, &100_000_000, &1);
    client.stake_on_call(&staker, &call_id, &200_000_000, &2);

    let up_stake = client.get_staker_stake(&call_id, &staker, &1);
    let down_stake = client.get_staker_stake(&call_id, &staker, &2);

    assert_eq!(up_stake, 100_000_000);
    assert_eq!(down_stake, 200_000_000);

    let call = client.get_call(&call_id);
    assert_eq!(call.outcome_stakes.get(1).unwrap_or(0), 100_000_000);
    assert_eq!(call.outcome_stakes.get(2).unwrap_or(0), 200_000_000);
}

#[test]
fn test_fuzz_arithmetic_no_overflow_with_max_values() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    let large_amounts = [i128::MAX / 2, i128::MAX / 4, i128::MAX / 8];

    for &amount in &large_amounts {
        let staker = Address::generate(&env);
        let result = client.try_stake_on_call(&staker, &call_id, &amount, &1);
        assert!(result.is_ok(), "large stake {} should not overflow", amount);
    }
}

#[test]
fn test_fuzz_stats_consistency() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    let mut up_stakers = 0u32;
    let mut down_stakers = 0u32;

    for i in 0..20 {
        let staker = Address::generate(&env);
        let position = if i % 2 == 0 { 1 } else { 2 };
        client.stake_on_call(&staker, &call_id, &10_000_000, &position);

        if position == 1 {
            up_stakers += 1;
        } else {
            down_stakers += 1;
        }
    }

    let stats = client.get_call_stats(&call_id);
    assert_eq!(stats.outcome_stake_counts.get(1).unwrap_or(0), up_stakers);
    assert_eq!(stats.outcome_stake_counts.get(2).unwrap_or(0), down_stakers);
    assert_eq!(stats.total_stakes, up_stakers + down_stakers);
}

#[test]
fn test_fuzz_boundary_min_stake_enforcement() {
    let (env, client, _admin, _om, stake_token) = setup_fuzz_env();
    env.ledger().set_timestamp(1000);

    let creator = Address::generate(&env);
    let call_id = create_test_call(&env, &client, &creator, &stake_token, 5000);

    let staker = Address::generate(&env);
    let below_min = TEST_MIN_STAKE - 1;
    let result = client.try_stake_on_call(&staker, &call_id, &below_min, &1);
    assert!(result.is_err(), "stake below minimum should fail");

    let at_min = TEST_MIN_STAKE;
    let result = client.try_stake_on_call(&staker, &call_id, &at_min, &1);
    assert!(result.is_ok(), "stake at minimum should succeed");
}
