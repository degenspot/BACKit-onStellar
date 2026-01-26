mod storage;
mod auth;
mod verification;

use soroban_sdk::{
    contract, contractimpl, Env, Address, Map, Vec, BytesN,
};

use storage::{Outcome, SignedOutcome, InstanceKey, TempKey};
use auth::require_admin;
use verification::{build_message, verify_signature};

#[contract]
pub struct OutcomeManager;

#[contractimpl]
impl OutcomeManager {
    // -------- Initialization --------

    pub fn initialize(
        env: Env,
        admin: Address,
        oracles: Vec<BytesN<32>>,
        quorum: u32,
    ) {
        admin.require_auth();

        if quorum == 0 || quorum > oracles.len() as u32 {
            panic!("invalid quorum");
        }

        let mut oracle_map = Map::<BytesN<32>, bool>::new(&env);
        for o in oracles {
            oracle_map.set(o, true);
        }

        env.storage().instance().set(&InstanceKey::Admin, &admin);
        env.storage().instance().set(&InstanceKey::Oracles, &oracle_map);
        env.storage().instance().set(&InstanceKey::Quorum, &quorum);
    }

    // -------- Admin Controls --------

    pub fn add_oracle(env: Env, oracle: BytesN<32>) {
        require_admin(&env);

        let mut oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&InstanceKey::Oracles).unwrap();

        oracles.set(oracle, true);
        env.storage().instance().set(&InstanceKey::Oracles, &oracles);
    }

    pub fn remove_oracle(env: Env, oracle: BytesN<32>) {
        require_admin(&env);

        let mut oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&InstanceKey::Oracles).unwrap();

        oracles.remove(oracle);
        env.storage().instance().set(&InstanceKey::Oracles, &oracles);
    }

    pub fn set_quorum(env: Env, quorum: u32) {
        require_admin(&env);

        let oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&InstanceKey::Oracles).unwrap();

        if quorum == 0 || quorum > oracles.len() as u32 {
            panic!("invalid quorum");
        }

        env.storage().instance().set(&InstanceKey::Quorum, &quorum);
    }

    // -------- Oracle Submission --------

    pub fn submit_outcome(env: Env, signed: SignedOutcome) {
        let oracles: Map<BytesN<32>, bool> =
            env.storage().instance().get(&InstanceKey::Oracles).unwrap();

        if !oracles.contains_key(signed.oracle_pubkey.clone()) {
            panic!("unauthorized oracle");
        }

        if env.storage().instance().has(&InstanceKey::FinalOutcome(signed.call_id)) {
            panic!("already settled");
        }

        if env
            .storage()
            .temporary()
            .has(&TempKey::Submission(
                signed.oracle_pubkey.clone(),
                signed.call_id,
            ))
        {
            panic!("duplicate submission");
        }

        let message = build_message(
            &env,
            signed.call_id,
            signed.outcome,
            signed.price,
            signed.timestamp,
        );

        if !verify_signature(
            &env,
            &signed.oracle_pubkey,
            &signed.signature,
            &message,
        ) {
            panic!("invalid signature");
        }

        let outcome_hash = env.crypto().sha256(&message);

        env.storage().temporary().set(
            &TempKey::Submission(signed.oracle_pubkey, signed.call_id),
            &outcome_hash,
        );

        let votes: u32 = env
            .storage()
            .temporary()
            .get(&TempKey::VoteCount(outcome_hash.clone(), signed.call_id))
            .unwrap_or(0);

        let votes = votes + 1;

        env.storage().temporary().set(
            &TempKey::VoteCount(outcome_hash.clone(), signed.call_id),
            &votes,
        );

        let quorum: u32 =
            env.storage().instance().get(&InstanceKey::Quorum).unwrap();

        if votes >= quorum {
            Self::finalize(
                env,
                Outcome {
                    call_id: signed.call_id,
                    outcome: signed.outcome,
                    price: signed.price,
                    timestamp: signed.timestamp,
                },
            );
        }
    }

    fn finalize(env: Env, outcome: Outcome) {
        env.storage().instance().set(
            &InstanceKey::FinalOutcome(outcome.call_id),
            &outcome,
        );

        env.events().publish(
            ("outcome", "finalized"),
            outcome.call_id,
        );
    }
}