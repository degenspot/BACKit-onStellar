use crate::storage::{InstanceKey, PersistentKey};
use soroban_sdk::{BytesN, Env, Map};

/// Schedule an oracle key for removal at a future ledger sequence.
/// The oracle remains valid for submissions until `effective_ledger` is reached.
pub fn schedule_oracle_removal(env: &Env, oracle_pubkey: BytesN<32>, effective_ledger: u32) {
    assert!(
        effective_ledger > env.ledger().sequence(),
        "effective_ledger must be in the future"
    );

    env.storage()
        .persistent()
        .set(&PersistentKey::PendingOracleRemoval(oracle_pubkey), &effective_ledger);
}

/// Execute a scheduled oracle removal once the grace period has elapsed.
/// Panics if no removal is scheduled or the grace period has not passed.
pub fn execute_oracle_removal(env: &Env, oracle_pubkey: BytesN<32>) {
    let key = PersistentKey::PendingOracleRemoval(oracle_pubkey.clone());

    let effective_ledger: u32 = env
        .storage()
        .persistent()
        .get(&key)
        .expect("no removal scheduled for this oracle");

    assert!(
        env.ledger().sequence() >= effective_ledger,
        "grace period has not elapsed"
    );

    // Remove the oracle from the active set
    let mut oracles: Map<BytesN<32>, bool> = env
        .storage()
        .instance()
        .get(&InstanceKey::Oracles)
        .unwrap_or_else(|| Map::new(env));

    oracles.remove(oracle_pubkey.clone());
    env.storage().instance().set(&InstanceKey::Oracles, &oracles);

    // Clean up the dedicated persistent entry
    env.storage().persistent().remove(&key);
}

/// Returns true if the oracle is still active at the current ledger.
/// An oracle is inactive if it is not in the oracle set, or if a removal
/// is scheduled and the effective ledger has already been reached.
pub fn is_oracle_active(env: &Env, oracle_pubkey: &BytesN<32>) -> bool {
    let oracles: Map<BytesN<32>, bool> = env
        .storage()
        .instance()
        .get(&InstanceKey::Oracles)
        .unwrap_or_else(|| Map::new(env));

    if !oracles.get(oracle_pubkey.clone()).unwrap_or(false) {
        return false;
    }

    let pending: Option<u32> = env
        .storage()
        .persistent()
        .get(&PersistentKey::PendingOracleRemoval(oracle_pubkey.clone()));

    if let Some(effective_ledger) = pending {
        return env.ledger().sequence() < effective_ledger;
    }

    true
}
