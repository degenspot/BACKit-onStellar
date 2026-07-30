use crate::types::{FactoryConfig, Swarm};
use soroban_sdk::{contracttype, Address, Env, Vec};

#[contracttype]
pub enum DataKey {
    Config,
    MarketCounter,
    Market(u64),
    MarketList,
    StrategyCounter,
    Strategy(u64),
    UserStrategies(Address),
}

pub fn set_config(env: &Env, config: &FactoryConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_config(env: &Env) -> Option<FactoryConfig> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn next_market_id(env: &Env) -> u64 {
    let counter: u64 = env
        .storage()
        .instance()
        .get(&DataKey::MarketCounter)
        .unwrap_or(0);
    let next_id = counter + 1;
    env.storage()
        .instance()
        .set(&DataKey::MarketCounter, &next_id);
    next_id
}

pub fn get_market_count(env: &Env) -> u32 {
    let counter: u64 = env
        .storage()
        .instance()
        .get(&DataKey::MarketCounter)
        .unwrap_or(0);
    counter as u32
}

pub fn set_market(env: &Env, call_id: u64, market: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::Market(call_id), market);
}

pub fn get_market(env: &Env, call_id: u64) -> Option<Address> {
    env.storage().instance().get(&DataKey::Market(call_id))
}

pub fn append_market_list(env: &Env, market: &Address) {
    let mut list: Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::MarketList)
        .unwrap_or_else(|| Vec::new(env));
    list.push_back(market.clone());
    env.storage().instance().set(&DataKey::MarketList, &list);
}

pub fn get_market_list(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::MarketList)
        .unwrap_or_else(|| Vec::new(env))
}

use crate::conditional_staking::ConditionalStrategy;

pub fn next_strategy_id(env: &Env) -> u64 {
    let counter: u64 = env
        .storage()
        .instance()
        .get(&DataKey::StrategyCounter)
        .unwrap_or(0);
    let next_id = counter + 1;
    env.storage()
        .instance()
        .set(&DataKey::StrategyCounter, &next_id);
    next_id
}

pub fn set_strategy(env: &Env, id: u64, strategy: &ConditionalStrategy) {
    env.storage().instance().set(&DataKey::Strategy(id), strategy);
}

pub fn get_strategy(env: &Env, id: u64) -> Option<ConditionalStrategy> {
    env.storage().instance().get(&DataKey::Strategy(id))
}

pub fn add_user_strategy(env: &Env, user: &Address, strategy_id: u64) {
    let key = DataKey::UserStrategies(user.clone());
    let mut list: soroban_sdk::Vec<u64> = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));
    list.push_back(strategy_id);
    env.storage().instance().set(&key, &list);
}

pub fn get_user_strategies(env: &Env, user: &Address) -> soroban_sdk::Vec<u64> {
    let key = DataKey::UserStrategies(user.clone());
    env.storage()
        .instance()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env))
}
