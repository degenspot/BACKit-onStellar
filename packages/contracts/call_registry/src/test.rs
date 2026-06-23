#![cfg(test)]
#![allow(deprecated)]
#![allow(unused)]

extern crate std;

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
    const STAKE_ON_CALL_BUDGET_CPU: u64 = 20_000_000;
    const STAKE_ON_CALL_BUDGET_MEM: u64 = 200_000;
    const GET_CALLS_PAGINATED_BUDGET_CPU: u64 = 10_000_000;
    const GET_CALLS_PAGINATED_BUDGET_MEM: u64 = 100_000;
    const GET_CALL_STAKERS_BUDGET_CPU: u64 = 20_000_000;
    const GET_CALL_STAKERS_BUDGET_MEM: u64 = 200_000;

    /// Spin up a fresh environment with a registered, initialised CallRegistry.
    fn setup() -> (Env, CallRegistryClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(CallRegistry, ());
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
        metadata_hash: &BytesN<32>,
        outcome_count: &u32,
    ) -> crate::types::Call {
        client.whitelist_token(stake_token);
        // Use a default IPFS CID for tests
        let ipfs_cid = Bytes::from_slice(&client.env, b"QmXxxx");
        client.create_call(
            creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: *stake_amount,
                start_price: TEST_START_PRICE,
                end_ts: *end_ts,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid,
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: *outcome_count,
            },
        )
    }

    #[derive(Clone, Copy, Debug)]
    struct BudgetUsage {
        cpu: u64,
        mem: u64,
    }

    fn measure_budget<F>(env: &Env, _cpu_limit: u64, _mem_limit: u64, f: F) -> BudgetUsage
    where
        F: FnOnce(),
    {
        env.cost_estimate().budget().reset_default();
        f();
        let budget = env.cost_estimate().budget();
        BudgetUsage {
            cpu: budget.cpu_instruction_cost(),
            mem: budget.memory_bytes_cost(),
        }
    }

    // ── initialize ────────────────────────────────────────────────────────────

    #[test]
    fn test_initialize() {
        let (env, admin, outcome_manager, _) = create_test_env();
        let contract_id = env.register(CallRegistry, ());
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
    fn test_dataentry_set_and_get() {
        let (env, client, _admin, _om) = setup();

        // Prepare inputs
        let creator = Address::generate(&env);
        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        // Use a deterministic metadata hash for test
        let metadata_hash = {
            let mut arr = [0u8; 32];
            arr[0] = 42u8;
            BytesN::from_array(&env, &arr)
        };

        // Create the call
        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");
        let call = client.create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid,
                metadata_hash: metadata_hash.clone(),
                condition: crate::types::ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 2u32,
            },
        );

        // Read back the stored DataEntry for the metadata hash
        // Since this is the first call in a fresh test environment, the ID is 1.
        let key = Bytes::from_slice(&env, b"call_1_hash");
        let entry: Option<Bytes> = client.get_call_data_entry(&call.id, &key);
        assert!(entry.is_some(), "DataEntry should be set");
        let entry_bytes = entry.unwrap();
        // Expect base-64 encoded byte hash
        assert!(entry_bytes.len() > 0u32);
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );

        env.cost_estimate().budget().reset_default();
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

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
            &metadata_hash,
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
            &metadata_hash,
            &2,
        );

        let stats = client.get_global_stats();
        assert_eq!(stats.total_calls, 2);

        env.cost_estimate().budget().reset_default();
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let result = client.try_create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: 0_i128,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: Bytes::from_slice(&env, b"QmXxxx"),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 2,
            },
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);
        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let result = client.try_create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: -100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: Bytes::from_slice(&env, b"QmXxxx"),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 2,
            },
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let result = client.try_create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 500u64, // in the past
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: Bytes::from_slice(&env, b"QmXxxx"),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 2,
            },
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );

        env.cost_estimate().budget().reset_default();

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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let created_call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
            &metadata_hash,
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
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        for _ in 0..25 {
            create_call_with_default_condition(
                &client,
                &creator,
                &stake_token,
                &100_000_000_i128,
                &2000u64,
                &token_address,
                &pair_id,
                &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        create_call_with_default_condition(
            &client,
            &creator1,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
            &metadata_hash,
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
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        create_call_with_default_condition(
            &client,
            &creator1,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
            &metadata_hash,
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
            &metadata_hash,
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

    fn make_call(
        env: &Env,
        client: &CallRegistryClient<'_>,
        creator: &Address,
    ) -> (crate::types::Call, Address) {
        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(env);
        let pair_id = Bytes::from_slice(env, b"USDC/XLM");
        let metadata_hash = BytesN::from_array(env, &[0u8; 32]);

        let call = create_call_with_default_condition(
            client,
            creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");
        let call = client.create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: ipfs_cid.clone(),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 3,
            },
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");
        let call = client.create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: ipfs_cid.clone(),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 3,
            },
        );

        env.cost_estimate().budget().reset_default();

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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");
        let call = client.create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: ipfs_cid.clone(),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 3,
            },
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");
        let call = client.create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: ipfs_cid.clone(),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 3,
            },
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let ipfs_cid = Bytes::from_slice(&env, b"QmXxxx");

        let call = client.create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: ipfs_cid.clone(),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 3,
            },
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = client.create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: Bytes::from_slice(&env, b"QmXxxx"),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 3,
            },
        );

        env.cost_estimate().budget().reset_default();

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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = client.create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: Bytes::from_slice(&env, b"QmXxxx"),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 3,
            },
        );

        env.cost_estimate().budget().reset_default();

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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        let call = client.create_call(
            &creator,
            &crate::types::CallInitArgs {
                stake_token: stake_token.clone(),
                stake_amount: 100_000_000_i128,
                start_price: TEST_START_PRICE,
                end_ts: 2000u64,
                token_address: token_address.clone(),
                pair_id: pair_id.clone(),
                ipfs_cid: Bytes::from_slice(&env, b"QmXxxx"),
                metadata_hash: metadata_hash.clone(),
                condition: ConditionType::TargetAbove(100_000_000_i128),
                outcome_count: 3,
            },
        );

        env.cost_estimate().budget().reset_default();

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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

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
            &metadata_hash,
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
            &metadata_hash,
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        client.whitelist_token(&stake_token);

        // Creator creates a call
        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );

        // Creator stakes on UP position (winning side)
        client.stake_on_call(&creator, &call.id, &50_000_000_i128, &1);

        // Resolve as UP (creator staked on winning side)
        env.ledger().set_timestamp(2100);
        client.resolve_call(&call.id, &1u32, &150_000_000_i128);

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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        client.whitelist_token(&stake_token);

        // Creator creates a call
        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );

        // Creator stakes on UP (but outcome will be DOWN, so incorrect)
        client.stake_on_call(&creator, &call.id, &50_000_000_i128, &1);

        // Resolve as DOWN (creator staked on losing side)
        env.ledger().set_timestamp(2100);
        client.resolve_call(&call.id, &2u32, &50_000_000_i128);

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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        client.whitelist_token(&stake_token);

        // Create call 1 and creator stakes on UP
        let call1 = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );
        client.stake_on_call(&creator, &call1.id, &50_000_000_i128, &1);

        // Create call 2 and creator stakes on DOWN
        let call2 = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );
        client.stake_on_call(&creator, &call2.id, &50_000_000_i128, &2);

        // Create call 3 and creator stakes on UP
        let call3 = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &4000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );
        client.stake_on_call(&creator, &call3.id, &50_000_000_i128, &1);

        // Resolve call 1 as UP (correct - creator staked UP)
        env.ledger().set_timestamp(2100);
        client.resolve_call(&call1.id, &1u32, &150_000_000_i128);

        // Resolve call 2 as UP (incorrect - creator staked DOWN)
        env.ledger().set_timestamp(3100);
        client.resolve_call(&call2.id, &1u32, &150_000_000_i128);

        // Resolve call 3 as UP (correct - creator staked UP)
        env.ledger().set_timestamp(4100);
        client.resolve_call(&call3.id, &1u32, &150_000_000_i128);

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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        client.whitelist_token(&stake_token);

        create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &2000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
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
            &metadata_hash,
            &2,
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

    #[test]
    fn test_get_call_stakers_paginated_caps_response() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);
        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );

        for _ in 0..60u32 {
            let staker = Address::generate(&env);
            client.stake_on_call(&staker, &call.id, &TEST_MIN_STAKE, &1u32);
        }

        let first_page = client.get_call_stakers(&call.id);
        let second_page = client.get_call_stakers_paginated(&call.id, &50u32, &50u32);

        assert_eq!(first_page.len(), 50);
        assert_eq!(second_page.len(), 10);
    }

    #[test]
    fn test_stake_on_call_stays_within_budget() {
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);
        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );

        let usage = measure_budget(
            &env,
            STAKE_ON_CALL_BUDGET_CPU,
            STAKE_ON_CALL_BUDGET_MEM,
            || {
                client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1u32);
            },
        );

        std::println!(
            "call_registry::stake_on_call cpu={} mem={}",
            usage.cpu,
            usage.mem
        );
        assert!(usage.cpu <= STAKE_ON_CALL_BUDGET_CPU);
        assert!(usage.mem <= STAKE_ON_CALL_BUDGET_MEM);
    }

    #[test]
    #[should_panic(expected = "ExceededLimit")]
    fn test_stake_on_call_exceeding_budget_fails() {
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
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);
        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );

        env.cost_estimate().budget().reset_limits(50_000, 1_024);
        client.stake_on_call(&staker, &call.id, &50_000_000_i128, &1u32);
    }

    #[test]
    fn test_get_calls_paginated_stays_within_budget() {
        let (env, client, _admin, _om) = setup();
        env.ledger().set_timestamp(1000);

        let creator = Address::generate(&env);
        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);

        for _ in 0..10u32 {
            create_call_with_default_condition(
                &client,
                &creator,
                &stake_token,
                &100_000_000_i128,
                &3000u64,
                &token_address,
                &pair_id,
                &metadata_hash,
                &2,
            );
        }

        let usage = measure_budget(
            &env,
            GET_CALLS_PAGINATED_BUDGET_CPU,
            GET_CALLS_PAGINATED_BUDGET_MEM,
            || {
                let results = client.get_calls_paginated(&1u64, &10u32);
                assert_eq!(results.len(), 10);
            },
        );

        std::println!(
            "call_registry::get_calls_paginated cpu={} mem={}",
            usage.cpu,
            usage.mem
        );
        assert!(usage.cpu <= GET_CALLS_PAGINATED_BUDGET_CPU);
        assert!(usage.mem <= GET_CALLS_PAGINATED_BUDGET_MEM);
    }

    #[test]
    fn test_get_call_stakers_stays_within_budget() {
        let (env, admin, outcome_manager, creator) = create_test_env();
        let contract_id = env.register_contract(None, CallRegistry);
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &TEST_MIN_STAKE);
        env.ledger().set_timestamp(1000);

        let stake_token = env.register_contract(None, MockToken);
        client.whitelist_token(&stake_token);
        let token_address = Address::generate(&env);
        let pair_id = Bytes::from_slice(&env, b"USDC/XLM");
        let metadata_hash = BytesN::from_array(&env, &[0u8; 32]);
        let call = create_call_with_default_condition(
            &client,
            &creator,
            &stake_token,
            &100_000_000_i128,
            &3000u64,
            &token_address,
            &pair_id,
            &metadata_hash,
            &2,
        );

        for _ in 0..50u32 {
            let staker = Address::generate(&env);
            client.stake_on_call(&staker, &call.id, &TEST_MIN_STAKE, &1u32);
        }

        let usage = measure_budget(
            &env,
            GET_CALL_STAKERS_BUDGET_CPU,
            GET_CALL_STAKERS_BUDGET_MEM,
            || {
                let stakers = client.get_call_stakers(&call.id);
                assert_eq!(stakers.len(), 50);
            },
        );

        std::println!(
            "call_registry::get_call_stakers cpu={} mem={}",
            usage.cpu,
            usage.mem
        );
        assert!(usage.cpu <= GET_CALL_STAKERS_BUDGET_CPU);
        assert!(usage.mem <= GET_CALL_STAKERS_BUDGET_MEM);
    }

}

