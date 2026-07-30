use crate::types::{MarketplaceConfig, OracleProvider};
use soroban_sdk::{contracttype, Address, BytesN, Env, Map, Vec};

#[contracttype]
pub enum DataKey {
    Config,
    Oracle(BytesN<32>),
    OracleList,
    OracleRatings(BytesN<32>),
    CallOracle(u64),
}

pub fn set_config(env: &Env, config: &MarketplaceConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_config(env: &Env) -> Option<MarketplaceConfig> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn set_oracle(env: &Env, pubkey: &BytesN<32>, provider: &OracleProvider) {
    env.storage().instance().set(&DataKey::Oracle(pubkey.clone()), provider);
}

pub fn get_oracle(env: &Env, pubkey: &BytesN<32>) -> Option<OracleProvider> {
    env.storage().instance().get(&DataKey::Oracle(pubkey.clone()))
}

pub fn set_oracle_list(env: &Env, list: &Vec<BytesN<32>>) {
    env.storage().instance().set(&DataKey::OracleList, list);
}

pub fn get_oracle_list(env: &Env) -> Vec<BytesN<32>> {
    env.storage()
        .instance()
        .get(&DataKey::OracleList)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_to_oracle_list(env: &Env, pubkey: &BytesN<32>) {
    let mut list = get_oracle_list(env);
    if !list.contains(pubkey.clone()) {
        list.push_back(pubkey.clone());
        set_oracle_list(env, &list);
    }
}

pub fn remove_from_oracle_list(env: &Env, pubkey: &BytesN<32>) {
    let list = get_oracle_list(env);
    let mut filtered = Vec::new(env);
    for i in 0..list.len() {
        let pk = list.get(i).unwrap();
        if pk != *pubkey {
            filtered.push_back(pk);
        }
    }
    set_oracle_list(env, &filtered);
}

pub fn set_call_oracle(env: &Env, call_id: u64, oracle: &BytesN<32>) {
    env.storage()
        .instance()
        .set(&DataKey::CallOracle(call_id), oracle);
}

pub fn get_call_oracle(env: &Env, call_id: u64) -> Option<BytesN<32>> {
    env.storage().instance().get(&DataKey::CallOracle(call_id))
}

pub fn set_oracle_ratings(env: &Env, oracle: &BytesN<32>, ratings: &Map<Address, bool>) {
    env.storage()
        .instance()
        .set(&DataKey::OracleRatings(oracle.clone()), ratings);
}

pub fn get_oracle_ratings(env: &Env, oracle: &BytesN<32>) -> Map<Address, bool> {
    env.storage()
        .instance()
        .get(&DataKey::OracleRatings(oracle.clone()))
        .unwrap_or_else(|| Map::new(env))
}
