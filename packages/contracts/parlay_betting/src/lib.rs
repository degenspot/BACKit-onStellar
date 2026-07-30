//! Auto-roll / parlay betting on top of [`prediction_market`] instances.
//!
//! A parlay chains several single-market predictions together: the user
//! stakes once, and each leg's winnings are auto-staked on the next leg. If
//! any leg loses, the parlay terminates.
//!
//! **Escrow model.** This contract is the staker of record on every leg — it
//! pulls the user's `initial_stake` into itself, stakes it on leg 1 *as
//! itself* (`env.current_contract_address()`, which auto-satisfies
//! `require_auth()` for calls this contract itself makes), and after each leg
//! resolves, claims that leg's payout (landing in this contract's own
//! balance) and re-stakes the full amount on the next leg, again as itself.
//!
//! **Why legs are tracked in aggregate.** Because every parlay stakes under
//! the *same* contract address, two different users' parlays that happen to
//! share a leg (same `call_id`) would otherwise collide: `outcome_manager`
//! tracks claims per `(call_id, staker)`, so the first parlay to advance past
//! a shared leg would claim the *combined* stake of every parlay using it,
//! and the second parlay's own claim attempt would panic with
//! `AlreadyClaimed`. [`types::LegAggregate`] tracks, per `call_id`, the total
//! this contract has staked across all parlays and (once claimed) the total
//! payout received; each parlay then computes its own proportional share
//! (`this_parlay_stake * claimed_payout / total_staked`) rather than issuing
//! its own separate on-chain claim.
#![no_std]

mod errors;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

use errors::ParlayError;
use events::{
    emit_parlay_completed, emit_parlay_created, emit_parlay_leg_resolved, emit_parlay_voided,
};
use prediction_market::PredictionMarketClient;
use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::{contract, contractimpl, token, Address, Env, IntoVal, Symbol, Vec};
use storage::*;
use types::{Parlay, ParlayConfig, ParlayLeg, ParlayStatus};

/// Sane upper bound on leg count — bounds per-parlay gas/storage cost the
/// same way this codebase caps other unbounded-input surfaces.
const MAX_LEGS: u32 = 10;

/// Pre-authorizes the token transfer that `prediction_market::stake_on_call`
/// performs internally on this contract's behalf.
///
/// This contract stakes *as itself* (`staker == env.current_contract_address()`),
/// so `stake_on_call`'s own `staker.require_auth()` is a direct call and is
/// automatically authorized. But `stake_on_call` then calls the stake
/// token's `transfer(from, to, amount)`, which itself calls
/// `from.require_auth()` — and since `from` is this contract but the
/// *direct* caller of `transfer` is `prediction_market` (not us), that
/// deeper check is not automatically satisfied. Soroban requires this
/// contract to explicitly vouch for that specific nested call ahead of
/// time via `authorize_as_current_contract`.
fn authorize_stake_transfer(
    env: &Env,
    stake_token: &Address,
    from: &Address,
    market_address: &Address,
    amount: i128,
) {
    let args: Vec<soroban_sdk::Val> = (from.clone(), market_address.clone(), amount).into_val(env);
    let entry = InvokerContractAuthEntry::Contract(SubContractInvocation {
        context: ContractContext {
            contract: stake_token.clone(),
            fn_name: Symbol::new(env, "transfer"),
            args,
        },
        sub_invocations: Vec::new(env),
    });
    env.authorize_as_current_contract(Vec::from_array(env, [entry]));
}

#[contract]
pub struct ParlayBetting;

#[contractimpl]
impl ParlayBetting {
    pub fn initialize(env: Env, admin: Address, outcome_manager: Address) -> Result<(), ParlayError> {
        if get_config(&env).is_some() {
            return Err(ParlayError::AlreadyInitialized);
        }
        admin.require_auth();
        set_config(
            &env,
            &ParlayConfig {
                admin,
                outcome_manager,
            },
        );
        Ok(())
    }

