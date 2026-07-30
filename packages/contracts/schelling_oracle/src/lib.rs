//! Commit-reveal Schelling point oracle for dispute resolution (issue #467).
//!
//! The existing oracle (`outcome_manager`) is a trusted set of ed25519
//! signers. This contract adds a permissionless, game-theoretically sound
//! dispute layer on top: anyone can dispute a reported outcome by bonding
//! stake, anyone can vote on the dispute by staking, and — because votes are
//! submitted as a commit-reveal pair rather than in the clear — voters can't
//! copy the current apparent majority, which is what makes the mechanism a
//! genuine [Schelling point](https://en.wikipedia.org/wiki/Focal_point_(game_theory))
//! rather than a popularity contest.
//!
//! **Scope decision (deliberate, not an oversight).** This crate does **not**
//! take a cross-contract dependency on `outcome_manager`, `call_registry`, or
//! `prediction_market` to read a market's real outcome/pool. Doing so would
//! couple this contract's storage layout and upgrade cadence to those crates,
//! which — per the constraints this work was scoped under — must stay
//! untouched and isolated from this change. Instead, `dispute_outcome`
//! accepts `original_outcome`, `total_pool_amount` and `stake_token` as
//! caller-supplied, trusted parameters. This mirrors an existing pattern
//! already in this codebase: `outcome_manager::submit_outcome` accepts a
//! caller-supplied `call_end_ts` rather than reading it cross-contract. In a
//! production deployment, the caller (a keeper bot, or `outcome_manager`
//! itself via a future integration) is trusted to pass accurate values; nothing
//! here re-derives them from an on-chain oracle read.
//!
//! ## The game
//!
//! 1. [`SchellingOracle::dispute_outcome`] — anyone opens a dispute against
//!    `call_id`'s reported `original_outcome`, claiming `disputed_outcome` is
//!    correct instead, and locks up a bond (`>= total_pool_amount * bond_bps`).
//!    This starts the **commit phase**, `voting_period_secs` long.
//! 2. [`SchellingOracle::vote_on_dispute`] — during the commit phase, anyone
//!    stakes `stake_amount` and submits `sha256(vote_outcome_be_bytes ++ salt)`
//!    rather than their vote in the clear, so nobody can copy the apparent
//!    majority. This starts (once the commit phase ends) the **reveal phase**,
//!    `reveal_period_secs` long.
//! 3. [`SchellingOracle::reveal_vote`] — during the reveal phase, each voter
//!    reveals `(vote_outcome, salt)`; the contract recomputes the hash and
//!    rejects any reveal that doesn't match the original commitment. Voters
//!    who never reveal forfeit their stake entirely (see
//!    [`SchellingOracle::resolve_dispute`]).
//! 4. [`SchellingOracle::resolve_dispute`] — callable by anyone once the
//!    reveal phase ends. Tallies revealed stake on each side; whichever side
//!    has strictly more revealed stake wins. See that function's doc comment
//!    for the exact (and slightly asymmetric, per the issue's own wording)
//!    payout math.
//!
//! ## Judgment call: `vote_on_dispute`'s signature
//!
//! The issue's acceptance-criteria bullet literally lists
//! `vote_on_dispute(env, voter, dispute_id, vote_outcome, stake_amount)` —
//! but its very next bullet describes a commit-reveal scheme where the
//! commit phase must submit a *hash*, not a plaintext `vote_outcome` (a
//! plaintext vote at commit time would defeat the entire point of
//! commit-reveal — anyone could copy the current tally). These two bullets
//! are contradictory as literally written. This implementation resolves the
//! contradiction in favor of the commit-reveal requirement (which is called
//! out as the specific anti-copycat mechanism the issue wants) and keeps the
//! `vote_on_dispute` name for the commit-phase call, but with a
//! `commitment_hash: BytesN<32>` parameter in place of a plaintext
//! `vote_outcome`. Revealing happens in the separate [`SchellingOracle::reveal_vote`].
#![no_std]

