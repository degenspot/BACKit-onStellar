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
mod errors;
mod events;
#[cfg(test)]
mod fuzz_tests;
mod sep10;
mod shares;
mod storage;
#[cfg(test)]
mod test;
mod types;

use backit_shared::{OUTCOME_DOWN, OUTCOME_UP};
use errors::CallRegistryError;
use events::*;
use storage::*;
use types::*;

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
        };

        set_config(&env, &config);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &CONTRACT_VERSION);
        // Track the 'version' instance key (Config key tracked inside set_config)
        inc_instance_entry_count(&env, 1);
        extend_storage_ttl(&env);

        env.events()
            .publish(("call_registry", "initialized"), (admin, outcome_manager));

        Ok(())
    }

    /// Test-only: register the XLM SAC address so is_native_xlm works in tests.
    #[cfg(test)]
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
        };

        set_call(&env, &call);
        record_call_created(&env);

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

        let mut outcome_stakers = call.stakes.get(position).unwrap_or_else(|| Map::new(&env));
        let staker_key = staker.clone();
        let current_staker_stake = outcome_stakers.get(staker_key.clone()).unwrap_or(0);
        let updated_staker_stake = current_staker_stake + amount;

        // Per-user stake cap
        if config.max_stake_per_user > 0 && updated_staker_stake > config.max_stake_per_user {
            panic!("Stake exceeds max_stake_per_user cap");
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
        extend_storage_ttl(&env);

        // Emit distinct XLM event so the indexer can differentiate XLM from USDC volume.
        if is_native_xlm(&env, &call.stake_token) {
            emit_xlm_stake_added(&env, call_id, &staker, amount, position);
        } else {
            emit_stake_added(&env, call_id, &staker, amount, position);
        }

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
    pub fn set_max_stake_per_user(env: Env, new_max: i128) {
        admin::set_max_stake_per_user(env, new_max);
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

        set_call(&env, &call);
        extend_storage_ttl(&env);

        emit_call_resolved(&env, call_id, outcome, end_price);

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
}
