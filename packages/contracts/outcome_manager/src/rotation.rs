use crate::storage::InstanceKey;
use soroban_sdk::{contracttype, BytesN, Env, Map};

/// A scheduled oracle removal — oracle remains valid until `effective_ledger`.
#[contracttype]
#[derive(Clone)]
pub struct PendingRemoval {
    pub oracle_pubkey: BytesN<32>,
    pub effective_ledger: u32,
}

const PENDING_REMOVALS_KEY: InstanceKey = InstanceKey::Admin; // placeholder — use a dedicated key in prod

/// Schedule an oracle key for removal at a future ledger sequence.
/// The oracle remains valid for submissions until `effective_ledger` is reached.
pub fn schedule_oracle_removal(env: &Env, oracle_pubkey: BytesN<32>, effective_ledger: u32) {
    assert!(effective_ledger > env.ledger().sequence(), "effective_ledger must be in the future");

    let mut pending: Map<BytesN<32>, u32> = env
        .storage()
        .instance()
        .get(&InstanceKey::Quorum) // reuse slot for demo; use a dedicated key in prod
        .unwrap_or_else(|| Map::new(env));

    pending.set(oracle_pubkey, effective_ledger);
    env.storage().instance().set(&InstanceKey::Quorum, &pending);
}

/// Returns true if the oracle is still valid at the current ledger.
pub fn is_oracle_active(env: &Env, oracle_pubkey: &BytesN<32>) -> bool {
    let oracles: Map<BytesN<32>, bool> = env
        .storage()
        .instance()
        .get(&InstanceKey::Oracles)
        .unwrap_or_else(|| Map::new(env));

    if !oracles.get(oracle_pubkey.clone()).unwrap_or(false) {
        return false;
    }

    // Check if a removal is scheduled and the grace period has passed
    let pending: Map<BytesN<32>, u32> = env
        .storage()
        .instance()
        .get(&InstanceKey::Quorum)
        .unwrap_or_else(|| Map::new(env));

    if let Some(effective_ledger) = pending.get(oracle_pubkey.clone()) {
        return env.ledger().sequence() < effective_ledger;
    }

    true
}