mod errors;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

use errors::OracleError;
use events::{
    emit_dispute_opened, emit_dispute_resolved, emit_vote_committed, emit_vote_revealed,
};
use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env};
use storage::*;
use types::{Dispute, DisputeConfig, DisputeResult, VoteCommitment};

/// Bounds per-dispute gas/storage cost the same way `parlay_betting` bounds
/// leg count and `outcome_manager` bounds oracle count.
pub const MAX_VOTERS_PER_DISPUTE: u32 = 200;

const BPS_DENOMINATOR: i128 = 10_000;

// ─── Token transfer helper ──────────────────────────────────────────────────
// Mirrors `prediction_market::transfer_token` exactly: native XLM must be
// moved via `StellarAssetClient` while ordinary SAC tokens use `token::Client`.

#[cfg(not(test))]
fn is_native_xlm(env: &Env, addr: &Address) -> bool {
    let sentinel = Address::from_string(&soroban_sdk::String::from_str(
        env,
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    ));
    *addr == sentinel
}

#[cfg(test)]
fn is_native_xlm(env: &Env, addr: &Address) -> bool {
    let key = soroban_sdk::Symbol::new(env, "xlm_sac_addr");
    if let Some(sentinel) = env.storage().instance().get::<_, Address>(&key) {
        return *addr == sentinel;
    }
    false
}

fn transfer_token(env: &Env, stake_token: &Address, from: &Address, to: &Address, amount: i128) {
    if is_native_xlm(env, stake_token) {
        token::StellarAssetClient::new(env, stake_token).transfer(from, to, &amount);
    } else {
        token::Client::new(env, stake_token).transfer(from, to, &amount);
    }
}

/// `sha256("schelling_vote:" ++ vote_outcome.to_be_bytes() ++ salt)`, mirroring
/// `outcome_manager::submit_price_observation`'s canonical byte-message style.
fn commitment_hash(env: &Env, vote_outcome: u32, salt: &BytesN<32>) -> BytesN<32> {
    let mut raw = Bytes::from_slice(env, b"schelling_vote:");
    raw.append(&Bytes::from_slice(env, &vote_outcome.to_be_bytes()));
    raw.append(&Bytes::from_slice(env, &salt.to_array()));
    env.crypto().sha256(&raw).into()
}

fn checked_add(a: i128, b: i128) -> Result<i128, OracleError> {
    a.checked_add(b).ok_or(OracleError::Overflow)
}

fn checked_mul(a: i128, b: i128) -> Result<i128, OracleError> {
    a.checked_mul(b).ok_or(OracleError::Overflow)
}

fn checked_div(a: i128, b: i128) -> Result<i128, OracleError> {
    a.checked_div(b).ok_or(OracleError::Overflow)
}

fn checked_sub(a: i128, b: i128) -> Result<i128, OracleError> {
    a.checked_sub(b).ok_or(OracleError::Overflow)
}

fn compute_min_bond(total_pool_amount: i128, bond_bps: u32) -> Result<i128, OracleError> {
    checked_div(checked_mul(total_pool_amount, bond_bps as i128)?, BPS_DENOMINATOR)
}

#[contract]
pub struct SchellingOracle;

#[contractimpl]
impl SchellingOracle {
    pub fn initialize(
        env: Env,
        admin: Address,
        voting_period_secs: u64,
        reveal_period_secs: u64,
        bond_bps: u32,
    ) -> Result<(), OracleError> {
        if get_config(&env).is_some() {
            return Err(OracleError::AlreadyInitialized);
        }
        admin.require_auth();
        validate_params(voting_period_secs, reveal_period_secs, bond_bps)?;

        set_config(
            &env,
            &DisputeConfig {
                admin,
                voting_period_secs,
                reveal_period_secs,
                bond_bps,
            },
        );
        Ok(())
    }

