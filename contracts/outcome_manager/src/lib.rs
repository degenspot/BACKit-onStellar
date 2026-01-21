use soroban_sdk::{
    contract, contractimpl, Env, Address, BytesN, Map,
};

use crate::verification::{build_message, verify_signature};

#[contract]
pub struct OutcomeManager;

#[derive(Clone)]
pub enum DataKey {
    Admin,
    Oracles,
    Settled(u64),
}

#[contractimpl]
impl OutcomeManager {
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle_pubkey: BytesN<32>,
    ) {
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);

        let mut oracles = Map::<BytesN<32>, bool>::new(&env);
        oracles.set(oracle_pubkey, true);

        env.storage().instance().set(&DataKey::Oracles, &oracles);
    }

    pub fn add_oracle(env: Env, oracle: BytesN<32>) {
        let admin: Address =
            env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&DataKey::Oracles).unwrap();

        oracles.set(oracle, true);
        env.storage().instance().set(&DataKey::Oracles, &oracles);
    }

    pub fn remove_oracle(env: Env, oracle: BytesN<32>) {
        let admin: Address =
            env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&DataKey::Oracles).unwrap();

        oracles.remove(oracle);
        env.storage().instance().set(&DataKey::Oracles, &oracles);
    }

    pub fn submit_outcome(
        env: Env,
        call_id: u64,
        outcome: u32,
        final_price: i128,
        timestamp: u64,
        oracle_pubkey: BytesN<32>,
        signature: BytesN<64>,
    ) {
        let oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&DataKey::Oracles).unwrap();

        if !oracles.contains_key(oracle_pubkey.clone()) {
            panic!("Unauthorized oracle");
        }

        if env.storage().instance().has(&DataKey::Settled(call_id)) {
            panic!("Call already settled");
        }

        let message =
            build_message(&env, call_id, outcome, final_price, timestamp);

        if !verify_signature(&env, &oracle_pubkey, &signature, &message) {
            panic!("Invalid oracle signature");
        }

        env.storage()
            .instance()
            .set(&DataKey::Settled(call_id), &true);
    }

    pub fn withdraw_payout(env: Env, caller: Address, call_id: u64) {
        caller.require_auth();

        if !env.storage().instance().has(&DataKey::Settled(call_id)) {
            panic!("Call not settled");
        }

        // TODO: integrate with CallRegistry
    }
}
