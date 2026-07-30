//! Raw cross-contract call helpers for `prediction_market_factory` and
//! `outcome_manager`.
//!
//! This crate deliberately does **not** take a real Cargo dependency on
//! either of those contract crates (unlike `prediction-market`, which it does
//! depend on — see `lib.rs`'s use of `PredictionMarketClient`). Linking two
//! or more `#[contract]` crates' generated code into the *same* WASM binary
//! makes every one of their `#[contractimpl]`-exported function names a WASM
//! export of *this* binary too, and several of those names collide across
//! `prediction_market_factory` / `outcome_manager` / `prediction_market`
//! (e.g. all three export a same-named `get_factory`/`get_config`/`pause`
//! function for their own unrelated purposes) — `rust-lld` fails with
//! "duplicate symbol" as soon as more than one of them is a production
//! dependency of the same deployable contract. `parlay_betting` sidesteps
//! this by depending on `prediction-market` alone and reaching
//! `outcome_manager` only via `env.invoke_contract`; `outcome_manager` itself
//! does the same thing to reach its registry/factory (see its
//! `call_types.rs` mirror of `call_registry`'s types). This module follows
//! the identical pattern for the two contracts this pool talks to besides
//! `prediction_market`.
//!
//! Both contract crates remain real `[dev-dependencies]` so the test suite
//! can deploy and drive real instances of them (their exports only collide
//! when linked into one WASM binary — deploying them as separate contract
//! instances during a native test run has no such conflict).

use soroban_sdk::{contracterror, Address, Env, IntoVal, Symbol};

use crate::errors::LendingPoolError;
use crate::types::PoolConfig;

/// Mirrors `prediction_market_factory::errors::FactoryError` 1:1 so this
/// crate can decode its `Result<Address, FactoryError>` return value without
/// depending on that crate (see module doc comment).
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
enum FactoryMirrorError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidStakeAmount = 4,
    InvalidEndTime = 5,
    InvalidOutcomeCount = 6,
    TokenNotWhitelisted = 7,
    ContractPaused = 8,
    MarketWasmNotSet = 9,
    MarketNotFound = 10,
    StrategyNotFound = 11,
    StrategyAlreadyExecuted = 12,
    StrategyCancelled = 13,
    StrategyExpired = 14,
    TooManyActions = 15,
    StrategyNotExecutable = 16,
}

/// Mirrors `outcome_manager::errors::OutcomeError` 1:1 so this crate can
/// decode a panic-turned-host-error from `claim_payout_for_market` (see
/// module doc comment).
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
enum OutcomeMirrorError {
    AlreadyInitialized = 1,
    InvalidQuorum = 2,
    UnauthorizedOracle = 3,
    AlreadySettled = 4,
    DuplicateSubmission = 5,
    InvalidOutcome = 6,
    CallNotSettled = 7,
    AlreadyClaimed = 8,
    NothingToClaim = 9,
    InvalidWinningStake = 10,
    Overflow = 11,
    CallNotFinalized = 12,
    InvalidFeeBps = 13,
    ContractPaused = 14,
    MaxOraclesReached = 15,
    SubmissionWindowExpired = 16,
    EmptyBatch = 17,
    LengthMismatch = 18,
    NotInitialized = 19,
    FeeCollectorNotSet = 20,
    ObservationOutOfOrder = 21,
    InsufficientPriceObservations = 22,
    NoPriceObservations = 23,
    ZeroTimeWindow = 24,
    RegistryNotSet = 25,
    DisputeWindowExpired = 26,
    FactoryNotSet = 27,
    InvalidMarket = 28,
    ObservationOutsideWindow = 29,
    NotRecoveryAgent = 30,
    RecoveryGracePeriodNotElapsed = 31,
}

/// Resolve `call_id`'s deployed market address via the configured
/// `prediction_market_factory` instance's `get_market` view function.
pub fn resolve_market_address(
    env: &Env,
    config: &PoolConfig,
    call_id: u64,
) -> Result<Address, LendingPoolError> {
    let args = (call_id,).into_val(env);
    let result: Result<Address, FactoryMirrorError> = env.invoke_contract(
        &config.prediction_market_factory,
        &Symbol::new(env, "get_market"),
        args,
    );
    result.map_err(|_| LendingPoolError::MarketCallFailed)
}

/// Claim this pool's payout for `call_id` via `outcome_manager`'s
/// `claim_payout_for_market`, which itself calls back into
/// `prediction_market::release_escrow` to move the tokens into this
/// contract's balance. That function has no `Result` return type of its own
/// — failures surface as a panic-turned-host-error, so this uses
/// `try_invoke_contract` (not the plain `invoke_contract` used above) to
/// catch that as a `Result` instead of aborting this contract's whole
/// transaction.
pub fn claim_payout_for_market(
    env: &Env,
    config: &PoolConfig,
    call_id: u64,
    staker: &Address,
    staker_winning_stake: i128,
    total_winning_stake: i128,
    total_losing_stake: i128,
) -> Result<(), LendingPoolError> {
    let args = (
        call_id,
        staker.clone(),
        staker_winning_stake,
        total_winning_stake,
        total_losing_stake,
    )
        .into_val(env);
    let result: Result<Result<(), soroban_sdk::ConversionError>, Result<OutcomeMirrorError, soroban_sdk::InvokeError>> =
        env.try_invoke_contract(&config.outcome_manager, &Symbol::new(env, "claim_payout_for_market"), args);
    match result {
        Ok(Ok(())) => Ok(()),
        _ => Err(LendingPoolError::MarketCallFailed),
    }
}
