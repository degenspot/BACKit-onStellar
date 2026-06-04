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
    /// Stored CallRegistry address; set via set_registry() to avoid caller-supplied forgery
    Registry,
    DisputeWindow,
    PendingOutcome(u64),     // stores Outcome after quorum, before finalization
    DisputeWindowStart(u64), // ledger timestamp when quorum was reached
    Paused,                  // Emergency pause flag for rogue oracle detection
    Version,
    MaxSubmissionDelay,
}

#[contracttype]
#[derive(Clone)]
pub enum PersistentKey {
    Votes(u64),
}


/// A single price data point submitted by an oracle for TWAP calculation
#[contracttype]
#[derive(Clone)]
pub struct PriceObservation {
    pub price: i128,
    pub timestamp: u64,
}
#[contracttype]
#[derive(Clone)]
pub enum TempKey {
    Submission(BytesN<32>, u64),
    VoteCount(BytesN<32>, u64),
    PriceObservations(u64),
}

/// Store the CallRegistry address in instance storage.
pub fn set_registry(env: &Env, registry: Address) {
    env.storage()
        .instance()
        .set(&InstanceKey::Registry, &registry);
}

/// Read the stored CallRegistry address; panics if not set.
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
