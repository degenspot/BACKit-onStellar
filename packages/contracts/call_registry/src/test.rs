#![cfg(test)]

use soroban_sdk::{testutils::*, Address, Bytes, Env, String as SorobanString};

mod call_registry {
    use super::*;
    use crate::{CallRegistry, CallRegistryClient};

    fn create_test_env() -> (Env, Address, Address, Address) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let outcome_manager = Address::generate(&env);
        let creator = Address::generate(&env);

        (env, admin, outcome_manager, creator)
    }

    #[test]
    fn test_initialize() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        // Initialize contract
        client.initialize(&admin, &outcome_manager);

        // Get config and verify
        let config = client.get_config();
        assert_eq!(config.admin, admin);
        assert_eq!(config.outcome_manager, outcome_manager);
    }

    #[test]
    #[should_panic(expected = "Contract already initialized")]
    fn test_initialize_twice_fails() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        client.initialize(&admin, &outcome_manager); // Should panic
    }

    #[test]
    fn test_create_call_success() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        // Setup
        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        // Create call
        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        // Verify
        assert_eq!(call.id, 1);
        assert_eq!(call.creator, creator);
        assert_eq!(call.stake_amount, 100_000_000);
        assert_eq!(call.total_up_stake, 0);
        assert_eq!(call.total_down_stake, 0);
        assert_eq!(call.outcome, 0);
        assert_eq!(call.settled, false);
        assert_eq!(call.created_at, 1000);
    }

    #[test]
    #[should_panic(expected = "Stake amount must be positive")]
    fn test_create_call_invalid_stake() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        client.create_call(
            &creator,
            &stake_token,
            &-100_000_000_i128, // Invalid
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );
    }

    #[test]
    #[should_panic(expected = "End timestamp must be in the future")]
    fn test_create_call_past_timestamp() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &500u64, // In the past
            &token_address,
            &pair_id,
            &ipfs_cid,
        );
    }

    #[test]
    fn test_stake_on_call_up() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        // Setup
        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        // Mock token transfer for test
        env.budget().reset_unlimited();

        // Stake UP
        let updated_call = client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1);

        // Verify
        assert_eq!(updated_call.total_up_stake, 50_000_000);
        assert_eq!(updated_call.total_down_stake, 0);
    }

    #[test]
    fn test_stake_on_call_down() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        // Setup
        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        env.budget().reset_unlimited();

        // Stake DOWN
        let updated_call = client.stake_on_call(&staker, &call.id, &30_000_000_i128, &2);

        // Verify
        assert_eq!(updated_call.total_up_stake, 0);
        assert_eq!(updated_call.total_down_stake, 30_000_000);
    }

    #[test]
    #[should_panic(expected = "Call has ended")]
    fn test_stake_on_ended_call() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        // Setup
        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        // Move time past end
        env.ledger().set_timestamp(3000);

        // Try to stake - should fail
        client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1);
    }

    #[test]
    #[should_panic(expected = "Invalid position")]
    fn test_stake_invalid_position() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        // Invalid position (3)
        client.stake_on_call(&staker, &call.id, &50_000_000_i128, &3);
    }

    #[test]
    fn test_get_call() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let created_call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        // Retrieve call
        let retrieved_call = client.get_call(&created_call.id);

        // Verify
        assert_eq!(retrieved_call.id, created_call.id);
        assert_eq!(retrieved_call.creator, creator);
        assert_eq!(retrieved_call.stake_amount, 100_000_000);
    }

    #[test]
    #[should_panic(expected = "Call does not exist")]
    fn test_get_nonexistent_call() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);

        // Try to get non-existent call
        client.get_call(&999);
    }

    #[test]
    fn test_get_call_stats() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker1 = Address::generate(&env);
        let staker2 = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        env.budget().reset_unlimited();

        // Add stakes
        client.stake_on_call(&staker1, &call.id, &50_000_000_i128, &1);
        client.stake_on_call(&staker2, &call.id, &30_000_000_i128, &2);

        // Get stats
        let stats = client.get_call_stats(&call.id);

        // Verify
        assert_eq!(stats.total_up_stake, 50_000_000);
        assert_eq!(stats.total_down_stake, 30_000_000);
        assert_eq!(stats.up_stake_count, 1);
        assert_eq!(stats.down_stake_count, 1);
    }

    #[test]
    fn test_resolve_call() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        // Move time past end
        env.ledger().set_timestamp(3000);

        // Resolve call
        let resolved = client.resolve_call(&call.id, &1, &150_000_000_i128);

        // Verify
        assert_eq!(resolved.outcome, 1);
        assert_eq!(resolved.end_price, 150_000_000);
    }

    #[test]
    #[should_panic(expected = "Call has not ended yet")]
    fn test_resolve_call_before_end() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        // Try to resolve before end time
        client.resolve_call(&call.id, &1, &150_000_000_i128);
    }

    #[test]
    fn test_set_admin() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let new_admin = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);

        // Change admin
        client.set_admin(&new_admin);

        // Verify
        let config = client.get_config();
        assert_eq!(config.admin, new_admin);
    }

    #[test]
    fn test_set_outcome_manager() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let new_manager = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);

        // Change outcome manager
        client.set_outcome_manager(&new_manager);

        // Verify
        let config = client.get_config();
        assert_eq!(config.outcome_manager, new_manager);
    }

    #[test]
    fn test_get_call_count() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        assert_eq!(client.get_call_count(), 0);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        // Create multiple calls
        client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        assert_eq!(client.get_call_count(), 2);
    }

    #[test]
    fn test_get_staker_stake() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        env.budget().reset_unlimited();

        // Add stake
        client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1);

        // Get stake
        let up_stake = client.get_staker_stake(&call.id, &staker, &1);
        let down_stake = client.get_staker_stake(&call.id, &staker, &2);

        assert_eq!(up_stake, 50_000_000);
        assert_eq!(down_stake, 0);
    }

    #[test]
    fn test_multiple_stakers() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker1 = Address::generate(&env);
        let staker2 = Address::generate(&env);
        let staker3 = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &5000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
        );

        env.budget().reset_unlimited();

        // Multiple stakers
        client.stake_on_call(&staker1, &call.id, &50_000_000_i128, &1);
        client.stake_on_call(&staker2, &call.id, &30_000_000_i128, &1);
        client.stake_on_call(&staker3, &call.id, &40_000_000_i128, &2);

        let call_updated = client.get_call(&call.id);

        // Verify totals
        assert_eq!(call_updated.total_up_stake, 80_000_000);
        assert_eq!(call_updated.total_down_stake, 40_000_000);
    }
}
