use soroban_sdk::{contracttype, Address, Env};
use crate::types::{ContractConfig, StakePosition};
use crate::storage::{get_call, set_call, get_config};

/// Basis points penalty for early stake withdrawal (default 1000 = 10%).
pub const DEFAULT_EARLY_EXIT_PENALTY_BPS: u32 = 1000;

/// Allow a staker to exit before market expiry, forfeiting a penalty to the pool.
///
/// - `position`: 1 = Up, 2 = Down
/// - Returns the net amount returned to the staker after penalty.
pub fn withdraw_stake(env: &Env, staker: Address, call_id: u64, position: u32) -> i128 {
    staker.require_auth();

    let mut call = get_call(env, call_id).expect("call not found");
    assert!(!call.settled, "call already settled");
    assert!(env.ledger().timestamp() < call.end_ts, "call has ended");

    let config: ContractConfig = get_config(env).expect("not initialized");
    let penalty_bps = DEFAULT_EARLY_EXIT_PENALTY_BPS;

    let stake = match position {
        1 => call.up_stakes.get(staker.clone()).unwrap_or(0),
        2 => call.down_stakes.get(staker.clone()).unwrap_or(0),
        _ => panic!("invalid position"),
    };
    assert!(stake > 0, "no stake to withdraw");

    let penalty = stake * penalty_bps as i128 / 10_000;
    let net = stake - penalty;

    // Remove stake and update totals
    match position {
        1 => {
            call.up_stakes.remove(staker.clone());
            call.total_up_stake -= stake;
            call.total_up_stake += penalty; // penalty stays in pool
        }
        _ => {
            call.down_stakes.remove(staker.clone());
            call.total_down_stake -= stake;
            call.total_down_stake += penalty;
        }
    }

    set_call(env, &call);

    soroban_sdk::token::Client::new(env, &call.stake_token)
        .transfer(&env.current_contract_address(), &staker, &net);

    net
}