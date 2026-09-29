#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, Env, Symbol, Vec};
use soroban_sdk::testutils::{Address as TestAddress};

use crate::{ContractError, ReputationNFTContract, Badge};

fn create_contract(env: &Env, admin: &Address) -> ReputationNFTContract {
    ReputationNFTContract::initialize(env.clone(), admin.clone());
    ReputationNFTContract
}

#[test]
fn test_initialization() {
    let env = Env::default();
    let admin = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    assert_eq!(contract.admin(env.clone()), admin);
}

#[test]
fn test_mint_and_get_badge() {
    let env = Env::default();
    let admin = Address::random(&env);
    let recipient = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    let badge_id = Symbol::new(&env, "PARLAY_CHAMPION");
    let metadata_uri = String::from_str(&env, "ipfs://Qm...");
    
    contract.mint(&env, admin.clone(), recipient.clone(), badge_id.clone(), 1, metadata_uri.clone()).unwrap();
    
    let badge = contract.get_badge(&env, recipient.clone(), badge_id.clone()).unwrap();
    assert_eq!(badge.owner, recipient);
    assert_eq!(badge.badge_id, badge_id);
    assert_eq!(badge.tier, 1);
    assert_eq!(badge.metadata_uri, metadata_uri);
    assert!(!badge.is_revoked);
}

#[test]
fn test_mint_duplicate_fails() {
    let env = Env::default();
    let admin = Address::random(&env);
    let recipient = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    let badge_id = Symbol::new(&env, "PARLAY_CHAMPION");
    let metadata_uri = String::from_str(&env, "ipfs://Qm...");
    
    contract.mint(&env, admin.clone(), recipient.clone(), badge_id.clone(), 1, metadata_uri.clone()).unwrap();
    
    let result = contract.mint(&env, admin, recipient, badge_id, 1, metadata_uri);
    assert_eq!(result, Err(ContractError::AlreadyMinted));
}

#[test]
fn test_transfer_fails() {
    let env = Env::default();
    let admin = Address::random(&env);
    let recipient = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    let badge_id = Symbol::new(&env, "PARLAY_CHAMPION");
    let metadata_uri = String::from_str(&env, "ipfs://Qm...");
    
    contract.mint(&env, admin.clone(), recipient.clone(), badge_id.clone(), 1, metadata_uri).unwrap();
    
    let result = contract.transfer(&env, recipient.clone(), Address::random(&env), badge_id);
    assert_eq!(result, Err(ContractError::NonTransferable));
}

#[test]
fn test_transfer_from_fails() {
    let env = Env::default();
    let admin = Address::random(&env);
    let recipient = Address::random(&env);
    let spender = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    let badge_id = Symbol::new(&env, "PARLAY_CHAMPION");
    let metadata_uri = String::from_str(&env, "ipfs://Qm...");
    
    contract.mint(&env, admin.clone(), recipient.clone(), badge_id.clone(), 1, metadata_uri).unwrap();
    
    let result = contract.transfer_from(&env, spender, recipient, Address::random(&env), badge_id);
    assert_eq!(result, Err(ContractError::NonTransferable));
}

#[test]
fn test_revoke_badge() {
    let env = Env::default();
    let admin = Address::random(&env);
    let recipient = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    let badge_id = Symbol::new(&env, "PARLAY_CHAMPION");
    let metadata_uri = String::from_str(&env, "ipfs://Qm...");
    
    contract.mint(&env, admin.clone(), recipient.clone(), badge_id.clone(), 1, metadata_uri).unwrap();
    
    contract.revoke(&env, admin, recipient.clone(), badge_id.clone()).unwrap();
    
    let badge = contract.get_badge(&env, recipient, badge_id).unwrap();
    assert!(badge.is_revoked);
}

#[test]
fn test_revoke_nonexistent_badge_fails() {
    let env = Env::default();
    let admin = Address::random(&env);
    let recipient = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    let badge_id = Symbol::new(&env, "PARLAY_CHAMPION");
    
    let result = contract.revoke(&env, admin, recipient, badge_id);
    assert_eq!(result, Err(ContractError::BadgeNotFound));
}

#[test]
fn test_has_badge() {
    let env = Env::default();
    let admin = Address::random(&env);
    let recipient = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    let badge_id = Symbol::new(&env, "PARLAY_CHAMPION");
    let metadata_uri = String::from_str(&env, "ipfs://Qm...");
    
    assert!(!contract.has_badge(&env, recipient.clone(), badge_id.clone()));
    
    contract.mint(&env, admin, recipient.clone(), badge_id.clone(), 1, metadata_uri).unwrap();
    
    assert!(contract.has_badge(&env, recipient, badge_id));
}

#[test]
fn test_invalid_tier() {
    let env = Env::default();
    let admin = Address::random(&env);
    let recipient = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    let badge_id = Symbol::new(&env, "PARLAY_CHAMPION");
    let metadata_uri = String::from_str(&env, "ipfs://Qm...");
    
    let result = contract.mint(&env, admin, recipient, badge_id, 6, metadata_uri);
    assert_eq!(result, Err(ContractError::InvalidTier));
}

#[test]
fn test_unauthorized_mint() {
    let env = Env::default();
    let admin = Address::random(&env);
    let unauthorized = Address::random(&env);
    let recipient = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    let badge_id = Symbol::new(&env, "PARLAY_CHAMPION");
    let metadata_uri = String::from_str(&env, "ipfs://Qm...");
    
    let result = contract.mint(&env, unauthorized, recipient, badge_id, 1, metadata_uri);
    assert_eq!(result, Err(ContractError::Unauthorized));
}

#[test]
fn test_set_admin() {
    let env = Env::default();
    let admin = Address::random(&env);
    let new_admin = Address::random(&env);
    let contract = create_contract(&env, &admin);
    
    contract.set_admin(&env, admin, new_admin.clone());
    assert_eq!(contract.admin(env), new_admin);
}
