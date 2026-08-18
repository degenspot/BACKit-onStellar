//! # CallRegistry Contract
//!
//! The `call_registry` contract is the core escrow and prediction-market engine
//! for BACKit on Stellar. It manages the full lifecycle of a *prediction call*:
//!
//! 1. **Creation** -- a user opens a call by specifying a token pair, condition,
//!    stake amount, and deadline (`create_call`).
//! 2. **Staking** -- other users stake tokens on one of N discrete outcomes
//!    (`stake_on_call`). Native XLM and SAC-wrapped tokens are both supported.
//! 3. **Resolution** -- the trusted `OutcomeManager` submits the winning outcome
//!    and end price after the deadline (`resolve_call`).
//! 4. **Settlement** -- winners claim their proportional share via share tokens
//!    (`redeem_shares`) or the outcome manager releases escrow (`release_escrow`).
//!
//! ## Architecture
//!
//! | Module        | Responsibility                                         |
//! |---------------|--------------------------------------------------------|
//! | `lib.rs`      | Public contract entry-points (`#[contractimpl]`)       |
//! | `types.rs`    | Shared data types (`Call`, `ContractConfig`, ...)      |
//! | `storage.rs`  | Typed storage accessors                                |
//! | `events.rs`   | Event-emission helpers                                 |
//! | `admin.rs`    | Admin-gated parameter mutations                        |
//! | `shares.rs`   | Share-token deploy / mint / burn helpers               |
//! | `sep10.rs`    | SEP-10 JWT verification                                |
//! | `duration.rs` | Duration / TTL utilities                               |
//!
//! ## Native XLM support
//!
//! Native XLM is identified by the all-zero 32-byte sentinel address
//! (`CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4`).
//! Pass this as `stake_token` in `create_call` or `stake_on_call` to stake XLM.
#![no_std]
#![allow(deprecated)]

use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env, Map, Symbol, Vec};

/// The sentinel value used to represent native XLM as the stake token.
/// All-zero 32-byte array encoded as a contract Address via
/// `Address::from_contract_id(BytesN::<32>::from_array(&env, &[0u8; 32]))`.
///
/// Callers should pass this address in `stake_token` to indicate native XLM.
pub const NATIVE_XLM_SENTINEL: [u8; 32] = [0u8; 32];

/// Returns `true` when the supplied address is the all-zero sentinel for native XLM.
// AFTER
#[cfg(not(test))]
#[inline]
fn is_native_xlm(env: &Env, addr: &Address) -> bool {
    let sentinel = Address::from_string(&soroban_sdk::String::from_str(
        env,
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    ));
    *addr == sentinel
}

#[cfg(test)]
fn is_native_xlm(env: &Env, addr: &Address) -> bool {
    let key = soroban_sdk::Symbol::new(env, "xlm_sac_addr");
    if let Some(sentinel) = env.storage().instance().get::<_, Address>(&key) {
        return *addr == sentinel;
    }
    false
}

/// Transfer tokens from `from` to `to`, dispatching on whether the call uses
/// native XLM (via `StellarAssetClient`) or a SAC-wrapped token (`token::Client`).
fn transfer_token(env: &Env, stake_token: &Address, from: &Address, to: &Address, amount: i128) {
    if is_native_xlm(env, stake_token) {
        token::StellarAssetClient::new(env, stake_token).transfer(from, to, &amount);
    } else {
        token::Client::new(env, stake_token).transfer(from, to, &amount);
    }
}

mod admin;
mod duration;
mod errors;
mod events;
#[cfg(test)]
mod fuzz_tests;
mod governance;
mod reputation;
mod sep10;
mod shares;
mod storage;
#[cfg(test)]
mod test;
pub mod types;
mod withdrawal;

use backit_shared::{OUTCOME_DOWN, OUTCOME_UP};
use errors::CallRegistryError;
use events::*;
use storage::*;
use types::*;

macro_rules! reentrancy_guard {
    ($env:expr) => {
        if storage::is_locked($env) {
            return Err(CallRegistryError::ReentrancyDetected);
        }
        storage::acquire_lock($env);
    };
}

const MAX_CALL_PAGE_SIZE: u32 = 20;
const MAX_CALL_STAKERS_PAGE_SIZE: u32 = 50;
pub const CONTRACT_VERSION: u32 = 1;

/// CallRegistry contract implementation.
/// Manages prediction calls and staking on market outcomes.
#[contract]
pub struct CallRegistry;

fn build_start_price_message(env: &Env, call_id: u64, price: i128) -> Bytes {
    let mut raw = Bytes::from_slice(env, b"start_price:");
    raw.append(&Bytes::from_slice(env, &call_id.to_be_bytes()));
    raw.append(&Bytes::from_slice(env, &price.to_be_bytes()));
    raw
}

fn evaluate_condition_impl(condition: &ConditionType, start_price: i128, end_price: i128) -> bool {
    match condition {
        ConditionType::TargetAbove(target) => end_price > *target,
        ConditionType::TargetBelow(target) => end_price < *target,
        ConditionType::PercentUp(percent) => {
            if start_price <= 0 {
                return false;
            }
            end_price * 100 >= start_price * (100 + *percent as i128)
        }
        ConditionType::PercentDown(percent) => {
            if start_price <= 0 {
                return false;
            }
            end_price * 100 <= start_price * (100 - *percent as i128)
        }
        ConditionType::Range(min, max) => {
            if min > max {
                return false;
            }
            end_price >= *min && end_price <= *max
        }
    }
}

