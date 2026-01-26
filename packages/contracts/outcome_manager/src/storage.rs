use soroban_sdk::{Env, BytesN};

#[derive(Clone)]
pub struct Outcome {
    pub call_id: u64,
    pub outcome: u32,
    pub price: i128,
    pub timestamp: u64,
}

#[derive(Clone)]
pub struct SignedOutcome {
    pub call_id: u64,
    pub outcome: u32,
    pub price: i128,
    pub timestamp: u64,
    pub oracle_pubkey: BytesN<32>,
    pub signature: BytesN<64>,
}

#[derive(Clone)]
pub enum InstanceKey {
    Admin,
    Oracles,
    Quorum,
    FinalOutcome(u64),
}

#[derive(Clone)]
pub enum TempKey {
    Submission(BytesN<32>, u64),      // (oracle_pubkey, call_id)
    VoteCount(BytesN<32>, u64),        // (outcome_hash, call_id)
}