    /// Admin-only. Updates the voting/reveal window lengths and bond
    /// requirement used for every dispute opened *after* this call (disputes
    /// already open keep the deadlines/bond they were created with).
    pub fn set_dispute_params(
        env: Env,
        admin: Address,
        voting_period_secs: u64,
        reveal_period_secs: u64,
        bond_bps: u32,
    ) -> Result<(), OracleError> {
        let mut config = get_config(&env).ok_or(OracleError::NotInitialized)?;
        if config.admin != admin {
            return Err(OracleError::Unauthorized);
        }
        admin.require_auth();
        validate_params(voting_period_secs, reveal_period_secs, bond_bps)?;

        config.voting_period_secs = voting_period_secs;
        config.reveal_period_secs = reveal_period_secs;
        config.bond_bps = bond_bps;
        set_config(&env, &config);
        Ok(())
    }

    /// The minimum bond required to dispute a market with `total_pool_amount`
    /// staked, under the *current* `bond_bps`. A pure view — useful for
    /// clients to preview the required bond before calling `dispute_outcome`.
    pub fn min_bond_amount(env: Env, total_pool_amount: i128) -> Result<i128, OracleError> {
        let config = get_config(&env).ok_or(OracleError::NotInitialized)?;
        compute_min_bond(total_pool_amount, config.bond_bps)
    }

    /// Opens a dispute against `call_id`'s `original_outcome`, claiming
    /// `disputed_outcome` instead, and locks `bond_amount` of `stake_token`
    /// from `disputer`. `bond_amount` must be at least
    /// `total_pool_amount * bond_bps / 10_000`.
    ///
    /// See the crate-level doc comment for why `original_outcome`,
    /// `total_pool_amount` and `stake_token` are caller-supplied rather than
    /// read cross-contract.
    pub fn dispute_outcome(
        env: Env,
        disputer: Address,
        call_id: u64,
        original_outcome: u32,
        disputed_outcome: u32,
        total_pool_amount: i128,
        stake_token: Address,
        bond_amount: i128,
    ) -> Result<u64, OracleError> {
        disputer.require_auth();
        let config = get_config(&env).ok_or(OracleError::NotInitialized)?;

        if original_outcome == 0 || disputed_outcome == 0 {
            return Err(OracleError::InvalidOutcome);
        }
        if original_outcome == disputed_outcome {
            return Err(OracleError::SameOutcome);
        }
        if total_pool_amount <= 0 {
            return Err(OracleError::InvalidPoolAmount);
        }
        if bond_amount <= 0 {
            return Err(OracleError::InvalidBondAmount);
        }

        let min_bond = compute_min_bond(total_pool_amount, config.bond_bps)?;
        if bond_amount < min_bond {
            return Err(OracleError::BondBelowMinimum);
        }

        let contract_address = env.current_contract_address();
        transfer_token(&env, &stake_token, &disputer, &contract_address, bond_amount);

        let now = env.ledger().timestamp();
        let commit_deadline = now
            .checked_add(config.voting_period_secs)
            .ok_or(OracleError::Overflow)?;
        let reveal_deadline = commit_deadline
            .checked_add(config.reveal_period_secs)
            .ok_or(OracleError::Overflow)?;

        let dispute_id = next_dispute_id(&env);
        let dispute = Dispute {
            id: dispute_id,
            call_id,
            disputer: disputer.clone(),
            original_outcome,
            disputed_outcome,
            stake_token,
            bond_amount,
            total_pool_amount,
            commit_deadline,
            reveal_deadline,
            result: DisputeResult::Pending,
        };
        set_dispute(&env, &dispute);

        emit_dispute_opened(
            &env,
            dispute_id,
            call_id,
            &disputer,
            original_outcome,
            disputed_outcome,
            bond_amount,
            commit_deadline,
            reveal_deadline,
        );

        Ok(dispute_id)
    }

