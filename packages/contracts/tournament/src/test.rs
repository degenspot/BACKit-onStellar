#![cfg(test)]
#![allow(deprecated)]

use crate::types::{ScoringWeights, TournamentStatus};
use crate::TournamentContract;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Address, Env, String, Vec};

fn default_weights() -> ScoringWeights {
    ScoringWeights {
        volume_weight_bps: 3000,
        uniqueness_weight_bps: 3000,
        accuracy_weight_bps: 4000,
    }
}

struct TestEnv {
    env: Env,
    contract_id: Address,
    admin: Address,
    factory: Address,
}

impl TestEnv {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let factory = Address::generate(&env);
        let contract_id = env.register_contract(None, TournamentContract);
        let te = Self {
            env,
            contract_id,
            admin,
            factory,
        };
        te.env.as_contract(&te.contract_id, || {
            TournamentContract::initialize(te.env.clone(), te.admin.clone(), te.factory.clone());
        });
        te
    }

    fn create_tournament(
        &self,
        name: &str,
        start_ts: u64,
        end_ts: u64,
        prize_pool: i128,
        weights: &ScoringWeights,
        top_n: u32,
    ) -> u64 {
        let admin = self.admin.clone();
        let w = weights.clone();
        let n = String::from_str(&self.env, name);
        self.env.as_contract(&self.contract_id, || {
            TournamentContract::create_tournament(
                self.env.clone(),
                admin.clone(),
                n.clone(),
                start_ts,
                end_ts,
                prize_pool,
                w.clone(),
                top_n,
            )
        })
    }

    fn enter_market(&self, tournament_id: u64, creator: &Address, call_id: u64) {
        let c = creator.clone();
        self.env.as_contract(&self.contract_id, || {
            TournamentContract::enter_market(self.env.clone(), tournament_id, c.clone(), call_id);
        });
    }

    fn update_market_stats(
        &self,
        tournament_id: u64,
        creator: &Address,
        total_stake: i128,
        unique_stakers: u32,
        resolved_correct: u32,
        resolved_total: u32,
    ) {
        let c = creator.clone();
        self.env.as_contract(&self.contract_id, || {
            TournamentContract::update_market_stats(
                self.env.clone(),
                tournament_id,
                c.clone(),
                total_stake,
                unique_stakers,
                resolved_correct,
                resolved_total,
            );
        });
    }

    fn calculate_score(&self, tournament_id: u64, participant: &Address) -> i128 {
        let p = participant.clone();
        self.env.as_contract(&self.contract_id, || {
            TournamentContract::calculate_score(self.env.clone(), tournament_id, p.clone())
        })
    }

    fn finalize_tournament(&self, tournament_id: u64) {
        self.env.as_contract(&self.contract_id, || {
            TournamentContract::finalize_tournament(self.env.clone(), tournament_id);
        });
    }

    fn get_tournament(
        &self,
        tournament_id: u64,
    ) -> Option<crate::types::Tournament> {
        self.env.as_contract(&self.contract_id, || {
            TournamentContract::get_tournament(self.env.clone(), tournament_id)
        })
    }

    fn get_tournament_standings(
        &self,
        tournament_id: u64,
        page: u32,
    ) -> Vec<crate::types::TournamentStanding> {
        self.env.as_contract(&self.contract_id, || {
            TournamentContract::get_tournament_standings(self.env.clone(), tournament_id, page)
        })
    }

    fn get_tournament_count(&self) -> u64 {
        self.env.as_contract(&self.contract_id, || {
            TournamentContract::get_tournament_count(self.env.clone())
        })
    }
}

#[test]
fn test_initialize() {
    let te = TestEnv::new();
    assert_eq!(te.get_tournament_count(), 0);
}

#[test]
#[should_panic(expected = "(Contract, #1)")]
fn test_initialize_twice() {
    let te = TestEnv::new();
    te.env.as_contract(&te.contract_id, || {
        TournamentContract::initialize(te.env.clone(), te.admin.clone(), te.factory.clone());
    });
}

#[test]
fn test_create_tournament() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();

    let id = te.create_tournament(
        "Tournament 1",
        now + 100,
        now + 1000,
        5_000_000,
        &default_weights(),
        5,
    );

    assert_eq!(id, 1);

    let tournament = te.get_tournament(1).unwrap();
    assert_eq!(tournament.id, 1);
    assert_eq!(tournament.name, String::from_str(&te.env, "Tournament 1"));
    assert_eq!(tournament.prize_pool, 5_000_000);
    assert_eq!(tournament.top_n, 5);
    assert_eq!(tournament.status, TournamentStatus::Active);
    assert_eq!(te.get_tournament_count(), 1);
}

#[test]
#[should_panic(expected = "(Contract, #7)")]
fn test_create_tournament_invalid_time() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();
    te.create_tournament("Bad", now + 1000, now + 500, 1_000_000, &default_weights(), 3);
}

#[test]
#[should_panic(expected = "(Contract, #8)")]
fn test_create_tournament_invalid_weights() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();

    let bad_weights = ScoringWeights {
        volume_weight_bps: 1000,
        uniqueness_weight_bps: 1000,
        accuracy_weight_bps: 1000,
    };
    te.create_tournament("Bad Weights", now + 100, now + 1000, 1_000_000, &bad_weights, 3);
}

#[test]
fn test_enter_market() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();

    let tid = te.create_tournament("T", now + 10, now + 1000, 1_000_000, &default_weights(), 3);

    te.env.ledger().set_timestamp(now + 50);

    let creator = Address::generate(&te.env);
    te.enter_market(tid, &creator, 1001);

    let score = te.calculate_score(tid, &creator);
    assert_eq!(score, 0);
}