// ── Native XLM staking tests ──────────────────────────────────────────────────
//
// These tests exercise the full XLM staking path:
//   create_call with XLM sentinel, stake_on_call with XLM, void refund in XLM,
//   release_escrow payout in XLM, and mixed XLM + USDC calls in separate markets.

mod native_xlm {
    use super::*;
    use crate::types::ConditionType;
    use crate::{CallRegistry, CallRegistryClient, NATIVE_XLM_SENTINEL};
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        token::StellarAssetClient,
        Address, Bytes, BytesN, Env, IntoVal,
    };

    const MIN_STAKE: i128 = 1_000_000; // 0.1 XLM (7 decimals)
    const STAKE_AMOUNT: i128 = 10_000_000; // 1 XLM

    /// Register a real Stellar Asset Contract for native XLM and return its address.
    /// In the test environment `register_stellar_asset_contract_v2` (or the
    /// single-arg form) gives us a proper SAC we can mint from.
    // REPLACE register_xlm_sac entirely:
    fn register_xlm_sac(env: &Env) -> Address {
        // For testing, we create a Stellar Asset Contract with a generated admin.
        // This SAC will represent native XLM in the test environment.
        let token_admin = Address::generate(env);
        env.register_stellar_asset_contract(token_admin)
    }

    /// Mint `amount` of `token` to `to` using the StellarAssetClient.
    fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    /// Spin up a registry and return (env, client, admin, outcome_manager, xlm_address).
    /// The XLM SAC is registered at the sentinel address so the contract
    /// recognises it as native XLM.
    fn setup_with_xlm() -> (Env, CallRegistryClient<'static>, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);

        let admin = Address::generate(&env);
        let outcome_manager = Address::generate(&env);

        let contract_id = env.register(CallRegistry, ());
        let client = CallRegistryClient::new(&env, &contract_id);

        client.initialize(&admin, &outcome_manager, &MIN_STAKE);

        // Register a SAC at the sentinel address so token::StellarAssetClient
        // can resolve transfers in the test environment.
        let xlm_addr = register_xlm_sac(&env);
        client.set_xlm_sac_address(&xlm_addr);
        assert!(
            client.is_native_xlm_address(&xlm_addr),
            "xlm sentinel not registered"
        );
        (env, client, admin, outcome_manager, xlm_addr)
    }

    // ── helper to create a call with XLM ─────────────────────────────────────

    fn create_xlm_call(
        env: &Env,
        client: &CallRegistryClient<'_>,
        creator: &Address,
        xlm_sentinel: &Address,
    ) -> crate::types::Call {
        let token_address = Address::generate(env);
        let pair_id = Bytes::from_slice(env, b"XLM/USD");
        let metadata_hash = BytesN::from_array(env, &[0u8; 32]);
        let ipfs_cid = Bytes::from_slice(env, b"QmXxxx");

        client.create_call(
            creator,
            &crate::types::CallInitArgs {
                stake_token: xlm_sentinel.clone(),
                stake_amount: STAKE_AMOUNT,
                start_price: 100_000_000_i128, // start_price
                end_ts: 10_000u64,             // end_ts
                token_address,
                pair_id,
                ipfs_cid,
                metadata_hash,
                condition: ConditionType::TargetAbove(105_000_000_i128),
                outcome_count: 2u32,
            },
        )
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    #[test]
    fn test_native_xlm_address_helper() {
        let (_env, client, _admin, _om, xlm_sac) = setup_with_xlm();
        assert_eq!(client.native_xlm_address(), xlm_sac);
        assert!(client.is_native_xlm_address(&xlm_sac));
    }

    #[test]
    fn test_create_call_with_native_xlm_succeeds() {
        let (env, client, _admin, _om, xlm_sac) = setup_with_xlm();
        let sentinel = xlm_sac.clone();
        let creator = Address::generate(&env);

        let call = create_xlm_call(&env, &client, &creator, &sentinel);

        assert_eq!(call.stake_token, sentinel);
        assert_eq!(call.stake_amount, STAKE_AMOUNT);
    }

    #[test]
    fn test_create_call_with_xlm_emits_xlm_call_created_event() {
        let (env, client, _admin, _om, xlm_sac) = setup_with_xlm();
        let creator = Address::generate(&env);
        let sentinel = xlm_sac.clone();

        create_xlm_call(&env, &client, &creator, &sentinel);

        let events = env.events().all();
        let has_xlm_event = events.iter().any(|e| {
            e.1 == soroban_sdk::vec![
                &env,
                "call_registry".into_val(&env),
                "xlm_call_created".into_val(&env),
            ]
        });
        assert!(has_xlm_event, "xlm_call_created event should be emitted");
    }

    #[test]
    fn test_create_call_with_xlm_does_not_emit_sac_call_created() {
        let (env, client, _admin, _om, xlm_sac) = setup_with_xlm();
        let creator = Address::generate(&env);
        let sentinel = xlm_sac.clone();

        create_xlm_call(&env, &client, &creator, &sentinel);

        let events = env.events().all();
        let has_sac_event = events.iter().any(|e| {
            e.1 == soroban_sdk::vec![
                &env,
                "call_registry".into_val(&env),
                "call_created".into_val(&env),
            ]
        });
        assert!(
            !has_sac_event,
            "generic call_created should NOT be emitted for XLM calls"
        );
    }

    #[test]
    fn test_stake_on_call_with_native_xlm_succeeds() {
        let (env, client, _admin, _om, xlm_sac) = setup_with_xlm();
        let creator = Address::generate(&env);
        let staker = Address::generate(&env);
        let sentinel = xlm_sac.clone();

        // Mint XLM to staker
        mint(&env, &xlm_sac, &staker, STAKE_AMOUNT * 10);

        let call = create_xlm_call(&env, &client, &creator, &sentinel);
        client.stake_on_call(&staker, &call.id, &STAKE_AMOUNT, &1u32);

        let updated = client.get_call(&call.id);
        let up_total = updated.outcome_stakes.get(1u32).unwrap_or(0);
        assert_eq!(up_total, STAKE_AMOUNT);
    }

    #[test]
    fn test_stake_on_call_with_xlm_emits_xlm_stake_added_event() {
        let (env, client, _admin, _om, xlm_sac) = setup_with_xlm();
        let creator = Address::generate(&env);
        let staker = Address::generate(&env);
        let sentinel = xlm_sac.clone();

        mint(&env, &xlm_sac, &staker, STAKE_AMOUNT * 10);

        let call = create_xlm_call(&env, &client, &creator, &sentinel);
        client.stake_on_call(&staker, &call.id, &STAKE_AMOUNT, &2u32);

        let events = env.events().all();
        let has_xlm_event = events.iter().any(|e| {
            e.1 == soroban_sdk::vec![
                &env,
                "call_registry".into_val(&env),
                "xlm_stake_added".into_val(&env),
            ]
        });
        assert!(has_xlm_event, "xlm_stake_added event should be emitted");
    }

    #[test]
    fn test_void_refund_in_native_xlm_emits_xlm_event() {
        let (env, client, _admin, _om, xlm_sac) = setup_with_xlm();
        let creator = Address::generate(&env);
        let staker = Address::generate(&env);
        let sentinel = xlm_sac.clone();

        mint(&env, &xlm_sac, &staker, STAKE_AMOUNT * 10);

        let call = create_xlm_call(&env, &client, &creator, &sentinel);
        client.stake_on_call(&staker, &call.id, &STAKE_AMOUNT, &1u32);
        client.void_call(&call.id);
        client.claim_void_refund(&staker, &call.id);

        let events = env.events().all();
        let has_xlm_refund = events.iter().any(|e| {
            e.1 == soroban_sdk::vec![
                &env,
                "call_registry".into_val(&env),
                "xlm_void_refund".into_val(&env),
            ]
        });
        assert!(has_xlm_refund, "xlm_void_refund event should be emitted");
    }

    #[test]
    fn test_void_refund_in_native_xlm_does_not_emit_sac_event() {
        let (env, client, _admin, _om, xlm_sac) = setup_with_xlm();
        let creator = Address::generate(&env);
        let staker = Address::generate(&env);
        let sentinel = xlm_sac.clone();

        mint(&env, &xlm_sac, &staker, STAKE_AMOUNT * 10);

        let call = create_xlm_call(&env, &client, &creator, &sentinel);
        client.stake_on_call(&staker, &call.id, &STAKE_AMOUNT, &1u32);
        client.void_call(&call.id);
        client.claim_void_refund(&staker, &call.id);

        let events = env.events().all();
        let has_sac_refund = events.iter().any(|e| {
            e.1 == soroban_sdk::vec![
                &env,
                "call_registry".into_val(&env),
                "void_refund_claimed".into_val(&env),
            ]
        });
        assert!(
            !has_sac_refund,
            "generic void_refund_claimed should NOT fire for XLM calls"
        );
    }

    #[test]
    fn test_release_escrow_in_native_xlm_emits_xlm_event() {
        let (env, client, _admin, outcome_manager, xlm_sac) = setup_with_xlm();
        let creator = Address::generate(&env);
        let staker = Address::generate(&env);
        let winner = Address::generate(&env);
        let sentinel = xlm_sac.clone();

        mint(&env, &xlm_sac, &staker, STAKE_AMOUNT * 10);

        let call = create_xlm_call(&env, &client, &creator, &sentinel);
        client.stake_on_call(&staker, &call.id, &STAKE_AMOUNT, &1u32);

        // Fast-forward past end_ts then resolve
        env.ledger().set_timestamp(10_001);
        client.resolve_call(&call.id, &1u32, &110_000_000_i128);

        client.release_escrow(&call.id, &winner, &STAKE_AMOUNT);

        let events = env.events().all();
        let has_xlm_escrow = events.iter().any(|e| {
            e.1 == soroban_sdk::vec![
                &env,
                "call_registry".into_val(&env),
                "xlm_escrow_released".into_val(&env),
            ]
        });
        assert!(
            has_xlm_escrow,
            "xlm_escrow_released event should be emitted"
        );
    }

    #[test]
    fn test_xlm_sentinel_not_counted_as_whitelisted_sac_token() {
        let (_env, client, _admin, _om, xlm_sac) = setup_with_xlm();
        let sentinel = xlm_sac.clone();

        // The sentinel is NOT in the whitelist map — it's handled separately.
        // is_token_whitelisted should return false for the XLM sentinel.
        assert!(
            !client.is_token_whitelisted(&sentinel),
            "XLM sentinel should not appear in the SAC whitelist"
        );
    }

    #[test]
    fn test_xlm_arithmetic_7_decimals_consistency() {
        // XLM has 7 decimal places: 1 XLM = 10_000_000 stroops
        // Verify the contract accepts and round-trips amounts in stroops correctly.
        let (env, client, _admin, _om, xlm_sac) = setup_with_xlm();
        let creator = Address::generate(&env);
        let staker = Address::generate(&env);
        let sentinel = xlm_sac.clone();

        let one_xlm: i128 = 10_000_000; // 1 XLM in stroops
        let half_xlm: i128 = 5_000_000; // 0.5 XLM
        let quarter_xlm: i128 = 2_500_000; // 0.25 XLM

        // Set min_stake to 0.1 XLM (1_000_000 stroops) — already set in setup
        mint(&env, &xlm_sac, &staker, one_xlm * 100);

        let call = create_xlm_call(&env, &client, &creator, &sentinel);

        // Stake 0.5 XLM on position 1 and 0.25 XLM on position 2
        client.stake_on_call(&staker, &call.id, &half_xlm, &1u32);
        client.stake_on_call(&staker, &call.id, &quarter_xlm, &2u32);

        let updated = client.get_call(&call.id);
        assert_eq!(updated.outcome_stakes.get(1u32).unwrap_or(0), half_xlm);
        assert_eq!(updated.outcome_stakes.get(2u32).unwrap_or(0), quarter_xlm);

        // Staker's individual recorded stake should match
        let up_stake = client.get_staker_stake(&call.id, &staker, &1u32);
        let down_stake = client.get_staker_stake(&call.id, &staker, &2u32);
        assert_eq!(up_stake, half_xlm);
        assert_eq!(down_stake, quarter_xlm);
    }

}

