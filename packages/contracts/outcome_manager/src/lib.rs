#![no_std]

mod auth;
mod events;
mod storage;
mod test;
mod verification;

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Vec};

use auth::require_admin;
use backit_shared::{is_valid_fee_bps, is_valid_outcome};
use events::{
    emit_admin_params_changed, emit_batch_payout_started, emit_contract_upgraded,
    emit_fee_collected, emit_outcome_disputed, emit_outcome_finalized, emit_outcome_submitted,
    emit_payout_claimed, emit_price_observation_submitted,
};
use storage::{
    set_dispute_window, set_max_submission_delay, InstanceKey, Outcome, OracleVote,
    PersistentKey, PriceObservation, SignedOutcome, TempKey,
};
use verification::{build_message, verify_signature};

pub const CONTRACT_VERSION: u32 = 1;
pub const MAX_ORACLES: u32 = 20;

// ─── Cross-contract helpers ────────────────────────────────────────────────────

/// Call `resolve_call(call_id, outcome, end_price)` on the CallRegistry.
fn registry_resolve_call(
    env: &Env,
    registry: &Address,
    call_id: u64,
    outcome: u32,
    end_price: i128,
) {
    let args = (call_id, outcome, end_price).into_val(env);
    env.invoke_contract::<()>(registry, &Symbol::new(env, "resolve_call"), args);
}

/// Call `release_escrow(call_id, to, amount)` on the CallRegistry.
fn registry_release_escrow(
    env: &Env,
    registry: &Address,
    call_id: u64,
    to: &Address,
    amount: i128,
) {
    let args = (call_id, to.clone(), amount).into_val(env);
    env.invoke_contract::<()>(registry, &Symbol::new(env, "release_escrow"), args);
}

/// Call `mark_settled(call_id)` on the CallRegistry.
fn registry_mark_settled(env: &Env, registry: &Address, call_id: u64) {
    let args = (call_id,).into_val(env);
    env.invoke_contract::<()>(registry, &Symbol::new(env, "mark_settled"), args);
}

// ─── Pause helper ─────────────────────────────────────────────────────────────

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct OutcomeManager;

#[contractimpl]
impl OutcomeManager {
    // ── Initialization ─────────────────────────────────────────────────────────

    /// Initialize the contract.
    ///
    /// * `admin`         – address with privileged control
    /// * `oracles`       – list of trusted oracle ed25519 public keys (32-byte)
    /// * `quorum`        – minimum matching votes required to finalize an outcome
    /// * `fee_collector` – address that receives protocol fees
    /// * `fee_bps`       – protocol fee in basis points (0–10000)
    ///
    /// # Panics
    /// If called more than once (`already initialized`).
    pub fn initialize(
        env: Env,
        admin: Address,
        oracles: Vec<BytesN<32>>,
        quorum: u32,
        fee_collector: Address,
        fee_bps: u32,
        dispute_window_secs: u64,
    ) {
        if env.storage().instance().has(&InstanceKey::Admin) {
            panic!("already initialized");
        }

        admin.require_auth();

        if quorum == 0 || quorum > oracles.len() as u32 {
            panic!("invalid quorum");
        }
        if oracles.len() as u32 > MAX_ORACLES {
            panic!("too many oracles");
        }
        if !is_valid_fee_bps(fee_bps) {
            panic!("invalid fee_bps");
        }

        let mut oracle_map = Map::<BytesN<32>, bool>::new(&env);
        for o in oracles.iter() {
            oracle_map.set(o, true);
        }

        env.storage().instance().set(&InstanceKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&InstanceKey::Oracles, &oracle_map);
        env.storage()
            .instance()
            .set(&InstanceKey::OracleList, &oracles);
        env.storage().instance().set(&InstanceKey::Quorum, &quorum);
        env.storage()
            .instance()
            .set(&InstanceKey::FeeCollector, &fee_collector);
        env.storage().instance().set(&InstanceKey::FeeBps, &fee_bps);
        set_dispute_window(&env, dispute_window_secs);
        set_max_submission_delay(&env, 86400);
        env.storage().instance().set(&InstanceKey::Version, &CONTRACT_VERSION);
    }

