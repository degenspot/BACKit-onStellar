use crate::types::{GasStationMetrics, SponsorshipInfo};
use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    XlmToken,
    Sponsorship(Address),
    /// Marks that the aggregate `outcome_manager` claim for this `call_id`
    /// has already been performed by this gas station (see the module doc
    /// comment on `claim_sponsored_payout` for the single-claim-per-call
    /// limitation this guards).
    CallProcessed(u64),
    Metrics,
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_xlm_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::XlmToken, token);
}

pub fn get_xlm_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::XlmToken)
}

pub fn set_sponsorship(env: &Env, user: &Address, info: &SponsorshipInfo) {
    env.storage()
        .instance()
        .set(&DataKey::Sponsorship(user.clone()), info);
}

pub fn get_sponsorship(env: &Env, user: &Address) -> Option<SponsorshipInfo> {
    env.storage().instance().get(&DataKey::Sponsorship(user.clone()))
}

pub fn get_metrics(env: &Env) -> GasStationMetrics {
    env.storage()
        .instance()
        .get(&DataKey::Metrics)
        .unwrap_or_else(GasStationMetrics::zero)
}

pub fn set_metrics(env: &Env, metrics: &GasStationMetrics) {
    env.storage().instance().set(&DataKey::Metrics, metrics);
}

pub fn is_call_processed(env: &Env, call_id: u64) -> bool {
    env.storage().instance().has(&DataKey::CallProcessed(call_id))
}

pub fn mark_call_processed(env: &Env, call_id: u64) {
    env.storage()
        .instance()
        .set(&DataKey::CallProcessed(call_id), &true);
}
