#![no_std]

mod errors;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

use errors::CharityError;
use events::{
    emit_charity_call_created, emit_charity_call_resolved, emit_charity_donation,
    emit_stake_added,
};
use soroban_sdk::{contract, contractimpl, token, Address, Env, Map};
use storage::*;
use types::{CharityCall, CharityCallInit};

fn transfer_token(env: &Env, token: &Address, from: &Address, to: &Address, amount: i128) {
    token::Client::new(env, token).transfer(from, to, &amount);
}

#[contract]
pub struct CharityMarkets;

#[contractimpl]
impl CharityMarkets {
    pub fn initialize(
        env: Env,
        admin: Address,
        outcome_manager: Address,
        stake_token: Address,
    ) {
        if get_admin(&env).is_some() {
            soroban_sdk::panic_with_error!(&env, CharityError::AlreadyInitialized);
        }
        set_admin(&env, &admin);
        set_outcome_manager(&env, &outcome_manager);
        set_stake_token(&env, &stake_token);
    }

    pub fn create_charity_call(
        env: Env,
        creator: Address,
        call_params: CharityCallInit,
        charity_address: Address,
        charity_split_bps: u32,
    ) -> Result<u64, CharityError> {
        creator.require_auth();

        let _admin = get_admin(&env).ok_or(CharityError::NotInitialized)?;
        let stake_token =
            get_stake_token(&env).ok_or(CharityError::NotInitialized)?;
        let outcome_manager =
            get_outcome_manager(&env).ok_or(CharityError::NotInitialized)?;

        if charity_split_bps > 10_000 {
            return Err(CharityError::CharitySplitExceedsMax);
        }
        if call_params.stake_amount <= 0 {
            return Err(CharityError::InvalidStakeAmount);
        }
        if call_params.outcome_count < 2 {
            return Err(CharityError::InvalidOutcome);
        }
        if call_params.creator_outcome < 1
            || call_params.creator_outcome > call_params.outcome_count
        {
            return Err(CharityError::InvalidOutcome);
        }

        transfer_token(
            &env,
            &stake_token,
            &creator,
            &env.current_contract_address(),
            call_params.stake_amount,
        );

        let call_id = get_next_call_id(&env);
        set_next_call_id(&env, call_id + 1);

        let mut outcome_stakes: Map<u32, i128> = Map::new(&env);
        let mut user_stakes: Map<u32, Map<Address, i128>> = Map::new(&env);
        for i in 1..=call_params.outcome_count {
            outcome_stakes.set(i, 0);
            user_stakes.set(i, Map::new(&env));
        }

        let mut creator_map: Map<Address, i128> = Map::new(&env);
        creator_map.set(creator.clone(), call_params.stake_amount);
        user_stakes.set(call_params.creator_outcome, creator_map);

        let prev = outcome_stakes.get(call_params.creator_outcome).unwrap_or(0);
        outcome_stakes.set(call_params.creator_outcome, prev + call_params.stake_amount);

        let charity_call = CharityCall {
            id: call_id,
            creator: creator.clone(),
            stake_token: stake_token.clone(),
            stake_amount: call_params.stake_amount,
            outcome_count: call_params.outcome_count,
            creator_outcome: call_params.creator_outcome,
            charity_address: charity_address.clone(),
            charity_split_bps,
            total_donated: 0,
            outcome_manager: outcome_manager.clone(),
            resolved: false,
            final_outcome: 0,
            created_at: env.ledger().timestamp(),
            outcome_stakes,
            user_stakes,
        };

        set_charity_call(&env, call_id, &charity_call);
        set_user_stake(&env, call_id, &creator, call_params.creator_outcome, call_params.stake_amount);

        emit_charity_call_created(
            &env,
            call_id,
            &creator,
            &charity_address,
            charity_split_bps,
            call_params.stake_amount,
        );

        Ok(call_id)
    }

    pub fn stake_on_charity_call(
        env: Env,
        staker: Address,
        call_id: u64,
        outcome: u32,
        amount: i128,
    ) -> Result<CharityCall, CharityError> {
        staker.require_auth();

        let stake_token =
            get_stake_token(&env).ok_or(CharityError::NotInitialized)?;
        let mut call =
            get_charity_call(&env, call_id).ok_or(CharityError::CallNotFound)?;

        if call.resolved {
            return Err(CharityError::AlreadyResolved);
        }
        if outcome < 1 || outcome > call.outcome_count {
            return Err(CharityError::InvalidOutcome);
        }
        if amount <= 0 {
            return Err(CharityError::InvalidStakeAmount);
        }

        transfer_token(
            &env,
            &stake_token,
            &staker,
            &env.current_contract_address(),
            amount,
        );

        let prev_total = call.outcome_stakes.get(outcome).unwrap_or(0);
        call.outcome_stakes.set(outcome, prev_total + amount);

        let mut outcome_stakers: Map<Address, i128> =
            call.user_stakes.get(outcome).unwrap_or_else(|| Map::new(&env));
        let prev_staker = outcome_stakers.get(staker.clone()).unwrap_or(0);
        outcome_stakers.set(staker.clone(), prev_staker + amount);
        call.user_stakes.set(outcome, outcome_stakers);

        set_user_stake(&env, call_id, &staker, outcome, prev_staker + amount);
        set_charity_call(&env, call_id, &call);

        emit_stake_added(&env, call_id, &staker, amount, outcome);

        Ok(call)
    }

