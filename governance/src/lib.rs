// SPDX-License-Identifier: Apache-2.0

/// Re-exports for governance contracts
pub use rbac::*;

mod rbac;
mod errors;

/// Governance contract with RBAC integration
#[soroban_sdk::contract]
pub struct GovernanceContract;

impl GovernanceContract {
    /// Initialize governance contract with RBAC
    pub fn new(env: Env, admin: Address) -> RBAC {
        rbac::Contract::new(env, admin)
    }

    /// Require a role for privileged functions
    pub fn require_role(env: Env, role: Role, caller: Address) {
        rbac::Contract::require_role(env, role, caller)
    }
}