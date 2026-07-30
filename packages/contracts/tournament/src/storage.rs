use crate::types::{MarketEntry, Tournament, TournamentStanding};
use soroban_sdk::{contracttype, Address, Env, Map, Vec};

#[contracttype]
pub enum InstanceKey {
    Admin,
    Factory,
    TournamentCount,
}

#[contracttype]
pub enum PersistentKey {
    Tournament(u64),
    MarketEntries(u64),
    ParticipantScores(u64, Address),
    TournamentStandings(u64),
    MarketEntryByCallId(u64),
}

// ─── Instance storage ─────────────────────────────────────────────────────────

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&InstanceKey::Admin)
}

pub fn set_factory(env: &Env, factory: &Address) {
    env.storage().instance().set(&InstanceKey::Factory, factory);
}

pub fn get_factory(env: &Env) -> Option<Address> {
    env.storage().instance().get(&InstanceKey::Factory)
}

pub fn set_tournament_count(env: &Env, count: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::TournamentCount, &count);
}

pub fn get_tournament_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::TournamentCount)
        .unwrap_or(0)
}

// ─── Persistent storage ───────────────────────────────────────────────────────

pub fn set_tournament(env: &Env, tournament: &Tournament) {
    env.storage()
        .persistent()
        .set(&PersistentKey::Tournament(tournament.id), tournament);
}

pub fn get_tournament(env: &Env, tournament_id: u64) -> Option<Tournament> {
    env.storage()
        .persistent()
        .get(&PersistentKey::Tournament(tournament_id))
}

pub fn set_market_entries(env: &Env, tournament_id: u64, entries: &Map<Address, MarketEntry>) {
    env.storage()
        .persistent()
        .set(&PersistentKey::MarketEntries(tournament_id), entries);
}

pub fn get_market_entries(env: &Env, tournament_id: u64) -> Option<Map<Address, MarketEntry>> {
    env.storage()
        .persistent()
        .get(&PersistentKey::MarketEntries(tournament_id))
}

pub fn set_participant_score(
    env: &Env,
    tournament_id: u64,
    participant: &Address,
    score: i128,
) {
    env.storage()
        .persistent()
        .set(
            &PersistentKey::ParticipantScores(tournament_id, participant.clone()),
            &score,
        );
}

#[allow(dead_code)]
pub fn get_participant_score(
    env: &Env,
    tournament_id: u64,
    participant: &Address,
) -> Option<i128> {
    env.storage()
        .persistent()
        .get(&PersistentKey::ParticipantScores(
            tournament_id,
            participant.clone(),
        ))
}

pub fn set_standings(env: &Env, tournament_id: u64, standings: &Vec<TournamentStanding>) {
    env.storage()
        .persistent()
        .set(
            &PersistentKey::TournamentStandings(tournament_id),
            standings,
        );
}

pub fn get_standings(env: &Env, tournament_id: u64) -> Option<Vec<TournamentStanding>> {
    env.storage()
        .persistent()
        .get(&PersistentKey::TournamentStandings(tournament_id))
}

pub fn set_market_entry_by_call_id(env: &Env, call_id: u64, entry: &(u64, Address)) {
    env.storage()
        .persistent()
        .set(&PersistentKey::MarketEntryByCallId(call_id), entry);
}

pub fn get_market_entry_by_call_id(env: &Env, call_id: u64) -> Option<(u64, Address)> {
    env.storage()
        .persistent()
        .get(&PersistentKey::MarketEntryByCallId(call_id))
}