    pub fn resolve_charity_call(
        env: Env,
        call_id: u64,
        final_outcome: u32,
    ) -> Result<CharityCall, CharityError> {
        let outcome_manager =
            get_outcome_manager(&env).ok_or(CharityError::NotInitialized)?;
        outcome_manager.require_auth();

        let mut call =
            get_charity_call(&env, call_id).ok_or(CharityError::CallNotFound)?;

        if call.resolved {
            return Err(CharityError::AlreadyResolved);
        }
        if final_outcome < 1 || final_outcome > call.outcome_count {
            return Err(CharityError::InvalidOutcome);
        }

        call.final_outcome = final_outcome;
        call.resolved = true;

        let stake_token = call.stake_token.clone();
        let contract_addr = env.current_contract_address();
        let creator_won = final_outcome == call.creator_outcome;

        if creator_won {
            let mut total_pool: i128 = 0;
            for i in 1..=call.outcome_count {
                total_pool += call.outcome_stakes.get(i).unwrap_or(0);
            }
            let winning_total =
                call.outcome_stakes.get(final_outcome).unwrap_or(0);

            if winning_total == 0 {
                return Err(CharityError::ZeroPool);
            }

            let losing_total = total_pool - winning_total;

            let creator_share_ratio = call.stake_amount * losing_total / winning_total;
            let creator_gross = call.stake_amount + creator_share_ratio;

            let charity_amount =
                (creator_gross * call.charity_split_bps as i128) / 10_000;
            let creator_payout = creator_gross - charity_amount;

            if charity_amount > 0 {
                transfer_token(
                    &env,
                    &stake_token,
                    &contract_addr,
                    &call.charity_address,
                    charity_amount,
                );
                call.total_donated = charity_amount;
                emit_charity_donation(&env, &call.creator, &call.charity_address, charity_amount);
            }

            transfer_token(
                &env,
                &stake_token,
                &contract_addr,
                &call.creator,
                creator_payout,
            );

            let winning_stakers_keys = call
                .user_stakes
                .get(final_outcome)
                .unwrap_or_else(|| Map::new(&env))
                .keys();
            for i in 0..winning_stakers_keys.len() {
                let staker = winning_stakers_keys.get(i).unwrap();
                if staker == call.creator {
                    continue;
                }
                let stake_amt = call.user_stakes.get(final_outcome)
                    .unwrap_or_else(|| Map::new(&env))
                    .get(staker.clone())
                    .unwrap_or(0);
                let share = stake_amt * losing_total / winning_total;
                let payout = stake_amt + share;
                transfer_token(&env, &stake_token, &contract_addr, &staker, payout);
            }
        } else {
            transfer_token(
                &env,
                &stake_token,
                &contract_addr,
                &call.charity_address,
                call.stake_amount,
            );
            call.total_donated = call.stake_amount;
            emit_charity_donation(&env, &call.creator, &call.charity_address, call.stake_amount);

            let winning_total =
                call.outcome_stakes.get(final_outcome).unwrap_or(0);
            if winning_total > 0 {
                let mut total_pool: i128 = 0;
                for i in 1..=call.outcome_count {
                    total_pool += call.outcome_stakes.get(i).unwrap_or(0);
                }
                let creator_stake = call.stake_amount;
                let remaining_pool = total_pool - creator_stake;
                let losing_total = remaining_pool - winning_total;

                let winning_stakers_keys = call
                    .user_stakes
                    .get(final_outcome)
                    .unwrap_or_else(|| Map::new(&env))
                    .keys();
                for i in 0..winning_stakers_keys.len() {
                    let staker = winning_stakers_keys.get(i).unwrap();
                    if staker == call.creator {
                        continue;
                    }
                    let stake_amt = call.user_stakes.get(final_outcome)
                        .unwrap_or_else(|| Map::new(&env))
                        .get(staker.clone())
                        .unwrap_or(0);
                    let share = if winning_total > 0 {
                        stake_amt * losing_total / winning_total
                    } else {
                        0
                    };
                    let payout = stake_amt + share;
                    transfer_token(&env, &stake_token, &contract_addr, &staker, payout);
                }
            }
        }

        set_charity_call(&env, call_id, &call);
        emit_charity_call_resolved(&env, call_id, final_outcome, creator_won);

        Ok(call)
    }

    pub fn get_charity_info(env: Env, call_id: u64) -> Result<(Address, u32, i128), CharityError> {
        let call =
            get_charity_call(&env, call_id).ok_or(CharityError::CallNotFound)?;
        Ok((call.charity_address, call.charity_split_bps, call.total_donated))
    }

    pub fn get_charity_call(env: Env, call_id: u64) -> Option<CharityCall> {
        get_charity_call(&env, call_id)
    }
}
