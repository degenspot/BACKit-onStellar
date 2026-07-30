#![no_std]
#![allow(deprecated)]

mod auth;
mod call_types;
mod errors;
mod events;
#[cfg(test)]
mod fuzz_tests;
mod storage;
mod test;
mod rotation;
mod verification;

pub use storage::SignedOutcome;

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Vec};

use auth::require_admin;
use backit_shared::{is_valid_fee_bps, is_valid_outcome};
use call_types::{Call, CallRegistryError};
use errors::OutcomeError;
use events::{
    emit_admin_params_changed, emit_batch_payout_started, emit_claimable_balance_created,
    emit_contract_upgraded, emit_fee_collected, emit_outcome_disputed, emit_outcome_finalized,
    emit_outcome_submitted, emit_payout_claimed, emit_price_observation_submitted,
    emit_recovery_address_removed, emit_recovery_address_set, emit_recovery_claimed,
    emit_twap_computed,
};
use storage::{
    get_resolution_config, get_twap_config, set_dispute_window, set_max_submission_delay,
    set_resolution_config, set_twap_config, InstanceKey, OracleVote, Outcome, PersistentKey,
    PriceObservation, ResolutionObservation, TempKey,
};
use verification::{build_message, verify_signature};

pub const CONTRACT_VERSION: u32 = 1;
pub const MAX_ORACLES: u32 = 20;

// ─── Cross-contract helpers ────────────────────────────────────────────────────

fn registry_resolve_call(
    env: &Env,
    registry: &Address,
    call_id: u64,
    outcome: u32,
    end_price: i128,
) {
    let args = (call_id, outcome, end_price).into_val(env);
    let result: Result<Call, CallRegistryError> =
        env.invoke_contract(registry, &Symbol::new(env, "resolve_call"), args);
    if result.is_err() {
        soroban_sdk::panic_with_error!(env, OutcomeError::CallNotSettled);
    }
}

fn registry_release_escrow(
    env: &Env,
    registry: &Address,
    call_id: u64,
    to: &Address,
    amount: i128,
) {
    let args = (call_id, to.clone(), amount).into_val(env);
    let result: Result<(), CallRegistryError> =
        env.invoke_contract(registry, &Symbol::new(env, "release_escrow"), args);
    if result.is_err() {
        soroban_sdk::panic_with_error!(env, OutcomeError::CallNotSettled);
    }
}

fn registry_mark_settled(env: &Env, registry: &Address, call_id: u64) {
    let args = (call_id,).into_val(env);
    let result: Result<(), CallRegistryError> =
        env.invoke_contract(registry, &Symbol::new(env, "mark_settled"), args);
    if result.is_err() {
        soroban_sdk::panic_with_error!(env, OutcomeError::CallNotSettled);
    }
}

/// Call `get_call(call_id)` on the CallRegistry and return the decoded Call.
#[allow(dead_code)]
fn registry_get_call(env: &Env, registry: &Address, call_id: u64) -> Call {
    let args = (call_id,).into_val(env);
    let result: Result<Call, CallRegistryError> =
        env.invoke_contract(registry, &Symbol::new(env, "get_call"), args);
    match result {
        Ok(call) => call,
        Err(_) => soroban_sdk::panic_with_error!(env, OutcomeError::CallNotSettled),
    }
}

/// Call `get_staker_stake(call_id, staker, position)` on the CallRegistry.
#[allow(dead_code)]
fn registry_get_staker_stake(
    env: &Env,
    registry: &Address,
    call_id: u64,
    staker: &Address,
    position: u32,
) -> i128 {
    let args = (call_id, staker.clone(), position).into_val(env);
    let result: Result<i128, CallRegistryError> =
        env.invoke_contract(registry, &Symbol::new(env, "get_staker_stake"), args);
    result.unwrap_or_default()
}

/// Look up the deployed market address for `call_id` via the configured factory.
fn factory_get_market(env: &Env, factory: &Address, call_id: u64) -> Address {
    let args = (call_id,).into_val(env);
    let result: Result<Address, CallRegistryError> =
        env.invoke_contract(factory, &Symbol::new(env, "get_market"), args);
    match result {
        Ok(addr) => addr,
        Err(_) => soroban_sdk::panic_with_error!(env, OutcomeError::InvalidMarket),
    }
}

/// When a factory is configured, ensure `registry` matches the factory's market for `call_id`.
fn validate_market_registry(env: &Env, registry: &Address, call_id: u64) {
    if let Some(factory) = storage::get_factory_opt(env) {
        let expected = factory_get_market(env, &factory, call_id);
        if expected != *registry {
            soroban_sdk::panic_with_error!(env, OutcomeError::InvalidMarket);
        }
    }
}

// ─── Pause helper ─────────────────────────────────────────────────────────────

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

fn not_initialized<T>(env: &Env) -> T {
    soroban_sdk::panic_with_error!(env, OutcomeError::NotInitialized);
}

fn overflow<T>(env: &Env) -> T {
    soroban_sdk::panic_with_error!(env, OutcomeError::Overflow);
}

fn get_oracles(env: &Env) -> Map<BytesN<32>, bool> {
    match env.storage().instance().get(&InstanceKey::Oracles) {
        Some(oracles) => oracles,
        None => not_initialized(env),
    }
}

fn get_quorum(env: &Env) -> u32 {
    match env.storage().instance().get(&InstanceKey::Quorum) {
        Some(quorum) => quorum,
        None => not_initialized(env),
    }
}

fn get_fee_collector(env: &Env) -> Address {
    match env.storage().instance().get(&InstanceKey::FeeCollector) {
        Some(fee_collector) => fee_collector,
        None => soroban_sdk::panic_with_error!(env, OutcomeError::FeeCollectorNotSet),
    }
}

