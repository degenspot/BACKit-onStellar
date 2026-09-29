use invariant_tests::{StakingOperation, VaultState};
use proptest::prelude::*;

#[test]
fn test_50k_iterations() {
    // Configure proptest to run 50,000 cases
    let mut config = ProptestConfig::default();
    config.cases = 50000;
    
    let mut runner = ProptestRunner::new(config);
    
    runner.run(&|(operations,)| {
        let mut vault = VaultState::new();
        
        for op in &operations {
            vault.apply_operation(op);
            assert!(vault.invariant_holds(), 
                "Invariant violated after operation: {:?}\nVault state: {:?}", op, vault);
        }
        
        Ok(())
    }, proptest::collection::vec(invariant_tests::staking_operation(), 1..=100));
}
