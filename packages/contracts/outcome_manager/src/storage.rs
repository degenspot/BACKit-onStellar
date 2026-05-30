use soroban_sdk::{contracttype, Address, BytesN};

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

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum InstanceKey {
    /// The admin address
    Admin,
    /// Map<BytesN<32>, bool> of trusted oracle pubkeys
    Oracles,
    /// Minimum number of matching oracle votes needed to finalize
    Quorum,
    /// FinalOutcome(call_id) ─ set once a call is settled
    FinalOutcome(u64),
    /// Claimed(call_id, staker) ─ prevents double-claims
    Claimed(u64, Address),
    /// Address that receives protocol fees
    FeeCollector,
    /// Fee in basis points (0–10000)
    FeeBps,
}

/// Short-lived keys cleared after settlement (temporary storage tier)
#[contracttype]
#[derive(Clone)]
pub enum TempKey {
    /// (oracle_pubkey, call_id) ─ guards against duplicate oracle submissions
    Submission(BytesN<32>, u64),
    /// (outcome_hash, call_id) ─ vote tally per outcome candidate before quorum
    VoteCount(BytesN<32>, u64),
}