fn get_registry(env: &Env) -> Address {
    match env.storage().instance().get(&InstanceKey::Registry) {
        Some(registry) => registry,
        None => soroban_sdk::panic_with_error!(env, OutcomeError::RegistryNotSet),
    }
}

fn require_call_settled(env: &Env, call_id: u64) {
    if !env
        .storage()
        .instance()
        .has(&InstanceKey::FinalOutcome(call_id))
    {
        soroban_sdk::panic_with_error!(env, OutcomeError::CallNotSettled);
    }
}

/// Read the settlement timestamp recorded for `call_id`. Both finalization
/// paths (`Self::finalize` and `finalize_outcome`) write this at the same
/// moment they write `FinalOutcome`, so by the time `require_call_settled`
/// has passed this should always be present. Fall back to "now" (i.e. an
/// elapsed time of zero) as a fail-safe if it's somehow missing, so a
/// missing timestamp can never be mistaken for an *elapsed* grace period.
fn get_settled_at(env: &Env, call_id: u64) -> u64 {
    storage::get_settled_at_opt(env, call_id).unwrap_or_else(|| env.ledger().timestamp())
}

fn get_fee_config(env: &Env) -> (u32, Address) {
    let fee_bps: u32 = env
        .storage()
        .instance()
        .get(&InstanceKey::FeeBps)
        .unwrap_or(0);
    let fee_collector = get_fee_collector(env);
    (fee_bps, fee_collector)
}

fn compute_total_fee(env: &Env, total_losing_stake: i128, fee_bps: u32) -> i128 {
    total_losing_stake
        .checked_mul(fee_bps as i128)
        .unwrap_or_else(|| overflow(env))
        .checked_div(10000)
        .unwrap_or_else(|| overflow(env))
}

fn compute_payout_parts(
    env: &Env,
    staker_winning_stake: i128,
    total_winning_stake: i128,
    total_fee: i128,
    net_losing: i128,
) -> (i128, i128) {
    let staker_fee_share = staker_winning_stake
        .checked_mul(total_fee)
        .unwrap_or_else(|| overflow(env))
        .checked_div(total_winning_stake)
        .unwrap_or_else(|| overflow(env));

    let prize_share = staker_winning_stake
        .checked_mul(net_losing)
        .unwrap_or_else(|| overflow(env))
        .checked_div(total_winning_stake)
        .unwrap_or_else(|| overflow(env));

    let payout = staker_winning_stake
        .checked_add(prize_share)
        .unwrap_or_else(|| overflow(env));

    (staker_fee_share, payout)
}

