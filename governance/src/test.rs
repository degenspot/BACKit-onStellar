// SPDX-License-Identifier: MIT
use soroban_sdk::{testutils::Address as _, vec, Env, Address};
use governance::GovernanceContractClient;

#[test]
fn test_withdrawal_lifecycle() {
    let env = Env::default();
    let contract_id = env.register_contract(None, governance::GovernanceContract);
    let client = GovernanceContractClient::new(&env, &contract_id);
    
    let token = Address::random(&env);
    let recipient = Address::random(&env);
    let amount = 1000;
    
    // Test proposal
    let proposal_id = client.propose_withdrawal(&token, &amount, &recipient);
    assert!(proposal_id == 0);
    
    // Test premature execution fails
    let result = std::panic::catch_unwind(|| {
        client.execute_withdrawal(&proposal_id);
    });
    assert!(result.is_err());
    
    // Test cancellation
    client.cancel_withdrawal(&proposal_id);
    
    // Test execution after timelock (simulated)
    let env = Env::default();
    env.mock_all_auths();
    
    // Fast-forward time by 48 hours + 1 second
    env.ledger().with_mut(|li| {
        li.timestamp = 48 * 60 * 60 + 1;
    });
    
    let proposal_id = client.propose_withdrawal(&token, &amount, &recipient);
    client.execute_withdrawal(&proposal_id);
    
    // Verify events were emitted
    let events = env.events().all();
    assert!(events.len() >= 2);
}

#[test]
fn test_admin_privileges() {
    let env = Env::default();
    let contract_id = env.register_contract(None, governance::GovernanceContract);
    let client = GovernanceContractClient::new(&env, &contract_id);
    
    let non_admin = Address::random(&env);
    let token = Address::random(&env);
    let recipient = Address::random(&env);
    let amount = 1000;
    
    // Non-admin cannot propose
    let result = std::panic::catch_unwind(|| {
        client.with_source_account(&non_admin).propose_withdrawal(&token, &amount, &recipient);
    });
    assert!(result.is_err());
    
    // Non-admin cannot cancel
    let proposal_id = client.propose_withdrawal(&token, &amount, &recipient);
    let result = std::panic::catch_unwind(|| {
        client.with_source_account(&non_admin).cancel_withdrawal(&proposal_id);
    });
    assert!(result.is_err());
}

#[test]
fn test_timelock_constants() {
    use governance::timelock::TIMELOCK_DURATION;
    assert_eq!(TIMELOCK_DURATION, 48 * 60 * 60);
}