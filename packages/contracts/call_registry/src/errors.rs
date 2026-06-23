use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum CallRegistryError {
    /// `initialize` was called on an already-initialised contract.
    AlreadyInitialized = 1,
    /// A function that requires the contract to be initialised was called before `initialize`.
    NotInitialized = 2,
    /// `stake_amount` (or the `amount` passed to `stake_on_call`) is ≤ 0.
    InvalidStakeAmount = 3,
    /// `end_ts` is not strictly in the future relative to the current ledger timestamp.
    InvalidEndTime = 4,
    /// No call exists for the supplied `call_id`.
    CallNotFound = 5,
    /// The call's `end_ts` has already passed; staking is no longer allowed.
    CallEnded = 6,
    /// The call has already been settled; the operation is a no-op.
    CallSettled = 7,
    /// `position` is not `1` (UP) or `2` (DOWN).
    InvalidPosition = 8,
    /// The caller does not hold the required role (admin / outcome_manager).
    Unauthorized = 9,
    /// Reserved for a future pause mechanism; no operations are permitted while paused.
    ContractPaused = 10,
    /// `resolve_call` was called before `end_ts` has passed.
    CallNotEnded = 11,
    /// `outcome` passed to `resolve_call` is not `1` (UP) or `2` (DOWN).
    InvalidOutcome = 12,
    /// `outcome_count` is less than 2.
    InvalidOutcomeCount = 13,
    /// `fee_bps` exceeds 10 000 (100 %).
    FeeTooHigh = 14,
    /// Staking attempted within the cutoff window before `end_ts`.
    StakingCutoffActive = 15,
    /// The SEP-10 token's `valid_until` ledger sequence has passed.
    Sep10TokenExpired = 16,

    // ── Governance errors ──────────────────────────────────────────────────
    /// The proposer's (or voter's) cumulative stake volume is below the required threshold.
    InsufficientStake = 17,
    /// The requested voting_end_ledger is too close to the current ledger.
    VotingPeriodTooShort = 18,
    /// No governance proposal exists with the given ID.
    ProposalNotFound = 19,
    /// The proposal is not in `Active` status (already executed or rejected).
    ProposalNotActive = 20,
    /// The voting deadline has already elapsed; no more votes accepted.
    VotingEnded = 21,
    /// The voting deadline has not yet elapsed; execution is premature.
    VotingNotEnded = 22,
    /// The proposal did not reach the required quorum.
    QuorumNotMet = 23,
    /// The caller has already voted on this proposal.
    AlreadyVoted = 24,
}