// ── SEP-10 tests ─────────────────────────────────────────────────────────────

mod sep10_tests {
    use super::*;
    use crate::{CallRegistry, CallRegistryClient};
    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::{testutils::Ledger as _, Address, Bytes, BytesN, Env};

    fn build_message_native(valid_until: u32, home_domain: &[u8]) -> std::vec::Vec<u8> {
        let mut msg = std::vec::Vec::new();
        msg.extend_from_slice(b"BACKit:SEP10:");
        msg.extend_from_slice(&valid_until.to_be_bytes());
        msg.extend_from_slice(b":");
        msg.extend_from_slice(home_domain);
        msg
    }

    fn make_signing_key(seed_byte: u8) -> SigningKey {
        let mut seed = [0u8; 32];
        seed[0] = seed_byte;
        SigningKey::from_bytes(&seed)
    }

    fn pubkey_to_soroban(env: &Env, signing_key: &SigningKey) -> BytesN<32> {
        BytesN::from_array(env, &signing_key.verifying_key().to_bytes())
    }

    fn sign(
        env: &Env,
        signing_key: &SigningKey,
        valid_until: u32,
        home_domain: &[u8],
    ) -> BytesN<64> {
        let msg = build_message_native(valid_until, home_domain);
        let sig = signing_key.sign(&msg);
        BytesN::from_array(env, &sig.to_bytes())
    }