#[test]
#[should_panic(expected = "(Contract, #9)")]
fn test_enter_market_duplicate() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();

    let tid = te.create_tournament("T", now + 10, now + 1000, 1_000_000, &default_weights(), 3);

    te.env.ledger().set_timestamp(now + 50);

    let creator = Address::generate(&te.env);
    te.enter_market(tid, &creator, 1001);
    te.enter_market(tid, &creator, 1002);
}

#[test]
fn test_calculate_score() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();

    let weights = ScoringWeights {
        volume_weight_bps: 5000,
        uniqueness_weight_bps: 2500,
        accuracy_weight_bps: 2500,
    };
    let tid = te.create_tournament("Score Test", now + 10, now + 1000, 1_000_000, &weights, 3);

    te.env.ledger().set_timestamp(now + 50);

    let creator = Address::generate(&te.env);
    te.enter_market(tid, &creator, 2001);

    te.update_market_stats(tid, &creator, 10_000_000_000, 100, 8, 10);

    let score = te.calculate_score(tid, &creator);
    assert_eq!(score, 9500);
}

#[test]
fn test_finalize_tournament() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();

    let tid = te.create_tournament(
        "Finalize Test",
        now + 10,
        now + 1000,
        10_000_000,
        &default_weights(),
        3,
    );

    te.env.ledger().set_timestamp(now + 50);

    let alice = Address::generate(&te.env);
    let bob = Address::generate(&te.env);
    let charlie = Address::generate(&te.env);

    te.enter_market(tid, &alice, 3001);
    te.enter_market(tid, &bob, 3002);
    te.enter_market(tid, &charlie, 3003);

    te.update_market_stats(tid, &alice, 20_000_000_000, 200, 9, 10);
    te.update_market_stats(tid, &bob, 10_000_000_000, 150, 7, 10);
    te.update_market_stats(tid, &charlie, 5_000_000_000, 50, 5, 10);

    te.env.ledger().set_timestamp(now + 2000);

    te.finalize_tournament(tid);

    let tournament = te.get_tournament(tid).unwrap();
    assert_eq!(tournament.status, TournamentStatus::Finalized);

    let standings = te.get_tournament_standings(tid, 0);
    assert_eq!(standings.len(), 3);

    let first = standings.get(0).unwrap();
    assert_eq!(first.rank, 1);
    assert_eq!(first.prize, 5_000_000);

    let second = standings.get(1).unwrap();
    assert_eq!(second.rank, 2);

    let third = standings.get(2).unwrap();
    assert_eq!(third.rank, 3);
}

#[test]
#[should_panic(expected = "(Contract, #5)")]
fn test_finalize_twice() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();

    let tid = te.create_tournament(
        "Double Finalize",
        now + 10,
        now + 100,
        1_000_000,
        &default_weights(),
        1,
    );

    te.env.ledger().set_timestamp(now + 50);

    let creator = Address::generate(&te.env);
    te.enter_market(tid, &creator, 4001);

    te.env.ledger().set_timestamp(now + 200);
    te.finalize_tournament(tid);
    te.finalize_tournament(tid);
}

#[test]
fn test_get_tournament_count() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();

    assert_eq!(te.get_tournament_count(), 0);

    te.create_tournament("T1", now + 100, now + 1000, 1_000_000, &default_weights(), 3);
    assert_eq!(te.get_tournament_count(), 1);

    te.create_tournament("T2", now + 200, now + 2000, 2_000_000, &default_weights(), 5);
    assert_eq!(te.get_tournament_count(), 2);
}

#[test]
fn test_get_tournament_nonexistent() {
    let te = TestEnv::new();

    let result = te.get_tournament(999);
    assert!(result.is_none());
}

#[test]
fn test_prize_distribution_single_winner() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();

    let tid = te.create_tournament(
        "Single Winner",
        now + 10,
        now + 100,
        5_000_000,
        &default_weights(),
        1,
    );

    te.env.ledger().set_timestamp(now + 50);

    let winner = Address::generate(&te.env);
    te.enter_market(tid, &winner, 5001);
    te.update_market_stats(tid, &winner, 10_000_000_000, 100, 10, 10);

    te.env.ledger().set_timestamp(now + 200);
    te.finalize_tournament(tid);

    let standings = te.get_tournament_standings(tid, 0);
    assert_eq!(standings.len(), 1);
    assert_eq!(standings.get(0).unwrap().prize, 5_000_000);
}

#[test]
fn test_paginated_standings() {
    let te = TestEnv::new();
    let now = te.env.ledger().timestamp();

    let tid = te.create_tournament(
        "Pagination",
        now + 10,
        now + 100,
        10_000_000,
        &default_weights(),
        3,
    );

    te.env.ledger().set_timestamp(now + 50);

    for i in 0..15 {
        let p = Address::generate(&te.env);
        te.enter_market(tid, &p, 6000 + i as u64);
        te.update_market_stats(
            tid,
            &p,
            (15 - i) as i128 * 1_000_000_000,
            (15 - i) as u32 * 10,
            (15 - i) as u32,
            10,
        );
    }

    te.env.ledger().set_timestamp(now + 200);
    te.finalize_tournament(tid);

    let page0 = te.get_tournament_standings(tid, 0);
    assert_eq!(page0.len(), 10);

    let page1 = te.get_tournament_standings(tid, 1);
    assert_eq!(page1.len(), 5);

    let page2 = te.get_tournament_standings(tid, 2);
    assert_eq!(page2.len(), 0);
}
