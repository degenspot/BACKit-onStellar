#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient as TokenAdminClient,
    Address, Env,
};

use crate::{IndexFund, IndexFundClient};

fn create_test_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let stake_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let factory = Address::generate(&env);
    (env, admin, stake_token, factory)
}

fn setup_fund<'a>(env: &'a Env, admin: &'a Address, stake_token: &'a Address, factory: &'a Address) -> IndexFundClient<'a> {
    env.mock_all_auths();
    let contract_id = env.register(IndexFund, ());
    let fund = IndexFundClient::new(env, &contract_id);
    fund.initialize(admin, stake_token, factory, &3600, &50, &50);
    fund
}

fn mint_tokens(env: &Env, token: &Address, to: &Address, amount: i128) {
    TokenAdminClient::new(env, token).mint(to, &amount);
}

#[test]
fn test_initialize() {
    let (env, admin, stake_token, factory) = create_test_env();
    let fund = setup_fund(&env, &admin, &stake_token, &factory);
    assert_eq!(fund.get_admin(), admin);
    assert_eq!(fund.get_stake_token(), stake_token);
    assert_eq!(fund.get_nav(), 0);
    assert!(fund.get_index_composition().len() == 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_double_initialize() {
    let (env, admin, stake_token, factory) = create_test_env();
    let fund = setup_fund(&env, &admin, &stake_token, &factory);
    fund.initialize(&admin, &stake_token, &factory, &3600, &50, &50);
}

#[test]
fn test_first_deposit_mints_at_par() {
    let (env, admin, stake_token, factory) = create_test_env();
    let fund = setup_fund(&env, &admin, &stake_token, &factory);

    let user = Address::generate(&env);
    env.mock_all_auths();
    mint_tokens(&env, &stake_token, &user, 1_000_000_000);

    let fee = 1_000_000_000 * 50 / 10_000;
    let net = 1_000_000_000 - fee;

    let index_tokens = fund.deposit(&user, &1_000_000_000);
    assert_eq!(index_tokens, net * 10_000_000);

    assert_eq!(fund.get_user_balance(&user), net * 10_000_000);
}

#[test]
fn test_second_deposit_mints_proportional() {
    let (env, admin, stake_token, factory) = create_test_env();
    let fund = setup_fund(&env, &admin, &stake_token, &factory);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    env.mock_all_auths();

    let usdc_amount = 1_000_000_000i128;
    let usdc_amount2 = 500_000_000i128;
    mint_tokens(&env, &stake_token, &user1, usdc_amount);
    mint_tokens(&env, &stake_token, &user2, usdc_amount2);

    let fee = usdc_amount * 50 / 10_000;
    let net = usdc_amount - fee;
    let index1 = fund.deposit(&user1, &usdc_amount);

    let fee2 = usdc_amount2 * 50 / 10_000;
    let net2 = usdc_amount2 - fee2;
    let index2 = fund.deposit(&user2, &usdc_amount2);

    let expected_index2 = net2 * index1 / net;
    assert_eq!(index2, expected_index2);
}

#[test]
fn test_withdraw_returns_proportional_usdc() {
    let (env, admin, stake_token, factory) = create_test_env();
    let fund = setup_fund(&env, &admin, &stake_token, &factory);

    let user = Address::generate(&env);
    env.mock_all_auths();

    let usdc_amount = 1_000_000_000i128;
    mint_tokens(&env, &stake_token, &user, usdc_amount);

    let index_tokens = fund.deposit(&user, &usdc_amount);

    let half = index_tokens / 2;
    let usdc_out = fund.withdraw(&user, &half);

    let fee = usdc_amount * 50 / 10_000;
    let net_usdc = usdc_amount - fee;
    let expected_gross = net_usdc / 2;
    let expected_withdraw_fee = expected_gross * 50 / 10_000;
    let expected_net = expected_gross - expected_withdraw_fee;
    assert_eq!(usdc_out, expected_net);

    assert_eq!(fund.get_user_balance(&user), index_tokens - half);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_deposit_zero() {
    let (env, admin, stake_token, factory) = create_test_env();
    let fund = setup_fund(&env, &admin, &stake_token, &factory);

    let user = Address::generate(&env);
    env.mock_all_auths();
    fund.deposit(&user, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_withdraw_more_than_balance() {
    let (env, admin, stake_token, factory) = create_test_env();
    let fund = setup_fund(&env, &admin, &stake_token, &factory);

    let user = Address::generate(&env);
    env.mock_all_auths();
    mint_tokens(&env, &stake_token, &user, 1_000_000_000);

    let index_tokens = fund.deposit(&user, &1_000_000_000);
    fund.withdraw(&user, &(index_tokens + 1));
}

#[test]
fn test_nav_after_first_deposit() {
    let (env, admin, stake_token, factory) = create_test_env();
    let fund = setup_fund(&env, &admin, &stake_token, &factory);

    let user = Address::generate(&env);
    env.mock_all_auths();
    mint_tokens(&env, &stake_token, &user, 1_000_000_000);

    fund.deposit(&user, &1_000_000_000);

    let fee = 1_000_000_000 * 50 / 10_000;
    let net = 1_000_000_000 - fee;

    let nav = fund.get_nav();
    assert_eq!(nav, net * 10_000_000 / (net * 10_000_000));
}

#[test]
fn test_performance_after_deposit() {
    let (env, admin, stake_token, factory) = create_test_env();
    let fund = setup_fund(&env, &admin, &stake_token, &factory);

    let user = Address::generate(&env);
    env.mock_all_auths();
    mint_tokens(&env, &stake_token, &user, 1_000_000_000);

    fund.deposit(&user, &1_000_000_000);

    let fee = 1_000_000_000 * 50 / 10_000;
    let net = 1_000_000_000 - fee;

    let perf = fund.get_index_performance();
    assert_eq!(perf.nav, net * 10_000_000 / (net * 10_000_000));
    assert_eq!(perf.total_markets, 0);
    assert_eq!(perf.total_aum, net);
    assert_eq!(perf.total_index_supply, net * 10_000_000);
}

#[test]
fn test_get_index_composition_empty() {
    let (env, admin, stake_token, factory) = create_test_env();
    let fund = setup_fund(&env, &admin, &stake_token, &factory);

    let composition = fund.get_index_composition();
    assert_eq!(composition.len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn test_initialize_fee_too_high() {
    let (env, admin, stake_token, factory) = create_test_env();
    env.mock_all_auths();
    let contract_id = env.register(IndexFund, ());
    let fund = IndexFundClient::new(&env, &contract_id);
    fund.initialize(&admin, &stake_token, &factory, &3600, &5000, &50);
}