    /// Phase 1 (Commit). `voter` stakes `stake_amount` and submits
    /// `commitment_hash = sha256("schelling_vote:" ++ vote_outcome_be_bytes ++ salt)`.
    /// Only usable before the dispute's commit deadline. One commitment per
    /// `(dispute_id, voter)`.
    pub fn vote_on_dispute(
        env: Env,
        voter: Address,
        dispute_id: u64,
        commitment_hash: BytesN<32>,
        stake_amount: i128,
    ) -> Result<(), OracleError> {
        voter.require_auth();
        let dispute = get_dispute(&env, dispute_id).ok_or(OracleError::DisputeNotFound)?;

        if dispute.result != DisputeResult::Pending {
            return Err(OracleError::AlreadyResolved);
        }
        if env.ledger().timestamp() >= dispute.commit_deadline {
            return Err(OracleError::CommitPeriodEnded);
        }
        if stake_amount <= 0 {
            return Err(OracleError::InvalidStakeAmount);
        }
        if get_commitment(&env, dispute_id, &voter).is_some() {
            return Err(OracleError::AlreadyCommitted);
        }
        if get_voters(&env, dispute_id).len() >= MAX_VOTERS_PER_DISPUTE {
            return Err(OracleError::TooManyVoters);
        }

        let contract_address = env.current_contract_address();
        transfer_token(
            &env,
            &dispute.stake_token,
            &voter,
            &contract_address,
            stake_amount,
        );

        set_commitment(
            &env,
            dispute_id,
            &voter,
            &VoteCommitment {
                commitment_hash: commitment_hash.clone(),
                stake_amount,
                revealed: false,
                revealed_outcome: 0,
            },
        );
        append_voter(&env, dispute_id, &voter);

        emit_vote_committed(&env, dispute_id, &voter, &commitment_hash, stake_amount);
        Ok(())
    }

    /// Phase 2 (Reveal). `voter` reveals the `(vote_outcome, salt)` pair
    /// behind their earlier commitment. Only usable strictly between the
    /// dispute's commit and reveal deadlines. `vote_outcome` must be either
    /// the dispute's `original_outcome` or `disputed_outcome` — any other
    /// value is rejected (there is no third option to vote for).
    pub fn reveal_vote(
        env: Env,
        voter: Address,
        dispute_id: u64,
        vote_outcome: u32,
        salt: BytesN<32>,
    ) -> Result<(), OracleError> {
        voter.require_auth();
        let dispute = get_dispute(&env, dispute_id).ok_or(OracleError::DisputeNotFound)?;

        if dispute.result != DisputeResult::Pending {
            return Err(OracleError::AlreadyResolved);
        }
        let now = env.ledger().timestamp();
        if now < dispute.commit_deadline {
            return Err(OracleError::RevealPeriodNotStarted);
        }
        if now >= dispute.reveal_deadline {
            return Err(OracleError::RevealPeriodEnded);
        }
        if vote_outcome != dispute.original_outcome && vote_outcome != dispute.disputed_outcome {
            return Err(OracleError::InvalidVoteOutcome);
        }

        let mut commitment =
            get_commitment(&env, dispute_id, &voter).ok_or(OracleError::NoCommitmentFound)?;
        if commitment.revealed {
            return Err(OracleError::AlreadyRevealed);
        }

        let expected_hash = commitment_hash(&env, vote_outcome, &salt);
        if expected_hash != commitment.commitment_hash {
            return Err(OracleError::CommitmentMismatch);
        }

        commitment.revealed = true;
        commitment.revealed_outcome = vote_outcome;
        set_commitment(&env, dispute_id, &voter, &commitment);

        emit_vote_revealed(&env, dispute_id, &voter, vote_outcome, commitment.stake_amount);
        Ok(())
    }