    /// Escrow `initial_stake` and place it on the first leg. The remaining
    /// legs are advanced one at a time via [`Self::advance_parlay`] as each
    /// market resolves.
    pub fn create_parlay(
        env: Env,
        user: Address,
        legs: Vec<ParlayLeg>,
        initial_stake: i128,
    ) -> Result<u64, ParlayError> {
        user.require_auth();
        get_config(&env).ok_or(ParlayError::NotInitialized)?;

        if legs.len() < 2 || legs.len() > MAX_LEGS {
            return Err(ParlayError::InvalidLegCount);
        }
        if initial_stake <= 0 {
            return Err(ParlayError::InvalidStakeAmount);
        }

        let first_leg = legs.get(0).unwrap();
        let market = PredictionMarketClient::new(&env, &first_leg.market_address);
        let call = market
            .try_get_call(&first_leg.call_id)
            .map_err(|_| ParlayError::MarketCallFailed)?
            .map_err(|_| ParlayError::MarketCallFailed)?;

        if first_leg.outcome < 1 || first_leg.outcome > call.outcome_count {
            return Err(ParlayError::InvalidOutcome);
        }

        let stake_token = call.stake_token.clone();
        let contract_address = env.current_contract_address();

        // Pull the user's stake into this contract, then stake it on leg 1
        // as ourselves. If the stake fails, the whole transaction (including
        // the transfer above) reverts, so the user's funds never actually
        // leave their account.
        token::Client::new(&env, &stake_token).transfer(&user, &contract_address, &initial_stake);
        authorize_stake_transfer(
            &env,
            &stake_token,
            &contract_address,
            &first_leg.market_address,
            initial_stake,
        );
        market.stake_on_call(
            &contract_address,
            &first_leg.call_id,
            &initial_stake,
            &first_leg.outcome,
        );
        bump_leg_aggregate(&env, first_leg.call_id, initial_stake);

        let parlay_id = next_parlay_id(&env);
        let parlay = Parlay {
            id: parlay_id,
            user: user.clone(),
            legs: legs.clone(),
            active_leg_index: 0,
            total_escrowed: initial_stake,
            status: ParlayStatus::Active,
            stake_token,
        };
        set_parlay(&env, &parlay);
        append_user_parlay(&env, &user, parlay_id);

        emit_parlay_created(&env, parlay_id, &user, initial_stake, legs.len());

        Ok(parlay_id)
    }

    /// Advance a parlay past its current active leg, once that leg's market
    /// has resolved. Permissionless — intended to be called by an off-chain
    /// keeper bot (or the oracle) after each leg resolves; see the module
    /// doc comment on why this contract can't safely pre-check readiness
    /// on-chain (it depends on `outcome_manager` internals that panic rather
    /// than return typed errors). Callers should simulate first and only
    /// submit once the simulation succeeds.
    pub fn advance_parlay(env: Env, parlay_id: u64) -> Result<(), ParlayError> {
        let config = get_config(&env).ok_or(ParlayError::NotInitialized)?;
        let mut parlay = get_parlay(&env, parlay_id).ok_or(ParlayError::ParlayNotFound)?;

        if parlay.status != ParlayStatus::Active {
            return Err(ParlayError::ParlayNotActive);
        }

        let leg_index = parlay.active_leg_index;
        let leg = parlay.legs.get(leg_index).unwrap();
        let market = PredictionMarketClient::new(&env, &leg.market_address);

        let call = market
            .try_get_call(&leg.call_id)
            .map_err(|_| ParlayError::MarketCallFailed)?
            .map_err(|_| ParlayError::MarketCallFailed)?;

        if call.outcome == 0 {
            return Err(ParlayError::LegNotResolved);
        }

        let won = call.outcome == leg.outcome;
        emit_parlay_leg_resolved(&env, parlay_id, leg_index, won);

        if !won {
            parlay.status = ParlayStatus::Lost;
            parlay.total_escrowed = 0;
            set_parlay(&env, &parlay);
            emit_parlay_completed(&env, parlay_id, 0);
            return Ok(());
        }

        let contract_address = env.current_contract_address();
        let this_leg_share = claim_leg_payout(
            &env,
            &config,
            &market,
            &parlay.stake_token,
            &leg,
            parlay.total_escrowed,
        )?;

        let is_last_leg = leg_index + 1 == parlay.legs.len();
        if is_last_leg {
            token::Client::new(&env, &parlay.stake_token).transfer(
                &contract_address,
                &parlay.user,
                &this_leg_share,
            );
            parlay.status = ParlayStatus::Won;
            parlay.total_escrowed = 0;
            set_parlay(&env, &parlay);
            emit_parlay_completed(&env, parlay_id, this_leg_share);
            return Ok(());
        }

        let next_leg = parlay.legs.get(leg_index + 1).unwrap();
        let next_market = PredictionMarketClient::new(&env, &next_leg.market_address);
        let next_call_result = next_market.try_get_call(&next_leg.call_id);

        let void_reason: Option<Symbol> = match next_call_result {
            Err(_) => Some(Symbol::new(&env, "market_call_failed")),
            Ok(Err(_)) => Some(Symbol::new(&env, "market_call_failed")),
            Ok(Ok(ref next_call)) => {
                if next_call.stake_token != parlay.stake_token {
                    Some(Symbol::new(&env, "token_mismatch"))
                } else if env.ledger().timestamp() >= next_call.end_ts {
                    Some(Symbol::new(&env, "market_expired"))
                } else {
                    None
                }
            }
        };

        if let Some(reason) = void_reason {
            token::Client::new(&env, &parlay.stake_token).transfer(
                &contract_address,
                &parlay.user,
                &this_leg_share,
            );
            parlay.status = ParlayStatus::Voided;
            parlay.total_escrowed = 0;
            set_parlay(&env, &parlay);
            emit_parlay_voided(&env, parlay_id, reason);
            return Ok(());
        }

        authorize_stake_transfer(
            &env,
            &parlay.stake_token,
            &contract_address,
            &next_leg.market_address,
            this_leg_share,
        );
        let stake_result = next_market.try_stake_on_call(
            &contract_address,
            &next_leg.call_id,
            &this_leg_share,
            &next_leg.outcome,
        );

        match stake_result {
            Ok(Ok(_)) => {
                bump_leg_aggregate(&env, next_leg.call_id, this_leg_share);
                parlay.active_leg_index = leg_index + 1;
                parlay.total_escrowed = this_leg_share;
                set_parlay(&env, &parlay);
                Ok(())
            }
            _ => {
                token::Client::new(&env, &parlay.stake_token).transfer(
                    &contract_address,
                    &parlay.user,
                    &this_leg_share,
                );
                parlay.status = ParlayStatus::Voided;
                parlay.total_escrowed = 0;
                set_parlay(&env, &parlay);
                emit_parlay_voided(&env, parlay_id, Symbol::new(&env, "stake_failed"));
                Ok(())
            }
        }
    }