    // ── Admin Controls ─────────────────────────────────────────────────────────

    pub fn add_oracle(env: Env, oracle: BytesN<32>) {
        require_admin(&env);
        let mut oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&InstanceKey::Oracles).unwrap();
        let mut oracle_list: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&InstanceKey::OracleList)
            .unwrap_or_else(|| Vec::new(&env));

        if oracles.contains_key(oracle.clone()) {
            return;
        }
        if oracle_list.len() as u32 >= MAX_ORACLES {
            panic!("max oracles reached");
        }
        oracles.set(oracle.clone(), true);
        oracle_list.push_back(oracle);
        env.storage()
            .instance()
            .set(&InstanceKey::Oracles, &oracles);
        env.storage()
            .instance()
            .set(&InstanceKey::OracleList, &oracle_list);
    }

    pub fn remove_oracle(env: Env, oracle: BytesN<32>) {
        require_admin(&env);
        let mut oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&InstanceKey::Oracles).unwrap();
        let oracle_list: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&InstanceKey::OracleList)
            .unwrap_or_else(|| Vec::new(&env));
        let mut filtered = Vec::new(&env);

        oracles.remove(oracle.clone());
        for existing in oracle_list.iter() {
            if existing != oracle {
                filtered.push_back(existing);
            }
        }
        env.storage()
            .instance()
            .set(&InstanceKey::Oracles, &oracles);
        env.storage()
            .instance()
            .set(&InstanceKey::OracleList, &filtered);
    }

    pub fn set_quorum(env: Env, quorum: u32) {
        require_admin(&env);
        let oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&InstanceKey::Oracles).unwrap();
        if quorum == 0 || quorum > oracles.len() as u32 {
            panic!("invalid quorum");
        }
        env.storage().instance().set(&InstanceKey::Quorum, &quorum);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        require_admin(&env);
        env.storage()
            .instance()
            .set(&InstanceKey::Admin, &new_admin);
    }

    pub fn set_max_submission_delay(env: Env, new_delay: u64) {
        require_admin(&env);
        set_max_submission_delay(&env, new_delay);
        emit_admin_params_changed(&env, new_delay);
    }

    pub fn get_max_submission_delay(env: Env) -> u64 {
        storage::get_max_submission_delay(&env)
    }

    // ── Emergency Pause ────────────────────────────────────────────────────────

    pub fn pause(env: Env) {
        require_admin(&env);
        env.storage().instance().set(&InstanceKey::Paused, &true);
    }

    pub fn unpause(env: Env) {
        require_admin(&env);
        env.storage().instance().set(&InstanceKey::Paused, &false);
    }

    pub fn is_paused_view(env: Env) -> bool {
        is_paused(&env)
    }

    // ── Oracle Submission ──────────────────────────────────────────────────────

    /// Accept a signed outcome report from a trusted oracle.
    ///
    /// Once `quorum` oracles submit the **same** outcome (identified by the
    /// SHA-256 hash of the canonical message), the call is automatically
    /// finalized and the CallRegistry is updated via cross-contract call.
    ///
    /// # Panics
    /// - `unauthorized oracle`    – pubkey not in the trusted set
    /// - `already settled`        – quorum was already reached
    /// - `duplicate submission`   – this oracle already voted on this call
    /// - `invalid outcome`        – outcome is not 1 (UP) or 2 (DOWN)
    /// - (ed25519_verify panics)  – signature is invalid; tx is reverted
    pub fn submit_outcome(env: Env, registry: Address, signed: SignedOutcome, call_end_ts: u64) {
        if is_paused(&env) {
            panic!("contract is paused");
        }

        // 1. Validate oracle
        let oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&InstanceKey::Oracles).unwrap();
        if !oracles.contains_key(signed.oracle_pubkey.clone()) {
            panic!("unauthorized oracle");
        }

        // 2. Reject if already settled
        if env
            .storage()
            .instance()
            .has(&InstanceKey::FinalOutcome(signed.call_id))
        {
            panic!("already settled");
        }

        // 3. Guard against duplicate oracle votes
        let submission_key = TempKey::Submission(signed.oracle_pubkey.clone(), signed.call_id);
        if env.storage().temporary().has(&submission_key) {
            panic!("duplicate submission");
        }

        // 4. Validate outcome range
        if !is_valid_outcome(signed.outcome) {
            panic!("invalid outcome: must be 1 (UP) or 2 (DOWN)");
        }

        // 4b. Enforce submission deadline: oracle timestamp must be within
        //     call_end_ts + max_submission_delay to reject stale reports
        let max_delay = storage::get_max_submission_delay(&env);
        let deadline = call_end_ts
            .checked_add(max_delay)
            .expect("overflow in submission deadline");
        if signed.timestamp > deadline {
            panic!("submission outside allowed window");
        }

        // 5. Build canonical message and verify ed25519 signature
        let message = build_message(
            &env,
            signed.call_id,
            signed.outcome,
            signed.price,
            signed.timestamp,
        );
        verify_signature(&env, &signed.oracle_pubkey, &signed.signature, &message);

        // 6. Hash outcome candidate for vote counting
        let outcome_hash: BytesN<32> = env.crypto().sha256(&message).into();

        // 7. Record oracle's vote (prevents duplicates)
        env.storage()
            .temporary()
            .set(&submission_key, &outcome_hash);

        let vote_key = PersistentKey::Votes(signed.call_id);
        let mut votes_for_call: Vec<OracleVote> = env
            .storage()
            .persistent()
            .get(&vote_key)
            .unwrap_or_else(|| Vec::new(&env));
        votes_for_call.push_back(OracleVote {
            oracle: signed.oracle_pubkey.clone(),
            outcome: signed.outcome,
            price: signed.price,
            timestamp: signed.timestamp,
        });
        env.storage().persistent().set(&vote_key, &votes_for_call);

        // 8. Tally votes for this outcome candidate
        let vote_key = TempKey::VoteCount(outcome_hash.clone(), signed.call_id);
        let votes: u32 = env.storage().temporary().get(&vote_key).unwrap_or(0);
        let votes = votes + 1;
        env.storage().temporary().set(&vote_key, &votes);

        emit_outcome_submitted(&env, signed.call_id, &signed.oracle_pubkey, signed.outcome);

        // 9. Finalize if quorum reached
        let quorum: u32 = env.storage().instance().get(&InstanceKey::Quorum).unwrap();
        if votes >= quorum {
            Self::finalize(
                &env,
                &registry,
                Outcome {
                    call_id: signed.call_id,
                    outcome: signed.outcome,
                    price: signed.price,
                    timestamp: signed.timestamp,
                },
            );
        }
    }

    // ── Settlement ─────────────────────────────────────────────────────────────

    fn finalize(env: &Env, registry: &Address, outcome: Outcome) {
        // Persist finalized outcome (blocks re-submission)
        env.storage()
            .instance()
            .set(&InstanceKey::FinalOutcome(outcome.call_id), &outcome);

        // Cross-contract: resolve the call in the registry
        registry_resolve_call(
            env,
            registry,
            outcome.call_id,
            outcome.outcome,
            outcome.price,
        );

        emit_outcome_finalized(env, outcome.call_id, outcome.outcome, outcome.price);
    }

    // ── Payout Claim ───────────────────────────────────────────────────────────

    /// Claim a pro-rata payout for a winning staker.
    ///
    /// **Payout formula** (with protocol fee):
    /// ```text
    /// fee        = total_losing_stake * fee_bps / 10000
    /// net_losing = total_losing_stake - fee
    /// payout     = staker_winning_stake
    ///            + floor(staker_winning_stake * net_losing / total_winning_stake)
    /// ```
    ///
    /// # Security
    /// The `Claimed` flag is written **before** the external `release_escrow`
    /// call, preventing reentrancy attacks.
    ///
    /// # Panics
    /// - `call not settled`       – quorum not yet reached
    /// - `already claimed`        – staker already claimed
    /// - `nothing to claim`       – staker_winning_stake ≤ 0
    /// - `invalid total winning`  – total_winning_stake ≤ 0
    pub fn claim_payout(
        env: Env,
        registry: Address,
        call_id: u64,
        staker: Address,
        staker_winning_stake: i128,
        total_winning_stake: i128,
        total_losing_stake: i128,
    ) {
        // 0. Check if contract is paused (emergency guard)
        if is_paused(&env) {
            panic!("contract is paused");
        }

        // 1. Require staker's authorization
        staker.require_auth();

        // 2. Verify the call is settled
        if !env
            .storage()
            .instance()
            .has(&InstanceKey::FinalOutcome(call_id))
        {
            panic!("call not settled");
        }

        // 3. Prevent double-claim
        let claimed_key = InstanceKey::Claimed(call_id, staker.clone());
        if env.storage().instance().has(&claimed_key) {
            panic!("already claimed");
        }

        // 4. Validate inputs
        if staker_winning_stake <= 0 {
            panic!("nothing to claim");
        }
        if total_winning_stake <= 0 {
            panic!("invalid total winning stake");
        }

        // 5. Compute protocol fee from losing pool (only on first claim; fee is
        //    proportional so each claimant effectively pays their share)
        let fee_bps: u32 = env
            .storage()
            .instance()
            .get(&InstanceKey::FeeBps)
            .unwrap_or(0);
        let fee_collector: Address = env
            .storage()
            .instance()
            .get(&InstanceKey::FeeCollector)
            .expect("fee collector not set");

        // Staker's proportional share of the total fee
        let total_fee = (total_losing_stake as i128)
            .checked_mul(fee_bps as i128)
            .expect("overflow in fee calculation")
            .checked_div(10000)
            .expect("division by zero");

        let staker_fee_share = staker_winning_stake
            .checked_mul(total_fee)
            .expect("overflow in staker fee share")
            .checked_div(total_winning_stake)
            .expect("division by zero");

        // 6. Net losing pool available to winners
        let net_losing = total_losing_stake
            .checked_sub(total_fee)
            .expect("underflow in net losing");

        // 7. Pro-rata payout from net losing pool
        let prize_share = staker_winning_stake
            .checked_mul(net_losing)
            .expect("overflow in prize calculation")
            .checked_div(total_winning_stake)
            .expect("division by zero");

        let payout = staker_winning_stake
            .checked_add(prize_share)
            .expect("overflow in payout sum");

        // 8. Mark as claimed BEFORE external calls (reentrancy guard)
        env.storage().instance().set(&claimed_key, &true);

        // 9. Transfer fee to fee_collector (if non-zero)
        if staker_fee_share > 0 {
            registry_release_escrow(&env, &registry, call_id, &fee_collector, staker_fee_share);
            emit_fee_collected(&env, call_id, staker_fee_share, &fee_collector);
        }

        // 10. Release net payout to staker
        registry_release_escrow(&env, &registry, call_id, &staker, payout);

        emit_payout_claimed(&env, call_id, &staker, payout);
    }

    pub fn finalize_outcome(env: Env, call_id: u64) {
        let pending: Outcome = env
            .storage()
            .instance()
            .get(&InstanceKey::PendingOutcome(call_id))
            .expect("no pending outcome");

        let window_start: u64 = env
            .storage()
            .instance()
            .get(&InstanceKey::DisputeWindowStart(call_id))
            .expect("no window start");

        let dispute_window = storage::get_dispute_window(&env);
        if env.ledger().timestamp() < window_start + dispute_window {
            panic!("dispute window not yet expired");
        }

        env.storage()
            .instance()
            .set(&InstanceKey::FinalOutcome(call_id), &pending);
        let registry = storage::get_registry(&env);
        registry_resolve_call(
            &env,
            &registry,
            pending.call_id,
            pending.outcome,
            pending.price,
        );
        emit_outcome_finalized(&env, call_id, pending.outcome, pending.price);
    }

    pub fn dispute_outcome(env: Env, call_id: u64, new_outcome: u32, new_price: i128) {
        require_admin(&env);

        let mut pending: Outcome = env
            .storage()
            .instance()
            .get(&InstanceKey::PendingOutcome(call_id))
            .expect("no pending outcome");

        let window_start: u64 = env
            .storage()
            .instance()
            .get(&InstanceKey::DisputeWindowStart(call_id))
            .expect("no window start");

        let dispute_window = storage::get_dispute_window(&env);
        if env.ledger().timestamp() >= window_start + dispute_window {
            panic!("dispute window has expired");
        }

        pending.outcome = new_outcome;
        pending.price = new_price;
        env.storage()
            .instance()
            .set(&InstanceKey::PendingOutcome(call_id), &pending);
        emit_outcome_disputed(&env, call_id, new_outcome, new_price);
    }

    /// Batch-settle payouts for multiple winning stakers in a single transaction.
    ///
    /// Admin-only. Each staker in `stakers` is matched positionally with the
    /// corresponding amount in `stakes`. Both vecs must be the same length.
    ///
    /// Individual `PayoutClaimed` events are emitted for each staker.
    /// Already-claimed stakers cause the entire batch to panic — callers must
    /// filter them out beforehand using `has_claimed`.
    ///
    /// # Panics
    /// - `not admin`                 – caller is not the contract admin
    /// - `call not settled`          – quorum not yet reached for this call
    /// - `empty batch`               – stakers vec is empty
    /// - `length mismatch`           – stakers and stakes vecs differ in length
    /// - `invalid total winning`     – total_winning_stake ≤ 0
    /// - `already claimed: <staker>` – a staker in the batch already claimed
    /// - `nothing to claim`          – a staker's stake amount is ≤ 0
    pub fn batch_claim_payouts(
        env: Env,
        registry: Address,
        call_id: u64,
        stakers: Vec<Address>,
        stakes: Vec<i128>,
        total_winning_stake: i128,
        total_losing_stake: i128,
    ) {
        // 1. Admin only
        require_admin(&env);

        // 2. Verify the call is settled
        if !env
            .storage()
            .instance()
            .has(&InstanceKey::FinalOutcome(call_id))
        {
            panic!("call not settled");
        }

        // 3. Reject empty batches
        if stakers.is_empty() {
            panic!("empty batch");
        }

        // 4. Vecs must be same length
        if stakers.len() != stakes.len() {
            panic!("length mismatch");
        }

        // 5. Validate shared inputs once
        if total_winning_stake <= 0 {
            panic!("invalid total winning stake");
        }

        // 6. Load fee config once
        let fee_bps: u32 = env
            .storage()
            .instance()
            .get(&InstanceKey::FeeBps)
            .unwrap_or(0);
        let fee_collector: Address = env
            .storage()
            .instance()
            .get(&InstanceKey::FeeCollector)
            .expect("fee collector not set");

        // Pre-compute shared fee values
        let total_fee = (total_losing_stake as i128)
            .checked_mul(fee_bps as i128)
            .expect("overflow in fee calculation")
            .checked_div(10000)
            .expect("division by zero");

        let net_losing = total_losing_stake
            .checked_sub(total_fee)
            .expect("underflow in net losing");

        emit_batch_payout_started(&env, call_id, stakers.len());

        // 7. Process each staker
        for i in 0..stakers.len() {
            let staker = stakers.get(i).unwrap();
            let staker_winning_stake = stakes.get(i).unwrap();

            if staker_winning_stake <= 0 {
                panic!("nothing to claim");
            }

            // Guard against duplicates within the batch and prior claims
            let claimed_key = InstanceKey::Claimed(call_id, staker.clone());
            if env.storage().instance().has(&claimed_key) {
                panic!("already claimed");
            }

            // Staker's proportional fee share
            let staker_fee_share = staker_winning_stake
                .checked_mul(total_fee)
                .expect("overflow in staker fee share")
                .checked_div(total_winning_stake)
                .expect("division by zero");

            // Pro-rata payout from net losing pool
            let prize_share = staker_winning_stake
                .checked_mul(net_losing)
                .expect("overflow in prize calculation")
                .checked_div(total_winning_stake)
                .expect("division by zero");

            let payout = staker_winning_stake
                .checked_add(prize_share)
                .expect("overflow in payout sum");

            // Mark claimed BEFORE external calls (reentrancy guard)
            env.storage().instance().set(&claimed_key, &true);

            // Transfer fee share
            if staker_fee_share > 0 {
                registry_release_escrow(&env, &registry, call_id, &fee_collector, staker_fee_share);
                emit_fee_collected(&env, call_id, staker_fee_share, &fee_collector);
            }

            // Release payout to staker
            registry_release_escrow(&env, &registry, call_id, &staker, payout);

            emit_payout_claimed(&env, call_id, &staker, payout);
        }
    }

    // ── Settlement Finalization ─────────────────────────────────────────────────

    /// Mark a call as fully settled in the registry (admin only).
    ///
    /// Call this after all winners have claimed, or after a grace period.
    pub fn mark_settled(env: Env, registry: Address, call_id: u64) {
        require_admin(&env);

        if !env
            .storage()
            .instance()
            .has(&InstanceKey::FinalOutcome(call_id))
        {
            panic!("call not finalized");
        }

        registry_mark_settled(&env, &registry, call_id);
    }

    // ── View Functions ─────────────────────────────────────────────────────────

    /// Return the finalized outcome, or panic if not yet settled.
    pub fn get_outcome(env: Env, call_id: u64) -> Outcome {
        env.storage()
            .instance()
            .get(&InstanceKey::FinalOutcome(call_id))
            .expect("call not settled")
    }

    /// `true` if the staker has already claimed their payout for this call.
    pub fn has_claimed(env: Env, call_id: u64, staker: Address) -> bool {
        env.storage()
            .instance()
            .has(&InstanceKey::Claimed(call_id, staker))
    }

    /// Return the current quorum threshold.
    pub fn get_quorum(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&InstanceKey::Quorum)
            .expect("not initialized")
    }

    /// Return whether a given oracle pubkey is trusted.
    pub fn is_oracle(env: Env, oracle: BytesN<32>) -> bool {
        let oracles: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&InstanceKey::Oracles)
            .expect("not initialized");
        oracles.contains_key(oracle)
    }

    /// Return the trusted oracle public keys.
    pub fn get_oracles(env: Env) -> Vec<BytesN<32>> {
        env.storage()
            .instance()
            .get(&InstanceKey::OracleList)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Return the total number of trusted oracles.
    pub fn get_oracle_count(env: Env) -> u32 {
        Self::get_oracles(env).len() as u32
    }

    /// Return all oracle votes stored for a call.
    pub fn get_votes(env: Env, call_id: u64) -> Vec<OracleVote> {
        env.storage()
            .persistent()
            .get(&PersistentKey::Votes(call_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Return the number of stored oracle votes for a call.
    pub fn get_vote_count(env: Env, call_id: u64) -> u32 {
        Self::get_votes(env, call_id).len() as u32
    }

    /// Return the current contract version.
    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&InstanceKey::Version)
            .unwrap_or(CONTRACT_VERSION)
    }

    /// Upgrade the contract WASM to a new hash (admin only).
    ///
    /// Increments the stored version and emits `ContractUpgraded`.
    ///
    /// # Panics
    /// - `not initialized` if the contract has not been initialized.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&InstanceKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let old_version: u32 = env
            .storage()
            .instance()
            .get(&InstanceKey::Version)
            .unwrap_or(CONTRACT_VERSION);
        let new_version = old_version + 1;

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        env.storage()
            .instance()
            .set(&InstanceKey::Version, &new_version);
        emit_contract_upgraded(&env, old_version, new_version, &admin);
    }

    /// Submit a signed price observation for TWAP calculation.
    ///
    /// Observations must be submitted in strictly increasing timestamp order.
    /// A minimum of 3 observations is required before `compute_twap` can be called.
    ///
    /// # Panics
    /// - `unauthorized oracle`              - pubkey not in the trusted set
    /// - `observation timestamp must be strictly increasing` - out-of-order submission
    pub fn submit_price_observation(
        env: Env,
        call_id: u64,
        observation: PriceObservation,
        oracle_pubkey: BytesN<32>,
        signature: BytesN<64>,
    ) {
        // 1. Validate oracle
        let oracles: Map<BytesN<32>, bool> = env
            .storage()
            .instance()
            .get(&InstanceKey::Oracles)
            .expect("not initialized");
        if !oracles.contains_key(oracle_pubkey.clone()) {
            panic!("unauthorized oracle");
        }

        // 2. Build canonical message and verify ed25519 signature
        //    Format: b"twap_obs:" | call_id (8 BE) | price (16 BE) | timestamp (8 BE)
        let mut raw = Bytes::from_slice(&env, b"twap_obs:");
        raw.append(&Bytes::from_slice(&env, &call_id.to_be_bytes()));
        raw.append(&Bytes::from_slice(&env, &observation.price.to_be_bytes()));
        raw.append(&Bytes::from_slice(&env, &observation.timestamp.to_be_bytes()));
        verify_signature(&env, &oracle_pubkey, &signature, &raw);

        // 3. Load existing observations or start fresh
        let key = TempKey::PriceObservations(call_id);
        let mut observations: Vec<PriceObservation> = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        // 4. Enforce monotonically increasing timestamps
        if let Some(last) = observations.last() {
            if observation.timestamp <= last.timestamp {
                panic!("observation timestamp must be strictly increasing");
            }
        }

        let price = observation.price;
        let timestamp = observation.timestamp;
        observations.push_back(observation);
        env.storage().temporary().set(&key, &observations);

        emit_price_observation_submitted(&env, call_id, &oracle_pubkey, price, timestamp);
    }

    /// Compute the time-weighted average price (TWAP) from stored observations.
    ///
    /// Uses the formula: TWAP = sum(price[i] * dt[i]) / total_dt
    /// where dt[i] = timestamp[i+1] - timestamp[i].
    ///
    /// # Panics
    /// - `no price observations for call`        - none submitted yet
    /// - `minimum 3 price observations required` - fewer than 3 stored
    /// - `zero time window`                      - all timestamps identical
    pub fn compute_twap(env: Env, call_id: u64) -> i128 {
        let key = TempKey::PriceObservations(call_id);
        let observations: Vec<PriceObservation> = env
            .storage()
            .temporary()
            .get(&key)
            .expect("no price observations for call");

        let n = observations.len();
        if n < 3 {
            panic!("minimum 3 price observations required");
        }

        let mut weighted_sum: i128 = 0;
        let mut total_time: i128 = 0;

        for i in 0..(n - 1) {
            let obs_i = observations.get(i).unwrap();
            let obs_next = observations.get(i + 1).unwrap();
            let dt = (obs_next.timestamp - obs_i.timestamp) as i128;
            weighted_sum = obs_i.price
                .checked_mul(dt)
                .expect("overflow in TWAP weighted sum")
                .checked_add(weighted_sum)
                .expect("overflow accumulating weighted sum");
            total_time = total_time
                .checked_add(dt)
                .expect("overflow in total time window");
        }

        if total_time == 0 {
            panic!("zero time window");
        }

        weighted_sum
            .checked_div(total_time)
            .expect("division error in TWAP")
    }
}
