use crate::types::CharityCallInit;
use crate::{CharityMarkets, CharityMarketsClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};
use token::StellarAssetClient;

#[allow(deprecated)]
fn create_token<'a>(env: &'a Env, admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let addr = env.register_stellar_asset_contract(admin.clone());
    let sac = StellarAssetClient::new(env, &addr);
    (addr, sac)
}

fn deploy<'a>(
    env: &'a Env,
) -> (CharityMarketsClient<'a>, Address, Address, Address, StellarAssetClient<'a>) {
    let admin = Address::generate(env);
    let outcome_manager = Address::generate(env);
    let (stake_token, sac) = create_token(env, &admin);

    let contract_id = env.register(CharityMarkets, ());
    let client = CharityMarketsClient::new(env, &contract_id);

    client.initialize(&admin, &outcome_manager, &stake_token);
    (client, admin, outcome_manager, stake_token, sac)
}

fn make_params(env: &Env, stake_amount: i128, creator_outcome: u32) -> CharityCallInit {
    CharityCallInit {
        stake_amount,
        outcome_count: 2,
        creator_outcome,
        end_ts: env.ledger().timestamp() + 10000,
    }
}

#[test]
fn test_creator_wins_no_donation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _om, _stake_token, sac) = deploy(&env);
    let creator = Address::generate(&env);
    let charity = Address::generate(&env);

    sac.mint(&creator, &1000);

    let params = make_params(&env, 100, 1);
    let call_id = client.create_charity_call(&creator, &params, &charity, &0);

    let (info_charity, info_split, info_donated) = client.get_charity_info(&call_id);
    assert_eq!(info_charity, charity);
    assert_eq!(info_split, 0);
    assert_eq!(info_donated, 0);

    client.resolve_charity_call(&call_id, &1);

    assert_eq!(sac.balance(&creator), 900 + 100);
    assert_eq!(sac.balance(&charity), 0);

    let (_, _, info_donated) = client.get_charity_info(&call_id);
    assert_eq!(info_donated, 0);
}

#[test]
fn test_creator_loses_donation_triggers() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _om, _stake_token, sac) = deploy(&env);
    let creator = Address::generate(&env);
    let charity = Address::generate(&env);

    sac.mint(&creator, &1000);

    let params = make_params(&env, 100, 1);
    let call_id = client.create_charity_call(&creator, &params, &charity, &0);

    client.resolve_charity_call(&call_id, &2);

    assert_eq!(sac.balance(&creator), 900);
    assert_eq!(sac.balance(&charity), 100);

    let (_, _, info_donated) = client.get_charity_info(&call_id);
    assert_eq!(info_donated, 100);
}

#[test]
fn test_creator_wins_partial_charity_split() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _om, _stake_token, sac) = deploy(&env);
    let creator = Address::generate(&env);
    let charity = Address::generate(&env);

    sac.mint(&creator, &1000);

    let params = make_params(&env, 100, 1);
    let call_id = client.create_charity_call(&creator, &params, &charity, &5000);

    let other = Address::generate(&env);
    sac.mint(&other, &1000);
    client.stake_on_charity_call(&other, &call_id, &2, &50);

    client.resolve_charity_call(&call_id, &1);

    let creator_gross = 100 + (100 * 50) / 100;
    let charity_amt = creator_gross * 5000 / 10000;
    let creator_net = creator_gross - charity_amt;

    assert_eq!(sac.balance(&creator), 900 + creator_net);
    assert_eq!(sac.balance(&charity), charity_amt);
    assert_eq!(sac.balance(&other), 950);

    let (_, _, info_donated) = client.get_charity_info(&call_id);
    assert_eq!(info_donated, charity_amt);
}

#[test]
fn test_charity_split_exceeds_max() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _om, _stake_token, sac) = deploy(&env);
    let creator = Address::generate(&env);
    let charity = Address::generate(&env);

    sac.mint(&creator, &1000);

    let params = make_params(&env, 100, 1);
    let result = client.try_create_charity_call(&creator, &params, &charity, &10001);
    assert!(result.is_err());
}

#[test]
fn test_create_charity_call_zero_stake_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _om, _stake_token, sac) = deploy(&env);
    let creator = Address::generate(&env);
    let charity = Address::generate(&env);

    sac.mint(&creator, &1000);

    let params = make_params(&env, 0, 1);
    let result = client.try_create_charity_call(&creator, &params, &charity, &0);
    assert!(result.is_err());
}

#[test]
fn test_double_resolve_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _om, _stake_token, sac) = deploy(&env);
    let creator = Address::generate(&env);
    let charity = Address::generate(&env);

    sac.mint(&creator, &1000);

    let params = make_params(&env, 100, 1);
    let call_id = client.create_charity_call(&creator, &params, &charity, &0);

    client.resolve_charity_call(&call_id, &1);

    let result = client.try_resolve_charity_call(&call_id, &1);
    assert!(result.is_err());
}
