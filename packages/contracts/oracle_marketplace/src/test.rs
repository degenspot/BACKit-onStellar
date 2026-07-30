#![cfg(test)]

extern crate std;

use crate::{
    types::{MarketplaceConfig, OracleProvider},
    OracleMarketplace, OracleMarketplaceClient,
};
use soroban_sdk::{
    testutils::Address as AddressTest,
    Address, BytesN, Env,
};

#[test]
fn initialize_marketplace() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let contract_id = env.register(OracleMarketplace, ());
    let client = OracleMarketplaceClient::new(&env, &contract_id);
    client.initialize(&admin, &3600u64, &100u32);

    let config = client.get_config_view();
    assert_eq!(config.admin, admin);
    assert_eq!(config.cooldown_secs, 3600);
    assert_eq!(config.default_fee_bps, 100);
}

#[test]
fn register_and_deregister_oracle() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let pubkey = BytesN::from_array(&env, &[1u8; 32]);

    let contract_id = env.register(OracleMarketplace, ());
    let client = OracleMarketplaceClient::new(&env, &contract_id);
    client.initialize(&admin, &3600u64, &100u32);

    client.register_oracle(&provider, &pubkey, &100u32, &0i128);

    let oracles = client.get_available_oracles();
    assert_eq!(oracles.len(), 1);

    client.deregister_oracle(&provider, &pubkey);

    let oracles = client.get_available_oracles();
    assert_eq!(oracles.len(), 0);
}

#[test]
fn select_oracle_for_call_and_rate() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let user = Address::generate(&env);
    let pubkey = BytesN::from_array(&env, &[1u8; 32]);

    let contract_id = env.register(OracleMarketplace, ());
    let client = OracleMarketplaceClient::new(&env, &contract_id);
    client.initialize(&admin, &3600u64, &100u32);

    client.register_oracle(&provider, &pubkey, &100u32, &0i128);
    client.select_oracle_for_call(&42u64, &pubkey);

    let selected = client.get_call_oracle(&42u64);
    assert_eq!(selected, Some(pubkey.clone()));

    client.rate_oracle(&user, &pubkey, &true);

    let metrics = client.get_oracle_metrics(&pubkey);
    assert_eq!(metrics, (0u64, 0u64));
}
