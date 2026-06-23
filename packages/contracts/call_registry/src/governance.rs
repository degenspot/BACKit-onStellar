use crate::errors::CallRegistryError;
use crate::events::{
    emit_proposal_created, emit_proposal_executed, emit_proposal_rejected, emit_vote_cast,
};
use crate::storage::{
    get_config, get_global_stats, get_proposal, get_proposal_counter, get_proposal_votes,
    get_user_total_stake_volume, set_proposal, set_proposal_counter, set_proposal_votes,
    set_user_vote_on_proposal, user_has_voted,
};
use crate::types::{GovernanceProposal, ProposalStatus, ProposalVotes};
use soroban_sdk::{Address, Env, Symbol, Vec};

/// Minimum voting period in ledgers (~1 hour at 5 s/ledger = 720 ledgers).
pub const MIN_VOTING_PERIOD: u32 = 720;

/// Create a governance proposal to change a contract parameter.
///
/// The proposer must have at least `proposal_threshold` total historical stake
/// volume. Vote power is snapshotted from `total_stake_volume` at creation time
/// to prevent flash-loan attacks.
///
/// # Errors
/// * [`CallRegistryError::NotInitialized`]       — contract not initialised.
/// * [`CallRegistryError::InsufficientStake`]    — proposer below threshold.
/// * [`CallRegistryError::VotingPeriodTooShort`] — deadline too soon.
pub fn propose_change(
    env: &Env,
    proposer: Address,
    parameter: Symbol,
    new_value: i128,
    voting_end_ledger: u32,
) -> Result<u64, CallRegistryError> {
    proposer.require_auth();

    let config = get_config(env).ok_or(CallRegistryError::NotInitialized)?;

    let proposer_volume = get_user_total_stake_volume(env, &proposer);
    if proposer_volume < config.proposal_threshold {
        return Err(CallRegistryError::InsufficientStake);
    }

    let current_ledger = env.ledger().sequence();
    if voting_end_ledger <= current_ledger.saturating_add(MIN_VOTING_PERIOD) {
        return Err(CallRegistryError::VotingPeriodTooShort);
    }

    let proposal_id = get_proposal_counter(env) + 1;
    set_proposal_counter(env, proposal_id);

    let total_volume = get_global_stats(env).total_stake_volume;

    let proposal = GovernanceProposal {
        id: proposal_id,
        proposer: proposer.clone(),
        parameter: parameter.clone(),
        new_value,
        voting_end_ledger,
        status: ProposalStatus::Active,
        yes_votes: 0,
        no_votes: 0,
        total_volume_snapshot: total_volume,
    };

    set_proposal(env, &proposal);
    set_proposal_votes(env, proposal_id, &ProposalVotes { yes: 0, no: 0 });

    emit_proposal_created(
        env,
        proposal_id,
        &proposer,
        &parameter,
        voting_end_ledger,
        total_volume,
    );

    Ok(proposal_id)
}

/// Cast a vote on an active proposal.
///
/// Vote power equals the voter's historical total stake volume — determined at
/// call time, not at proposal creation, which is safe because stake volume only
/// increases (resolved calls are permanent).
///
/// # Errors
/// * [`CallRegistryError::NotInitialized`]    — contract not initialised.
/// * [`CallRegistryError::ProposalNotFound`]  — unknown proposal_id.
/// * [`CallRegistryError::ProposalNotActive`] — already executed or rejected.
/// * [`CallRegistryError::VotingEnded`]       — past the voting deadline.
/// * [`CallRegistryError::AlreadyVoted`]      — this voter already voted.
/// * [`CallRegistryError::InsufficientStake`] — voter has zero stake history.
pub fn vote(
    env: &Env,
    voter: Address,
    proposal_id: u64,
    support: bool,
) -> Result<(), CallRegistryError> {
    voter.require_auth();
    get_config(env).ok_or(CallRegistryError::NotInitialized)?;

    let mut proposal = get_proposal(env, proposal_id).ok_or(CallRegistryError::ProposalNotFound)?;

    if proposal.status != ProposalStatus::Active {
        return Err(CallRegistryError::ProposalNotActive);
    }

    let current_ledger = env.ledger().sequence();
    if current_ledger > proposal.voting_end_ledger {
        return Err(CallRegistryError::VotingEnded);
    }

    if user_has_voted(env, proposal_id, &voter) {
        return Err(CallRegistryError::AlreadyVoted);
    }

    let vote_power = get_user_total_stake_volume(env, &voter);
    if vote_power == 0 {
        return Err(CallRegistryError::InsufficientStake);
    }

    set_user_vote_on_proposal(env, proposal_id, &voter);

    let mut votes =
        get_proposal_votes(env, proposal_id).unwrap_or(ProposalVotes { yes: 0, no: 0 });
    if support {
        votes.yes += vote_power;
        proposal.yes_votes += vote_power;
    } else {
        votes.no += vote_power;
        proposal.no_votes += vote_power;
    }
    set_proposal_votes(env, proposal_id, &votes);
    set_proposal(env, &proposal);

    emit_vote_cast(env, proposal_id, &voter, support, vote_power);

    Ok(())
}

