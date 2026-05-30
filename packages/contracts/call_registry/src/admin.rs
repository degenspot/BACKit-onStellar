use soroban_sdk::{Address, Env};

use crate::events::PARAM_MIN_STAKE;
use backit_shared::is_valid_fee_bps;

use crate::errors::CallRegistryError;
use crate::events::{
    emit_admin_params_changed_address, emit_admin_params_changed_i128,
    emit_admin_params_changed_u32, emit_token_delisted, emit_token_whitelisted, PARAM_ADMIN,
    PARAM_FEE_BPS, PARAM_MAX_STAKE_PER_USER, PARAM_OUTCOME_MANAGER,
};
use crate::storage::{extend_storage_ttl, get_config, set_config};

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
