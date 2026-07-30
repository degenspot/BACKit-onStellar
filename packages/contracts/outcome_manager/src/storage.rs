use soroban_sdk::{contracttype, Address, BytesN, Env};

/// Represents a finalized outcome after quorum is reached
#[contracttype]
#[derive(Clone)]
pub struct Outcome {
    pub call_id: u64,
    /// 1 = UP, 2 = DOWN
    pub outcome: u32,
    /// Final price in the oracle's fixed-point representation
    pub price: i128,
    /// Unix timestamp of the oracle observation
    pub timestamp: u64,
}

/// A signed price/outcome report from a single trusted oracle
#[contracttype]
#[derive(Clone)]
pub struct SignedOutcome {
    pub call_id: u64,
    /// 1 = UP, 2 = DOWN
    pub outcome: u32,
    pub price: i128,
    pub timestamp: u64,
    /// Oracle's raw ed25519 public key (32 bytes)
    pub oracle_pubkey: BytesN<32>,
    /// ed25519 signature of the canonical message
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleVote {
    pub oracle: BytesN<32>,
    pub outcome: u32,
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum InstanceKey {
    Admin,
    Oracles,
    OracleList,
    Quorum,
    FinalOutcome(u64),
    Claimed(u64, Address),
    FeeCollector,
    FeeBps,
    /// Stored CallRegistry / market address; set via `set_registry`.
    Registry,
    /// Factory that deploys per-market instances; set via `set_factory`.
    Factory,
    DisputeWindow,
    PendingOutcome(u64),     // stores Outcome after quorum, before finalization
    DisputeWindowStart(u64), // ledger timestamp when quorum was reached
    Paused,                  // Emergency pause flag for rogue oracle detection
    Version,
    MaxSubmissionDelay,
    /// Map of (call_id, staker) -> claimable balance ID (32-byte Stellar balance ID)
    ClaimableBalanceId(u64, Address),
    /// SDEX deviation threshold in basis points (default 500 = 5%)
    SdexThresholdBps,
    /// TWAP window length in seconds, counting back from a call's `end_ts`.
    /// Default 600 (10 minutes).
    TwapWindowSecs,
    /// Minimum price observations required for a TWAP to be considered
    /// valid. Default 3.
    TwapMinObservations,
    /// Minimum confirmations for flash-loan-resistant multi-block resolution.
    /// Default 5.
    ResolutionConfirmations,
    /// Minimum ledger blocks that must separate the first and last resolution
    /// observation. Default 3.
    ResolutionMinBlocks,
    /// Ledger timestamp (seconds) at which `call_id` was settled — i.e. the
    /// moment `FinalOutcome(call_id)` was written, via either the immediate
    /// quorum path (`Self::finalize`) or the dispute-window path
    /// (`finalize_outcome`). Used to measure the social-recovery grace period.
    SettledAt(u64),
    /// Grace period (seconds) that must elapse after a call is settled
    /// before a designated recovery address may claim an unclaimed payout
    /// on the original winner's behalf. Default 30 days (2_592_000s).
    RecoveryGracePeriodSecs,
}

#[contracttype]
#[derive(Clone)]
pub enum PersistentKey {
    Votes(u64),
    /// Pending oracle removal: value is the effective_ledger at which removal takes effect.
    PendingOracleRemoval(BytesN<32>),
    /// Pending oracle addition: reserved for scheduled oracle onboarding.
    PendingOracleAdditions(BytesN<32>),
    /// Social recovery: maps a user's address to the trusted recovery
    /// address they've designated via `set_recovery_address`. Per-user, so
    /// this lives in persistent (not instance) storage — see
    /// `PersistentKey::Votes` for the established pattern of keying
    /// per-entity persistent data off this enum.
    RecoveryAddress(Address),
}

/// A single price data point submitted by an oracle for TWAP calculation
#[contracttype]
#[derive(Clone)]
pub struct PriceObservation {
    pub price: i128,
    pub timestamp: u64,
}

/// A multi-block resolution observation from a single oracle (flash loan
/// resistant: requires observations spanning >= `min_confirmation_blocks`).
#[contracttype]
#[derive(Clone)]
pub struct ResolutionObservation {
    pub oracle: BytesN<32>,
    pub price: i128,
    pub timestamp: u64,
    pub ledger_sequence: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum TempKey {
    Submission(BytesN<32>, u64),
    VoteCount(BytesN<32>, u64),
    PriceObservations(u64),
    ResolutionObservations(u64),
}

/// Store the CallRegistry address in instance storage.
pub fn set_registry(env: &Env, registry: Address) {
    env.storage()
        .instance()
        .set(&InstanceKey::Registry, &registry);
}

#[allow(dead_code)]
pub fn get_registry_opt(env: &Env) -> Option<Address> {
    env.storage().instance().get(&InstanceKey::Registry)
}

pub fn set_factory(env: &Env, factory: Address) {
    env.storage()
        .instance()
        .set(&InstanceKey::Factory, &factory);
}

pub fn get_factory_opt(env: &Env) -> Option<Address> {
    env.storage().instance().get(&InstanceKey::Factory)
}

/// Read the stored CallRegistry address; panics if not set.
#[allow(dead_code)]
pub fn get_registry(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&InstanceKey::Registry)
        .expect("registry not set")
}

pub fn set_dispute_window(env: &Env, secs: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::DisputeWindow, &secs);
}

pub fn get_dispute_window(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::DisputeWindow)
        .unwrap_or(3600)
}

