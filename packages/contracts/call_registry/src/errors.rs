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
    /// Generic not found error for requested entity (e.g., proposal)
    NotFound = 20,
    /// Invalid input was provided to the operation
    InvalidInput = 21,
    /// The operation is not ready to be executed yet (timelock not expired)
    NotReady = 22,
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
    /// Re-entrant call detected on a guarded function.
    ReentrancyDetected = 17,
    /// A checked arithmetic operation (multiplication, division, addition, or
    /// subtraction) would have overflowed/underflowed or divided by zero.
    /// Raised by the reputation-weighted stake-limit calculations and any
    /// other checked-math call sites in this crate.
    Overflow = 18,
}

/// Panics with [`CallRegistryError::Overflow`]. Shared helper for checked
/// arithmetic call sites across the crate (mirrors the equivalent
/// `overflow<T>` helper used in the `outcome_manager` crate for the same
/// purpose, so both contracts fail the same deterministic way on overflow
/// instead of relying on raw wrapping/panicking arithmetic operators).
pub fn overflow<T>(env: &soroban_sdk::Env) -> T {
    soroban_sdk::panic_with_error!(env, CallRegistryError::Overflow);
}
