#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke},
    vec, Address, Bytes, BytesN, Env, IntoVal, Symbol,
};

use crate::errors::CallRegistryError;

// ── Mock token ────────────────────────────────────────────────────────────────

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
}

// ── Test module ───────────────────────────────────────────────────────────────

mod call_registry {
    use super::*;
    use crate::storage::DataKey;
    use crate::types::ConditionType;
    use crate::{CallRegistry, CallRegistryClient};
    use ed25519_dalek::{Signer, SigningKey};

    // ── Helpers ───────────────────────────────────────────────────────────────

    const TEST_MIN_STAKE: i128 = 1_000_000;
    const TEST_START_PRICE: i128 = 100_000_000;

    /// Spin up a fresh environment with a registered, initialised CallRegistry.
    fn setup() -> (Env, CallRegistryClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let outcome_manager = Address::generate(&env);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);

        (env, client, admin, outcome_manager)
    }

    fn create_test_env() -> (Env, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let outcome_manager = Address::generate(&env);
        let creator = Address::generate(&env);
        (env, admin, outcome_manager, creator)
    }

    fn gen_keypair(env: &Env) -> (BytesN<32>, BytesN<32>) {
        use rand::RngCore;

        let mut seed = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut seed);

        let signing_key = SigningKey::from_bytes(&seed);
        let public_key = signing_key.verifying_key();

        (
            BytesN::from_array(env, &seed),
            BytesN::from_array(env, &public_key.to_bytes()),
        )
    }

    fn sign_start_price(env: &Env, secret: &BytesN<32>, call_id: u64, price: i128) -> BytesN<64> {
        let mut raw = Bytes::from_slice(env, b"start_price:");
        raw.append(&Bytes::from_slice(env, &call_id.to_be_bytes()));
        raw.append(&Bytes::from_slice(env, &price.to_be_bytes()));

        let msg_len = raw.len() as usize;
        let mut buf = [0u8; 64];
        raw.copy_into_slice(&mut buf[..msg_len]);

        let signing_key = SigningKey::from_bytes(&secret.to_array());
        let sig = signing_key.sign(&buf[..msg_len]);
        BytesN::from_array(env, &sig.to_bytes())
    }

    /// Convenience wrapper: creates a call with a `TargetAbove` condition so
    /// every test that doesn't care about conditions doesn't have to repeat it.
    fn create_call_with_default_condition(
        client: &CallRegistryClient<'_>,
        creator: &Address,
        stake_token: &Address,
        stake_amount: &i128,
        end_ts: &u64,
        token_address: &Address,
        pair_id: &Bytes,
        ipfs_cid: &Bytes,
        outcome_count: &u32,
    ) -> crate::types::Call {
        client.whitelist_token(stake_token);
        client.create_call(
            creator,
            stake_token,
            stake_amount,
            &TEST_START_PRICE,
            end_ts,
            token_address,
            pair_id,
            ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            outcome_count,
        )
    }

    // ── initialize ────────────────────────────────────────────────────────────

    #[test]
    fn test_initialize() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);

        let config = client.get_config();
        assert_eq!(config.admin, admin);
        assert_eq!(config.outcome_manager, outcome_manager);
        assert!(!config.paused);
    }

    #[test]
    fn test_initialize_twice_fails() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);

        let result = client.try_initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        assert_eq!(
            result,
            Err(Ok(CallRegistryError::AlreadyInitialized)),
            "second initialize should return AlreadyInitialized"
        );
    }

    // ── set_admin ─────────────────────────────────────────────────────────────

    #[test]
    fn test_set_admin_updates_config() {
        let (env, client, _admin, _om) = setup();
        let new_admin = Address::generate(&env);

        client.set_admin(&new_admin);

        assert_eq!(client.get_config().admin, new_admin);
    }

    #[test]
    fn test_set_admin_emits_admin_params_changed() {
        let (env, client, old_admin, _om) = setup();
        let new_admin = Address::generate(&env);

        client.set_admin(&new_admin);

        let events = env.events().all();
        let last = events.last().expect("no events");

        assert_eq!(
            last.1,
            soroban_sdk::vec![
                &env,
                "call_registry".into_val(&env),
                "admin_params_changed".into_val(&env),
            ]
        );

        let (param, _changed_by, old_val, new_val): (Symbol, Address, Address, Address) =
            last.2.into_val(&env);

        assert_eq!(param, Symbol::new(&env, "admin"));
        assert_eq!(old_val, old_admin);
        assert_eq!(new_val, new_admin);
    }

    #[test]
    fn test_set_admin() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let new_admin = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        client.set_admin(&new_admin);

        assert_eq!(client.get_config().admin, new_admin);
    }

    // ── set_outcome_manager ───────────────────────────────────────────────────

    #[test]
    fn test_set_outcome_manager_updates_config() {
        let (env, client, _admin, _om) = setup();
        let new_om = Address::generate(&env);

        client.set_outcome_manager(&new_om);

        assert_eq!(client.get_config().outcome_manager, new_om);
    }

    #[test]
    fn test_set_outcome_manager_emits_admin_params_changed() {
        let (env, client, _admin, old_om) = setup();
        let new_om = Address::generate(&env);

        client.set_outcome_manager(&new_om);

        let events = env.events().all();
        let last = events.last().expect("no events");

        let (param, _changed_by, old_val, new_val): (Symbol, Address, Address, Address) =
            last.2.into_val(&env);

        assert_eq!(param, Symbol::new(&env, "outcome_manager"));
        assert_eq!(old_val, old_om);
        assert_eq!(new_val, new_om);
    }

    #[test]
    fn test_set_outcome_manager() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let new_manager = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        client.set_outcome_manager(&new_manager);

        assert_eq!(client.get_config().outcome_manager, new_manager);
    }

    // ── set_fee ───────────────────────────────────────────────────────────────

    #[test]
    fn test_set_fee_updates_config() {
        let (_env, client, _admin, _om) = setup();
        client.set_fee(&250_u32);
        assert_eq!(client.get_config().fee_bps, 250);
    }

    #[test]
    fn test_set_fee_emits_admin_params_changed() {
        let (env, client, _admin, _om) = setup();
        client.set_fee(&100_u32);

        let events = env.events().all();
        let last = events.last().expect("no events");

        let (param, _changed_by, old_val, new_val): (Symbol, Address, u32, u32) =
            last.2.into_val(&env);

        assert_eq!(param, Symbol::new(&env, "fee_bps"));
        assert_eq!(old_val, 0_u32);
        assert_eq!(new_val, 100_u32);
    }

    #[test]
    fn test_set_fee_zero_is_valid() {
        let (_env, client, _admin, _om) = setup();
        client.set_fee(&0_u32);
        assert_eq!(client.get_config().fee_bps, 0);
    }

    #[test]
    fn test_set_fee_max_boundary_is_valid() {
        let (_env, client, _admin, _om) = setup();
        client.set_fee(&10_000_u32);
        assert_eq!(client.get_config().fee_bps, 10_000);
    }

    #[test]
    fn test_set_fee_above_max_returns_fee_too_high() {
        let (_env, client, _admin, _om) = setup();
        let result = client.try_set_fee(&10_001_u32);
        assert_eq!(
            result,
            Err(Ok(CallRegistryError::FeeTooHigh)),
            "fee > 10_000 should return FeeTooHigh"
        );
    }

    // ── extend_call_ttl ───────────────────────────────────────────────────────

    #[test]
    fn test_extend_call_ttl_succeeds_for_existing_call() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        // Should not error — TTL extension on an existing call
        client.extend_call_ttl(&call.id);
    }

    #[test]
    fn test_extend_call_ttl_missing_call_returns_error() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);

        let result = client.try_extend_call_ttl(&999u64);
        assert_eq!(
            result,
            Err(Ok(CallRegistryError::CallNotFound)),
            "missing call should return CallNotFound"
        );
    }

    // ── persistent storage ────────────────────────────────────────────────────

    #[test]
    fn test_set_call_uses_persistent_storage() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let retrieved = client.get_call(&call.id);
        assert_eq!(retrieved.id, call.id);
    }

    #[test]
    fn test_staker_calls_ttl_extended_on_stake() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        env.budget().reset_unlimited();
        client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1);

        let staker_calls = client.get_staker_calls(&staker);
        assert_eq!(staker_calls.len(), 1);
        assert_eq!(staker_calls.get(0).unwrap().id, call.id);
    }

    #[test]
    fn test_call_stakers_tracked_without_duplicates() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker1 = Address::generate(&env);
        let staker2 = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        client.stake_on_call(&staker1, &call.id, &50_000_000_i128, &1);
        client.stake_on_call(&staker1, &call.id, &20_000_000_i128, &2);
        client.stake_on_call(&staker2, &call.id, &30_000_000_i128, &1);

        let stakers = client.get_call_stakers(&call.id);
        assert_eq!(stakers.len(), 2);
        assert_eq!(stakers.get(0).unwrap(), staker1);
        assert_eq!(stakers.get(1).unwrap(), staker2);
        assert_eq!(client.get_call_staker_count(&call.id), 2);
    }

    // ── global stats ──────────────────────────────────────────────────────────

    #[test]
    fn test_global_stats_increment() {
        let (env, client, _admin, _om) = setup();
        env.ledger().set_timestamp(1000);

        let creator = Address::generate(&env);
        let staker1 = Address::generate(&env);
        let staker2 = Address::generate(&env);
        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let stats = client.get_global_stats();
        assert_eq!(stats.total_calls, 0);
        assert_eq!(stats.total_stake_volume, 0);
        assert_eq!(stats.total_unique_stakers, 0);

        let call1 = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        let call2 = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let stats = client.get_global_stats();
        assert_eq!(stats.total_calls, 2);

        env.budget().reset_unlimited();
        client.stake_on_call(&staker1, &call1.id, &50_000_000_i128, &1);
        client.stake_on_call(&staker1, &call1.id, &20_000_000_i128, &1);
        client.stake_on_call(&staker2, &call2.id, &30_000_000_i128, &2);

        let stats = client.get_global_stats();
        assert_eq!(stats.total_stake_volume, 100_000_000);
        assert_eq!(stats.total_unique_stakers, 2);
    }

    // ── create_call ───────────────────────────────────────────────────────────

    #[test]
    fn test_create_call_success() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        assert_eq!(call.id, 1);
        assert_eq!(call.creator, creator);
        assert_eq!(call.stake_amount, 100_000_000);
        assert_eq!(call.outcome_stakes.get(1).unwrap_or(0), 0);
        assert_eq!(call.outcome_stakes.get(2).unwrap_or(0), 0);
        assert_eq!(call.outcome, 0);
        assert_eq!(call.start_price, TEST_START_PRICE);
        assert!(!call.settled);
        assert_eq!(call.condition, ConditionType::TargetAbove(100_000_000_i128));
        assert_eq!(call.created_at, 1000);
    }

    #[test]
    fn test_create_call_zero_start_price_returns_error() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let result = client.try_create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &0_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &2,
        );

        assert_eq!(result, Err(Ok(CallRegistryError::InvalidStakeAmount)));
    }

    #[test]
    fn test_set_start_price_updates_call() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");
        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let (secret, pubkey) = gen_keypair(&env);
        let new_price = 125_000_000_i128;
        let signature = sign_start_price(&env, &secret, call.id, new_price);

        let updated = client.set_start_price(&call.id, &new_price, &pubkey, &signature);
        assert_eq!(updated.start_price, new_price);
        assert_eq!(client.get_call(&call.id).start_price, new_price);
    }

    #[test]
    fn test_create_call_invalid_stake_returns_error() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let result = client.try_create_call(
            &creator,
            &stake_token,
            &-100_000_000_i128,
            &TEST_START_PRICE,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &2,
        );

        assert_eq!(
            result,
            Err(Ok(CallRegistryError::InvalidStakeAmount)),
            "negative stake should return InvalidStakeAmount"
        );
    }

    #[test]
    fn test_create_call_past_timestamp_returns_error() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let result = client.try_create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &TEST_START_PRICE,
            &500u64, // in the past
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &2,
        );

        assert_eq!(
            result,
            Err(Ok(CallRegistryError::InvalidEndTime)),
            "past end_ts should return InvalidEndTime"
        );
    }

    // ── stake_on_call ─────────────────────────────────────────────────────────

    #[test]
    fn test_stake_on_call_up() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        env.budget().reset_unlimited();

        let updated_call = client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1);

        assert_eq!(updated_call.outcome_stakes.get(1).unwrap_or(0), 50_000_000);
        assert_eq!(updated_call.outcome_stakes.get(2).unwrap_or(0), 0);
    }

    #[test]
    fn test_stake_on_call_down() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let updated_call = client.stake_on_call(&staker, &call.id, &30_000_000_i128, &2);

        assert_eq!(updated_call.outcome_stakes.get(1).unwrap_or(0), 0);
        assert_eq!(updated_call.outcome_stakes.get(2).unwrap_or(0), 30_000_000);
    }

    #[test]
    fn test_stake_on_ended_call_returns_error() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        env.ledger().set_timestamp(3000); // past end_ts

        let result = client.try_stake_on_call(&staker, &call.id, &50_000_000_i128, &1);
        assert_eq!(
            result,
            Err(Ok(CallRegistryError::CallEnded)),
            "staking after end_ts should return CallEnded"
        );
    }

    #[test]
    fn test_stake_invalid_position_returns_error() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let result = client.try_stake_on_call(&staker, &call.id, &50_000_000_i128, &3);
        assert_eq!(
            result,
            Err(Ok(CallRegistryError::InvalidPosition)),
            "position 3 should return InvalidPosition"
        );
    }

    // ── get_call ──────────────────────────────────────────────────────────────

    #[test]
    fn test_get_call() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let created_call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let retrieved = client.get_call(&created_call.id);

        assert_eq!(retrieved.id, created_call.id);
        assert_eq!(retrieved.creator, creator);
        assert_eq!(retrieved.stake_amount, 100_000_000);
    }

    #[test]
    fn test_get_nonexistent_call_returns_error() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);

        let result = client.try_get_call(&999);
        assert_eq!(
            result,
            Err(Ok(CallRegistryError::CallNotFound)),
            "missing call should return CallNotFound"
        );
    }

    // ── get_call_stats ────────────────────────────────────────────────────────

    #[test]
    fn test_get_call_stats() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker1 = Address::generate(&env);
        let staker2 = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        client.stake_on_call(&staker1, &call.id, &50_000_000_i128, &1);
        client.stake_on_call(&staker2, &call.id, &30_000_000_i128, &2);

        let stats = client.get_call_stats(&call.id);

        assert_eq!(stats.outcome_stakes.get(1).unwrap_or(0), 50_000_000);
        assert_eq!(stats.outcome_stakes.get(2).unwrap_or(0), 30_000_000);
        assert_eq!(stats.outcome_stake_counts.get(1).unwrap_or(0), 1);
        assert_eq!(stats.outcome_stake_counts.get(2).unwrap_or(0), 1);
    }

    // ── resolve_call ──────────────────────────────────────────────────────────

    #[test]
    fn test_resolve_call() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        env.ledger().set_timestamp(3000); // after end_ts

        let resolved = client.resolve_call(&call.id, &1, &150_000_000_i128);

        assert_eq!(resolved.outcome, 1);
        assert_eq!(resolved.end_price, 150_000_000);
    }

    #[test]
    fn test_resolve_call_before_end_returns_error() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        // still at ts=1000, before end_ts=2000
        let result = client.try_resolve_call(&call.id, &1, &150_000_000_i128);
        assert_eq!(
            result,
            Err(Ok(CallRegistryError::CallNotEnded)),
            "resolving before end_ts should return CallNotEnded"
        );
    }

    // ── get_call_count ────────────────────────────────────────────────────────

    #[test]
    fn test_get_call_count() {
        let (env, admin, outcome_manager, creator) = create_test_env();

        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        assert_eq!(client.get_call_count(), 0);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        assert_eq!(client.get_call_count(), 2);
    }

    // ── pagination ────────────────────────────────────────────────────────────

    #[test]
    fn test_get_calls_paginated_respects_limit_and_start_id() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let token_admin = Address::generate(&env);
        let stake_token = env.register_stellar_asset_contract(token_admin);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &4000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let results = client.get_calls_paginated(&2u64, &2u32);

        assert_eq!(results.len(), 2);
        assert_eq!(results.get(0).unwrap().id, 2);
        assert_eq!(results.get(1).unwrap().id, 3);
    }

    #[test]
    fn test_get_calls_paginated_respects_maximum_limit() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        for _ in 0..25 {
            create_call_with_default_condition(
                &client,
                &creator,
                &stake_token,
                &100_000_000_i128,
                &2000u64,
                &token_address,
                &pair_id,
                &ipfs_cid,
                &2,
            );
        }

        let results = client.get_calls_paginated(&1u64, &100u32);
        assert_eq!(results.len(), 20);
        assert_eq!(results.get(0).unwrap().id, 1);
        assert_eq!(results.get(19).unwrap().id, 20);
    }

    #[test]
    fn test_get_calls_by_creator_paginated_returns_creator_specific_results() {
        let (env, admin, outcome_manager, creator1) = create_test_env();
        let creator2 = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        create_call_with_default_condition(
            &client,
            &creator1,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        create_call_with_default_condition(
            &client,
            &creator2,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        create_call_with_default_condition(
            &client,
            &creator1,
            &stake_token,
            &100_000_000_i128,
            &4000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let results = client.get_calls_by_creator_paginated(&creator1, &1u64, &10u32);

        assert_eq!(results.len(), 2);
        assert_eq!(results.get(0).unwrap().creator, creator1);
        assert_eq!(results.get(1).unwrap().creator, creator1);
        assert_eq!(results.get(0).unwrap().id, 1);
        assert_eq!(results.get(1).unwrap().id, 3);
    }

    #[test]
    fn test_get_calls_by_creator_paginated_handles_gaps_and_max_limit() {
        let (env, admin, outcome_manager, creator1) = create_test_env();
        let creator2 = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = Address::generate(&env);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        create_call_with_default_condition(
            &client,
            &creator1,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        create_call_with_default_condition(
            &client,
            &creator2,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        create_call_with_default_condition(
            &client,
            &creator1,
            &stake_token,
            &100_000_000_i128,
            &4000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let results = client.get_calls_by_creator_paginated(&creator1, &1u64, &10u32);

        assert_eq!(results.len(), 2);
        assert_eq!(results.get(0).unwrap().creator, creator1);
        assert_eq!(results.get(1).unwrap().creator, creator1);
        assert_eq!(results.get(0).unwrap().id, 1);
        assert_eq!(results.get(1).unwrap().id, 3);
    }

    // ── void_call / claim_void_refund ─────────────────────────────────────────

    fn make_call(env: &Env, client: &CallRegistryClient<'_>, creator: &Address) -> (crate::types::Call, Address) {
        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(env);
        let pair_id = Bytes::from_slice(env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(env, b"QmXxxx");

        let call = create_call_with_default_condition(
            client,
            creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        (call, stake_token)
    }

    fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
        use soroban_sdk::token::StellarAssetClient;
        let sac = StellarAssetClient::new(env, token);
        sac.mint(to, &amount);
    }

    #[test]
    fn test_void_call_succeeds() {
        let (env, client, _admin, _om) = setup();
        env.ledger().set_timestamp(1000);
        let creator = Address::generate(&env);
        let (call, _) = make_call(&env, &client, &creator);

        client.void_call(&call.id);

        let updated = client.get_call(&call.id);
        assert!(updated.voided);
    }

    #[test]
    fn test_claim_void_refund_succeeds() {
        let (env, client, _admin, _om) = setup();
        env.ledger().set_timestamp(1000);
        let creator = Address::generate(&env);
        let staker = Address::generate(&env);
        let (call, _stake_token) = make_call(&env, &client, &creator);

        client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1);

        client.void_call(&call.id);
        client.claim_void_refund(&staker, &call.id);
    }

    #[test]
    #[should_panic(expected = "No stake to refund")]
    fn test_claim_refund_with_no_stake_panics() {
        let (env, client, _admin, _om) = setup();
        env.ledger().set_timestamp(1000);
        let creator = Address::generate(&env);
        let non_staker = Address::generate(&env);
        let (call, _) = make_call(&env, &client, &creator);

        client.void_call(&call.id);
        client.claim_void_refund(&non_staker, &call.id);
    }

    // ── 3-outcome market tests ───────────────────────────────────────────────

    #[test]
    fn test_create_3_outcome_call_success() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &TEST_START_PRICE,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &3,
        );

        assert_eq!(call.id, 1);
        assert_eq!(call.outcome_count, 3);
        assert_eq!(call.outcome_stakes.get(1).unwrap_or(0), 0);
        assert_eq!(call.outcome_stakes.get(2).unwrap_or(0), 0);
        assert_eq!(call.outcome_stakes.get(3).unwrap_or(0), 0);
    }

    #[test]
    fn test_stake_on_3_outcome_call() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &TEST_START_PRICE,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &3,
        );

        env.budget().reset_unlimited();

        client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1);
        client.stake_on_call(&staker, &call.id, &30_000_000_i128, &2);
        client.stake_on_call(&staker, &call.id, &20_000_000_i128, &3);

        let updated_call = client.get_call(&call.id);
        assert_eq!(updated_call.outcome_stakes.get(1).unwrap_or(0), 50_000_000);
        assert_eq!(updated_call.outcome_stakes.get(2).unwrap_or(0), 30_000_000);
        assert_eq!(updated_call.outcome_stakes.get(3).unwrap_or(0), 20_000_000);
    }

    #[test]
    fn test_resolve_3_outcome_call() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &TEST_START_PRICE,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &3,
        );

        env.ledger().set_timestamp(3000); // after end_ts

        let resolved = client.resolve_call(&call.id, &2, &150_000_000_i128);

        assert_eq!(resolved.outcome, 2);
        assert_eq!(resolved.end_price, 150_000_000);
    }

    #[test]
    fn test_resolve_3_outcome_call_invalid_outcome_returns_error() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &TEST_START_PRICE,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &3,
        );

        env.ledger().set_timestamp(3000);

        let result = client.try_resolve_call(&call.id, &4, &150_000_000_i128);
        assert_eq!(
            result,
            Err(Ok(CallRegistryError::InvalidOutcome)),
            "outcome 4 should return InvalidOutcome for 3-outcome call"
        );
    }

    #[test]
    fn test_stake_invalid_position_on_3_outcome_call_returns_error() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &TEST_START_PRICE,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &3,
        );

        let result = client.try_stake_on_call(&staker, &call.id, &50_000_000_i128, &4);
        assert_eq!(
            result,
            Err(Ok(CallRegistryError::InvalidPosition)),
            "position 4 should return InvalidPosition for 3-outcome call"
        );
    }

    #[test]
    fn test_get_outcome_stakes() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &TEST_START_PRICE,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &3,
        );

        env.budget().reset_unlimited();

        client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1);
        client.stake_on_call(&staker, &call.id, &30_000_000_i128, &2);
        client.stake_on_call(&staker, &call.id, &20_000_000_i128, &3);

        let outcome_stakes = client.get_outcome_stakes(&call.id);
        assert_eq!(outcome_stakes.get(1).unwrap_or(0), 50_000_000);
        assert_eq!(outcome_stakes.get(2).unwrap_or(0), 30_000_000);
        assert_eq!(outcome_stakes.get(3).unwrap_or(0), 20_000_000);
    }

    #[test]
    fn test_get_staker_stake_multi_outcome() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &TEST_START_PRICE,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &3,
        );

        env.budget().reset_unlimited();

        client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1);
        client.stake_on_call(&staker, &call.id, &30_000_000_i128, &2);
        client.stake_on_call(&staker, &call.id, &20_000_000_i128, &3);

        assert_eq!(client.get_staker_stake(&call.id, &staker, &1), 50_000_000);
        assert_eq!(client.get_staker_stake(&call.id, &staker, &2), 30_000_000);
        assert_eq!(client.get_staker_stake(&call.id, &staker, &3), 20_000_000);

        let result = client.try_get_staker_stake(&call.id, &staker, &4);
        assert_eq!(
            result,
            Err(Ok(CallRegistryError::InvalidPosition)),
            "position 4 should return InvalidPosition for 3-outcome call"
        );
    }

    #[test]
    fn test_get_call_stats_multi_outcome() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let staker1 = Address::generate(&env);
        let staker2 = Address::generate(&env);
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &stake_token,
            &100_000_000_i128,
            &TEST_START_PRICE,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &ConditionType::TargetAbove(100_000_000_i128),
            &3,
        );

        env.budget().reset_unlimited();

        client.stake_on_call(&staker1, &call.id, &50_000_000_i128, &1);
        client.stake_on_call(&staker2, &call.id, &30_000_000_i128, &1);
        client.stake_on_call(&staker1, &call.id, &40_000_000_i128, &2);
        client.stake_on_call(&staker2, &call.id, &20_000_000_i128, &3);

        let stats = client.get_call_stats(&call.id);

        assert_eq!(stats.outcome_stakes.get(1).unwrap_or(0), 80_000_000);
        assert_eq!(stats.outcome_stakes.get(2).unwrap_or(0), 40_000_000);
        assert_eq!(stats.outcome_stakes.get(3).unwrap_or(0), 20_000_000);
        assert_eq!(stats.outcome_stake_counts.get(1).unwrap_or(0), 2);
        assert_eq!(stats.outcome_stake_counts.get(2).unwrap_or(0), 1);
        assert_eq!(stats.outcome_stake_counts.get(3).unwrap_or(0), 1);
        assert_eq!(stats.total_stakes, 4);
    }

    // ── Creator Reputation Stats Tests ────────────────────────────────────────

    #[test]
    fn test_creator_stats_increment_on_create() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        // Creator starts with no stats
        let stats = client.get_creator_stats_view(&creator);
        assert_eq!(stats.total_created, 0);
        assert_eq!(stats.total_resolved, 0);
        assert_eq!(stats.total_correct, 0);

        // Create first call
        create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let stats = client.get_creator_stats_view(&creator);
        assert_eq!(stats.total_created, 1);
        assert_eq!(stats.total_resolved, 0);
        assert_eq!(stats.total_correct, 0);

        // Create second call
        create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        let stats = client.get_creator_stats_view(&creator);
        assert_eq!(stats.total_created, 2);
        assert_eq!(stats.total_resolved, 0);
        assert_eq!(stats.total_correct, 0);
    }

    #[test]
    fn test_creator_stats_resolved_and_correct_on_win() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        client.whitelist_token(&stake_token);

        // Creator creates a call
        let _call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        // Creator stakes on UP position (winning side)
        client.stake_on_call(&creator, &1u64, &50_000_000_i128, &1);

        // Resolve as UP (creator staked on winning side)
        env.ledger().set_timestamp(2100);
        client.resolve_call(&1u64, &1u32, &150_000_000_i128);

        let stats = client.get_creator_stats_view(&creator);
        assert_eq!(stats.total_created, 1);
        assert_eq!(stats.total_resolved, 1);
        assert_eq!(stats.total_correct, 1);
    }

    #[test]
    fn test_creator_stats_resolved_but_not_correct_on_loss() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        client.whitelist_token(&stake_token);

        // Creator creates a call
        let _call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );

        // Creator stakes on UP (but outcome will be DOWN, so incorrect)
        client.stake_on_call(&creator, &1u64, &50_000_000_i128, &1);

        // Resolve as DOWN (creator staked on losing side)
        env.ledger().set_timestamp(2100);
        client.resolve_call(&1u64, &2u32, &50_000_000_i128);

        let stats = client.get_creator_stats_view(&creator);
        assert_eq!(stats.total_created, 1);
        assert_eq!(stats.total_resolved, 1);
        assert_eq!(stats.total_correct, 0);
    }

    #[test]
    fn test_creator_stats_multiple_calls_mixed_outcomes() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        client.whitelist_token(&stake_token);

        // Create call 1 and creator stakes on UP
        let _call1 = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        client.stake_on_call(&creator, &1u64, &50_000_000_i128, &1);

        // Create call 2 and creator stakes on DOWN
        let _call2 = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        client.stake_on_call(&creator, &2u64, &50_000_000_i128, &2);

        // Create call 3 and creator stakes on UP
        let _call3 = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &4000u64,
            &token_address,
            &pair_id,
            &ipfs_cid,
            &2,
        );
        client.stake_on_call(&creator, &3u64, &50_000_000_i128, &1);

        // Resolve call 1 as UP (correct - creator staked UP)
        env.ledger().set_timestamp(2100);
        client.resolve_call(&1u64, &1u32, &150_000_000_i128);

        // Resolve call 2 as UP (incorrect - creator staked DOWN)
        env.ledger().set_timestamp(3100);
        client.resolve_call(&2u64, &1u32, &150_000_000_i128);

        // Resolve call 3 as UP (correct - creator staked UP)
        env.ledger().set_timestamp(4100);
        client.resolve_call(&3u64, &1u32, &150_000_000_i128);

        let stats = client.get_creator_stats_view(&creator);
        assert_eq!(stats.total_created, 3);
        assert_eq!(stats.total_resolved, 3);
        assert_eq!(stats.total_correct, 2);
    }

    // ── Storage Stats ─────────────────────────────────────────────────────────

    #[test]
    fn test_get_storage_stats_after_initialize() {
        let (_env, client, _admin, _om) = setup();
        let stats = client.get_storage_stats();
        // After initialize: Config + version = 2 instance entries
        assert_eq!(stats.call_count, 0);
        assert_eq!(stats.instance_entry_count, 2);
        assert_eq!(stats.estimated_instance_bytes, 2 * 128);
    }

    #[test]
    fn test_get_instance_entry_count_after_initialize() {
        let (_env, client, _admin, _om) = setup();
        assert_eq!(client.get_instance_entry_count(), 2);
    }

    #[test]
    fn test_storage_stats_call_count_increments_after_create() {
        let (env, client, _admin, _om) = setup();
        env.ledger().set_timestamp(1000);

        let creator = Address::generate(&env);
        let stake_token = env.register_contract(None, MockToken);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        client.whitelist_token(&stake_token);

        create_call_with_default_condition(
            &client, &creator, &stake_token, &100_000_000_i128,
            &2000u64, &token_address, &pair_id, &ipfs_cid, &2,
        );
        create_call_with_default_condition(
            &client, &creator, &stake_token, &100_000_000_i128,
            &3000u64, &token_address, &pair_id, &ipfs_cid, &2,
        );

        let stats = client.get_storage_stats();
        assert_eq!(stats.call_count, 2);
        // Config + version + CallCounter + GlobalStats = 4
        assert_eq!(stats.instance_entry_count, 4);
        assert_eq!(stats.estimated_instance_bytes, 4 * 128);
    }

    #[test]
    fn test_storage_stats_instance_entry_count_increases_with_void_refund() {
        let (env, client, _admin, _om) = setup();
        env.ledger().set_timestamp(1000);
        let creator = Address::generate(&env);
        let staker = Address::generate(&env);
        let (call, _stake_token) = make_call(&env, &client, &creator);

        client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1);

        let before = client.get_instance_entry_count();
        client.void_call(&call.id);
        client.claim_void_refund(&staker, &call.id);
        let after = client.get_instance_entry_count();

        // One new VoidRefundClaimed entry added
        assert_eq!(after, before + 1);
    }

    #[test]
    fn test_storage_stats_no_warning_below_threshold() {
        let (env, client, _admin, _om) = setup();
        // Well below 500 entries — get_storage_stats should not emit storage_warning
        let stats = client.get_storage_stats();
        assert!(stats.instance_entry_count < 500);

        let events = env.events().all();
        let has_warning = events.iter().any(|e| {
            e.1 == soroban_sdk::vec![
                &env,
                "call_registry".into_val(&env),
                "storage_warning".into_val(&env),
            ]
        });
        assert!(!has_warning);
    }
}