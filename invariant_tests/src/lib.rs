use proptest::prelude::*;
use soroban_sdk::{BigInt, Vec};

// Represents a staking operation with random parameters
#[derive(Debug, Clone)]
pub struct StakingOperation {
    pub staker_id: u64,
    pub amount: u64,
    pub outcome: bool, // true = success, false = failure
    pub resolution: u8, // 0 = immediate, 1 = delayed, 2 = partial
}

// Generates random staking operations
prop_compose! {
    pub fn staking_operation()(
        staker_id in 1..1000u64,
        amount in 1..10000u64,
        outcome in proptest::bool::ANY,
        resolution in 0..3u8,
    ) -> StakingOperation {
        StakingOperation {
            staker_id,
            amount,
            outcome,
            resolution,
        }
    }
}

// Simulates the vault state
#[derive(Debug, Default)]
pub struct VaultState {
    pub total_staked: u64,
    pub total_payouts: u64,
    pub total_fees: u64,
    pub user_stakes: std::collections::HashMap<u64, u64>,
}

impl VaultState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply_operation(&mut self, op: &StakingOperation) {
        match op.outcome {
            true => {
                // Successful stake
                self.total_staked += op.amount;
                *self.user_stakes.entry(op.staker_id).or_insert(0) += op.amount;
                
                // Simulate payout (90% return, 10% fee)
                let payout = (op.amount * 90) / 100;
                let fee = op.amount - payout;
                self.total_payouts += payout;
                self.total_fees += fee;
                
                // Reduce user stake by payout + fee
                *self.user_stakes.entry(op.staker_id).or_insert(0) -= op.amount;
            }
            false => {
                // Failed stake - only fees are collected
                let fee = op.amount / 10; // 10% fee on failed stakes
                self.total_fees += fee;
                self.total_staked += op.amount - fee;
                *self.user_stakes.entry(op.staker_id).or_insert(0) += op.amount - fee;
            }
        }
    }

    pub fn invariant_holds(&self) -> bool {
        let sum_user_stakes: u64 = self.user_stakes.values().sum();
        let total_funds = self.total_payouts + self.total_fees;
        sum_user_stakes == self.total_staked && self.total_staked == total_funds
    }
}

// Property test for fund conservation
proptest! {
    #[test]
    fn test_fund_conservation(operations in proptest::collection::vec(staking_operation(), 1..=100)) {
        let mut vault = VaultState::new();
        
        for op in &operations {
            vault.apply_operation(op);
            
            // Assert invariant after each operation
            prop_assert!(vault.invariant_holds(), 
                "Invariant violated after operation: {:?}\nVault state: {:?}", op, vault);
        }
        
        // Final invariant check
        prop_assert!(vault.invariant_holds());
    }
}
