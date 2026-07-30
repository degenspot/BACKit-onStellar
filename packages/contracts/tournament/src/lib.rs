#![no_std]

mod errors;
mod events;
mod storage;
mod types;

pub use types::{
    MarketEntry, ScoringWeights, Tournament, TournamentStanding, TournamentStatus,
};

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, Map, String, Vec};
use storage::*;

use errors::TournamentError;
use events::{
    emit_market_entered, emit_tournament_created, emit_tournament_finalized,
};

const MAX_SCORE: i128 = 10_000;
const BPS_DENOMINATOR: u32 = 10_000;

fn validate_weights(weights: &ScoringWeights) -> Result<(), TournamentError> {
    let sum = weights
        .volume_weight_bps
        .wrapping_add(weights.uniqueness_weight_bps)
        .wrapping_add(weights.accuracy_weight_bps);
    if sum != BPS_DENOMINATOR {
        return Err(TournamentError::InvalidWeights);
    }
    Ok(())
}

#[contract]
pub struct TournamentContract;

#[contractimpl]
impl TournamentContract {
    pub fn initialize(env: Env, admin: Address, factory: Address) {
        if get_admin(&env).is_some() {
            soroban_sdk::panic_with_error!(&env, TournamentError::AlreadyInitialized);
        }
        set_admin(&env, &admin);
        set_factory(&env, &factory);
        set_tournament_count(&env, 0);
    }

