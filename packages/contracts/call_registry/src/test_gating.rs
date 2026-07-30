#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal,
};

#[test]
fn test_staking_gates() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
        li.sequence = 100;
    });

    let admin = Address::generate(&env);
    let manager = Address::generate(&env);
    let creator = Address::generate(&env);
    
    let registry_id = env.register_contract(None, crate::CallRegistry);
    let registry = crate::CallRegistryClient::new(&env, &registry_id);
    
    registry.initialize(&admin, &manager, &100i128);
    
    // Whitelist a token
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = soroban_sdk::token::Client::new(&env, &token_id.address());
    registry.whitelist_token(&token_id.address());
    
    let staker1 = Address::generate(&env);
    let staker2 = Address::generate(&env); // low balance
    
    // Mint tokens
    token.mint(&staker1, &10000i128);
    token.mint(&staker2, &10000i128);
    
    // Let's test the MinAccountAge gate.
    
    let call_args = crate::types::CallInitArgs {
        stake_token: token_id.address(),
        stake_amount: 100,
        start_price: 1000,
        end_ts: 2000,
        token_address: Address::generate(&env),
        pair_id: Bytes::new(&env),
        ipfs_cid: Bytes::new(&env),
        metadata_hash: BytesN::from_array(&env, &[0; 32]),
        condition: crate::types::ConditionType::TargetAbove(2000),
        outcome_count: 2,
        gate: Some(crate::types::StakingGate::MinAccountAge(10)),
    };
    
    let call = registry.create_call(&creator, &call_args);
    
    // Staker1 tries to stake at ledger 100. Their first interaction is set to 100.
    // 100 - 100 = 0 < 10. Should fail.
    let res = registry.try_stake_on_call(&staker1, &call.id, &100i128, &1);
    assert!(res.is_err());
    
    // Fast forward ledger to 110. Now staker1's age is 110 - 100 = 10 >= 10.
    env.ledger().with_mut(|li| {
        li.sequence = 110;
    });
    
    let res2 = registry.try_stake_on_call(&staker1, &call.id, &100i128, &1);
    assert!(res2.is_ok());
    
    // Test that gate updates affect new stakes
    // Admin sets global gate to MinTrustlines(5)
    registry.set_global_gate(&Some(crate::types::StakingGate::MinTrustlines(5)));
    
    // Create new call using global gate
    let call_args2 = crate::types::CallInitArgs {
        stake_token: token_id.address(),
        stake_amount: 100,
        start_price: 1000,
        end_ts: 2000,
        token_address: Address::generate(&env),
        pair_id: Bytes::new(&env),
        ipfs_cid: Bytes::new(&env),
        metadata_hash: BytesN::from_array(&env, &[0; 32]),
        condition: crate::types::ConditionType::TargetAbove(2000),
        outcome_count: 2,
        gate: None, // Will use global gate
    };
    
    let call2 = registry.create_call(&creator, &call_args2);
    
    let res3 = registry.try_stake_on_call(&staker2, &call2.id, &100i128, &1);
    assert!(res3.is_err());
    
    // Give staker2 5 trustlines
    registry.set_trustline_count(&staker2, &5);
    
    let res4 = registry.try_stake_on_call(&staker2, &call2.id, &100i128, &1);
    assert!(res4.is_ok());
}