    pub fn get_parlay(env: Env, parlay_id: u64) -> Result<Parlay, ParlayError> {
        storage::get_parlay(&env, parlay_id).ok_or(ParlayError::ParlayNotFound)
    }

    pub fn get_user_parlays(env: Env, user: Address) -> Vec<u64> {
        storage::get_user_parlays(&env, &user)
    }
}

fn bump_leg_aggregate(env: &Env, call_id: u64, amount: i128) {
    let mut agg = get_leg_aggregate(env, call_id);
    agg.total_staked += amount;
    set_leg_aggregate(env, call_id, &agg);
}

/// Claim (or reuse an already-claimed) payout for `leg`, returning this
/// specific parlay's proportional share. See the module doc comment for why
/// this is aggregate-then-proportional rather than a direct per-parlay claim.
fn claim_leg_payout(
    env: &Env,
    config: &ParlayConfig,
    market: &PredictionMarketClient,
    stake_token: &Address,
    leg: &ParlayLeg,
    this_parlay_stake: i128,
) -> Result<i128, ParlayError> {
    let contract_address = env.current_contract_address();
    let mut agg = get_leg_aggregate(env, leg.call_id);

    if agg.claimed_payout.is_none() {
        let has_claimed: bool = env.invoke_contract(
            &config.outcome_manager,
            &Symbol::new(env, "has_claimed"),
            (leg.call_id, contract_address.clone()).into_val(env),
        );
        if has_claimed {
            // Defensive fallback only — in normal operation we always set
            // `claimed_payout` in the same call that performs the claim, so
            // this contract's own bookkeeping should never disagree with
            // outcome_manager's about whether the claim already happened.
            return Err(ParlayError::MarketCallFailed);
        }

        let outcome_stakes = market
            .try_get_outcome_stakes(&leg.call_id)
            .map_err(|_| ParlayError::MarketCallFailed)?
            .map_err(|_| ParlayError::MarketCallFailed)?;

        let total_winning_stake = outcome_stakes.get(leg.outcome).unwrap_or(0);
        let mut total_losing_stake: i128 = 0;
        for (position, amount) in outcome_stakes.iter() {
            if position != leg.outcome {
                total_losing_stake += amount;
            }
        }

        let token_client = token::Client::new(env, stake_token);
        let balance_before = token_client.balance(&contract_address);

        let args = (
            leg.call_id,
            contract_address.clone(),
            agg.total_staked,
            total_winning_stake,
            total_losing_stake,
        )
            .into_val(env);
        let _: () = env.invoke_contract(
            &config.outcome_manager,
            &Symbol::new(env, "claim_payout_for_market"),
            args,
        );

        let balance_after = token_client.balance(&contract_address);
        agg.claimed_payout = Some(balance_after - balance_before);
        set_leg_aggregate(env, leg.call_id, &agg);
    }

    let claimed_payout = agg.claimed_payout.unwrap();
    claimed_payout
        .checked_mul(this_parlay_stake)
        .and_then(|v| v.checked_div(agg.total_staked))
        .ok_or(ParlayError::MarketCallFailed)
}
