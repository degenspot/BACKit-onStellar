use soroban_sdk::{Address, Env};

use crate::events::PARAM_MIN_STAKE;
use backit_shared::is_valid_fee_bps;

use crate::errors::CallRegistryError;
use crate::events::{
    emit_admin_added, emit_admin_removed, emit_operation_proposed, emit_proposal_approved,
    emit_proposal_executed, emit_proposal_vetoed,
};
use crate::events::{
    emit_admin_params_changed_address, emit_admin_params_changed_i128,
    emit_admin_params_changed_u32, emit_admin_params_changed_u64, emit_contract_paused,
    emit_contract_unpaused, emit_token_delisted, emit_token_whitelisted, PARAM_ADMIN,
    PARAM_FEE_BPS, PARAM_MAX_STAKE_PER_USER, PARAM_OUTCOME_MANAGER, PARAM_STAKING_CUTOFF,
};
use crate::storage::{extend_storage_ttl, get_config, set_config};
use crate::storage::{get_proposal, next_proposal_id, remove_proposal, set_proposal};
use crate::types::{Operation, Proposal, ProposalStatus};
use soroban_sdk::Vec as SdkVec;

/// Transfer admin privileges to a new address.
/// # Authorization
/// Current admin must sign.
/// # Errors
/// * [`CallRegistryError::NotInitialized`] – contract not initialised.
pub fn set_admin(env: Env, new_admin: Address) -> Result<(), CallRegistryError> {
    let mut config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;

    config.admin.require_auth();

    let old_admin = config.admin.clone();
    config.admin = new_admin.clone();

    set_config(&env, &config);
    extend_storage_ttl(&env);

    emit_admin_params_changed_address(&env, PARAM_ADMIN, &new_admin, &old_admin, &new_admin);

    Ok(())
}

/// Replace the outcome manager.
/// # Authorization
/// Current admin must sign.
/// # Errors
/// * [`CallRegistryError::NotInitialized`] – contract not initialised.
pub fn set_outcome_manager(env: Env, new_manager: Address) -> Result<(), CallRegistryError> {
    let mut config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;

    config.admin.require_auth();

    let old_manager = config.outcome_manager.clone();
    config.outcome_manager = new_manager.clone();

    set_config(&env, &config);
    extend_storage_ttl(&env);

    emit_admin_params_changed_address(
        &env,
        PARAM_OUTCOME_MANAGER,
        &config.admin,
        &old_manager,
        &new_manager,
    );

    Ok(())
}

/// Set the protocol fee in basis points (1 bp = 0.01 %).
/// # Arguments
/// * `new_fee_bps` — fee in basis points; must be ≤ 10 000 (100 %)
/// # Authorization
/// Current admin must sign.
/// # Errors
/// * [`CallRegistryError::NotInitialized`] – contract not initialised.
/// * [`CallRegistryError::FeeTooHigh`]     – `new_fee_bps` > 10 000.
pub fn set_fee(env: Env, new_fee_bps: u32) -> Result<(), CallRegistryError> {
    if !is_valid_fee_bps(new_fee_bps) {
        return Err(CallRegistryError::FeeTooHigh);
    }

    let mut config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;

    config.admin.require_auth();

    let old_fee_bps = config.fee_bps;
    config.fee_bps = new_fee_bps;

    set_config(&env, &config);
    extend_storage_ttl(&env);

    emit_admin_params_changed_u32(&env, PARAM_FEE_BPS, &config.admin, old_fee_bps, new_fee_bps);

    Ok(())
}

/// Set the maximum stake any single user may place per call per position.
///
/// Pass `0` to remove the cap (unlimited).
///
/// # Authorization
/// Current admin must sign.
///
/// # Panics
/// * Contract not initialized
/// * `new_max` is negative
pub fn set_max_stake_per_user(env: Env, new_max: i128) {
    if new_max < 0 {
        panic!("max_stake_per_user cannot be negative");
    }

    let mut config = get_config(&env).expect("Contract not initialized");

    config.admin.require_auth();

    let old_max = config.max_stake_per_user;
    config.max_stake_per_user = new_max;

    set_config(&env, &config);
    extend_storage_ttl(&env);

    emit_admin_params_changed_i128(
        &env,
        PARAM_MAX_STAKE_PER_USER,
        &config.admin,
        old_max,
        new_max,
    );
}

pub fn whitelist_token(env: Env, token_address: Address) {
    let mut config = get_config(&env).expect("not initialized");
    config.admin.require_auth();
    config.whitelisted_tokens.set(token_address.clone(), true);
    set_config(&env, &config);
    emit_token_whitelisted(&env, &token_address);
}

