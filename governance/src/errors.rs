// SPDX-License-Identifier: Apache-2.0
use soroban_sdk::env::Env;
use soroban_sdk::xdr::ScVal;

/// Custom error types for RBAC violations
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

impl Error {
    pub fn to_contract_error(&self) -> soroban_sdk::contracterror::ContractError {
        match self {
            Error::Unauthorized => soroban_sdk::contracterror::ContractError::GenericError {
                error: "Unauthorized access".into(),
            },
            Error::RoleNotFound => soroban_sdk::contracterror::ContractError::GenericError {
                error: "Role not found".into(),
            },
            Error::InvalidRole => soroban_sdk::contracterror::ContractError::GenericError {
                error: "Invalid role".into(),
            },
            Error::TTLExpired => soroban_sdk::contracterror::ContractError::GenericError {
                error: "Role TTL expired".into(),
            },
            Error::DuplicateRole => soroban_sdk::contracterror::ContractError::GenericError {
                error: "Duplicate role assignment".into(),
            },
        }
    }
}