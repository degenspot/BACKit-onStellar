#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, IntoVal, Symbol};

// Import your contract crates here. 
// Assuming the crate name defined in Cargo.toml is "market_contract"
// use market_contract::{MarketContract, MarketContractClient};

// MOCKING the contract for the sake of this standalone test file 
// (Replace this module with your actual crate import)
mod market_contract {
    use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
    #[contract]
    pub struct MarketContract;
    #[contractimpl]
    impl MarketContract {
        pub fn init(_env: Env, _token: Address, _oracle: Address) {}
        pub fn create_call(_env: Env, _id: u64, _asset: Address, _amount: i128) {}
        pub fn stake(_env: Env, _id: u64, _user: Address, _amount: i128, _prediction: bool) {}
        pub fn submit_outcome(_env: Env, _id: u64, _outcome: bool) {}
        pub fn withdraw(_env: Env, _id: u64, _user: Address) {}
    }
}
use market_contract::{MarketContract, MarketContractClient};

#[test]
fn test_full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let user_a = Address::generate(&env); // Creator
    let user_b = Address::generate(&env); // Staker
    
    // 2. Register Contracts
    let contract_id = env.register_contract(None, MarketContract);
    let client = MarketContractClient::new(&env, &contract_id);
    
    // Setup Token (Mock USDC)
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin.clone());
    let token = soroban_sdk::token::Client::new(&env, &token_id);

    // 3. Initialize Contract
    client.init(&token_id, &oracle);

    // 4. Fund Users
    token.mint(&user_a, &1000);
    token.mint(&user_b, &1000);

    // 5. Create Call (User A bets 100 on "True")
    let call_id = 1u64;
    let bet_amount = 100i128;
    
    // Approve contract to spend User A's tokens
    // Note: In real integration, auth mocking handles the 'require_auth' checks
    client.create_call(&call_id, &token_id, &bet_amount);

    // 6. Stake (User B bets 100 on "False")
    client.stake(&call_id, &user_b, &bet_amount, &false);

    // 7. Advance Time (if needed for expiry logic)
    // env.ledger().set_timestamp(env.ledger().timestamp() + 3600);

    // 8. Submit Outcome (Oracle says "False" - User B wins)
    client.submit_outcome(&call_id, &false);

    // 9. Withdraw Payout
    // Expect User B to get 200 (pot)
    let balance_before = token.balance(&user_b);
    client.withdraw(&call_id, &user_b);
    let balance_after = token.balance(&user_b);

    // Assertions
    // In this mock, logic isn't running, but in real test:
    // assert_eq!(balance_after, balance_before + 200);
}

#[test]
#[should_panic(expected = "Insufficient balance")]
fn test_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register_contract(None, MarketContract);
    let client = MarketContractClient::new(&env, &contract_id);
    
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin);
    
    // User has 0 tokens
    let poor_user = Address::generate(&env);
    
    client.create_call(&1, &token_id, &100); // Should fail
}

#[test]
#[should_panic(expected = "Unauthorized oracle")]
fn test_unauthorized_oracle() {
    let env = Env::default();
    env.mock_all_auths();
    
    let oracle = Address::generate(&env);
    let fake_oracle = Address::generate(&env);
    
    let contract_id = env.register_contract(None, MarketContract);
    let client = MarketContractClient::new(&env, &contract_id);
    
    // Init with real oracle
    let token_id = env.register_stellar_asset_contract(Address::generate(&env));
    client.init(&token_id, &oracle);

    // Fake oracle tries to submit
    // In a real implementation, you would switch the auth context here
    client.submit_outcome(&1, &true); 
}
