// SPDX-License-Identifier: Apache-2.0
use soroban_sdk::{contractimport, Env, Symbol, Vec, contracttype, contractimpl, map, token, Address, Bytes, contracterror, IntoVal, String, try_invariant, Val, contractmetadata, contractmethod, contractevent, contractstorage, contractstate, contracttype, contractimpl, contractmethod, contractstorage, contractstate, contracttype, contractimpl, contractmethod, contractstorage, contractstate, contracttype, contractimpl, contractmethod, contractstorage, contractstate};

#[derive(Clone, Debug, PartialEq, Eq, soroban_sdk::IntoVal, soroban_sdk::FromVal)]
pub enum PauseFlags {
    PAUSE_CREATION = 1 << 0,
    PAUSE_STAKING = 1 << 1,
    PAUSE_SETTLEMENT = 1 << 2,
    PAUSE_ALL = (1 << 3) - 1,
}

#[derive(Clone, Debug, PartialEq, Eq, soroban_sdk::IntoVal, soroban_sdk::FromVal)]
pub struct PauseConfig {
    pub flags: PauseFlags,
    pub pauser: Address,
}

#[contracterror]
pub enum ContractError {
    #[msg("Operation is paused")]
    Paused,
    #[msg("Only pauser can pause/unpause")]
    Unauthorized,
}

#[contractstorage]
pub struct Storage {
    pub pause_config: PauseConfig,
}

#[contractimpl]
pub struct Contract;

impl Contract {
    pub fn new(env: Env, pauser: Address) -> Address {
        let pause_config = PauseConfig {
            flags: PauseFlags::PAUSE_ALL,
            pauser,
        };
        
        env.storage().instance().set(&StorageKey::PauseConfig, &pause_config.into_val(&env));
        
        Self::env().contract_address()
    }

    pub fn pause(env: Env, flags: PauseFlags) -> Result<(), ContractError> {
        let storage = Self::get_storage(&env);
        
        if storage.pause_config.pauser != env.invoker() {
            return Err(ContractError::Unauthorized);
        }
        
        let mut pause_config = storage.pause_config;
        pause_config.flags = flags;
        
        env.storage().instance().set(&StorageKey::PauseConfig, &pause_config.into_val(&env));
        Ok(())
    }

    pub fn unpause(env: Env, flags: PauseFlags) -> Result<(), ContractError> {
        let storage = Self::get_storage(&env);
        
        if storage.pause_config.pauser != env.invoker() {
            return Err(ContractError::Unauthorized);
        }
        
        let mut pause_config = storage.pause_config;
        pause_config.flags &= !flags;
        
        env.storage().instance().set(&StorageKey::PauseConfig, &pause_config.into_val(&env));
        Ok(())
    }

    fn get_storage(env: &Env) -> Storage {
        let pause_config = env.storage().instance().get(&StorageKey::PauseConfig).unwrap_or_else(|| {
            panic!("Pause config not initialized")
        });
        
        Storage {
            pause_config: PauseConfig::from_val(&pause_config).unwrap(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, soroban_sdk::IntoVal, soroban_sdk::FromVal)]
enum StorageKey {
    PauseConfig,
}

#[contractmethod]
pub fn is_paused(env: Env, flag: PauseFlags) -> bool {
    let storage = Contract::get_storage(&env);
    (storage.pause_config.flags & flag) != 0
}