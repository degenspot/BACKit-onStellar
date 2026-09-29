// SPDX-License-Identifier: Apache-2.0
use soroban_sdk::{contractimport, env, symbol, vec, Address, Bytes, BytesN, Env, Symbol, Vec};
use soroban_sdk::token::TokenClient;
use soroban_sdk::contracttype::Contract;
use soroban_sdk::token::TokenClient;
use soroban_sdk::token::TokenType;
use soroban_sdk::token::Token;
use soroban_sdk::token::TokenClient;

// Custom error types for RBAC violations
pub mod errors {
    use soroban_sdk::env::Env;
    use soroban_sdk::xdr::ScVal;
    
    soroban_sdk::contractimport!(file = "errors.rs");
    
    #[derive(Debug, Clone, Eq, PartialEq, soroban_sdk::xdr::Xdr)]
    pub enum Error {
        Unauthorized,
        RoleNotFound,
        InvalidRole,
        TTLExpired,
        DuplicateRole,
    }
    
    impl soroban_sdk::xdr::Xdr for Error {
        fn xdr() -> soroban_sdk::xdr::Xdr {
            use soroban_sdk::xdr::ScVal;
            ScVal::xdr()
        }
    }
}

/// Role enum defining supported governance roles
#[derive(Debug, Clone, Eq, PartialEq, soroban_sdk::xdr::Xdr)]
pub enum Role {
    Admin,
    Oracle,
    Pauser,
    FeeManager,
}

/// Role mapping structure with TTL
#[derive(Debug, Clone, Eq, PartialEq, soroban_sdk::xdr::Xdr)]
pub struct RoleMapping {
    pub role: Role,
    pub address: Address,
    pub ttl: u64,
}

/// RBAC contract state
#[derive(Debug, Clone, Eq, PartialEq, soroban_sdk::xdr::Xdr)]
pub struct RBAC {
    pub admins: Vec<Address>,
    pub roles: Vec<RoleMapping>,
}

/// RBAC contract
pub struct Contract;

impl Contract {
    /// Initialize RBAC with initial admin
    pub fn new(env: Env, admin: Address) -> RBAC {
        RBAC {
            admins: vec![admin; env],
            roles: Vec::new(env),
        }
    }

    /// Check if caller has the required role
    pub fn require_role(env: Env, role: Role, caller: Address) {
        let rbac = Self::RBAC(env);
        let has_role = rbac.roles.iter().any(|mapping| {
            mapping.role == role && mapping.address == caller && mapping.ttl > env.ledger().timestamp()
        });
        
        if !has_role {
            env.abort(
                errors::Error::Unauthorized,
                "Caller does not have the required role"
            );
        }
    }

    /// Grant a role to an address with TTL
    pub fn grant_role(env: Env, role: Role, address: Address, ttl: u64) {
        Self::require_role(env, Role::Admin, env.invoker());
        
        let rbac = Self::RBAC(env);
        let existing = rbac.roles.iter().find(|m| m.role == role && m.address == address);
        
        if existing.is_some() {
            env.abort(
                errors::Error::DuplicateRole,
                "Role already assigned to this address"
            );
        }
        
        let new_mapping = RoleMapping {
            role,
            address,
            ttl: env.ledger().timestamp() + ttl,
        };
        
        rbac.roles.push(new_mapping);
    }

    /// Revoke a role from an address
    pub fn revoke_role(env: Env, role: Role, address: Address) {
        Self::require_role(env, Role::Admin, env.invoker());
        
        let rbac = Self::RBAC(env);
        let mut roles = rbac.roles;
        
        roles.retain(|m| !(m.role == role && m.address == address));
        
        // Update state
        let _ = Self::RBAC(env).roles.set(roles);
    }

    /// Transfer a role to a new address
    pub fn transfer_role(env: Env, role: Role, new_address: Address) {
        Self::require_role(env, role, env.invoker());
        
        let rbac = Self::RBAC(env);
        let mut roles = rbac.roles;
        
        if let Some(mapping) = roles.iter_mut().find(|m| m.role == role && m.address == env.invoker()) {
            mapping.address = new_address;
        } else {
            env.abort(
                errors::Error::RoleNotFound,
                "Caller does not hold the specified role"
            );
        }
    }
}
