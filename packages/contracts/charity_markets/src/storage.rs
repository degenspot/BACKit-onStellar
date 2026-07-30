use crate::types::CharityCall;
use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    OutcomeManager,
    StakeToken,
    NextCallId,
    CharityCall(u64),
    UserStake(u64, Address, u32),
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_outcome_manager(env: &Env, mgr: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::OutcomeManager, mgr);
}

pub fn get_outcome_manager(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::OutcomeManager)
}

pub fn set_stake_token(env: &Env, token: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::StakeToken, token);
}

pub fn get_stake_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::StakeToken)
}

pub fn set_next_call_id(env: &Env, id: u64) {
    env.storage()
        .instance()
        .set(&DataKey::NextCallId, &id);
}

pub fn get_next_call_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextCallId)
        .unwrap_or(1)
}

pub fn set_charity_call(env: &Env, call_id: u64, call: &CharityCall) {
    env.storage()
        .instance()
        .set(&DataKey::CharityCall(call_id), call);
}

pub fn get_charity_call(env: &Env, call_id: u64) -> Option<CharityCall> {
    env.storage()
        .instance()
        .get(&DataKey::CharityCall(call_id))
}

pub fn set_user_stake(
    env: &Env,
    call_id: u64,
    staker: &Address,
    outcome: u32,
    amount: i128,
) {
    env.storage()
        .instance()
        .set(
            &DataKey::UserStake(call_id, staker.clone(), outcome),
            &amount,
        );
}

#[allow(dead_code)]
pub fn get_user_stake(env: &Env, call_id: u64, staker: &Address, outcome: u32) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::UserStake(call_id, staker.clone(), outcome))
        .unwrap_or(0)
}