/// Attempts to compute a valid TWAP from `observations`, extending the last
/// observation's price forward to `end_ts`:
///
/// `TWAP = (p1*(t2-t1) + p2*(t3-t2) + ... + pN*(end_ts-tN)) / (end_ts-t1)`
///
/// Returns `None` — never panics — if there are fewer than
/// `min_observations`, if the observations don't span at least half of
/// `window_secs`, or on arithmetic overflow. Either signal means the TWAP
/// isn't trustworthy and the caller should fall back to a single-point
/// price instead.
fn try_compute_twap(
    observations: &Vec<PriceObservation>,
    end_ts: u64,
    window_secs: u64,
    min_observations: u32,
) -> Option<i128> {
    let n = observations.len();
    if n < min_observations {
        return None;
    }

    let first = observations.get(0).unwrap();
    let last = observations.get(n - 1).unwrap();
    let span = last.timestamp.saturating_sub(first.timestamp);
    if span < window_secs / 2 {
        return None;
    }

    let mut weighted_sum: i128 = 0;
    let mut total_time: i128 = 0;

    for i in 0..n {
        let obs = observations.get(i).unwrap();
        let next_ts = if i + 1 < n {
            observations.get(i + 1).unwrap().timestamp
        } else {
            end_ts
        };
        if next_ts < obs.timestamp {
            // end_ts strictly before the last observation, or malformed
            // order — genuinely invalid. `next_ts == obs.timestamp` is
            // legitimate (a zero-length tail when end_ts lands exactly on
            // the last observation) and contributes zero weight below.
            return None;
        }
        let dt = (next_ts - obs.timestamp) as i128;
        weighted_sum = obs.price.checked_mul(dt)?.checked_add(weighted_sum)?;
        total_time = total_time.checked_add(dt)?;
    }

    if total_time == 0 {
        return None;
    }

    weighted_sum.checked_div(total_time)
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct OutcomeManager;

#[contractimpl]
impl OutcomeManager {
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
            soroban_sdk::panic_with_error!(&env, OutcomeError::AlreadyInitialized);
        }

        admin.require_auth();

        if quorum == 0 || quorum > oracles.len() {
            soroban_sdk::panic_with_error!(&env, OutcomeError::InvalidQuorum);
        }
        if oracles.len() > MAX_ORACLES {
            soroban_sdk::panic_with_error!(&env, OutcomeError::MaxOraclesReached);
        }
        if !is_valid_fee_bps(fee_bps) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::InvalidFeeBps);
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
        env.storage()
            .instance()
            .set(&InstanceKey::Version, &CONTRACT_VERSION);
    }

    pub fn add_oracle(env: Env, oracle: BytesN<32>) {
        require_admin(&env);
        let mut oracles = get_oracles(&env);
        let mut oracle_list: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&InstanceKey::OracleList)
            .unwrap_or_else(|| Vec::new(&env));

        if oracles.contains_key(oracle.clone()) {
            return;
        }
        if oracle_list.len() >= MAX_ORACLES {
            soroban_sdk::panic_with_error!(&env, OutcomeError::MaxOraclesReached);
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
        let mut oracles = get_oracles(&env);
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
        let oracles = get_oracles(&env);
        if quorum == 0 || quorum > oracles.len() {
            soroban_sdk::panic_with_error!(&env, OutcomeError::InvalidQuorum);
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

    /// Set the SDEX price deviation threshold in basis points (admin only).
    /// Default: 500 (5%). Submissions deviating more than this are rejected.
    pub fn set_sdex_threshold(env: Env, new_threshold: u32) {
        require_admin(&env);
        env.storage()
            .instance()
            .set(&InstanceKey::SdexThresholdBps, &new_threshold);
        emit_admin_params_changed(&env, new_threshold as u64);
    }

    pub fn get_sdex_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&InstanceKey::SdexThresholdBps)
            .unwrap_or(500)
    }

    /// Query the SDEX midpoint price for a pair from the on-chain orderbook.
    /// Returns None when there is insufficient liquidity (spread > 10%).
    /// NOTE: In Soroban, direct SDEX orderbook queries require a host function
    /// or a helper oracle contract. This returns None (graceful degradation)
    /// when the query cannot be satisfied, as per the acceptance criteria.
    pub fn query_sdex_midpoint(
        _env: Env,
        _selling_asset: Address,
        _buying_asset: Address,
    ) -> Option<i128> {
        // Soroban does not yet expose a native host function for SDEX orderbook
        // queries within a single transaction budget. When the Stellar protocol
        // exposes this capability, replace the body with the actual host call.
        // For now: return None so callers gracefully skip SDEX validation.
        None
    }

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

    /// Store the default registry / market address (admin only).
    ///
    /// Used by `finalize_outcome` when the dispute-window path is active.
    pub fn set_registry(env: Env, registry: Address) {
        require_admin(&env);
        storage::set_registry(&env, registry);
    }

    /// Store the prediction market factory address (admin only).
    ///
    /// **Design decision:** a single shared `outcome_manager` instance serves all
    /// factory-deployed markets. Oracle quorum state is keyed by global `call_id`,
    /// while escrow lives in per-market contract instances. Per-market outcome
    /// managers would isolate oracle config but multiply deployment and admin cost.
    pub fn set_factory(env: Env, factory: Address) {
        require_admin(&env);
        storage::set_factory(&env, factory);
    }

    /// Return the configured factory address, if any.
    pub fn get_factory(env: Env) -> Option<Address> {
        storage::get_factory_opt(&env)
    }

    /// Resolve a market contract address from the configured factory.
    pub fn resolve_market_address(env: Env, call_id: u64) -> Address {
        let factory = match storage::get_factory_opt(&env) {
            Some(factory) => factory,
            None => soroban_sdk::panic_with_error!(&env, OutcomeError::FactoryNotSet),
        };
        factory_get_market(&env, &factory, call_id)
    }

    /// Submit an oracle outcome, resolving the market address from the factory.
    pub fn submit_outcome_for_market(env: Env, signed: SignedOutcome, call_end_ts: u64) {
        let registry = Self::resolve_market_address(env.clone(), signed.call_id);
        Self::submit_outcome(env, registry, signed, call_end_ts);
    }

    /// Claim payout, resolving the market address from the factory.
    pub fn claim_payout_for_market(
        env: Env,
        call_id: u64,
        staker: Address,
        staker_winning_stake: i128,
        total_winning_stake: i128,
        total_losing_stake: i128,
    ) {
        let registry = Self::resolve_market_address(env.clone(), call_id);
        Self::claim_payout(
            env,
            registry,
            call_id,
            staker,
            staker_winning_stake,
            total_winning_stake,
            total_losing_stake,
        );
    }

    pub fn submit_outcome(env: Env, registry: Address, signed: SignedOutcome, call_end_ts: u64) {
        if is_paused(&env) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::ContractPaused);
        }

        validate_market_registry(&env, &registry, signed.call_id);

        let oracles = get_oracles(&env);
        if !oracles.contains_key(signed.oracle_pubkey.clone()) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::UnauthorizedOracle);
        }

        if env
            .storage()
            .instance()
            .has(&InstanceKey::FinalOutcome(signed.call_id))
        {
            soroban_sdk::panic_with_error!(&env, OutcomeError::AlreadySettled);
        }

        let submission_key = TempKey::Submission(signed.oracle_pubkey.clone(), signed.call_id);
        if env.storage().temporary().has(&submission_key) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::DuplicateSubmission);
        }

        if !is_valid_outcome(signed.outcome) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::InvalidOutcome);
        }

        let max_delay = storage::get_max_submission_delay(&env);
        let deadline = call_end_ts
            .checked_add(max_delay)
            .unwrap_or_else(|| overflow(&env));
        if signed.timestamp > deadline {
            soroban_sdk::panic_with_error!(&env, OutcomeError::SubmissionWindowExpired);
        }

        let message = build_message(
            &env,
            signed.call_id,
            signed.outcome,
            signed.price,
            signed.timestamp,
        );
        verify_signature(&env, &signed.oracle_pubkey, &signed.signature, &message);

        // SDEX cross-validation: if SDEX returns a midpoint, check deviation.
        // If SDEX has no liquidity, skip (None = graceful degradation).
        let sdex_midpoint: Option<i128> = None; // host function not yet available
        if let Some(sdex_price) = sdex_midpoint {
            if sdex_price > 0 {
                let threshold_bps: u32 = env
                    .storage()
                    .instance()
                    .get(&InstanceKey::SdexThresholdBps)
                    .unwrap_or(500);
                let diff = (signed.price - sdex_price).abs();
                let deviation_bps = diff.checked_mul(10000).unwrap_or(i128::MAX) / sdex_price;
                if deviation_bps > threshold_bps as i128 {
                    // Emit warning event then reject
                    env.events().publish(
                        ("outcome_manager", "PriceDeviationWarning"),
                        (
                            signed.call_id,
                            signed.price,
                            sdex_price,
                            deviation_bps as u32,
                        ),
                    );
                    soroban_sdk::panic_with_error!(&env, OutcomeError::InvalidOutcome);
                }
            }
        }

        let outcome_hash: BytesN<32> = env.crypto().sha256(&message).into();

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

        let vote_key = TempKey::VoteCount(outcome_hash.clone(), signed.call_id);
        let votes: u32 = env.storage().temporary().get(&vote_key).unwrap_or(0);
        let votes = votes + 1;
        env.storage().temporary().set(&vote_key, &votes);

        emit_outcome_submitted(&env, signed.call_id, &signed.oracle_pubkey, signed.outcome);

        let quorum = get_quorum(&env);
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

    fn finalize(env: &Env, registry: &Address, outcome: Outcome) {
        env.storage()
            .instance()
            .set(&InstanceKey::FinalOutcome(outcome.call_id), &outcome);
        storage::set_settled_at(env, outcome.call_id, env.ledger().timestamp());

        registry_resolve_call(
            env,
            registry,
            outcome.call_id,
            outcome.outcome,
            outcome.price,
        );
        emit_outcome_finalized(env, outcome.call_id, outcome.outcome, outcome.price);
    }

    /// Claim a pro-rata payout for a winning staker.
    ///
    /// Creates a claimable balance record for the staker. The claimable balance
    /// ID is stored in contract storage so the frontend can look it up.
    /// Falls back to direct transfer via `release_escrow` if needed.
    pub fn claim_payout(
        env: Env,
        registry: Address,
        call_id: u64,
        staker: Address,
        staker_winning_stake: i128,
        total_winning_stake: i128,
        total_losing_stake: i128,
    ) {
        if is_paused(&env) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::ContractPaused);
        }

        staker.require_auth();
        require_call_settled(&env, call_id);

        let claimed_key = InstanceKey::Claimed(call_id, staker.clone());
        if env.storage().instance().has(&claimed_key) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::AlreadyClaimed);
        }

        if staker_winning_stake <= 0 {
            soroban_sdk::panic_with_error!(&env, OutcomeError::NothingToClaim);
        }
        if total_winning_stake <= 0 {
            soroban_sdk::panic_with_error!(&env, OutcomeError::InvalidWinningStake);
        }

        let (fee_bps, fee_collector) = get_fee_config(&env);
        let total_fee = compute_total_fee(&env, total_losing_stake, fee_bps);
        let net_losing = total_losing_stake
            .checked_sub(total_fee)
            .unwrap_or_else(|| overflow(&env));

        let (staker_fee_share, payout) = compute_payout_parts(
            &env,
            staker_winning_stake,
            total_winning_stake,
            total_fee,
            net_losing,
        );

        // Mark as claimed BEFORE external calls (reentrancy guard)
        env.storage().instance().set(&claimed_key, &true);

        // Store a synthetic claimable balance ID derived from call_id + staker hash
        // so the frontend can query it. The actual payout is still via release_escrow
        // for compatibility (Soroban host claimable balance API varies by network).
        let mut id_input = Bytes::from_slice(&env, b"claimbal:");
        id_input.append(&Bytes::from_slice(&env, &call_id.to_be_bytes()));
        // Use staker address XDR bytes to guarantee per-staker uniqueness
        id_input.append(&staker.clone().to_xdr(&env));
        let balance_id: BytesN<32> = env.crypto().sha256(&id_input).into();

        env.storage().instance().set(
            &InstanceKey::ClaimableBalanceId(call_id, staker.clone()),
            &balance_id,
        );

        if staker_fee_share > 0 {
            registry_release_escrow(&env, &registry, call_id, &fee_collector, staker_fee_share);
            emit_fee_collected(&env, call_id, staker_fee_share, &fee_collector);
        }

        registry_release_escrow(&env, &registry, call_id, &staker, payout);

        emit_claimable_balance_created(&env, call_id, &staker, &balance_id, payout);
        emit_payout_claimed(&env, call_id, &staker, payout);
    }

    // ─── Social recovery ───────────────────────────────────────────────────

    /// Designate a recovery address for `user`. If `user` doesn't claim a
    /// payout within `recovery_grace_period` seconds of settlement, the
    /// designated recovery address may claim it on `user`'s behalf via
    /// `claim_on_behalf`. Must be signed by `user`. Setting a recovery
    /// address does not remove `user`'s own right to claim at any time.
    pub fn set_recovery_address(env: Env, user: Address, recovery_address: Address) {
        user.require_auth();
        storage::set_recovery_address(&env, user.clone(), recovery_address.clone());
        emit_recovery_address_set(&env, &user, &recovery_address);
    }

    /// Remove `user`'s designated recovery address, if any. Must be signed
    /// by `user`.
    pub fn remove_recovery_address(env: Env, user: Address) {
        user.require_auth();
        storage::remove_recovery_address(&env, user.clone());
        emit_recovery_address_removed(&env, &user);
    }

    /// Return `user`'s designated recovery address, if one has been set.
    pub fn get_recovery_address(env: Env, user: Address) -> Option<Address> {
        storage::get_recovery_address_opt(&env, user)
    }

    /// Set the grace period (seconds) that must elapse after a call is
    /// settled before a designated recovery address may claim an unclaimed
    /// payout on the original winner's behalf (admin only). Default 30 days.
    pub fn set_recovery_grace_period(env: Env, new_period_secs: u64) {
        require_admin(&env);
        storage::set_recovery_grace_period(&env, new_period_secs);
        emit_admin_params_changed(&env, new_period_secs);
    }

    /// Return the current recovery grace period, in seconds.
    pub fn get_recovery_grace_period(env: Env) -> u64 {
        storage::get_recovery_grace_period(&env)
    }

    /// Claim a winning staker's payout on their behalf, as their designated
    /// recovery address, once `recovery_grace_period` has elapsed since the
    /// call settled and the original winner hasn't claimed it themselves.
    ///
    /// Reuses the exact same payout computation as `claim_payout`
    /// (`compute_payout_parts`) and the exact same `Claimed(call_id, ..)`
    /// reentrancy-guard flag — marked against `original_winner` (not
    /// `recovery_agent`) so the original winner can't *also* claim
    /// afterward. The computed payout is transferred `to = recovery_agent`.
    pub fn claim_on_behalf(
        env: Env,
        registry: Address,
        call_id: u64,
        recovery_agent: Address,
        original_winner: Address,
        staker_winning_stake: i128,
        total_winning_stake: i128,
        total_losing_stake: i128,
    ) {
        if is_paused(&env) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::ContractPaused);
        }

        recovery_agent.require_auth();

        let stored_recovery = storage::get_recovery_address_opt(&env, original_winner.clone());
        if stored_recovery.as_ref() != Some(&recovery_agent) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::NotRecoveryAgent);
        }

        require_call_settled(&env, call_id);

        // Check the definitive "already claimed" state before the
        // time-based grace-period gate, so a winner who already claimed
        // always sees `AlreadyClaimed` rather than a confusing
        // `RecoveryGracePeriodNotElapsed` if the grace period also hasn't
        // elapsed yet.
        let claimed_key = InstanceKey::Claimed(call_id, original_winner.clone());
        if env.storage().instance().has(&claimed_key) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::AlreadyClaimed);
        }

        let settled_at = get_settled_at(&env, call_id);
        let grace_period = storage::get_recovery_grace_period(&env);
        let elapsed = env.ledger().timestamp().saturating_sub(settled_at);
        if elapsed < grace_period {
            soroban_sdk::panic_with_error!(&env, OutcomeError::RecoveryGracePeriodNotElapsed);
        }

        if staker_winning_stake <= 0 {
            soroban_sdk::panic_with_error!(&env, OutcomeError::NothingToClaim);
        }
        if total_winning_stake <= 0 {
            soroban_sdk::panic_with_error!(&env, OutcomeError::InvalidWinningStake);
        }

        let (fee_bps, fee_collector) = get_fee_config(&env);
        let total_fee = compute_total_fee(&env, total_losing_stake, fee_bps);
        let net_losing = total_losing_stake
            .checked_sub(total_fee)
            .unwrap_or_else(|| overflow(&env));

        let (staker_fee_share, payout) = compute_payout_parts(
            &env,
            staker_winning_stake,
            total_winning_stake,
            total_fee,
            net_losing,
        );

        // Mark as claimed against the ORIGINAL WINNER before external calls
        // (reentrancy guard) — this is the same flag `claim_payout` checks,
        // so the original winner can no longer claim once the recovery
        // agent has claimed on their behalf, and vice versa.
        env.storage().instance().set(&claimed_key, &true);

        if staker_fee_share > 0 {
            registry_release_escrow(&env, &registry, call_id, &fee_collector, staker_fee_share);
            emit_fee_collected(&env, call_id, staker_fee_share, &fee_collector);
        }

        // The actual tokens go to the recovery agent, not the original winner.
        registry_release_escrow(&env, &registry, call_id, &recovery_agent, payout);

        emit_recovery_claimed(&env, &recovery_agent, &original_winner, call_id, payout);
    }

    /// Batch-create claimable balances for multiple winning stakers (admin only).
    ///
    /// Gas-efficient: computes payouts and stores claimable balance IDs for all
    /// stakers in a single transaction, then triggers `release_escrow` for each.
    pub fn batch_create_claimable_balances(
        env: Env,
        registry: Address,
        call_id: u64,
        stakers: Vec<Address>,
        stakes: Vec<i128>,
        total_winning_stake: i128,
        total_losing_stake: i128,
    ) {
        require_admin(&env);
        require_call_settled(&env, call_id);

        if stakers.is_empty() {
            soroban_sdk::panic_with_error!(&env, OutcomeError::EmptyBatch);
        }
        if stakers.len() != stakes.len() {
            soroban_sdk::panic_with_error!(&env, OutcomeError::LengthMismatch);
        }
        if total_winning_stake <= 0 {
            soroban_sdk::panic_with_error!(&env, OutcomeError::InvalidWinningStake);
        }

        let (fee_bps, fee_collector) = get_fee_config(&env);
        let total_fee = compute_total_fee(&env, total_losing_stake, fee_bps);
        let net_losing = total_losing_stake
            .checked_sub(total_fee)
            .unwrap_or_else(|| overflow(&env));

        emit_batch_payout_started(&env, call_id, stakers.len());

        let mut aggregated_fee_share = 0_i128;
        for i in 0..stakers.len() {
            let staker = stakers.get(i).unwrap();
            let staker_winning_stake = stakes.get(i).unwrap();

            if staker_winning_stake <= 0 {
                soroban_sdk::panic_with_error!(&env, OutcomeError::NothingToClaim);
            }

            let claimed_key = InstanceKey::Claimed(call_id, staker.clone());
            if env.storage().instance().has(&claimed_key) {
                soroban_sdk::panic_with_error!(&env, OutcomeError::AlreadyClaimed);
            }

            let (staker_fee_share, payout) = compute_payout_parts(
                &env,
                staker_winning_stake,
                total_winning_stake,
                total_fee,
                net_losing,
            );

            // Derive and store claimable balance ID
            let mut id_input = Bytes::from_slice(&env, b"claimbal:");
            id_input.append(&Bytes::from_slice(&env, &call_id.to_be_bytes()));
            id_input.append(&Bytes::from_slice(&env, &(i as u64).to_be_bytes()));
            let balance_id: BytesN<32> = env.crypto().sha256(&id_input).into();

            env.storage().instance().set(
                &InstanceKey::ClaimableBalanceId(call_id, staker.clone()),
                &balance_id,
            );

            // Mark claimed BEFORE external calls (reentrancy guard)
            env.storage().instance().set(&claimed_key, &true);

            aggregated_fee_share = aggregated_fee_share
                .checked_add(staker_fee_share)
                .unwrap_or_else(|| overflow(&env));

            registry_release_escrow(&env, &registry, call_id, &staker, payout);
            emit_claimable_balance_created(&env, call_id, &staker, &balance_id, payout);
            emit_payout_claimed(&env, call_id, &staker, payout);
        }

        if aggregated_fee_share > 0 {
            registry_release_escrow(
                &env,
                &registry,
                call_id,
                &fee_collector,
                aggregated_fee_share,
            );
            emit_fee_collected(&env, call_id, aggregated_fee_share, &fee_collector);
        }
    }

    pub fn batch_claim_payouts(
        env: Env,
        registry: Address,
        call_id: u64,
        stakers: Vec<Address>,
        stakes: Vec<i128>,
        total_winning_stake: i128,
        total_losing_stake: i128,
    ) {
        require_admin(&env);
        require_call_settled(&env, call_id);

        if stakers.is_empty() {
            soroban_sdk::panic_with_error!(&env, OutcomeError::EmptyBatch);
        }
        if stakers.len() != stakes.len() {
            soroban_sdk::panic_with_error!(&env, OutcomeError::LengthMismatch);
        }
        if total_winning_stake <= 0 {
            soroban_sdk::panic_with_error!(&env, OutcomeError::InvalidWinningStake);
        }

        let (fee_bps, fee_collector) = get_fee_config(&env);
        let total_fee = compute_total_fee(&env, total_losing_stake, fee_bps);
        let net_losing = total_losing_stake
            .checked_sub(total_fee)
            .unwrap_or_else(|| overflow(&env));

        emit_batch_payout_started(&env, call_id, stakers.len());

        let mut aggregated_fee_share = 0_i128;
        for i in 0..stakers.len() {
            let staker = stakers.get(i).unwrap();

            let staker_winning_stake = stakes.get(i).unwrap();
            if staker_winning_stake <= 0 {
                soroban_sdk::panic_with_error!(&env, OutcomeError::NothingToClaim);
            }

            let claimed_key = InstanceKey::Claimed(call_id, staker.clone());
            if env.storage().instance().has(&claimed_key) {
                soroban_sdk::panic_with_error!(&env, OutcomeError::AlreadyClaimed);
            }

            let (staker_fee_share, payout) = compute_payout_parts(
                &env,
                staker_winning_stake,
                total_winning_stake,
                total_fee,
                net_losing,
            );

            env.storage().instance().set(&claimed_key, &true);

            aggregated_fee_share = aggregated_fee_share
                .checked_add(staker_fee_share)
                .unwrap_or_else(|| overflow(&env));

            registry_release_escrow(&env, &registry, call_id, &staker, payout);
            emit_payout_claimed(&env, call_id, &staker, payout);
        }

        if aggregated_fee_share > 0 {
            registry_release_escrow(
                &env,
                &registry,
                call_id,
                &fee_collector,
                aggregated_fee_share,
            );
            emit_fee_collected(&env, call_id, aggregated_fee_share, &fee_collector);
        }
    }

    pub fn mark_settled(env: Env, registry: Address, call_id: u64) {
        require_admin(&env);
        if !env
            .storage()
            .instance()
            .has(&InstanceKey::FinalOutcome(call_id))
        {
            soroban_sdk::panic_with_error!(&env, OutcomeError::CallNotFinalized);
        }
        registry_mark_settled(&env, &registry, call_id);
    }

    pub fn finalize_outcome(env: Env, call_id: u64) {
        let pending: Outcome = match env
            .storage()
            .instance()
            .get(&InstanceKey::PendingOutcome(call_id))
        {
            Some(pending) => pending,
            None => soroban_sdk::panic_with_error!(&env, OutcomeError::CallNotFinalized),
        };

        let window_start: u64 = match env
            .storage()
            .instance()
            .get(&InstanceKey::DisputeWindowStart(call_id))
        {
            Some(window_start) => window_start,
            None => soroban_sdk::panic_with_error!(&env, OutcomeError::CallNotFinalized),
        };

        let dispute_window = storage::get_dispute_window(&env);
        if env.ledger().timestamp() < window_start + dispute_window {
            soroban_sdk::panic_with_error!(&env, OutcomeError::CallNotFinalized);
        }

        env.storage()
            .instance()
            .set(&InstanceKey::FinalOutcome(call_id), &pending);
        storage::set_settled_at(&env, call_id, env.ledger().timestamp());
        let registry = get_registry(&env);
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

        let mut pending: Outcome = match env
            .storage()
            .instance()
            .get(&InstanceKey::PendingOutcome(call_id))
        {
            Some(pending) => pending,
            None => soroban_sdk::panic_with_error!(&env, OutcomeError::CallNotFinalized),
        };

        let window_start: u64 = match env
            .storage()
            .instance()
            .get(&InstanceKey::DisputeWindowStart(call_id))
        {
            Some(window_start) => window_start,
            None => soroban_sdk::panic_with_error!(&env, OutcomeError::CallNotFinalized),
        };

        let dispute_window = storage::get_dispute_window(&env);
        if env.ledger().timestamp() >= window_start + dispute_window {
            soroban_sdk::panic_with_error!(&env, OutcomeError::DisputeWindowExpired);
        }

        if !is_valid_outcome(new_outcome) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::InvalidOutcome);
        }

        pending.outcome = new_outcome;
        pending.price = new_price;
        env.storage()
            .instance()
            .set(&InstanceKey::PendingOutcome(call_id), &pending);
        emit_outcome_disputed(&env, call_id, new_outcome, new_price);
    }

    pub fn get_outcome(env: Env, call_id: u64) -> Outcome {
        match env
            .storage()
            .instance()
            .get(&InstanceKey::FinalOutcome(call_id))
        {
            Some(outcome) => outcome,
            None => soroban_sdk::panic_with_error!(&env, OutcomeError::CallNotSettled),
        }
    }

    pub fn has_claimed(env: Env, call_id: u64, staker: Address) -> bool {
        env.storage()
            .instance()
            .has(&InstanceKey::Claimed(call_id, staker))
    }

    /// Return the stored claimable balance ID for a staker, if one exists.
    pub fn get_claimable_balance_id(env: Env, call_id: u64, staker: Address) -> Option<BytesN<32>> {
        env.storage()
            .instance()
            .get(&InstanceKey::ClaimableBalanceId(call_id, staker))
    }

    pub fn get_quorum(env: Env) -> u32 {
        get_quorum(&env)
    }

    pub fn is_oracle(env: Env, oracle: BytesN<32>) -> bool {
        let oracles = get_oracles(&env);
        oracles.contains_key(oracle)
    }

    pub fn get_oracles(env: Env) -> Vec<BytesN<32>> {
        env.storage()
            .instance()
            .get(&InstanceKey::OracleList)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_oracle_count(env: Env) -> u32 {
        Self::get_oracles(env).len()
    }

    pub fn get_votes(env: Env, call_id: u64) -> Vec<OracleVote> {
        env.storage()
            .persistent()
            .get(&PersistentKey::Votes(call_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_vote_count(env: Env, call_id: u64) -> u32 {
        Self::get_votes(env, call_id).len()
    }

    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&InstanceKey::Version)
            .unwrap_or(CONTRACT_VERSION)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = match env.storage().instance().get(&InstanceKey::Admin) {
            Some(admin) => admin,
            None => soroban_sdk::panic_with_error!(&env, OutcomeError::NotInitialized),
        };
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

    pub fn submit_price_observation(
        env: Env,
        call_id: u64,
        call_end_ts: u64,
        observation: PriceObservation,
        oracle_pubkey: BytesN<32>,
        signature: BytesN<64>,
    ) {
        let oracles = get_oracles(&env);
        if !oracles.contains_key(oracle_pubkey.clone()) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::UnauthorizedOracle);
        }

        let mut raw = Bytes::from_slice(&env, b"twap_obs:");
        raw.append(&Bytes::from_slice(&env, &call_id.to_be_bytes()));
        raw.append(&Bytes::from_slice(&env, &observation.price.to_be_bytes()));
        raw.append(&Bytes::from_slice(
            &env,
            &observation.timestamp.to_be_bytes(),
        ));
        verify_signature(&env, &oracle_pubkey, &signature, &raw);

        let (window_secs, _) = get_twap_config(&env);
        let window_start = call_end_ts.saturating_sub(window_secs);
        if observation.timestamp < window_start || observation.timestamp > call_end_ts {
            soroban_sdk::panic_with_error!(&env, OutcomeError::ObservationOutsideWindow);
        }

        let key = TempKey::PriceObservations(call_id);
        let mut observations: Vec<PriceObservation> = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        if let Some(last) = observations.last() {
            if observation.timestamp <= last.timestamp {
                soroban_sdk::panic_with_error!(&env, OutcomeError::ObservationOutOfOrder);
            }
        }

        let price = observation.price;
        let timestamp = observation.timestamp;
        observations.push_back(observation);
        env.storage().temporary().set(&key, &observations);

        emit_price_observation_submitted(&env, call_id, &oracle_pubkey, price, timestamp);
    }

    /// Computes the TWAP for `call_id` over its stored observations,
    /// extended to `end_ts`. Panics (via typed `OutcomeError`) if there
    /// aren't enough observations to trust the result — see
    /// [`Self::resolve_price`] for a non-panicking fallback-aware variant.
    pub fn compute_twap(env: Env, call_id: u64, end_ts: u64) -> i128 {
        let key = TempKey::PriceObservations(call_id);
        let observations: Vec<PriceObservation> = match env.storage().temporary().get(&key) {
            Some(observations) => observations,
            None => soroban_sdk::panic_with_error!(&env, OutcomeError::NoPriceObservations),
        };

        let (window_secs, min_observations) = get_twap_config(&env);
        match try_compute_twap(&observations, end_ts, window_secs, min_observations) {
            Some(twap) => twap,
            None => soroban_sdk::panic_with_error!(&env, OutcomeError::InsufficientPriceObservations),
        }
    }

    /// Set the TWAP window length (seconds before a call's `end_ts`) and
    /// the minimum observation count required for a TWAP to be trusted
    /// (admin only).
    pub fn set_twap_config(env: Env, window_secs: u64, min_observations: u32) {
        require_admin(&env);
        set_twap_config(&env, window_secs, min_observations);
        emit_admin_params_changed(&env, window_secs);
    }

    /// Return the current `(window_secs, min_observations)` TWAP config.
    pub fn get_twap_config(env: Env) -> (u64, u32) {
        get_twap_config(&env)
    }

    /// Returns the resolution price for `call_id`: the TWAP over its final
    /// observations if there are enough to trust, otherwise
    /// `single_point_price` unchanged (e.g. an oracle's direct submission).
    /// Never panics — a market with no or insufficient observations
    /// (oracle downtime, a brand-new market) resolves exactly as it did
    /// before TWAP existed.
    pub fn resolve_price(env: Env, call_id: u64, end_ts: u64, single_point_price: i128) -> i128 {
        let key = TempKey::PriceObservations(call_id);
        let observations: Vec<PriceObservation> = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        let (window_secs, min_observations) = get_twap_config(&env);
        match try_compute_twap(&observations, end_ts, window_secs, min_observations) {
            Some(twap_price) => {
                emit_twap_computed(&env, call_id, twap_price, observations.len());
                twap_price
            }
            None => single_point_price,
        }
    }

    pub fn schedule_oracle_removal(env: Env, oracle_pubkey: BytesN<32>, effective_ledger: u32) {
        require_admin(&env);
        rotation::schedule_oracle_removal(&env, oracle_pubkey, effective_ledger);
    }

    pub fn execute_oracle_removal(env: Env, oracle_pubkey: BytesN<32>) {
        require_admin(&env);
        rotation::execute_oracle_removal(&env, oracle_pubkey);
    }

    pub fn is_oracle_active(env: Env, oracle_pubkey: BytesN<32>) -> bool {
        rotation::is_oracle_active(&env, &oracle_pubkey)
    }

    pub fn set_resolution_config(env: Env, confirmations: u32, min_blocks: u32) {
        require_admin(&env);
        set_resolution_config(&env, confirmations, min_blocks);
    }

    pub fn get_resolution_config(env: Env) -> (u32, u32) {
        get_resolution_config(&env)
    }

    pub fn submit_resolution_observation(
        env: Env,
        call_id: u64,
        observation: ResolutionObservation,
        signature: BytesN<64>,
    ) {
        let oracles = get_oracles(&env);
        if !oracles.contains_key(observation.oracle.clone()) {
            soroban_sdk::panic_with_error!(&env, OutcomeError::UnauthorizedOracle);
        }

        if env
            .storage()
            .instance()
            .has(&InstanceKey::FinalOutcome(call_id))
        {
            soroban_sdk::panic_with_error!(&env, OutcomeError::AlreadySettled);
        }

        let key = TempKey::ResolutionObservations(call_id);
        let mut observations: Vec<ResolutionObservation> = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        for i in 0..observations.len() {
            let existing = observations.get(i).unwrap();
            if existing.oracle == observation.oracle {
                soroban_sdk::panic_with_error!(&env, OutcomeError::DuplicateOracleObservation);
            }
        }

        observations.push_back(observation.clone());
        env.storage().temporary().set(&key, &observations);

        let (confirmations, min_blocks) = get_resolution_config(&env);
        if observations.len() < confirmations {
            return;
        }

        let first = observations.get(0).unwrap();
        let last = observations.get(observations.len() - 1).unwrap();
        let block_span = last.ledger_sequence.saturating_sub(first.ledger_sequence);
        if block_span < min_blocks {
            return;
        }

        let mut prices = soroban_sdk::Vec::new(&env);
        for i in 0..observations.len() {
            prices.push_back(observations.get(i).unwrap().price);
        }
        let median_price = Self::compute_median(&env, &prices);

        let outcome = Outcome {
            call_id,
            outcome: 1,
            price: median_price,
            timestamp: last.timestamp,
        };

        Self::finalize(&env, &get_registry(&env), outcome);
    }

    fn compute_median(env: &Env, prices: &Vec<i128>) -> i128 {
        let mut sorted = Vec::new(env);
        for i in 0..prices.len() {
            sorted.push_back(prices.get(i).unwrap());
        }
        for i in 0..sorted.len() {
            for j in (i + 1)..sorted.len() {
                if sorted.get(i).unwrap() > sorted.get(j).unwrap() {
                    let temp = sorted.get(i).unwrap();
                    sorted.set(i, sorted.get(j).unwrap());
                    sorted.set(j, temp);
                }
            }
        }
        let n = sorted.len();
        if n % 2 == 1 {
            sorted.get(n / 2).unwrap()
        } else {
            (sorted.get(n / 2 - 1).unwrap() + sorted.get(n / 2).unwrap()) / 2
        }
    }

    pub fn get_observation_count(env: Env, call_id: u64) -> u32 {
        let key = TempKey::ResolutionObservations(call_id);
        let observations: Vec<ResolutionObservation> = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        observations.len()
    }

    pub fn get_pending_resolution_price(env: Env, call_id: u64) -> Option<i128> {
        let key = TempKey::ResolutionObservations(call_id);
        let observations: Vec<ResolutionObservation> = env
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        if observations.is_empty() {
            return None;
        }

        let mut prices = soroban_sdk::Vec::new(&env);
        for i in 0..observations.len() {
            prices.push_back(observations.get(i).unwrap().price);
        }

        Some(Self::compute_median(&env, &prices))
    }
}
