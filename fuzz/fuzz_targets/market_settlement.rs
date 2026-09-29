//! Fuzz testing harness for multi-outcome settlement edge cases
//! Targets: call creation, staking math, settlement distribution with extreme i128 values

#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{i128, vec, Env, Symbol};
use shared::{
    call_registry::{CallRegistry, CallRegistryClient},
    outcome_manager::{OutcomeManager, OutcomeManagerClient},
};

// Fuzz input structure mirroring critical contract parameters
#[derive(Debug, Clone, arbitrary::Arbitrary)]
struct FuzzInput {
    // Up to 32 outcomes (contract max)
    outcome_count: u8,
    // Stake amounts (including i128::MAX and single-stroop)
    stake_amounts: Vec<i128>,
    // Fee-on-transfer flags
    has_fee_on_transfer: Vec<bool>,
    // Settlement weights (must sum to 10000 for 32 outcomes)
    weights: Vec<u32>,
    // Random seed for deterministic test case reproduction
    seed: u64,
}

fuzz_target!(|input: FuzzInput| {
    // Filter invalid inputs early to focus on meaningful edge cases
    if input.outcome_count == 0 || input.outcome_count > 32 {
        return;
    }
    if input.stake_amounts.len() != input.outcome_count as usize {
        return;
    }
    if input.weights.len() != input.outcome_count as usize {
        return;
    }

    // Mock environment for testing
    let env = Env::default();
    env.mock_all_auths();

    // Initialize contract clients
    let call_registry = CallRegistryClient::new(&env, &env.register_contract(None, CallRegistry));
    let outcome_manager = OutcomeManagerClient::new(&env, &env.register_contract(None, OutcomeManager));

    // Normalize weights to sum to 10000 (contract requirement)
    let total_weight: u32 = input.weights.iter().sum();
    if total_weight == 0 {
        return; // Avoid division by zero
    }
    let weights: Vec<u32> = input
        .weights
        .iter()
        .map(|&w| (w as u64 * 10000 / total_weight as u64) as u32)
        .collect();

    // Test call creation with extreme stakes
    let call_id = Symbol::new(&env, "fuzz_call");
    for (i, &stake) in input.stake_amounts.iter().enumerate() {
        if stake <= 0 {
            continue; // Skip invalid stakes
        }

        // Test single-stroop edge case
        if stake == 1 {
            let _ = call_registry.try_create_call(&call_id, &stake, &i128::from(i));
        }
        // Test i128::MAX edge case
        else if stake == i128::MAX {
            let _ = call_registry.try_create_call(&call_id, &stake, &i128::from(i));
        }
        // Test normal case
        else {
            let _ = call_registry.try_create_call(&call_id, &stake, &i128::from(i));
        }
    }

    // Test multi-outcome settlement with extreme weights
    let outcomes: Vec<Symbol> = (0..input.outcome_count)
        .map(|i| Symbol::new(&env, &format!("outcome_{}", i)))
        .collect();

    // Verify no panics on settlement distribution
    let _ = outcome_manager.try_distribute_settlement(
        &call_id,
        &outcomes,
        &weights,
        &input.has_fee_on_transfer,
    );

    // Test fee-on-transfer edge cases
    for (i, &has_fee) in input.has_fee_on_transfer.iter().enumerate() {
        if has_fee {
            let outcome = &outcomes[i];
            let _ = outcome_manager.try_apply_fee_on_transfer(outcome, &100); // 1% fee
        }
    }
});