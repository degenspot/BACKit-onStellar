use crate::events::{emit_stake_withdrawn, emit_xlm_stake_withdrawn};
use crate::storage::{
    extend_storage_ttl, get_call, get_config, get_user_stake, set_call, set_user_stake,
};
use soroban_sdk::{Address, Env, Map};

/// Basis points penalty for early stake withdrawal (default 1000 = 10%).
pub const DEFAULT_EARLY_EXIT_PENALTY_BPS: u32 = 1000;

/// Allow a staker to exit before market expiry, forfeiting a penalty to the pool.
///
/// - `position`: 1..=outcome_count
/// - Returns `(refunded_amount, penalty)`.
pub fn execute_withdrawal(env: &Env, staker: Address, call_id: u64, position: u32) -> (i128, i128) {
    staker.require_auth();

    let mut call = get_call(env, call_id).expect("call not found");

    // Guard: call must still be active
    let current_ts = env.ledger().timestamp();
    if current_ts >= call.end_ts {
        panic!("call has ended");
    }
    if call.settled {
        panic!("call already settled");
    }
    if call.cancelled {
        panic!("call has been cancelled");
    }
    if call.voided {
        panic!("call has been voided");
    }

    // Guard: valid position
    if position < 1 || position > call.outcome_count {
        panic!("invalid position");
    }

    // Guard: staker must have a stake on this position
    let stake = get_user_stake(env, call_id, &staker, position);
    if stake <= 0 {
        panic!("no stake to withdraw");
    }

    let _config = get_config(env).expect("not initialized");
    let penalty_bps = DEFAULT_EARLY_EXIT_PENALTY_BPS;

    let penalty = stake * penalty_bps as i128 / 10_000;
    let refund = stake - penalty;

    // Remove staker's entry from the position map
    let mut outcome_stakers: Map<Address, i128> =
        call.stakes.get(position).unwrap_or_else(|| Map::new(env));
    outcome_stakers.remove(staker.clone());
    call.stakes.set(position, outcome_stakers);

    // Reduce the position's total by the refund only; penalty stays in the pool
    let current_total = call.outcome_stakes.get(position).unwrap_or(0);
    call.outcome_stakes.set(position, current_total - refund);

    // Zero out the per-user stake record
    set_user_stake(env, call_id, &staker, position, 0);

    set_call(env, &call);
    extend_storage_ttl(env);

    // Transfer refund from contract to staker
    if crate::is_native_xlm(env, &call.stake_token) {
        soroban_sdk::token::StellarAssetClient::new(env, &call.stake_token).transfer(
            &env.current_contract_address(),
            &staker,
            &refund,
        );
        emit_xlm_stake_withdrawn(env, call_id, &staker, refund, penalty);
    } else {
        soroban_sdk::token::Client::new(env, &call.stake_token).transfer(
            &env.current_contract_address(),
            &staker,
            &refund,
        );
        emit_stake_withdrawn(env, call_id, &staker, refund, penalty);
    }

    (refund, penalty)
}