pub fn remove_token(env: Env, token_address: Address) {
    let mut config = get_config(&env).expect("not initialized");
    config.admin.require_auth();
    config.whitelisted_tokens.remove(token_address.clone());
    set_config(&env, &config);
    emit_token_delisted(&env, &token_address);
}

pub fn set_min_stake(env: Env, new_min_stake: i128) {
    if new_min_stake < 0 {
        panic!("min_stake cannot be negative");
    }
    let mut config = get_config(&env).expect("not initialized");
    config.admin.require_auth();
    let old = config.min_stake;
    config.min_stake = new_min_stake;
    set_config(&env, &config);
    extend_storage_ttl(&env);
    emit_admin_params_changed_i128(&env, PARAM_MIN_STAKE, &config.admin, old, new_min_stake);
}

/// Pause the contract — blocks create, stake, and resolve until unpaused.
/// # Authorization
/// Current admin must sign.
pub fn pause(env: Env) {
    let mut config = get_config(&env).expect("not initialized");
    config.admin.require_auth();
    config.paused = true;
    set_config(&env, &config);
    extend_storage_ttl(&env);
    emit_contract_paused(&env, &config.admin);
}

/// Unpause the contract.
/// # Authorization
/// Current admin must sign.
pub fn unpause(env: Env) {
    let mut config = get_config(&env).expect("not initialized");
    config.admin.require_auth();
    config.paused = false;
    set_config(&env, &config);
    extend_storage_ttl(&env);
    emit_contract_unpaused(&env, &config.admin);
}

/// Set the staking cutoff window in seconds before `end_ts`.
///
/// Staking is rejected when `current_timestamp >= call.end_ts - staking_cutoff_secs`.
/// Pass `0` to disable the cutoff (allow staking right up to `end_ts`).
///
/// # Authorization
/// Current admin must sign.
///
/// # Panics
/// * Contract not initialized.
pub fn set_staking_cutoff(env: Env, new_cutoff: u64) {
    let mut config = get_config(&env).expect("not initialized");
    config.admin.require_auth();
    let old_cutoff = config.staking_cutoff_secs;
    config.staking_cutoff_secs = new_cutoff;
    set_config(&env, &config);
    extend_storage_ttl(&env);
    emit_admin_params_changed_u64(
        &env,
        PARAM_STAKING_CUTOFF,
        &config.admin,
        old_cutoff,
        new_cutoff,
    );
}

/// Propose an admin operation (multisig flow).
pub fn propose_admin_operation(
    env: Env,
    proposer: Address,
    operation: Operation,
    timelock_seconds: u64,
) -> Result<u64, CallRegistryError> {
    proposer.require_auth();

    let mut config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;

    let id = next_proposal_id(&env);
    let now = env.ledger().timestamp();
    let proposal = Proposal {
        id,
        proposer: proposer.clone(),
        operation,
        approvals: SdkVec::new(&env),
        created_at: now,
        timelock_until: now + timelock_seconds,
        status: ProposalStatus::Active,
    };
    set_proposal(&env, &proposal);
    extend_storage_ttl(&env);
    emit_operation_proposed(&env, id, &proposer);
    Ok(id)
}

/// Approve a proposal. Admin must be in `admin_set` when multisig is active.
pub fn approve_admin_proposal(
    env: Env,
    admin: Address,
    proposal_id: u64,
) -> Result<(), CallRegistryError> {
    admin.require_auth();
    let mut proposal = get_proposal(&env, proposal_id).ok_or(CallRegistryError::NotFound)?;
    if proposal.status != ProposalStatus::Active {
        return Err(CallRegistryError::InvalidInput);
    }
    // Idempotent: if already approved, no-op
    for a in proposal.approvals.iter() {
        if a == admin {
            return Ok(());
        }
    }
    proposal.approvals.push_back(admin.clone());
    set_proposal(&env, &proposal);
    emit_proposal_approved(&env, proposal_id, &admin);
    Ok(())
}

/// Veto a proposal immediately.
pub fn veto_admin_proposal(
    env: Env,
    admin: Address,
    proposal_id: u64,
) -> Result<(), CallRegistryError> {
    admin.require_auth();
    let mut proposal = get_proposal(&env, proposal_id).ok_or(CallRegistryError::NotFound)?;
    if proposal.status != ProposalStatus::Active {
        return Err(CallRegistryError::InvalidInput);
    }
    proposal.status = ProposalStatus::Vetoed;
    set_proposal(&env, &proposal);
    emit_proposal_vetoed(&env, proposal_id, &admin);
    Ok(())
}

