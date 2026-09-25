
// SPDX-License-Identifier: Apache-2.0
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Decimal};
use soroban_sdk::token::{Client as TokenClient, TokenClientError};
use prediction_market_futures::{FuturesContract, ContractError, Position};

#[test]
fn test_open_position_success() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let collateral_token = Address::generate(&env);
    let user = Address::generate(&env);

    let contract = FuturesContract::new(&env, admin.clone(), collateral_token.clone());

    // Mock token client
    let token_client = TokenClient::new(&env, &collateral_token);
    token_client.mint(&user, Decimal::from_str(&env, "1000.0").unwrap()).unwrap();

    // Open long position
    let result = contract.open_position(
        &env,
        admin.clone(),
        user.clone(),
        Symbol::new(&env, "TEST_MARKET"),
        Decimal::from_str(&env, "10.0").unwrap(),
        Decimal::from_str(&env, "5.0").unwrap(),
        true,
    );

    assert!(result.is_ok());
    assert_eq!(token_client.balance(&user), Decimal::from_str(&env, "950.0").unwrap());
}

#[test]
fn test_open_position_insufficient_collateral() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let collateral_token = Address::generate(&env);
    let user = Address::generate(&env);

    let contract = FuturesContract::new(&env, admin.clone(), collateral_token.clone());

    // Mock token client
    let token_client = TokenClient::new(&env, &collateral_token);
    token_client.mint(&user, Decimal::from_str(&env, "10.0").unwrap()).unwrap();

    // Try to open position with insufficient collateral
    let result = contract.open_position(
        &env,
        admin.clone(),
        user.clone(),
        Symbol::new(&env, "TEST_MARKET"),
        Decimal::from_str(&env, "100.0").unwrap(),
        Decimal::from_str(&env, "5.0").unwrap(),
        true,
    );

    assert!(matches!(result, Err(ContractError::InsufficientCollateral)));
}

#[test]
fn test_liquidate_success() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let collateral_token = Address::generate(&env);
    let user = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let contract = FuturesContract::new(&env, admin.clone(), collateral_token.clone());

    // Mock token client
    let token_client = TokenClient::new(&env, &collateral_token);
    token_client.mint(&user, Decimal::from_str(&env, "1000.0").unwrap()).unwrap();

    // Open long position
    contract.open_position(
        &env,
        admin.clone(),
        user.clone(),
        Symbol::new(&env, "TEST_MARKET"),
        Decimal::from_str(&env, "10.0").unwrap(),
        Decimal::from_str(&env, "5.0").unwrap(),
        true,
    ).unwrap();

    // Update mark price to trigger liquidation
    contract.update_mark_price(&env, admin.clone(), Decimal::from_str(&env, "0.9").unwrap()).unwrap();

    // Liquidate position
    let result = contract.liquidate(&env, admin.clone(), 0, liquidator.clone());

    assert!(result.is_ok());
    let recovered = result.unwrap();
    assert_eq!(recovered, Decimal::from_str(&env, "50.0").unwrap());
    assert_eq!(token_client.balance(&liquidator), Decimal::from_str(&env, "2.5").unwrap()); // 5% bounty
}

#[test]
fn test_liquidate_threshold_not_met() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let collateral_token = Address::generate(&env);
    let user = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let contract = FuturesContract::new(&env, admin.clone(), collateral_token.clone());

    // Mock token client
    let token_client = TokenClient::new(&env, &collateral_token);
    token_client.mint(&user, Decimal::from_str(&env, "1000.0").unwrap()).unwrap();

    // Open long position
    contract.open_position(
        &env,
        admin.clone(),
        user.clone(),
        Symbol::new(&env, "TEST_MARKET"),
        Decimal::from_str(&env, "10.0").unwrap(),
        Decimal::from_str(&env, "5.0").unwrap(),
        true,
    ).unwrap();

    // Update mark price (not enough to trigger liquidation)
    contract.update_mark_price(&env, admin.clone(), Decimal::from_str(&env, "0.95").unwrap()).unwrap();

    // Attempt liquidation (should fail)
    let result = contract.liquidate(&env, admin.clone(), 0, liquidator.clone());

    assert!(matches!(result, Err(ContractError::LiquidationThresholdNotMet)));
}