pub fn set_max_submission_delay(env: &Env, delay: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::MaxSubmissionDelay, &delay);
}

pub fn get_max_submission_delay(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::MaxSubmissionDelay)
        .unwrap_or(86400)
}

pub const DEFAULT_TWAP_WINDOW_SECS: u64 = 600;
pub const DEFAULT_TWAP_MIN_OBSERVATIONS: u32 = 3;
pub const DEFAULT_RESOLUTION_CONFIRMATIONS: u32 = 5;
pub const DEFAULT_MIN_CONFIRMATION_BLOCKS: u32 = 3;

pub fn set_twap_config(env: &Env, window_secs: u64, min_observations: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::TwapWindowSecs, &window_secs);
    env.storage()
        .instance()
        .set(&InstanceKey::TwapMinObservations, &min_observations);
}

pub fn get_twap_config(env: &Env) -> (u64, u32) {
    let window_secs = env
        .storage()
        .instance()
        .get(&InstanceKey::TwapWindowSecs)
        .unwrap_or(DEFAULT_TWAP_WINDOW_SECS);
    let min_observations = env
        .storage()
        .instance()
        .get(&InstanceKey::TwapMinObservations)
        .unwrap_or(DEFAULT_TWAP_MIN_OBSERVATIONS);
    (window_secs, min_observations)
}

// ─── Resolution config (flash loan resistant) ───────────────────────────────

pub fn set_resolution_config(env: &Env, confirmations: u32, min_blocks: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::ResolutionConfirmations, &confirmations);
    env.storage()
        .instance()
        .set(&InstanceKey::ResolutionMinBlocks, &min_blocks);
}

pub fn get_resolution_config(env: &Env) -> (u32, u32) {
    let confirmations: u32 = env
        .storage()
        .instance()
        .get(&InstanceKey::ResolutionConfirmations)
        .unwrap_or(DEFAULT_RESOLUTION_CONFIRMATIONS);
    let min_blocks: u32 = env
        .storage()
        .instance()
        .get(&InstanceKey::ResolutionMinBlocks)
        .unwrap_or(DEFAULT_MIN_CONFIRMATION_BLOCKS);
    (confirmations, min_blocks)
}

// ─── Social recovery ────────────────────────────────────────────────────────

/// 30 days, in seconds — the default grace period before a designated
/// recovery address may claim an unclaimed payout on the original winner's
/// behalf.
pub const DEFAULT_RECOVERY_GRACE_PERIOD_SECS: u64 = 30 * 24 * 60 * 60;

/// Record the ledger timestamp at which `call_id` was settled. Called at the
/// exact moment `FinalOutcome(call_id)` is written (both the immediate-quorum
/// path and the dispute-window path).
pub fn set_settled_at(env: &Env, call_id: u64, ts: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::SettledAt(call_id), &ts);
}

/// Read the settlement timestamp for `call_id`, if recorded.
pub fn get_settled_at_opt(env: &Env, call_id: u64) -> Option<u64> {
    env.storage().instance().get(&InstanceKey::SettledAt(call_id))
}

pub fn set_recovery_grace_period(env: &Env, secs: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::RecoveryGracePeriodSecs, &secs);
}

pub fn get_recovery_grace_period(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::RecoveryGracePeriodSecs)
        .unwrap_or(DEFAULT_RECOVERY_GRACE_PERIOD_SECS)
}

/// Set (or overwrite) `user`'s designated recovery address.
pub fn set_recovery_address(env: &Env, user: Address, recovery_address: Address) {
    env.storage()
        .persistent()
        .set(&PersistentKey::RecoveryAddress(user), &recovery_address);
}

/// Read `user`'s designated recovery address, if any.
pub fn get_recovery_address_opt(env: &Env, user: Address) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&PersistentKey::RecoveryAddress(user))
}

/// Remove `user`'s designated recovery address, if one is set.
pub fn remove_recovery_address(env: &Env, user: Address) {
    env.storage()
        .persistent()
        .remove(&PersistentKey::RecoveryAddress(user));
}