#[contractimpl]
impl CallRegistry {
    /// Initialise the contract with an admin and an outcome manager.
    /// # Errors
    /// * [`CallRegistryError::AlreadyInitialized`] – called more than once.
    pub fn initialize(
        env: Env,
        admin: Address,
        outcome_manager: Address,
        min_stake: i128,
    ) -> Result<(), CallRegistryError> {
        if get_config(&env).is_some() {
            return Err(CallRegistryError::AlreadyInitialized);
        }

        admin.require_auth();

        let config = ContractConfig {
            admin: admin.clone(),
            outcome_manager: outcome_manager.clone(),
            fee_bps: 0,
            max_stake_per_user: 0,
            whitelisted_tokens: Map::new(&env),
            min_stake,
            metadata_version: 0,
            paused: false,
            staking_cutoff_secs: 300,
            share_wasm_hash: None,
            resolution_grace_period: 604800,
            admin_set: Vec::new(&env),
            admin_threshold: 1,
            base_stake_limit: 0,
            reputation_multiplier: 0,
            global_gate_kind: None,
            global_gate_min_account_age: 0,
            global_gate_min_xlm_balance: 0,
            global_gate_min_trustlines: 0,
            global_gate_badge: None,
        };

        set_config(&env, &config);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &CONTRACT_VERSION);
        // Record the ledger sequence at contract deployment/initialization so
        // tests and gating logic can derive a sensible "first seen" fallback.
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "deployed_seq"), &env.ledger().sequence());
        // Track the 'version' instance key (Config key tracked inside set_config)
        inc_instance_entry_count(&env, 1);
        extend_storage_ttl(&env);

        env.events()
            .publish(("call_registry", "initialized"), (admin, outcome_manager));

        Ok(())
    }

    /// Test-only: register the XLM SAC address so is_native_xlm works in tests.
    pub fn set_xlm_sac_address(env: Env, xlm_sac: Address) {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "xlm_sac_addr"), &xlm_sac);
    }

    /// Set the share token WASM hash (admin only).
    /// Must be called after initialize before create_call can deploy share tokens.
    pub fn set_share_wasm_hash(
        env: Env,
        share_wasm_hash: BytesN<32>,
    ) -> Result<(), CallRegistryError> {
        let mut config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        config.admin.require_auth();
        config.share_wasm_hash = Some(share_wasm_hash);
        set_config(&env, &config);
        Ok(())
    }

    /// Create a new prediction call.
    /// # Errors
    /// * [`CallRegistryError::InvalidStakeAmount`] – `stake_amount` ≤ 0.
    /// * [`CallRegistryError::InvalidEndTime`] – `end_ts` is not in the future.
    /// * [`CallRegistryError::InvalidOutcomeCount`] – `outcome_count` < 2.
    pub fn create_call(
        env: Env,
        creator: Address,
        args: CallInitArgs,
    ) -> Result<Call, CallRegistryError> {
        creator.require_auth();
        reentrancy_guard!(&env);

        let CallInitArgs {
            stake_token,
            stake_amount,
            start_price,
            end_ts,
            token_address,
            pair_id,
            ipfs_cid,
            metadata_hash,
            condition,
            outcome_count,
            gate_kind,
            gate_min_account_age,
            gate_min_xlm_balance,
            gate_min_trustlines,
            gate_badge,
        } = args;

        let mut share_tokens = Map::new(&env);
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        assert!(!config.paused, "Contract is paused");
        if stake_amount < config.min_stake || stake_amount <= 0 {
            return Err(CallRegistryError::InvalidStakeAmount);
        }
        if start_price <= 0 {
            return Err(CallRegistryError::InvalidStakeAmount);
        }

        if outcome_count < 2 {
            return Err(CallRegistryError::InvalidOutcomeCount);
        }

        let current_timestamp = env.ledger().timestamp();
        if end_ts <= current_timestamp {
            return Err(CallRegistryError::InvalidEndTime);
        }
        duration::assert_duration_within_limit(&env, end_ts);

        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        // Native XLM (sentinel address) is always allowed; SAC tokens must be whitelisted.
        if !is_native_xlm(&env, &stake_token)
            && !config
                .whitelisted_tokens
                .get(stake_token.clone())
                .unwrap_or(false)
        {
            panic!("stake token not whitelisted");
        }
        let call_id = next_call_id(&env);

        let mut outcome_stakes = Map::new(&env);
        let mut stakes = Map::new(&env);

        // Initialize maps for each outcome
        for i in 1..=outcome_count {
            outcome_stakes.set(i, 0);
            stakes.set(i, Map::new(&env));
        }

        if let Some(ref wasm_hash) = config.share_wasm_hash {
            for i in 1..=outcome_count {
                let token_addr = shares::deploy_share_token(&env, wasm_hash, call_id, i);
                share_tokens.set(i, token_addr);
            }
        }

        let call = Call {
            id: call_id,
            creator: creator.clone(),
            stake_token: stake_token.clone(),
            stake_amount,
            end_ts,
            token_address: token_address.clone(),
            pair_id: pair_id.clone(),
            metadata_hash: metadata_hash.clone(),
            outcome_count,
            outcome_stakes,
            stakes,
            outcome: 0,
            start_price,
            end_price: 0,
            condition,
            settled: false,
            voided: false,
            created_at: current_timestamp,
            cancelled: false,
            metadata_version: 0,
            share_tokens,
            gate_kind,
            gate_min_account_age,
            gate_min_xlm_balance,
            gate_min_trustlines,
            gate_badge,
        };

        set_call(&env, &call);
        record_call_created(&env);

        // Track first interaction
        if get_account_first_seen(&env, &creator).is_none() {
            set_account_first_seen(&env, &creator, env.ledger().sequence());
        }

        // Track creator reputation: increment total_created
        let mut creator_stats = get_creator_stats(&env, &creator);
        creator_stats.total_created += 1;
        set_creator_stats(&env, &creator, &creator_stats);

        extend_storage_ttl(&env);

        if is_native_xlm(&env, &stake_token) {
            emit_xlm_call_created(
                &env,
                call_id,
                &creator,
                stake_amount,
                start_price,
                end_ts,
                &token_address,
                &pair_id,
                &metadata_hash,
                outcome_count,
            );
        } else {
            emit_call_created(
                &env,
                call_id,
                &creator,
                &stake_token,
                stake_amount,
                start_price,
                end_ts,
                &token_address,
                &pair_id,
                &metadata_hash,
                outcome_count,
            );
        }

        // Write immutable metadata to the contract's Stellar account DataEntries.
        // Key names: `call_{call_id}_cid` and `call_{call_id}_hash`.
        // We store base64(IPFS CID bytes) and base64(sha256(metadata fields)).
        // Implement a small base64 encoder that works in no_std using soroban vectors.
        fn encode_base64(env: &Env, input: &Bytes) -> Bytes {
            let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            let mut out_buf = [0u8; 128];
            let mut out_idx = 0;
            let mut i = 0u32;
            let input_len = input.len();
            while i + 3 <= input_len {
                if out_idx + 4 > out_buf.len() {
                    break;
                } // safety bound
                let b0 = input.get(i).unwrap_or(0);
                let b1 = input.get(i + 1).unwrap_or(0);
                let b2 = input.get(i + 2).unwrap_or(0);
                let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
                out_buf[out_idx] = table[((n >> 18) & 0x3F) as usize];
                out_buf[out_idx + 1] = table[((n >> 12) & 0x3F) as usize];
                out_buf[out_idx + 2] = table[((n >> 6) & 0x3F) as usize];
                out_buf[out_idx + 3] = table[(n & 0x3F) as usize];
                out_idx += 4;
                i += 3;
            }
            let rem = input_len - i;
            if rem == 1 && out_idx + 4 <= out_buf.len() {
                let b0 = input.get(i).unwrap_or(0);
                let n = (b0 as u32) << 16;
                out_buf[out_idx] = table[((n >> 18) & 0x3F) as usize];
                out_buf[out_idx + 1] = table[((n >> 12) & 0x3F) as usize];
                out_buf[out_idx + 2] = b'=';
                out_buf[out_idx + 3] = b'=';
                out_idx += 4;
            } else if rem == 2 && out_idx + 4 <= out_buf.len() {
                let b0 = input.get(i).unwrap_or(0);
                let b1 = input.get(i + 1).unwrap_or(0);
                let n = ((b0 as u32) << 16) | ((b1 as u32) << 8);
                out_buf[out_idx] = table[((n >> 18) & 0x3F) as usize];
                out_buf[out_idx + 1] = table[((n >> 12) & 0x3F) as usize];
                out_buf[out_idx + 2] = table[((n >> 6) & 0x3F) as usize];
                out_buf[out_idx + 3] = b'=';
                out_idx += 4;
            }
            Bytes::from_slice(env, &out_buf[..out_idx])
        }

        fn format_key(env: &Env, prefix: &[u8], id: u64, suffix: &[u8]) -> Bytes {
            let mut buf = [0u8; 64];
            let mut idx = 0;
            for &b in prefix {
                buf[idx] = b;
                idx += 1;
            }
            if id == 0 {
                buf[idx] = b'0';
                idx += 1;
            } else {
                let mut temp = id;
                let mut digits = [0u8; 20];
                let mut d_idx = 0;
                while temp > 0 {
                    digits[d_idx] = b'0' + (temp % 10) as u8;
                    temp /= 10;
                    d_idx += 1;
                }
                while d_idx > 0 {
                    d_idx -= 1;
                    buf[idx] = digits[d_idx];
                    idx += 1;
                }
            }
            for &b in suffix {
                buf[idx] = b;
                idx += 1;
            }
            Bytes::from_slice(env, &buf[..idx])
        }

        let key_cid = format_key(&env, b"call_", call_id, b"_cid");
        let key_hash = format_key(&env, b"call_", call_id, b"_hash");
        // Base64-encode the ipfs_cid and the metadata_hash raw bytes
        let cid_b64 = encode_base64(&env, &ipfs_cid);
        let raw_hash = Bytes::from_slice(&env, &metadata_hash.to_array());
        let hash_b64 = encode_base64(&env, &raw_hash);
        env.storage().persistent().set(&key_cid, &cid_b64);
        env.storage().persistent().set(&key_hash, &hash_b64);

        storage::release_lock(&env);
        Ok(call)
    }

    /// Documentation: DataEntry vs Soroban Storage
    /// * DataEntry: Use for immutable metadata (e.g. IPFS CID at call creation). Costs 0.5 XLM once, free to read off-chain.
    /// * Soroban Storage: Use for mutable state (e.g. stakes, resolution status) that the contract logic must update and read.
    ///
    /// Cost Comparison:
    /// Storing a 60-byte IPFS string in Soroban persistent storage inflates ledger size and increases rent.
    /// Using a 32-byte hash reference saves ~50% byte allocation in state, while the full CID is available
    /// freely off-chain in the account's classic DataEntry at a flat rate of 0.5 XLM (no recurring rent).
    /// View: retrieve a DataEntry from the contract's Stellar account for a call.
    /// Returns `None` when no entry exists for the key.
    pub fn get_call_data_entry(env: Env, _call_id: u64, key: Bytes) -> Option<Bytes> {
        env.storage().persistent().get(&key)
    }

    /// Update the metadata hash for an existing call (creator only).
    ///
    /// Can only be called while the call is still active (not settled, not
    /// cancelled, and `end_ts` has not passed). Each successful update
    /// increments `metadata_version`.
    ///
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] -- `call_id` does not exist.
    pub fn update_call_metadata(
        env: Env,
        creator: Address,
        call_id: u64,
        new_metadata_hash: BytesN<32>,
    ) -> Result<(), CallRegistryError> {
        creator.require_auth();
        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        if call.creator != creator {
            panic!("not the call creator");
        }
        if call.settled || call.cancelled {
            panic!("call is ended or cancelled");
        }
        let current_ts = env.ledger().timestamp();
        if current_ts >= call.end_ts {
            panic!("call has expired");
        }

        let old_hash = call.metadata_hash.clone();
        call.metadata_hash = new_metadata_hash.clone();
        call.metadata_version += 1;

        set_call(&env, &call);
        emit_call_metadata_updated(
            &env,
            call_id,
            &creator,
            &old_hash,
            &new_metadata_hash,
            call.metadata_version,
        );
        Ok(())
    }
    /// Extend the TTL of a specific call's persistent storage entry.
    /// Anyone may call this to prevent an active call from being archived.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn extend_call_ttl(env: Env, call_id: u64) -> Result<(), CallRegistryError> {
        let key = storage::DataKey::Call(call_id);
        if !env.storage().persistent().has(&key) {
            return Err(CallRegistryError::CallNotFound);
        }
        env.storage().persistent().extend_ttl(
            &key,
            storage::PERSISTENT_LIFETIME_THRESHOLD,
            storage::PERSISTENT_BUMP_AMOUNT,
        );
        Ok(())
    }

    /// Add a SAC token to the stake-token whitelist (admin only).
    ///
    /// Once whitelisted, the token may be used as `stake_token` in `create_call`.
    /// Native XLM is always implicitly allowed and does not need whitelisting.
    pub fn whitelist_token(env: Env, token_address: Address) {
        admin::whitelist_token(env, token_address);
    }

    /// Remove a SAC token from the stake-token whitelist (admin only).
    ///
    /// Existing calls that already use this token are unaffected.
    pub fn remove_token(env: Env, token_address: Address) {
        admin::remove_token(env, token_address);
    }

    /// Return `true` if `token_address` is currently on the whitelist.
    pub fn is_token_whitelisted(env: Env, token_address: Address) -> bool {
        let config = get_config(&env).expect("not initialized");
        config
            .whitelisted_tokens
            .get(token_address)
            .unwrap_or(false)
    }

    /// Add stake to an existing call.
    /// # Errors
    /// * [`CallRegistryError::InvalidStakeAmount`] – `amount` ≤ 0.
    /// * [`CallRegistryError::CallNotFound`]        – `call_id` does not exist.
    /// * [`CallRegistryError::CallEnded`]           – call's `end_ts` has passed.
    /// * [`CallRegistryError::CallSettled`]         – call is already settled.
    /// * [`CallRegistryError::InvalidPosition`]     – `position` ∉ [1, outcome_count].
    pub fn stake_on_call(
        env: Env,
        staker: Address,
        call_id: u64,
        amount: i128,
        position: u32,
    ) -> Result<Call, CallRegistryError> {
        staker.require_auth();
        reentrancy_guard!(&env);

        if amount <= 0 {
            return Err(CallRegistryError::InvalidStakeAmount);
        }

        let config = get_config(&env).expect("not initialized");
        assert!(!config.paused, "Contract is paused");
        if amount < config.min_stake {
            panic!("stake below minimum");
        }

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        let current_timestamp = env.ledger().timestamp();
        if current_timestamp >= call.end_ts {
            return Err(CallRegistryError::CallEnded);
        }

        // Staking cutoff: reject stakes within `staking_cutoff_secs` of end_ts.
        let cutoff = config.staking_cutoff_secs;
        if cutoff > 0 && call.end_ts > cutoff && current_timestamp >= call.end_ts - cutoff {
            return Err(CallRegistryError::StakingCutoffActive);
        }

        if call.settled {
            return Err(CallRegistryError::CallSettled);
        }

        if call.cancelled {
            panic!("Call has been cancelled");
        }

        if call.voided {
            panic!("Call has been voided");
        }

        // Validate position is within valid range
        if position < 1 || position > call.outcome_count {
            return Err(CallRegistryError::InvalidPosition);
        }

        // Track first interaction
        if get_account_first_seen(&env, &staker).is_none() {
            let deployed_seq: u32 = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "deployed_seq"))
                .unwrap_or(env.ledger().sequence());
            set_account_first_seen(&env, &staker, deployed_seq);
        }

        if !Self::check_user_qualifies(env.clone(), staker.clone(), call_id) {
            panic!("User does not meet the staking gate requirements");
        }

        let mut outcome_stakers = call.stakes.get(position).unwrap_or_else(|| Map::new(&env));
        let staker_key = staker.clone();
        let current_staker_stake = outcome_stakers.get(staker_key.clone()).unwrap_or(0);
        let updated_staker_stake = current_staker_stake + amount;

        // Reputation-weighted individual stake cap (per call, per position).
        // Replaces the old flat `max_stake_per_user`-only check: the user's
        // personal limit now scales with their on-chain prediction accuracy
        // and historical stake volume (see `reputation` module), while
        // `max_stake_per_user`, if configured, still acts as an absolute
        // outer ceiling on top of it.
        let staker_stats = get_creator_stats(&env, &staker);
        let staker_volume = get_user_total_stake_volume(&env, &staker);
        let effective_limit = reputation::effective_stake_limit(
            &env,
            config.base_stake_limit,
            config.reputation_multiplier,
            config.max_stake_per_user,
            &staker_stats,
            staker_volume,
        );
        if updated_staker_stake > effective_limit {
            panic!("Stake exceeds reputation-weighted stake limit");
        }

        // Transfer tokens in — supports both native XLM and SAC-wrapped tokens.
        transfer_token(
            &env,
            &call.stake_token,
            &staker,
            &env.current_contract_address(),
            amount,
        );

        if let Some(share_token) = call.share_tokens.get(position) {
            shares::mint_shares(&env, &share_token, &staker, amount);
            emit_shares_minted(&env, call_id, &staker, position, amount);
        }

        // Update stake maps with generalized position support
        let current_total = call.outcome_stakes.get(position).unwrap_or(0);
        call.outcome_stakes.set(position, current_total + amount);

        outcome_stakers.set(staker_key.clone(), updated_staker_stake);
        call.stakes.set(position, outcome_stakers);

        add_call_staker(&env, call_id, &staker);
        set_user_stake(&env, call_id, &staker, position, updated_staker_stake);

        set_call(&env, &call);
        add_staker_call(&env, &staker, call_id);
        record_stake(&env, &staker, amount);
        record_user_stake_volume(&env, &staker, amount);
        extend_storage_ttl(&env);

        // Emit distinct XLM event so the indexer can differentiate XLM from USDC volume.
        if is_native_xlm(&env, &call.stake_token) {
            emit_xlm_stake_added(&env, call_id, &staker, amount, position);
        } else {
            emit_stake_added(&env, call_id, &staker, amount, position);
        }

        storage::release_lock(&env);
        Ok(call)
    }

    /// Redeem winning share tokens for a proportional payout.
    ///
    /// Burns the redeemer's winning share-token balance and transfers the
    /// corresponding fraction of the total stake pool back to the redeemer.
    ///
    /// **Payout formula:** `balance * total_all_stakes / total_winning_stakes`
    ///
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] -- `call_id` does not exist.
    pub fn redeem_shares(
        env: Env,
        redeemer: Address,
        call_id: u64,
    ) -> Result<i128, CallRegistryError> {
        redeemer.require_auth();

        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        if call.outcome == 0 {
            panic!("call not yet resolved");
        }
        if !call.settled {
            panic!("call not yet settled");
        }

        let winning_outcome = call.outcome;
        let share_token = match call.share_tokens.get(winning_outcome) {
            Some(t) => t,
            None => panic!("share tokens not configured for this call"),
        };

        // Check redeemer's winning share balance
        let balance = shares::share_balance(&env, &share_token, &redeemer);
        if balance <= 0 {
            panic!("no winning shares to redeem");
        }

        // Total winning pool and total stakes
        let total_winning_stakes = call.outcome_stakes.get(winning_outcome).unwrap_or(0);
        let total_all_stakes: i128 = (1..=call.outcome_count)
            .map(|i| call.outcome_stakes.get(i).unwrap_or(0))
            .sum();

        // Payout: redeemer's share of winning pool gets proportional total pot
        // Each winning share is worth: total_all_stakes / total_winning_stakes
        let payout = if total_winning_stakes > 0 {
            (balance as i128) * total_all_stakes / total_winning_stakes
        } else {
            0
        };

        if payout <= 0 {
            panic!("zero payout");
        }

        // Burn the winning shares
        shares::burn_shares(&env, &share_token, &redeemer, balance);

        // Transfer payout from contract to redeemer
        transfer_token(
            &env,
            &call.stake_token,
            &env.current_contract_address(),
            &redeemer,
            payout,
        );

        emit_shares_redeemed(&env, call_id, &redeemer, winning_outcome, balance);

        Ok(payout)
    }

    /// Transfer outcome share tokens from one address to another.
    ///
    /// Allows secondary trading of outcome positions before a call is resolved.
    ///
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`]    -- `call_id` does not exist.
    /// * [`CallRegistryError::InvalidPosition`] -- `outcome` outside [1, outcome_count].
    /// * [`CallRegistryError::NotInitialized`]  -- share tokens not deployed.
    pub fn transfer_shares(
        env: Env,
        from: Address,
        to: Address,
        call_id: u64,
        outcome: u32,
        amount: i128,
    ) -> Result<(), CallRegistryError> {
        from.require_auth();

        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        if outcome < 1 || outcome > call.outcome_count {
            return Err(CallRegistryError::InvalidPosition);
        }

        let share_token = match call.share_tokens.get(outcome) {
            Some(t) => t,
            None => return Err(CallRegistryError::NotInitialized), // or a dedicated error
        };

        soroban_sdk::token::Client::new(&env, &share_token).transfer(&from, &to, &amount);

        emit_shares_transferred(&env, call_id, &from, &to, outcome, amount);

        Ok(())
    }

    /// Set the maximum individual stake per user per position per call (admin only).
    /// Pass `0` to remove the cap.
    ///
    /// This remains a separate, absolute ceiling on top of the
    /// reputation-weighted personal limit — see `set_reputation_params` and
    /// the `reputation` module doc comment for how the two combine.
    pub fn set_max_stake_per_user(env: Env, new_max: i128) {
        admin::set_max_stake_per_user(env, new_max);
    }

    /// Set reputation-weighted staking-limit parameters (admin only).
    ///
    /// * `base_limit` — the personal stake ceiling (per call, per position)
    ///   for brand-new users, and the baseline the reputation multiplier
    ///   scales from. Pass `0` to disable the reputation-weighted system
    ///   entirely (only `max_stake_per_user`, if any, will apply).
    /// * `multiplier` — reputation multiplier in basis points (`10_000` ==
    ///   `1.0`). See the `reputation` module for the exact fixed-point
    ///   formula.
    ///
    /// # Panics
    /// * Contract not initialized.
    /// * `base_limit` is negative.
    pub fn set_reputation_params(env: Env, base_limit: i128, multiplier: u32) {
        reputation::set_reputation_params(env, base_limit, multiplier);
    }

    /// View: the reputation-weighted individual stake limit (per call, per
    /// position) currently enforced for `user` in `stake_on_call`, after
    /// combining the reputation formula with `max_stake_per_user` (if
    /// configured). Returns `i128::MAX` when no cap applies at all.
    pub fn get_user_stake_limit(env: Env, user: Address) -> i128 {
        reputation::get_user_stake_limit(&env, &user)
    }

    /// Set the minimum stake required per staking action (admin only).
    ///
    /// Both `create_call` and `stake_on_call` enforce this floor.
    pub fn set_min_stake(env: Env, new_min_stake: i128) {
        admin::set_min_stake(env, new_min_stake);
    }

    /// Pause the contract (admin only).
    pub fn pause(env: Env) {
        admin::pause(env);
    }

    /// Unpause the contract (admin only).
    pub fn unpause(env: Env) {
        admin::unpause(env);
    }

    /// Set the staking cutoff window in seconds before `end_ts` (admin only).
    /// Staking is blocked when `current_timestamp >= call.end_ts - new_cutoff`.
    /// Pass `0` to disable the cutoff.
    pub fn set_staking_cutoff(env: Env, new_cutoff: u64) {
        admin::set_staking_cutoff(env, new_cutoff);
    }

    /// Propose a multisig admin operation.
    pub fn propose_admin_operation(
        env: Env,
        proposer: Address,
        operation: types::Operation,
        timelock_seconds: u64,
    ) -> Result<u64, CallRegistryError> {
        admin::propose_admin_operation(env, proposer, operation, timelock_seconds)
    }

    /// Approve a proposal.
    pub fn approve_admin_proposal(
        env: Env,
        admin_addr: Address,
        proposal_id: u64,
    ) -> Result<(), CallRegistryError> {
        admin::approve_admin_proposal(env, admin_addr, proposal_id)
    }

    /// Veto a proposal.
    pub fn veto_admin_proposal(
        env: Env,
        admin_addr: Address,
        proposal_id: u64,
    ) -> Result<(), CallRegistryError> {
        admin::veto_admin_proposal(env, admin_addr, proposal_id)
    }

    /// Execute a proposal after timelock and approvals.
    pub fn execute_admin_proposal(
        env: Env,
        caller: Address,
        proposal_id: u64,
    ) -> Result<(), CallRegistryError> {
        admin::execute_admin_proposal(env, caller, proposal_id)
    }

    /// Cancel a proposal when timelock expired without sufficient approvals.
    pub fn cancel_admin_proposal(
        env: Env,
        caller: Address,
        proposal_id: u64,
    ) -> Result<(), CallRegistryError> {
        admin::cancel_admin_proposal(env, caller, proposal_id)
    }

    /// Set the maximum allowed call duration in seconds (admin only).
    /// Defaults to 30 days (2_592_000 s). Emits AdminParamsChanged.
    pub fn set_max_duration(env: Env, admin: Address, max_duration_secs: u64) {
        duration::set_max_duration(&env, admin, max_duration_secs);
    }

    /// Get the current maximum allowed call duration in seconds.
    pub fn get_max_duration(env: Env) -> u64 {
        duration::get_max_duration(&env)
    }

    /// Resolve a call with an outcome (outcome_manager only).
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] – contract not initialised.
    /// * [`CallRegistryError::CallNotFound`]   – `call_id` does not exist.
    /// * [`CallRegistryError::InvalidOutcome`] – `outcome` ∉ [1, outcome_count].
    /// * [`CallRegistryError::CallNotEnded`]   – `end_ts` has not yet passed.
    pub fn resolve_call(
        env: Env,
        call_id: u64,
        outcome: u32,
        end_price: i128,
    ) -> Result<Call, CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        assert!(!config.paused, "Contract is paused");
        config.outcome_manager.require_auth();
        reentrancy_guard!(&env);

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        // Validate outcome is within valid range
        if outcome < 1 || outcome > call.outcome_count {
            return Err(CallRegistryError::InvalidOutcome);
        }

        let current_timestamp = env.ledger().timestamp();
        if current_timestamp < call.end_ts {
            return Err(CallRegistryError::CallNotEnded);
        }

        if call.voided {
            panic!("Call has been voided");
        }

        call.outcome = outcome;
        call.end_price = end_price;

        // Track creator reputation: increment total_resolved and conditionally total_correct
        let mut creator_stats = get_creator_stats(&env, &call.creator);
        let old_creator_stats = creator_stats.clone();
        creator_stats.total_resolved += 1;

        // Check if creator staked on the winning position
        let creator_winning_stake = match outcome {
            OUTCOME_UP => get_user_stake(&env, call.id, &call.creator, 1),
            OUTCOME_DOWN => get_user_stake(&env, call.id, &call.creator, 2),
            _ => 0,
        };

        if creator_winning_stake > 0 {
            creator_stats.total_correct += 1;
        }

        set_creator_stats(&env, &call.creator, &creator_stats);

        // Reputation stats just changed — recompute the creator's
        // reputation-weighted stake limit and emit `StakeLimitUpdated` if it
        // actually moved (e.g. crossing the "proven user" resolved-call
        // threshold, or accuracy shifting enough to change the limit).
        let creator_volume = get_user_total_stake_volume(&env, &call.creator);
        reputation::maybe_emit_stake_limit_updated(
            &env,
            &call.creator,
            &config,
            &old_creator_stats,
            &creator_stats,
            creator_volume,
        );

        set_call(&env, &call);
        extend_storage_ttl(&env);

        emit_call_resolved(&env, call_id, outcome, end_price);

        storage::release_lock(&env);
        Ok(call)
    }

    /// Mark a call as settled (outcome_manager only).
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] – contract not initialised.
    /// * [`CallRegistryError::CallNotFound`]   – `call_id` does not exist.
    /// * [`CallRegistryError::CallSettled`]     – call is already settled.
    pub fn mark_settled(env: Env, call_id: u64) -> Result<(), CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        config.outcome_manager.require_auth();

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        if call.settled {
            return Err(CallRegistryError::CallSettled);
        }

        call.settled = true;
        set_call(&env, &call);

        Ok(())
    }

    /// Release escrowed tokens to a recipient (outcome_manager only).
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] – contract not initialised.
    /// * [`CallRegistryError::CallNotFound`]   – `call_id` does not exist.
    pub fn release_escrow(
        env: Env,
        call_id: u64,
        to: Address,
        amount: i128,
    ) -> Result<(), CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        config.outcome_manager.require_auth();

        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        // Dispatch to native XLM or SAC-wrapped token path.
        transfer_token(
            &env,
            &call.stake_token,
            &env.current_contract_address(),
            &to,
            amount,
        );

        // Emit a distinct XLM event so the indexer can track XLM payout volume.
        if is_native_xlm(&env, &call.stake_token) {
            emit_xlm_escrow_released(&env, call_id, &to, amount);
        }

        Ok(())
    }

    /// Transfer admin privileges to a new address (admin only).
    /// # Errors
    /// Propagates errors from [`admin::set_admin`].
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), CallRegistryError> {
        admin::set_admin(env, new_admin)
    }

    /// Configure multi-party admin set and threshold (requires current admin signature).
    /// Threshold=1 is backward-compatible single-admin behavior. Max 10 admins.
    /// Emits AdminSetUpdated event.
    pub fn set_admin_set(
        env: Env,
        new_admins: Vec<Address>,
        new_threshold: u32,
    ) -> Result<(), CallRegistryError> {
        let mut config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        // Require existing admin (or threshold signatures in future iterations)
        config.admin.require_auth();
        if new_threshold == 0 || new_threshold as usize > new_admins.len() as usize {
            panic!("threshold must be >= 1 and <= admin_set length");
        }
        config.admin_set = new_admins.clone();
        config.admin_threshold = new_threshold;
        set_config(&env, &config);
        env.events().publish(
            ("call_registry", "AdminSetUpdated"),
            (new_admins, new_threshold),
        );
        Ok(())
    }

    /// Return the current admin set and threshold.
    pub fn get_admin_set(env: Env) -> Result<(Vec<Address>, u32), CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        Ok((config.admin_set, config.admin_threshold))
    }

    // ── On-Chain Governance ──────────────────────────────────────────────────

    /// Create a governance proposal to change a contract parameter.
    /// Proposer must have at least `proposal_threshold` total stake volume.
    pub fn propose_change(
        env: Env,
        proposer: Address,
        parameter: Symbol,
        new_value_bytes: soroban_sdk::Bytes,
        voting_end_ledger: u32,
        proposer_stake_volume: i128,
    ) -> u64 {
        governance::propose_change(
            &env,
            proposer,
            parameter,
            new_value_bytes,
            voting_end_ledger,
            proposer_stake_volume,
        )
    }

    /// Cast a vote on a governance proposal. Voting power = voter's stake volume.
    pub fn governance_vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        support: bool,
        voter_stake_volume: i128,
    ) {
        governance::vote(&env, voter, proposal_id, support, voter_stake_volume)
    }

    /// Execute a passed proposal after the voting period ends.
    pub fn execute_proposal(env: Env, proposal_id: u64, total_platform_stake: i128) {
        governance::execute_proposal(&env, proposal_id, total_platform_stake);
    }

    /// Get a specific proposal by ID.
    pub fn get_proposal(env: Env, proposal_id: u64) -> governance::GovernanceProposal {
        governance::get_proposal(&env, proposal_id)
    }

    /// Get all currently active (open) proposals.
    pub fn get_active_proposals(env: Env) -> Vec<governance::GovernanceProposal> {
        governance::get_active_proposals(&env)
    }

    /// Update governance configuration (admin only).
    pub fn set_governance_config(
        env: Env,
        cfg: governance::GovernanceConfig,
    ) -> Result<(), CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        governance::set_governance_config(&env, &config.admin, cfg);
        Ok(())
    }
    /// Replace the outcome manager (admin only).
    /// # Errors
    /// Propagates errors from [`admin::set_outcome_manager`].
    pub fn set_outcome_manager(env: Env, new_manager: Address) -> Result<(), CallRegistryError> {
        admin::set_outcome_manager(env, new_manager)
    }

    /// Set the protocol fee in basis points, e.g. 100 = 1 % (admin only).
    /// # Errors
    /// Propagates errors from [`admin::set_fee`].
    pub fn set_fee(env: Env, new_fee_bps: u32) -> Result<(), CallRegistryError> {
        admin::set_fee(env, new_fee_bps)
    }

    /// Get current contract configuration.
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] – contract not initialised.
    pub fn get_config(env: Env) -> Result<ContractConfig, CallRegistryError> {
        get_config(&env).ok_or(CallRegistryError::NotInitialized)
    }

    /// Get call data by ID.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn get_call(env: Env, call_id: u64) -> Result<Call, CallRegistryError> {
        get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)
    }

    /// Retrieve the metadata hash (IPFS CID hash) for a specific call.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn get_call_metadata_hash(env: Env, call_id: u64) -> Result<BytesN<32>, CallRegistryError> {
        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        Ok(call.metadata_hash)
    }

    /// Get the condition type for a specific call.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn get_condition(env: Env, call_id: u64) -> Result<ConditionType, CallRegistryError> {
        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        Ok(call.condition)
    }

    /// Evaluate whether price movement satisfies the supplied condition.
    pub fn evaluate_condition(
        _env: Env,
        condition: ConditionType,
        start_price: i128,
        end_price: i128,
    ) -> bool {
        evaluate_condition_impl(&condition, start_price, end_price)
    }

    /// Get all calls created by a specific address (unbounded scan — prefer paginated variant).
    pub fn get_calls_by_creator(env: Env, creator: Address) -> Vec<Call> {
        let mut calls = Vec::new(&env);
        let total_calls = get_call_counter(&env);

        for i in 1..=total_calls {
            if let Some(call) = get_call(&env, i) {
                if call.creator == creator {
                    calls.push_back(call);
                }
            }
        }

        calls
    }

    /// Get a paginated slice of calls starting at `start_id`.
    /// Returns at most [`MAX_CALL_PAGE_SIZE`] calls.
    pub fn get_calls_paginated(env: Env, start_id: u64, limit: u32) -> Vec<Call> {
        let mut calls = Vec::new(&env);
        let total_calls = get_call_counter(&env);
        let page_size = limit.min(MAX_CALL_PAGE_SIZE);

        if page_size == 0 || total_calls == 0 {
            return calls;
        }

        let start = if start_id < 1 { 1 } else { start_id };
        if start > total_calls {
            return calls;
        }
        let end = start.saturating_add(page_size as u64 - 1).min(total_calls);

        for current in start..=end {
            if let Some(call) = get_call(&env, current) {
                calls.push_back(call);
            }
        }

        calls
    }

    /// Get a paginated slice of calls created by a specific address.
    /// Returns at most [`MAX_CALL_PAGE_SIZE`] calls starting from `start_id`.
    pub fn get_calls_by_creator_paginated(
        env: Env,
        creator: Address,
        start_id: u64,
        limit: u32,
    ) -> Vec<Call> {
        let mut calls = Vec::new(&env);
        let total_calls = get_call_counter(&env);
        let page_size = limit.min(MAX_CALL_PAGE_SIZE);

        if page_size == 0 {
            return calls;
        }

        let mut count = 0;
        let mut current = if start_id < 1 { 1 } else { start_id };

        while count < page_size && current <= total_calls {
            if let Some(call) = get_call(&env, current) {
                if call.creator == creator {
                    calls.push_back(call);
                    count += 1;
                }
            }
            current += 1;
        }

        calls
    }

    /// Get statistics for a specific call.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn get_call_stats(env: Env, call_id: u64) -> Result<CallStats, CallRegistryError> {
        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        let mut outcome_stake_counts = Map::new(&env);
        let mut total_stakes = 0;

        for i in 1..=call.outcome_count {
            let outcome_stakers = call.stakes.get(i).unwrap_or_else(|| Map::new(&env));
            let count = outcome_stakers.len();
            outcome_stake_counts.set(i, count);
            total_stakes += count;
        }

        Ok(CallStats {
            outcome_stakes: call.outcome_stakes,
            outcome_stake_counts,
            total_stakes,
        })
    }

    /// Get creator reputation statistics
    pub fn get_creator_stats_view(env: Env, creator: Address) -> CreatorStats {
        get_creator_stats(&env, &creator)
    }

    /// Get all calls a staker has participated in.
    pub fn get_staker_calls(env: Env, staker: Address) -> Vec<Call> {
        let call_ids = get_staker_calls(&env, &staker);
        let mut calls = Vec::new(&env);

        for call_id in call_ids.iter() {
            if let Some(call) = get_call(&env, call_id) {
                calls.push_back(call);
            }
        }

        calls
    }

    /// Get all stakers that have participated in a call.
    pub fn get_call_stakers(env: Env, call_id: u64) -> Result<Vec<Address>, CallRegistryError> {
        get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        Ok(storage::get_call_stakers_bounded(
            &env,
            call_id,
            0,
            MAX_CALL_STAKERS_PAGE_SIZE,
        ))
    }

    /// Get a bounded page of stakers that have participated in a call.
    pub fn get_call_stakers_paginated(
        env: Env,
        call_id: u64,
        start: u32,
        limit: u32,
    ) -> Result<Vec<Address>, CallRegistryError> {
        get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        Ok(storage::get_call_stakers_bounded(
            &env,
            call_id,
            start,
            limit.min(MAX_CALL_STAKERS_PAGE_SIZE),
        ))
    }

    /// Get the number of unique stakers that have participated in a call.
    pub fn get_call_staker_count(env: Env, call_id: u64) -> Result<u32, CallRegistryError> {
        get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        Ok(storage::get_call_stakers(&env, call_id).len() as u32)
    }

    /// Get the stake amount a staker has on a specific call position.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`]    – `call_id` does not exist.
    /// * [`CallRegistryError::InvalidPosition`] – `position` ∉ [1, outcome_count].
    pub fn get_staker_stake(
        env: Env,
        call_id: u64,
        staker: Address,
        position: u32,
    ) -> Result<i128, CallRegistryError> {
        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        if position < 1 || position > call.outcome_count {
            return Err(CallRegistryError::InvalidPosition);
        }

        let outcome_stakers = call.stakes.get(position).unwrap_or_else(|| Map::new(&env));
        Ok(outcome_stakers.get(staker).unwrap_or(0))
    }

    /// Get the total stakes for each outcome of a call.
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] – `call_id` does not exist.
    pub fn get_outcome_stakes(env: Env, call_id: u64) -> Result<Map<u32, i128>, CallRegistryError> {
        let call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        Ok(call.outcome_stakes)
    }

    /// Get total number of calls created.
    pub fn get_call_count(env: Env) -> u64 {
        get_call_counter(&env)
    }

    /// Get contract-wide aggregated statistics.
    pub fn get_global_stats(env: Env) -> GlobalStats {
        storage::get_global_stats(&env)
    }

    /// Set or correct a call's start price using an oracle-signed payload.
    pub fn set_start_price(
        env: Env,
        call_id: u64,
        price: i128,
        oracle_pubkey: BytesN<32>,
        signature: BytesN<64>,
    ) -> Result<Call, CallRegistryError> {
        if price <= 0 {
            return Err(CallRegistryError::InvalidStakeAmount);
        }

        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        config.outcome_manager.require_auth();

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;
        if call.settled {
            return Err(CallRegistryError::CallSettled);
        }
        if call.cancelled {
            panic!("Call has been cancelled");
        }
        if call.voided {
            panic!("Call has been voided");
        }

        let message = build_start_price_message(&env, call_id, price);
        env.crypto()
            .ed25519_verify(&oracle_pubkey, &message, &signature);

        call.start_price = price;
        set_call(&env, &call);
        extend_storage_ttl(&env);

        Ok(call)
    }

    /// Return the number of entries currently tracked in instance storage.
    pub fn get_instance_entry_count(env: Env) -> u32 {
        storage::get_instance_entry_count(&env)
    }

    /// Return a storage utilisation snapshot.
    /// Emits `StorageWarning` if instance entries exceed the threshold.
    pub fn get_storage_stats(env: Env) -> StorageStats {
        let stats = storage::get_storage_stats(&env);
        if stats.instance_entry_count >= INSTANCE_ENTRY_WARNING_THRESHOLD {
            events::emit_storage_warning(
                &env,
                stats.instance_entry_count,
                stats.estimated_instance_bytes,
            );
        }
        stats
    }

    /// Return the current contract version.
    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "version"))
            .unwrap_or(CONTRACT_VERSION)
    }

    /// Upgrade the contract WASM to a new hash (admin only).
    ///
    /// # Errors
    /// * [`CallRegistryError::NotInitialized`] -- contract not initialised.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), CallRegistryError> {
        let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
        config.admin.require_auth();

        let old_version: u32 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "version"))
            .unwrap_or(CONTRACT_VERSION);
        let new_version = old_version + 1;

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &new_version);

        emit_contract_upgraded(&env, old_version, new_version, &config.admin);

        Ok(())
    }

    /// Cancel a call before any third-party stakes have been placed (creator only).
    ///
    /// Refunds the creator's escrowed `stake_amount` and marks the call as cancelled.
    ///
    /// # Errors
    /// * [`CallRegistryError::CallNotFound`] -- `call_id` does not exist.
    ///
    /// # Panics
    /// * If the caller is not the call creator.
    /// * If any outcome has been staked on by a third party.
    /// * If the call is already settled or cancelled.
    pub fn cancel_call(env: Env, creator: Address, call_id: u64) -> Result<(), CallRegistryError> {
        creator.require_auth();
        reentrancy_guard!(&env);

        let mut call = get_call(&env, call_id).ok_or(CallRegistryError::CallNotFound)?;

        if call.creator != creator {
            panic!("not the call creator");
        }
        if call.settled {
            panic!("call is already settled");
        }
        if call.cancelled {
            panic!("call is already cancelled");
        }

        // Reject if any third-party stake has been placed on any outcome.
        let total_staked: i128 = (1..=call.outcome_count)
            .map(|i| call.outcome_stakes.get(i).unwrap_or(0))
            .sum();
        if total_staked > 0 {
            panic!("cannot cancel call with active stakes");
        }

        let stake_amount = call.stake_amount;
        call.cancelled = true;
        set_call(&env, &call);
        extend_storage_ttl(&env);

        // Refund the creator's escrowed stake.
        transfer_token(
            &env,
            &call.stake_token,
            &env.current_contract_address(),
            &creator,
            stake_amount,
        );

        if is_native_xlm(&env, &call.stake_token) {
            emit_xlm_call_cancelled(&env, call_id, &creator, stake_amount);
        } else {
            emit_call_cancelled(&env, call_id, &creator, stake_amount);
        }

        storage::release_lock(&env);
        Ok(())
    }

    /// Void a call (admin only). Can be called at any time.
    /// Once voided, no new stakes or resolutions are accepted.
    /// Emits CallVoided.
    pub fn void_call(env: Env, call_id: u64) {
        let config = get_config(&env).expect("Not initialized");
        config.admin.require_auth();

        let mut call = get_call(&env, call_id).expect("Call not found");

        if call.voided {
            panic!("Call already voided");
        }

        if call.settled {
            panic!("Call already settled");
        }

        call.voided = true;
        set_call(&env, &call);
        extend_storage_ttl(&env);

        emit_call_voided(&env, call_id, &config.admin);
    }

    /// Claim a full refund for a voided call.
    /// Refunds the exact stake the caller placed (up + down combined).
    /// Emits VoidRefundClaimed.
    pub fn claim_void_refund(env: Env, staker: Address, call_id: u64) {
        staker.require_auth();

        let call = get_call(&env, call_id).expect("Call not found");

        if !call.voided {
            panic!("Call is not voided");
        }

        if is_void_refund_claimed(&env, call_id, &staker) {
            panic!("Refund already claimed");
        }

        let up_stake = get_user_stake(&env, call_id, &staker, 1);
        let down_stake = get_user_stake(&env, call_id, &staker, 2);
        let total_refund = up_stake + down_stake;

        if total_refund <= 0 {
            panic!("No stake to refund");
        }

        set_void_refund_claimed(&env, call_id, &staker);
        extend_storage_ttl(&env);

        // Dispatch to native XLM or SAC-wrapped token path.
        transfer_token(
            &env,
            &call.stake_token,
            &env.current_contract_address(),
            &staker,
            total_refund,
        );

        if is_native_xlm(&env, &call.stake_token) {
            emit_xlm_void_refund_claimed(&env, call_id, &staker, total_refund);
        } else {
            emit_void_refund_claimed(&env, call_id, &staker, total_refund);
        }
    }

    /// Claim a full refund for an expired call that was never resolved/settled.
    /// Only callable after `end_ts + resolution_grace_period` has passed and the
    /// call has not been settled. Refunds the exact stake (no penalty, no profit).
    /// Emits ExpiredRefundClaimed.
    pub fn claim_expired_refund(env: Env, staker: Address, call_id: u64) {
        staker.require_auth();

        let call = get_call(&env, call_id).expect("Call not found");
        let config = get_config(&env).expect("not initialized");

        let current_timestamp = env.ledger().timestamp();
        let grace_deadline = call.end_ts + config.resolution_grace_period;

        if current_timestamp <= grace_deadline {
            panic!("Grace period has not elapsed");
        }

        if call.settled {
            panic!("Call is already settled");
        }

        if call.voided {
            panic!("Call is voided; use claim_void_refund");
        }

        if is_expired_refund_claimed(&env, call_id, &staker) {
            panic!("Refund already claimed");
        }

        let mut total_refund: i128 = 0;
        for position in 1..=call.outcome_count {
            total_refund += get_user_stake(&env, call_id, &staker, position);
        }

        if total_refund <= 0 {
            panic!("No stake to refund");
        }

        set_expired_refund_claimed(&env, call_id, &staker);
        extend_storage_ttl(&env);

        transfer_token(
            &env,
            &call.stake_token,
            &env.current_contract_address(),
            &staker,
            total_refund,
        );

        if is_native_xlm(&env, &call.stake_token) {
            emit_xlm_expired_refund_claimed(&env, call_id, &staker, total_refund);
        } else {
            emit_expired_refund_claimed(&env, call_id, &staker, total_refund);
        }
    }

    /// Returns the sentinel `Address` that represents native XLM.
    /// Pass this as `stake_token` in `create_call` or `stake_on_call` to use native XLM.
    pub fn native_xlm_address(env: Env) -> Address {
        #[cfg(test)]
        {
            use soroban_sdk::Symbol;
            if let Some(addr) = env
                .storage()
                .instance()
                .get::<_, Address>(&Symbol::new(&env, "xlm_sac_addr"))
            {
                return addr;
            }
        }
        Address::from_string(&soroban_sdk::String::from_str(
            &env,
            "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        ))
    }

    /// Returns `true` when `addr` is the native XLM sentinel.
    pub fn is_native_xlm_address(env: Env, addr: Address) -> bool {
        is_native_xlm(&env, &addr)
    }

    // ── SEP-10 authentication ─────────────────────────────────────────────────

    /// Verify a SEP-10 ed25519 token against a public key (view — no state change).
    ///
    /// Returns `true` if the signature is valid and the token has not expired.
    /// Returns `false` if `valid_until` < current ledger sequence (expired).
    /// Panics if the ed25519 signature is cryptographically invalid.
    pub fn verify_sep10_token(
        env: Env,
        public_key: BytesN<32>,
        token: BytesN<64>,
        valid_until: u32,
        home_domain: Bytes,
    ) -> bool {
        sep10::verify_sep10_token_impl(&env, &public_key, &token, valid_until, &home_domain)
    }

    /// Verify a SEP-10 token and permanently store the `home_domain` for `user`.
    ///
    /// Requires both a Soroban transaction signature (`user.require_auth()`) and
    /// a valid SEP-10 token for identity binding (KYC / reputation tracking).
    /// Emits `Sep10Verified(user, home_domain)` on success.
    ///
    /// # Errors
    /// * [`CallRegistryError::Sep10TokenExpired`] – token's `valid_until` has passed.
    pub fn link_sep10_domain(
        env: Env,
        user: Address,
        public_key: BytesN<32>,
        token: BytesN<64>,
        valid_until: u32,
        home_domain: Bytes,
    ) -> Result<(), CallRegistryError> {
        user.require_auth();

        if !sep10::verify_sep10_token_impl(&env, &public_key, &token, valid_until, &home_domain) {
            return Err(CallRegistryError::Sep10TokenExpired);
        }

        set_sep10_domain(&env, &user, &home_domain);
        emit_sep10_verified(&env, &user, &home_domain);
        extend_storage_ttl(&env);

        Ok(())
    }

    /// Return the SEP-10-verified `home_domain` for a user, if they have linked one.
    /// Returns `None` if the user has never called `link_sep10_domain`.
    pub fn get_sep10_home_domain(env: Env, user: Address) -> Option<Bytes> {
        get_sep10_domain(&env, &user)
    }

    /// Withdraw stake early before a call ends, forfeiting a 10% penalty to the pool.
    ///
    /// - Panics if the call has ended, is settled, cancelled, or voided.
    /// - Panics if the staker has no stake on `position`.
    /// - Refunds `stake - penalty` to the staker; penalty remains in the pool.
    /// - Emits `StakeWithdrawn` (or `xlm_stake_withdrawn` for native XLM).
    ///
    /// # Arguments
    /// * `staker`   -- address withdrawing their stake (must sign).
    /// * `call_id`  -- the call to withdraw from.
    /// * `position` -- outcome position (1..=outcome_count).
    pub fn withdraw_stake(env: Env, staker: Address, call_id: u64, position: u32) -> (i128, i128) {
        let config = get_config(&env).expect("not initialized");
        assert!(!config.paused, "Contract is paused");
        if storage::is_locked(&env) {
            panic!("reentrancy detected");
        }
        storage::acquire_lock(&env);
        let result = withdrawal::execute_withdrawal(&env, staker, call_id, position);
        storage::release_lock(&env);
        result
    }

    /// Set a global staking gate that applies to all calls without a specific gate
    pub fn set_global_gate(
        env: Env,
        gate_kind: Option<u32>,
        gate_min_account_age: u32,
        gate_min_xlm_balance: i128,
        gate_min_trustlines: u32,
        gate_badge: Option<Address>,
    ) {
        let mut config = get_config(&env).expect("not initialized");
        config.admin.require_auth();
        config.global_gate_kind = gate_kind;
        config.global_gate_min_account_age = gate_min_account_age;
        config.global_gate_min_xlm_balance = gate_min_xlm_balance;
        config.global_gate_min_trustlines = gate_min_trustlines;
        config.global_gate_badge = gate_badge;
        set_config(&env, &config);
    }

    /// Admin function to set user trustline count (sync from backend)
    pub fn set_user_trustline_count(env: Env, user: Address, count: u32) {
        let config = get_config(&env).expect("not initialized");
        config.admin.require_auth();
        storage::set_user_trustline_count(&env, &user, count);
    }

    /// Returns the active gate fields for a call (call-local overrides global).
    pub fn get_call_gate_fields(
        env: Env,
        call_id: u64,
    ) -> Option<(Option<u32>, u32, i128, u32, Option<Address>)> {
        let call = get_call(&env, call_id)?;
        if call.gate_kind.is_some() {
            Some((
                call.gate_kind,
                call.gate_min_account_age,
                call.gate_min_xlm_balance,
                call.gate_min_trustlines,
                call.gate_badge,
            ))
        } else {
            let config = get_config(&env)?;
            Some((
                config.global_gate_kind,
                config.global_gate_min_account_age,
                config.global_gate_min_xlm_balance,
                config.global_gate_min_trustlines,
                config.global_gate_badge,
            ))
        }
    }

    /// Return the active `StakingGate` for a call, combining per-call and
    /// global gates into a single enum for convenient views.
    pub fn get_call_gate(env: Env, call_id: u64) -> Option<StakingGate> {
        let fields = Self::get_call_gate_fields(env.clone(), call_id)?;
        let (gate_kind_opt, min_account_age, min_xlm_balance, min_trustlines, badge_opt) = fields;
        let gate_kind = match gate_kind_opt {
            Some(k) => k,
            None => return None,
        };

        if gate_kind == GATE_NONE {
            return Some(StakingGate::None);
        }

        if gate_kind == GATE_MIN_ACCOUNT_AGE {
            return Some(StakingGate::MinAccountAge(min_account_age));
        }

        if gate_kind == GATE_MIN_XLM_BALANCE {
            return Some(StakingGate::MinXlmBalance(min_xlm_balance));
        }

        if gate_kind == GATE_MIN_TRUSTLINES {
            return Some(StakingGate::MinTrustlines(min_trustlines));
        }

        if gate_kind == GATE_HOLDS_BADGE {
            if let Some(badge) = badge_opt {
                return Some(StakingGate::HoldsBadge(badge));
            }
            return None;
        }

        None
    }

    /// Check if a user qualifies to stake on a call
    pub fn check_user_qualifies(env: Env, user: Address, call_id: u64) -> bool {
        let fields = match Self::get_call_gate_fields(env.clone(), call_id) {
            Some(f) => f,
            None => return true,
        };
        let (gate_kind_opt, min_account_age, min_xlm_balance, min_trustlines, badge_opt) = fields;
        let gate_kind = match gate_kind_opt {
            Some(k) => k,
            None => return true,
        };

        if gate_kind == GATE_NONE {
            return true;
        }

        if gate_kind == GATE_MIN_ACCOUNT_AGE {
            let first_seen =
                get_account_first_seen(&env, &user).unwrap_or_else(|| env.ledger().sequence());
            let current = env.ledger().sequence();
            return current >= first_seen + min_account_age;
        }

        if gate_kind == GATE_MIN_XLM_BALANCE {
            let xlm_sac_addr: Address = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "xlm_sac_addr"))
                .expect("XLM SAC not configured");
            let balance = soroban_sdk::token::Client::new(&env, &xlm_sac_addr).balance(&user);
            return balance >= min_xlm_balance;
        }

        if gate_kind == GATE_MIN_TRUSTLINES {
            return get_user_trustline_count(&env, &user) >= min_trustlines;
        }

        if gate_kind == GATE_HOLDS_BADGE {
            if let Some(badge) = badge_opt {
                return soroban_sdk::token::Client::new(&env, &badge).balance(&user) > 0;
            }
            return false;
        }

        // Unknown kind - be conservative and reject.
        false
    }
}