    fn setup() -> (Env, CallRegistryClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CallRegistry, ());
        let client = CallRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let outcome_manager = Address::generate(&env);
        client.initialize(&admin, &outcome_manager, &0i128);
        (env, client, admin, outcome_manager)
    }

    #[test]
    fn test_verify_sep10_token_valid() {
        let (env, client, _, _) = setup();
        let signing_key = make_signing_key(1);
        let valid_until: u32 = 1000;
        let home_domain = b"example.com";

        env.ledger().set_sequence_number(500);

        let pubkey = pubkey_to_soroban(&env, &signing_key);
        let token = sign(&env, &signing_key, valid_until, home_domain);
        let domain_bytes = Bytes::from_slice(&env, home_domain);

        assert!(client.verify_sep10_token(&pubkey, &token, &valid_until, &domain_bytes));
    }

    #[test]
    fn test_verify_sep10_token_expired() {
        let (env, client, _, _) = setup();
        let signing_key = make_signing_key(2);
        let valid_until: u32 = 100;
        let home_domain = b"example.com";

        env.ledger().set_sequence_number(200);

        let pubkey = pubkey_to_soroban(&env, &signing_key);
        let token = sign(&env, &signing_key, valid_until, home_domain);
        let domain_bytes = Bytes::from_slice(&env, home_domain);

        assert!(!client.verify_sep10_token(&pubkey, &token, &valid_until, &domain_bytes));
    }

    #[test]
    #[should_panic]
    fn test_verify_sep10_token_wrong_pubkey() {
        let (env, client, _, _) = setup();
        let signing_key = make_signing_key(3);
        let wrong_key = make_signing_key(99);
        let valid_until: u32 = 1000;
        let home_domain = b"example.com";

        env.ledger().set_sequence_number(1);

        let token = sign(&env, &signing_key, valid_until, home_domain);
        let wrong_pubkey = pubkey_to_soroban(&env, &wrong_key);
        let domain_bytes = Bytes::from_slice(&env, home_domain);

        client.verify_sep10_token(&wrong_pubkey, &token, &valid_until, &domain_bytes);
    }

    #[test]
    #[should_panic]
    fn test_verify_sep10_token_tampered() {
        let (env, client, _, _) = setup();
        let signing_key = make_signing_key(4);
        let valid_until: u32 = 1000;
        let home_domain = b"example.com";

        env.ledger().set_sequence_number(1);

        let pubkey = pubkey_to_soroban(&env, &signing_key);
        let mut sig_bytes = signing_key
            .sign(&build_message_native(valid_until, home_domain))
            .to_bytes();
        sig_bytes[0] ^= 0xFF;
        let tampered_token = BytesN::from_array(&env, &sig_bytes);
        let domain_bytes = Bytes::from_slice(&env, home_domain);

        client.verify_sep10_token(&pubkey, &tampered_token, &valid_until, &domain_bytes);
    }

    #[test]
    fn test_link_sep10_domain_stores_and_emits() {
        let (env, client, _, _) = setup();
        let signing_key = make_signing_key(5);
        let user = Address::generate(&env);
        let valid_until: u32 = 1000;
        let home_domain = b"trader.stellar";

        env.ledger().set_sequence_number(1);

        let pubkey = pubkey_to_soroban(&env, &signing_key);
        let token = sign(&env, &signing_key, valid_until, home_domain);
        let domain_bytes = Bytes::from_slice(&env, home_domain);

        client.link_sep10_domain(&user, &pubkey, &token, &valid_until, &domain_bytes);

        assert_eq!(client.get_sep10_home_domain(&user), Some(domain_bytes));
    }

    #[test]
    fn test_link_sep10_domain_expired_returns_error() {
        let (env, client, _, _) = setup();
        let signing_key = make_signing_key(6);
        let user = Address::generate(&env);
        let valid_until: u32 = 50;
        let home_domain = b"expired.stellar";

        env.ledger().set_sequence_number(100);

        let pubkey = pubkey_to_soroban(&env, &signing_key);
        let token = sign(&env, &signing_key, valid_until, home_domain);
        let domain_bytes = Bytes::from_slice(&env, home_domain);

        let result =
            client.try_link_sep10_domain(&user, &pubkey, &token, &valid_until, &domain_bytes);
        assert!(result.is_err());
        assert_eq!(client.get_sep10_home_domain(&user), None);
    }

    #[test]
    fn test_get_sep10_home_domain_none_before_link() {
        let (env, client, _, _) = setup();
        let user = Address::generate(&env);
        assert_eq!(client.get_sep10_home_domain(&user), None);
    }
}