    /// Callable by anyone once the reveal phase has ended. Tallies revealed
    /// stake on each side and distributes bonds/stakes accordingly, then
    /// marks the dispute resolved.
    ///
    /// **Payout math**, resolving the majority-vote rule and the "the
    /// disputer earns the bond of the incorrect voters" / "the disputer's
    /// bond is distributed to correct voters" wording from the issue (which,
    /// read literally, is intentionally asymmetric rather than a naive 50/50
    /// split — see the judgment-call note below):
    ///
    /// - Unrevealed (committed but never revealed) voters forfeit their
    ///   entire stake unconditionally, regardless of which side wins.
    /// - **If the majority of revealed stake sided with `disputed_outcome`**
    ///   (disputer wins): the disputer receives their bond back *plus* the
    ///   full forfeited pool (losing voters' stake + unrevealed stake).
    ///   Voters who revealed `disputed_outcome` (the correct side) simply
    ///   get their own stake back — they bore no risk of loss, so they take
    ///   no share of the reward; the disputer, who *did* risk their bond to
    ///   raise the dispute, captures the entire reward.
    /// - **Otherwise** (disputer loses, including an exact tie or nobody
    ///   revealing for `disputed_outcome`): the disputer's bond is forfeited
    ///   in full, and — together with the losing side's forfeited stake and
    ///   any unrevealed stake — is distributed pro-rata (weighted by stake)
    ///   among voters who revealed `original_outcome`, *in addition to* those
    ///   voters getting their own stake back.
    /// - **Edge case:** if literally nobody ever committed a vote, the
    ///   dispute resolves as `Void` and the disputer's bond is simply
    ///   refunded (there is no participation to judge the dispute against).
    /// - **Edge case:** if the winning side described above has zero
    ///   revealed stake (this can only happen when both sides have zero
    ///   revealed stake, i.e. everyone who committed either sat out the
    ///   reveal or none exist), the pool that would have been distributed to
    ///   winning voters is instead sent to the contract's admin/treasury
    ///   address, so funds are never stranded or divided by zero.
    ///
    /// Judgment call: the issue's payout wording is asymmetric on its face
    /// (only the disputer is said to "earn the incorrect voters' bond" when
    /// right; only the *voters* are said to receive the disputer's bond when
    /// the disputer is wrong — voters are never said to receive a bonus when
    /// they're the ones who happen to be right alongside a right disputer).
    /// This implementation takes that wording literally rather than
    /// "fixing" it into a symmetric split, since a literal reading is a
    /// defensible design (the disputer uniquely bears the bond risk that
    /// creates the dispute in the first place, so is uniquely rewarded for
    /// being right) and the issue doesn't ask for symmetry explicitly.
    pub fn resolve_dispute(env: Env, dispute_id: u64) -> Result<(), OracleError> {
        let mut dispute = get_dispute(&env, dispute_id).ok_or(OracleError::DisputeNotFound)?;
        if dispute.result != DisputeResult::Pending {
            return Err(OracleError::AlreadyResolved);
        }
        if env.ledger().timestamp() < dispute.reveal_deadline {
            return Err(OracleError::RevealPeriodNotEnded);
        }

        let contract_address = env.current_contract_address();
        let voters = get_voters(&env, dispute_id);

        if voters.is_empty() {
            transfer_token(
                &env,
                &dispute.stake_token,
                &contract_address,
                &dispute.disputer,
                dispute.bond_amount,
            );
            dispute.result = DisputeResult::Void;
            set_dispute(&env, &dispute);
            emit_dispute_resolved(&env, dispute_id, DisputeResult::Void, 0);
            return Ok(());
        }

        // Pass 1: tally revealed stake on each side plus unrevealed (forfeit) stake.
        let mut original_total: i128 = 0;
        let mut disputed_total: i128 = 0;
        let mut unrevealed_total: i128 = 0;
        for voter in voters.iter() {
            let commitment = get_commitment(&env, dispute_id, &voter)
                .ok_or(OracleError::NoCommitmentFound)?;
            if !commitment.revealed {
                unrevealed_total = checked_add(unrevealed_total, commitment.stake_amount)?;
            } else if commitment.revealed_outcome == dispute.original_outcome {
                original_total = checked_add(original_total, commitment.stake_amount)?;
            } else {
                disputed_total = checked_add(disputed_total, commitment.stake_amount)?;
            }
        }

        let disputer_wins = disputed_total > original_total;
        let distributed: i128;

        if disputer_wins {
            let reward_for_disputer = checked_add(original_total, unrevealed_total)?;
            let disputer_payout = checked_add(dispute.bond_amount, reward_for_disputer)?;
            transfer_token(
                &env,
                &dispute.stake_token,
                &contract_address,
                &dispute.disputer,
                disputer_payout,
            );
            distributed = reward_for_disputer;

            for voter in voters.iter() {
                let commitment = get_commitment(&env, dispute_id, &voter)
                    .ok_or(OracleError::NoCommitmentFound)?;
                if commitment.revealed && commitment.revealed_outcome == dispute.disputed_outcome {
                    transfer_token(
                        &env,
                        &dispute.stake_token,
                        &contract_address,
                        &voter,
                        commitment.stake_amount,
                    );
                }
            }
        } else {
            let reward_pool = checked_add(
                checked_add(dispute.bond_amount, disputed_total)?,
                unrevealed_total,
            )?;
            distributed = reward_pool;

            if original_total == 0 {
                // Nobody revealed for the winning side: nothing to weight
                // the reward by. Route the entire pool to the treasury
                // (admin) rather than stranding it or dividing by zero.
                let config = get_config(&env).ok_or(OracleError::NotInitialized)?;
                transfer_token(
                    &env,
                    &dispute.stake_token,
                    &contract_address,
                    &config.admin,
                    reward_pool,
                );
            } else {
                let mut distributed_share: i128 = 0;
                for voter in voters.iter() {
                    let commitment = get_commitment(&env, dispute_id, &voter)
                        .ok_or(OracleError::NoCommitmentFound)?;
                    if commitment.revealed && commitment.revealed_outcome == dispute.original_outcome
                    {
                        let share = checked_div(
                            checked_mul(commitment.stake_amount, reward_pool)?,
                            original_total,
                        )?;
                        let payout = checked_add(commitment.stake_amount, share)?;
                        transfer_token(
                            &env,
                            &dispute.stake_token,
                            &contract_address,
                            &voter,
                            payout,
                        );
                        distributed_share = checked_add(distributed_share, share)?;
                    }
                }
                // Integer-division dust: whatever the pro-rata split didn't
                // account for (rounding remainder) goes to the treasury so
                // every stroop that entered the contract is accounted for.
                let leftover = checked_sub(reward_pool, distributed_share)?;
                if leftover > 0 {
                    let config = get_config(&env).ok_or(OracleError::NotInitialized)?;
                    transfer_token(
                        &env,
                        &dispute.stake_token,
                        &contract_address,
                        &config.admin,
                        leftover,
                    );
                }
            }
        }

        let result = if disputer_wins {
            DisputeResult::DisputerWon
        } else {
            DisputeResult::DisputerLost
        };
        dispute.result = result;
        set_dispute(&env, &dispute);

        emit_dispute_resolved(&env, dispute_id, result, distributed);
        Ok(())
    }

    pub fn get_dispute(env: Env, dispute_id: u64) -> Result<Dispute, OracleError> {
        storage::get_dispute(&env, dispute_id).ok_or(OracleError::DisputeNotFound)
    }

    pub fn get_commitment(
        env: Env,
        dispute_id: u64,
        voter: Address,
    ) -> Result<VoteCommitment, OracleError> {
        storage::get_commitment(&env, dispute_id, &voter).ok_or(OracleError::NoCommitmentFound)
    }
}

fn validate_params(
    voting_period_secs: u64,
    reveal_period_secs: u64,
    bond_bps: u32,
) -> Result<(), OracleError> {
    if voting_period_secs == 0 || reveal_period_secs == 0 {
        return Err(OracleError::InvalidPeriod);
    }
    if bond_bps == 0 || (bond_bps as i128) > BPS_DENOMINATOR {
        return Err(OracleError::InvalidBondBps);
    }
    Ok(())
}