    pub fn create_tournament(
        env: Env,
        admin: Address,
        name: String,
        start_ts: u64,
        end_ts: u64,
        prize_pool: i128,
        scoring_weights: ScoringWeights,
        top_n: u32,
    ) -> u64 {
        admin.require_auth();

        let stored_admin = get_admin(&env)
            .ok_or(TournamentError::NotInitialized)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));
        if admin != stored_admin {
            soroban_sdk::panic_with_error!(&env, TournamentError::Unauthorized);
        }

        let current_ts = env.ledger().timestamp();
        if start_ts < current_ts || end_ts <= start_ts {
            soroban_sdk::panic_with_error!(&env, TournamentError::InvalidTimeRange);
        }
        if prize_pool <= 0 {
            soroban_sdk::panic_with_error!(&env, TournamentError::InvalidPrizePool);
        }
        if top_n == 0 {
            soroban_sdk::panic_with_error!(&env, TournamentError::InvalidTopN);
        }
        validate_weights(&scoring_weights)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));

        let count = get_tournament_count(&env);
        let tournament_id = count.wrapping_add(1);
        set_tournament_count(&env, tournament_id);

        let tournament = Tournament {
            id: tournament_id,
            name,
            start_ts,
            end_ts,
            prize_pool,
            scoring_weights,
            top_n,
            status: TournamentStatus::Active,
            created_at: current_ts,
        };
        set_tournament(&env, &tournament);
        set_market_entries(&env, tournament_id, &Map::new(&env));

        emit_tournament_created(
            &env,
            tournament_id,
            &admin,
            &tournament.name,
            start_ts,
            end_ts,
            prize_pool,
        );

        tournament_id
    }

    pub fn enter_market(
        env: Env,
        tournament_id: u64,
        creator: Address,
        call_id: u64,
    ) {
        let factory = get_factory(&env)
            .ok_or(TournamentError::NotInitialized)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));
        factory.require_auth();

        let tournament = get_tournament(&env, tournament_id)
            .ok_or(TournamentError::TournamentNotFound)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));

        if tournament.status != TournamentStatus::Active {
            soroban_sdk::panic_with_error!(&env, TournamentError::TournamentNotActive);
        }

        let current_ts = env.ledger().timestamp();
        if current_ts < tournament.start_ts || current_ts >= tournament.end_ts {
            soroban_sdk::panic_with_error!(&env, TournamentError::TournamentNotActive);
        }

        if get_market_entry_by_call_id(&env, call_id).is_some() {
            soroban_sdk::panic_with_error!(&env, TournamentError::MarketAlreadyEntered);
        }

        let mut entries = get_market_entries(&env, tournament_id).unwrap_or_else(|| Map::new(&env));
        if entries.contains_key(creator.clone()) {
            soroban_sdk::panic_with_error!(&env, TournamentError::MarketAlreadyEntered);
        }

        let entry = MarketEntry {
            call_id,
            total_stake: 0,
            unique_stakers: 0,
            resolved_correct: 0,
            resolved_total: 0,
        };
        entries.set(creator.clone(), entry);
        set_market_entries(&env, tournament_id, &entries);
        set_market_entry_by_call_id(&env, call_id, &(tournament_id, creator.clone()));

        emit_market_entered(&env, tournament_id, &creator, call_id);
    }

    pub fn update_market_stats(
        env: Env,
        tournament_id: u64,
        creator: Address,
        total_stake: i128,
        unique_stakers: u32,
        resolved_correct: u32,
        resolved_total: u32,
    ) {
        let factory = get_factory(&env)
            .ok_or(TournamentError::NotInitialized)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));
        factory.require_auth();

        let mut entries = get_market_entries(&env, tournament_id)
            .ok_or(TournamentError::TournamentNotFound)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));

        let mut entry = entries
            .get(creator.clone())
            .ok_or(TournamentError::ParticipantNotFound)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));

        entry.total_stake = total_stake;
        entry.unique_stakers = unique_stakers;
        entry.resolved_correct = resolved_correct;
        entry.resolved_total = resolved_total;

        entries.set(creator.clone(), entry);
        set_market_entries(&env, tournament_id, &entries);
    }

    pub fn calculate_score(
        env: Env,
        tournament_id: u64,
        participant: Address,
    ) -> i128 {
        let tournament = get_tournament(&env, tournament_id)
            .ok_or(TournamentError::TournamentNotFound)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));

        let entries = get_market_entries(&env, tournament_id)
            .ok_or(TournamentError::TournamentNotFound)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));

        let entry = entries
            .get(participant.clone())
            .ok_or(TournamentError::ParticipantNotFound)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));

        let weights = &tournament.scoring_weights;

        let volume_score = if entry.total_stake > 0 {
            let raw = entry.total_stake / 1_000_000;
            if raw > MAX_SCORE {
                MAX_SCORE
            } else {
                raw
            }
        } else {
            0
        };

        let uniqueness_score = {
            let raw = (entry.unique_stakers as i128) * 100;
            if raw > MAX_SCORE {
                MAX_SCORE
            } else {
                raw
            }
        };

        let accuracy_score = if entry.resolved_total > 0 {
            let ratio = (entry.resolved_correct as i128) * MAX_SCORE / (entry.resolved_total as i128);
            ratio
        } else {
            0
        };

        let weighted = (volume_score * (weights.volume_weight_bps as i128)
            + uniqueness_score * (weights.uniqueness_weight_bps as i128)
            + accuracy_score * (weights.accuracy_weight_bps as i128))
            / (BPS_DENOMINATOR as i128);

        weighted
    }

    pub fn finalize_tournament(env: Env, tournament_id: u64) {
        let admin = get_admin(&env)
            .ok_or(TournamentError::NotInitialized)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));
        admin.require_auth();

        let mut tournament = get_tournament(&env, tournament_id)
            .ok_or(TournamentError::TournamentNotFound)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));

        if tournament.status == TournamentStatus::Finalized {
            soroban_sdk::panic_with_error!(&env, TournamentError::TournamentAlreadyFinalized);
        }

        let current_ts = env.ledger().timestamp();
        if current_ts < tournament.end_ts {
            soroban_sdk::panic_with_error!(&env, TournamentError::TournamentNotFinalized);
        }

        let entries = get_market_entries(&env, tournament_id)
            .ok_or(TournamentError::TournamentNotFound)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));

        let participants: Vec<Address> = entries.keys();

        let mut scored: Vec<(Address, i128)> = Vec::new(&env);
        for i in 0..participants.len() {
            let p = participants.get(i).unwrap();
            let score = Self::calculate_score(env.clone(), tournament_id, p.clone());
            scored.push_back((p.clone(), score));
            set_participant_score(&env, tournament_id, &p, score);
        }

        let mut sorted = scored;
        let n = sorted.len();
        for i in 0..n {
            for j in i + 1..n {
                let a = sorted.get(i).unwrap();
                let b = sorted.get(j).unwrap();
                if b.1 > a.1 || (b.1 == a.1 && b.0 < a.0) {
                    let tmp_i = sorted.get(i).unwrap();
                    let tmp_j = sorted.get(j).unwrap();
                    sorted.set(i, (tmp_j.0.clone(), tmp_j.1));
                    sorted.set(j, (tmp_i.0.clone(), tmp_i.1));
                }
            }
        }

        let top_n = tournament.top_n.min(sorted.len() as u32);
        let total_prize = tournament.prize_pool;

        let mut standings: Vec<TournamentStanding> = Vec::new(&env);
        let winner = sorted.get(0).unwrap().0.clone();
        let mut winner_prize = 0;

        for i in 0..top_n {
            let (participant, score) = sorted.get(i as u32).unwrap();
            let prize = if top_n == 1 {
                total_prize
            } else if total_prize > 0 {
                let share = (top_n - i) as i128;
                let total_shares = (top_n * (top_n + 1) / 2) as i128;
                total_prize * share / total_shares
            } else {
                0
            };

            if i == 0 {
                winner_prize = prize;
            }

            standings.push_back(TournamentStanding {
                participant: participant.clone(),
                score,
                rank: i + 1,
                prize,
            });
        }

        for i in top_n..sorted.len() as u32 {
            let (participant, score) = sorted.get(i).unwrap();
            standings.push_back(TournamentStanding {
                participant: participant.clone(),
                score,
                rank: i + 1,
                prize: 0,
            });
        }

        set_standings(&env, tournament_id, &standings);

        tournament.status = TournamentStatus::Finalized;
        set_tournament(&env, &tournament);

        emit_tournament_finalized(
            &env,
            tournament_id,
            &winner,
            winner_prize,
            participants.len() as u32,
        );
    }

    pub fn get_tournament_standings(
        env: Env,
        tournament_id: u64,
        page: u32,
    ) -> Vec<TournamentStanding> {
        let standings = get_standings(&env, tournament_id)
            .ok_or(TournamentError::TournamentNotFound)
            .unwrap_or_else(|e| soroban_sdk::panic_with_error!(&env, e));

        let page_size: u32 = 10;
        let start = page.wrapping_mul(page_size) as usize;
        let end = start.wrapping_add(page_size as usize);

        let mut result: Vec<TournamentStanding> = Vec::new(&env);
        let len = standings.len() as usize;
        for i in start..end.min(len) {
            result.push_back(standings.get(i as u32).unwrap());
        }
        result
    }

    pub fn get_tournament(env: Env, tournament_id: u64) -> Option<Tournament> {
        get_tournament(&env, tournament_id)
    }

    pub fn get_tournament_count(env: Env) -> u64 {
        get_tournament_count(&env)
    }

    pub fn get_factory(env: Env) -> Option<Address> {
        get_factory(&env)
    }
}
