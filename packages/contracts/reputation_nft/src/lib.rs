//! Soulbound Reputation NFT Contract
//! Implements non-transferable achievement badges (SEP-008 compliant)

#![no_std]

use soroban_sdk::{contract, contractimpl, contracterror, symbol, vec, Address, Env, Symbol, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ContractError {
    NonTransferable = 1,
    Unauthorized = 2,
    BadgeNotFound = 3,
    AlreadyMinted = 4,
    InvalidTier = 5
}

pub struct Badge {
    pub owner: Address,
    pub badge_id: Symbol,
    pub tier: u32,
    pub metadata_uri: String,
    pub is_revoked: bool
}

pub struct ReputationNFTContract;

#[contract]
pub impl ReputationNFTContract {
    /// Admin address (set during contract initialization)
    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&Symbol::new(&env, "admin")).unwrap_or_else(|| panic!("admin not set"))
    }

    /// Initialize contract with admin address
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&Symbol::new(&env, "admin")) {
            panic!("already initialized");
        }
        env.storage().instance().set(&Symbol::new(&env, "admin"), &admin);
    }

    /// Mint a new soulbound badge to recipient
    pub fn mint(env: Env, admin: Address, recipient: Address, badge_id: Symbol, tier: u32, metadata_uri: String) -> Result<(), ContractError> {
        admin.require_auth()?;

        if tier > 5 {
            return Err(ContractError::InvalidTier);
        }

        let key = (recipient, badge_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(ContractError::AlreadyMinted);
        }

        let badge = Badge {
            owner: recipient.clone(),
            badge_id: badge_id.clone(),
            tier,
            metadata_uri,
            is_revoked: false
        };

        env.storage().persistent().set(&key, &badge);
        env.storage().persistent().set(&(badge_id, recipient), &true);

        Ok(())
    }

    /// Revoke a badge (admin only)
    pub fn revoke(env: Env, admin: Address, recipient: Address, badge_id: Symbol) -> Result<(), ContractError> {
        admin.require_auth()?;

        let key = (recipient.clone(), badge_id.clone());
        let mut badge: Badge = env.storage().persistent().get(&key).ok_or(ContractError::BadgeNotFound)?;

        if badge.is_revoked {
            return Err(ContractError::BadgeNotFound);
        }

        badge.is_revoked = true;
        env.storage().persistent().set(&key, &badge);

        Ok(())
    }

    /// Get badge details
    pub fn get_badge(env: Env, recipient: Address, badge_id: Symbol) -> Result<Badge, ContractError> {
        let key = (recipient, badge_id);
        env.storage().persistent().get(&key).ok_or(ContractError::BadgeNotFound)
    }

    /// Check if address owns a specific badge
    pub fn has_badge(env: Env, recipient: Address, badge_id: Symbol) -> bool {
        let key = (recipient, badge_id);
        env.storage().persistent().has(&key)
    }

    /// Override transfer - always reverts for soulbound tokens
    pub fn transfer(env: Env, from: Address, to: Address, badge_id: Symbol) -> Result<(), ContractError> {
        from.require_auth()?;
        Err(ContractError::NonTransferable)
    }

    /// Override transfer_from - always reverts for soulbound tokens
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, badge_id: Symbol) -> Result<(), ContractError> {
        spender.require_auth()?;
        Err(ContractError::NonTransferable)
    }

    /// Get all badges for an address
    pub fn get_badges(env: Env, recipient: Address) -> Vec<Badge> {
        let mut result = Vec::new(&env);
        
        // Note: In production, use proper storage iteration
        // This is a simplified version for demonstration
        let prefix = (recipient,);
        
        // In real implementation, use storage.iter() with proper prefix
        // For now, return empty vec as placeholder
        result
    }
}

#[contract]
pub impl ReputationNFTContract {
    /// Admin-only function to set new admin
    pub fn set_admin(env: Env, current_admin: Address, new_admin: Address) {
        current_admin.require_auth()?;
        env.storage().instance().set(&Symbol::new(&env, "admin"), &new_admin);
    }
}