/// Execute a proposal after timelock and when approval threshold met.
pub fn execute_admin_proposal(
    env: Env,
    caller: Address,
    proposal_id: u64,
) -> Result<(), CallRegistryError> {
    // anyone may call execute; checks enforced below
    let mut proposal = get_proposal(&env, proposal_id).ok_or(CallRegistryError::NotFound)?;
    if proposal.status != ProposalStatus::Active {
        return Err(CallRegistryError::InvalidInput);
    }
    let now = env.ledger().timestamp();
    if now < proposal.timelock_until {
        return Err(CallRegistryError::NotReady);
    }

    let mut config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;

    let approvals = proposal.approvals.len();
    let threshold = config.admin_threshold;
    if !config.admin_set.is_empty() {
        if approvals < threshold {
            return Err(CallRegistryError::Unauthorized);
        }
    } else {
        // single admin mode: require main admin auth
        config.admin.require_auth();
    }

    // Perform operation
    match proposal.operation {
        Operation::SetFee(new_fee) => {
            if !backit_shared::is_valid_fee_bps(new_fee) {
                return Err(CallRegistryError::FeeTooHigh);
            }
            let old = config.fee_bps;
            config.fee_bps = new_fee;
            set_config(&env, &config);
            emit_admin_params_changed_u32(&env, PARAM_FEE_BPS, &config.admin, old, new_fee);
        }
        Operation::SetMinStake(new_min) => {
            if new_min < 0 {
                return Err(CallRegistryError::InvalidInput);
            }
            let old = config.min_stake;
            config.min_stake = new_min;
            set_config(&env, &config);
            emit_admin_params_changed_i128(&env, PARAM_MIN_STAKE, &config.admin, old, new_min);
        }
        Operation::SetAdminThreshold(t) => {
            config.admin_threshold = t;
            set_config(&env, &config);
        }
        Operation::Pause => {
            config.paused = true;
            set_config(&env, &config);
            emit_contract_paused(&env, &config.admin);
        }
        Operation::Unpause => {
            config.paused = false;
            set_config(&env, &config);
            emit_contract_unpaused(&env, &config.admin);
        }
        Operation::Upgrade(ref _wasm_hash) => {
            // For security, actual upgrade should be handled by deployer; emit event
            // emit_contract_upgraded handled elsewhere when wasm actually changes
        }
        Operation::WithdrawFees(ref token_addr, amount) => {
            // attempt to transfer from contract to primary admin
            if amount <= 0 {
                return Err(CallRegistryError::InvalidInput);
            }
            // if native XLM sentinel, use StellarAssetClient
            if crate::is_native_xlm(&env, &token_addr) {
                soroban_sdk::token::StellarAssetClient::new(&env, &token_addr).transfer(
                    &env.current_contract_address(),
                    &config.admin,
                    &amount,
                );
            } else {
                soroban_sdk::token::Client::new(&env, &token_addr).transfer(
                    &env.current_contract_address(),
                    &config.admin,
                    &amount,
                );
            }
        }
        Operation::AddAdmin(ref addr) => {
            // add if not present
            let mut found = false;
            for a in config.admin_set.iter() {
                if a == *addr {
                    found = true;
                    break;
                }
            }
            if !found {
                config.admin_set.push_back(addr.clone());
                set_config(&env, &config);
                emit_admin_added(&env, &addr);
            }
        }
        Operation::RemoveAdmin(ref addr) => {
            // remove all occurrences
            let mut new_vec: SdkVec<Address> = SdkVec::new(&env);
            for a in config.admin_set.iter() {
                if a != *addr {
                    new_vec.push_back(a.clone());
                }
            }
            config.admin_set = new_vec;
            set_config(&env, &config);
            emit_admin_removed(&env, &addr);
        }
    }

    proposal.status = ProposalStatus::Executed;
    set_proposal(&env, &proposal);
    emit_proposal_executed(&env, proposal_id, &caller);
    Ok(())
}

/// Cancel a proposal when timelock expired and approvals insufficient.
pub fn cancel_admin_proposal(
    env: Env,
    caller: Address,
    proposal_id: u64,
) -> Result<(), CallRegistryError> {
    let proposal = get_proposal(&env, proposal_id).ok_or(CallRegistryError::NotFound)?;
    if proposal.status != ProposalStatus::Active {
        return Err(CallRegistryError::InvalidInput);
    }
    let now = env.ledger().timestamp();
    if now < proposal.timelock_until {
        return Err(CallRegistryError::NotReady);
    }
    let config = get_config(&env).ok_or(CallRegistryError::NotInitialized)?;
    if !config.admin_set.is_empty() && (proposal.approvals.len() as u32) >= config.admin_threshold {
        return Err(CallRegistryError::InvalidInput);
    }
    // anyone may cancel in this state
    remove_proposal(&env, proposal_id);
    Ok(())
}
