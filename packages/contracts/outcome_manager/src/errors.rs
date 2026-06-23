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
