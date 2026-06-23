use soroban_sdk::{symbol_short, Env};

/// Emitted when a new oracle outcome report is accepted (before quorum)
pub fn emit_outcome_submitted(
    env: &Env,
    call_id: u64,
    oracle: &soroban_sdk::BytesN<32>,
    outcome: u32,
) {
    env.events().publish(
        (symbol_short!("outcome"), symbol_short!("submitted")),
        (call_id, oracle.clone(), outcome),
    );
}

/// Emitted when quorum is reached and the call is finalized
pub fn emit_outcome_finalized(env: &Env, call_id: u64, outcome: u32, price: i128) {
    env.events().publish(
        (symbol_short!("outcome"), symbol_short!("finalized")),
        (call_id, outcome, price),
    );
}

/// Emitted when a winning staker claims their payout
pub fn emit_payout_claimed(env: &Env, call_id: u64, staker: &soroban_sdk::Address, amount: i128) {
    env.events().publish(
        (symbol_short!("payout"), symbol_short!("claimed")),
        (call_id, staker.clone(), amount),
    );
}

/// Emitted when the protocol fee is collected during payout settlement
pub fn emit_fee_collected(
    env: &Env,
    call_id: u64,
    fee_amount: i128,
    fee_collector: &soroban_sdk::Address,
) {
    env.events().publish(
        (symbol_short!("fee"), symbol_short!("collected")),
        (call_id, fee_amount, fee_collector.clone()),
    );
}

/// Emitted once at the start of a batch settlement
pub fn emit_batch_payout_started(env: &Env, call_id: u64, staker_count: u32) {
    env.events().publish(
        (symbol_short!("payout"), symbol_short!("batch")),
        (call_id, staker_count),
    );
}

/// Emitted when the admin overrides a pending outcome during the dispute window.
///
/// `new_outcome` and `new_price` reflect the corrected values. The outcome
/// still needs `finalize_outcome` to be called once the window closes.
pub fn emit_outcome_disputed(env: &Env, call_id: u64, new_outcome: u32, new_price: i128) {
    env.events().publish(
        (symbol_short!("outcome"), symbol_short!("disputed")),
        (call_id, new_outcome, new_price),
    );
}

/// Emitted when the admin pauses the contract.
///
/// While paused, `submit_outcome` and `claim_payout` revert with
/// [`OutcomeError::ContractPaused`].
pub fn emit_contract_paused(env: &Env) {
    env.events()
        .publish((symbol_short!("contract"), symbol_short!("paused")), ());
}

/// Emitted when the admin unpauses the contract, resuming normal operations.
pub fn emit_contract_unpaused(env: &Env) {
    env.events()
        .publish((symbol_short!("contract"), symbol_short!("unpaused")), ());
}

/// Emitted when the contract WASM is upgraded
pub fn emit_contract_upgraded(
    env: &Env,
    old_version: u32,
    new_version: u32,
    admin: &soroban_sdk::Address,
) {
    env.events().publish(
        ("outcome_manager", "contract_upgraded"),
        (old_version, new_version, admin.clone()),
    );
}

/// Emitted when an admin updates a contract configuration parameter
pub fn emit_admin_params_changed(env: &Env, new_max_submission_delay: u64) {
    env.events()
        .publish(("admin", "params_changed"), new_max_submission_delay);
}

/// Emitted when an oracle submits a price observation for TWAP
pub fn emit_price_observation_submitted(
    env: &Env,
    call_id: u64,
    oracle: &soroban_sdk::BytesN<32>,
    price: i128,
    timestamp: u64,
) {
    env.events().publish(
        (symbol_short!("twap"), symbol_short!("obs_sub")),
        (call_id, oracle.clone(), price, timestamp),
    );
}

/// Emitted when a claimable balance is created for a winning staker
pub fn emit_claimable_balance_created(
    env: &Env,
    call_id: u64,
    staker: &soroban_sdk::Address,
    balance_id: &soroban_sdk::BytesN<32>,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("claimbal"), symbol_short!("created")),
        (call_id, staker.clone(), balance_id.clone(), amount),
    );
}

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OutcomeError {
    /// `initialize` was called on an already-initialized contract.
    AlreadyInitialized = 1,
    /// `quorum` is 0 or exceeds the current oracle count.
    InvalidQuorum = 2,
    /// The oracle public key is not in the trusted oracle set.
    UnauthorizedOracle = 3,
    /// Quorum was already reached; the call outcome is already settled.
    AlreadySettled = 4,
    /// This oracle already submitted a vote for the given `call_id`.
    DuplicateSubmission = 5,
    /// The outcome value is not within [1, outcome_count].
    InvalidOutcome = 6,
    /// `claim_payout` was called before quorum was reached.
    CallNotSettled = 7,
    /// The staker has already claimed their payout for this `call_id`.
    AlreadyClaimed = 8,
    /// The staker's winning stake is 0; there is nothing to claim.
    NothingToClaim = 9,
    /// `total_winning_stake` is 0 or negative; payout cannot be calculated.
    InvalidWinningStake = 10,
    /// An arithmetic operation overflowed; the transaction is reverted.
    Overflow = 11,
    /// No pending outcome exists, or the dispute window has not yet elapsed.
    CallNotFinalized = 12,
    /// `fee_bps` exceeds 10 000 (100%).
    InvalidFeeBps = 13,
    /// The contract is paused; `submit_outcome` and `claim_payout` are blocked.
    ContractPaused = 14,
    /// Adding an oracle would exceed the `MAX_ORACLES` cap of 20.
    MaxOraclesReached = 15,
    /// The oracle's `timestamp` is after `call_end_ts + max_submission_delay`.
    SubmissionWindowExpired = 16,
    /// `batch_claim_payouts` was called with an empty `stakers` vec.
    EmptyBatch = 17,
    /// `stakers` and `stakes` vecs passed to `batch_claim_payouts` differ in length.
    LengthMismatch = 18,
    /// A function requiring initialization was called before `initialize`.
    NotInitialized = 19,
    /// A fee collector address has not been set yet.
    FeeCollectorNotSet = 20,
    /// A price observation was submitted out of chronological order.
    ObservationOutOfOrder = 21,
    /// `compute_twap` was called but fewer than 3 price observations are stored.
    InsufficientPriceObservations = 22,
    /// `compute_twap` was called but no price observations exist for this call.
    NoPriceObservations = 23,
    /// All stored observations share the same timestamp; TWAP window is zero.
    ZeroTimeWindow = 24,
    /// The `CallRegistry` address has not been set in instance storage.
    RegistryNotSet = 25,
    /// `dispute_outcome` was called after the dispute window has already closed.
    DisputeWindowExpired = 26,
}
