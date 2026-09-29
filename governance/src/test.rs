//! Tests for treasury fee split

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, vec, Address, Env};

#[test]
fn test_fee_distribution() {
    let e = Env::default();
    let admin = Address::random(&e);
    
    // Set initial ratios (50%, 25%, 15%, 10%)
    let ratios = FeeSplit {
        protocol_treasury: 5000,
        creator_incentives: 2500,
        token_buyback: 1500,
        sac_burn: 1000,
    };
    
    e.storage().set(ADMIN_KEY, &admin);
    e.storage().set(SPLIT_RATIOS_KEY, &ratios);
    
    // Test distribution
    let amount = 10000;
    let result = distribute_fees(&e, amount);
    assert!(result.is_ok());
}

#[test]
fn test_invalid_ratios() {
    let e = Env::default();
    let invalid_ratios = FeeSplit {
        protocol_treasury: 5000,
        creator_incentives: 2500,
        token_buyback: 1500,
        sac_burn: 1001, // Sum exceeds 10000
    };
    assert!(!invalid_ratios.validate());
}

#[test]
fn test_update_ratios() {
    let e = Env::default();
    let admin = Address::random(&e);
    let new_ratios = FeeSplit {
        protocol_treasury: 4000,
        creator_incentives: 3000,
        token_buyback: 2000,
        sac_burn: 1000,
    };
    
    e.storage().set(ADMIN_KEY, &admin);
    let result = update_split_ratios(&e, admin, new_ratios);
    assert!(result.is_ok());
}

#[test]
fn test_unauthorized_update() {
    let e = Env::default();
    let non_admin = Address::random(&e);
    let new_ratios = FeeSplit {
        protocol_treasury: 4000,
        creator_incentives: 3000,
        token_buyback: 2000,
        sac_burn: 1000,
    };
    
    let result = update_split_ratios(&e, non_admin, new_ratios);
    assert!(matches!(result, Err(Error::Unauthorized)));
}