/// Execute a passed proposal (open to anyone after deadline).
///
/// Applies the parameter change to `ContractConfig`. Governance is the primary
/// path; the admin fast-track still works independently.
///
/// # Errors
/// * [`CallRegistryError::NotInitialized`]    — contract not initialised.
/// * [`CallRegistryError::ProposalNotFound`]  — unknown proposal_id.
/// * [`CallRegistryError::ProposalNotActive`] — already executed or rejected.
/// * [`CallRegistryError::VotingNotEnded`]    — deadline not yet elapsed.
/// * [`CallRegistryError::QuorumNotMet`]      — insufficient yes_votes.
pub fn execute_proposal(env: &Env, proposal_id: u64) -> Result<(), CallRegistryError> {
    let mut config = get_config(env).ok_or(CallRegistryError::NotInitialized)?;

    let mut proposal =
        get_proposal(env, proposal_id).ok_or(CallRegistryError::ProposalNotFound)?;

    if proposal.status != ProposalStatus::Active {
        return Err(CallRegistryError::ProposalNotActive);
    }

    let current_ledger = env.ledger().sequence();
    if current_ledger <= proposal.voting_end_ledger {
        return Err(CallRegistryError::VotingNotEnded);
    }

    // Quorum: yes_votes >= (total_volume_snapshot * governance_quorum_bps / 10_000)
    let required = if proposal.total_volume_snapshot > 0 {
        (proposal.total_volume_snapshot * config.governance_quorum_bps as i128) / 10_000_i128
    } else {
        0_i128
    };

    let passes = proposal.yes_votes >= required && proposal.yes_votes > proposal.no_votes;

    if !passes {
        proposal.status = ProposalStatus::Rejected;
        set_proposal(env, &proposal);
        emit_proposal_rejected(env, proposal_id, proposal.yes_votes, proposal.no_votes);
        return Err(CallRegistryError::QuorumNotMet);
    }

    apply_parameter(env, &mut config, &proposal.parameter, proposal.new_value);
    crate::storage::set_config(env, &config);

    proposal.status = ProposalStatus::Executed;
    set_proposal(env, &proposal);

    emit_proposal_executed(env, proposal_id, &proposal.parameter, proposal.yes_votes);

    Ok(())
}

/// Apply a governance-approved parameter update to `ContractConfig`.
/// Only recognised parameter names are applied; unknown names are ignored.
fn apply_parameter(
    env: &Env,
    config: &mut crate::types::ContractConfig,
    parameter: &Symbol,
    new_value: i128,
) {
    if *parameter == Symbol::new(env, "fee_bps") {
        config.fee_bps = new_value as u32;
    } else if *parameter == Symbol::new(env, "min_stake") {
        config.min_stake = new_value;
    } else if *parameter == Symbol::new(env, "staking_cutoff") {
        config.staking_cutoff_secs = new_value as u64;
    } else if *parameter == Symbol::new(env, "proposal_threshold") {
        config.proposal_threshold = new_value;
    } else if *parameter == Symbol::new(env, "gov_quorum_bps") {
        config.governance_quorum_bps = new_value as u32;
    } else if *parameter == Symbol::new(env, "voting_period") {
        config.voting_period_ledgers = new_value as u32;
    } else if *parameter == Symbol::new(env, "max_stake") {
        config.max_stake_per_user = new_value;
    }
}

// ── View functions ────────────────────────────────────────────────────────────

/// Return a proposal by ID.
pub fn get_proposal_view(env: &Env, proposal_id: u64) -> Option<GovernanceProposal> {
    get_proposal(env, proposal_id)
}

/// Return all currently-active proposals (capped at 50 to bound compute).
pub fn get_active_proposals(env: &Env) -> Vec<GovernanceProposal> {
    let counter = get_proposal_counter(env);
    let current_ledger = env.ledger().sequence();
    let mut result = Vec::new(env);
    let mut i = 1u64;
    let mut found = 0u32;
    while i <= counter && found < 50 {
        if let Some(p) = get_proposal(env, i) {
            if p.status == ProposalStatus::Active && current_ledger <= p.voting_end_ledger {
                result.push_back(p);
                found += 1;
            }
        }
        i += 1;
    }
    result
}

/// Return vote tallies for a proposal.
pub fn get_proposal_votes_view(env: &Env, proposal_id: u64) -> Option<ProposalVotes> {
    get_proposal_votes(env, proposal_id)
}
