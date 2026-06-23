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
}
