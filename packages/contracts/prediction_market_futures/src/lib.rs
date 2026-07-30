//! # Prediction Market Futures Contract
//!
//! This module implements leveraged derivative positions on prediction market odds
//! movements via standalone futures contracts backed by margin collateral.
//!
//! ## Technical Overview
//!
//! Standalone futures contracts are created with a specified strike probability in basis points
//! (10,000 = 100%) and a required margin requirement. A creator takes the "Long" position
//! (buyer) and commits their margin. Any counterparty can then accept the contract to take
//! the "Short" position (seller), matching the margin requirement.
//!
//! Upon expiry, the contract is settled based on the current implied probability of the underlying
//! prediction market (queried from pool ratios).
//!
//! ## Financial & Leverage Risks
//!
//! 1. **Leverage Risk**: Futures positions are leveraged. Small shifts in the underlying
//!    pool ratios can cause significant changes in the payout relative to the locked margin.
//! 2. **Payout & Liquidation Caps**: Payouts are capped at `2 * margin_requirement` total
//!    to either party, meaning that if the price moves extremely in favor of one party,
//!    the payout delta is capped at `margin_requirement` (reclaiming the opponent's entire margin).
//!    There is no negative balance or unlimited liability, ensuring maximum loss is capped at
//!    the committed margin.

#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, token, Address, Bytes, BytesN, Env, Map, Vec,
};

/// Describes the price-movement condition that determines the winning outcome (mirrored from prediction_market).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ConditionType {
    TargetAbove(i128),
    TargetBelow(i128),
    PercentUp(u32),
    PercentDown(u32),
    Range(i128, i128),
}

/// Mirrors prediction_market::Call so prediction_market_futures can deserialize it cross-contract.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    pub id: u64,
    pub creator: Address,
    pub stake_token: Address,
    pub stake_amount: i128,
    pub end_ts: u64,
    pub token_address: Address,
    pub pair_id: Bytes,
    pub metadata_hash: BytesN<32>,
    pub outcome_count: u32,
    pub outcome_stakes: Map<u32, i128>,
    pub stakes: Map<u32, Map<Address, i128>>,
    pub outcome: u32,
    pub start_price: i128,
    pub end_price: i128,
    pub condition: ConditionType,
    pub settled: bool,
    pub voided: bool,
    pub created_at: u64,
    pub cancelled: bool,
    pub metadata_version: u32,
    pub share_tokens: Map<u32, Address>,
}

#[contractclient(name = "PredictionMarketFactoryClient")]
pub trait PredictionMarketFactory {
    fn get_market(env: Env, call_id: u64) -> Address;
}

#[contractclient(name = "PredictionMarketClient")]
pub trait PredictionMarket {
    fn get_call(env: Env, call_id: u64) -> Call;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FuturesError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ContractNotFound = 3,
    ContractAlreadySettled = 4,
    NoCounterparty = 5,
    CounterpartyAlreadyAssigned = 6,
    ContractExpired = 7,
    ContractNotExpired = 8,
    InvalidMargin = 9,
    InvalidStrikeProbability = 10,
    InvalidExpiry = 11,
    InvalidOutcome = 12,
    MarketNotFound = 13,
    Overflow = 14,
    Unauthorized = 15,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum FuturesStatus {
    Pending,
    Active,
    Settled,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FuturesPosition {
    pub contract_id: u64,
    pub creator: Address, // Long side
    pub counterparty: Option<Address>, // Short side, optional until accepted
    pub call_id: u64, // Underlying prediction market ID
    pub outcome: u32,
    pub strike_probability_bps: u32, // strike probability in basis points (e.g. 5000 = 50%)
    pub expiry_ts: u64,
    pub margin_requirement: i128,
    pub is_settled: bool,
    pub status: FuturesStatus,
}

#[contracttype]
pub enum DataKey {
    Factory,
    ContractCounter,
    FuturesPosition(u64),
    ActiveFutures(u64), // call_id -> Vec<u64>
}

fn get_futures_factory(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Factory)
}

fn set_futures_factory(env: &Env, factory: &Address) {
    env.storage().instance().set(&DataKey::Factory, factory);
}

fn get_contract_counter(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::ContractCounter).unwrap_or(0)
}

fn set_contract_counter(env: &Env, counter: u64) {
    env.storage().instance().set(&DataKey::ContractCounter, &counter);
}

fn get_futures_position(env: &Env, contract_id: u64) -> Option<FuturesPosition> {
    env.storage().persistent().get(&DataKey::FuturesPosition(contract_id))
}

fn set_futures_position(env: &Env, contract_id: u64, position: &FuturesPosition) {
    env.storage().persistent().set(&DataKey::FuturesPosition(contract_id), position);
}

fn get_active_futures(env: &Env, call_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::ActiveFutures(call_id))
        .unwrap_or_else(|| Vec::new(env))
}

fn set_active_futures(env: &Env, call_id: u64, active_list: &Vec<u64>) {
    env.storage()
        .persistent()
        .set(&DataKey::ActiveFutures(call_id), active_list);
}

#[cfg(not(test))]
#[inline]
fn is_native_xlm(env: &Env, addr: &Address) -> bool {
    let sentinel = Address::from_string(&soroban_sdk::String::from_str(
        env,
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    ));
    *addr == sentinel
}

#[cfg(test)]
fn is_native_xlm(env: &Env, addr: &Address) -> bool {
    let key = soroban_sdk::Symbol::new(env, "xlm_sac_addr");
    if let Some(sentinel) = env.storage().instance().get::<_, Address>(&key) {
        return *addr == sentinel;
    }
    false
}

fn transfer_token(env: &Env, token_address: &Address, from: &Address, to: &Address, amount: i128) {
    if is_native_xlm(env, token_address) {
        token::StellarAssetClient::new(env, token_address).transfer(from, to, &amount);
    } else {
        token::Client::new(env, token_address).transfer(from, to, &amount);
    }
}

#[cfg(test)]
mod test;

#[contract]
pub struct PredictionMarketFutures;

#[contractimpl]
impl PredictionMarketFutures {
    /// Initializes the standalone futures contract with the PredictionMarketFactory address.
    pub fn initialize(env: Env, factory: Address) -> Result<(), FuturesError> {
        if get_futures_factory(&env).is_some() {
            return Err(FuturesError::AlreadyInitialized);
        }
        set_futures_factory(&env, &factory);
        Ok(())
    }

    /// Creates a new leveraged futures contract.
    /// Locks the `margin_requirement` as collateral from the `creator` (long side).
    pub fn create_futures_contract(
        env: Env,
        creator: Address,
        call_id: u64,
        outcome: u32,
        strike_probability_bps: u32,
        expiry_ts: u64,
        margin_requirement: i128,
    ) -> Result<u64, FuturesError> {
        creator.require_auth();

        if margin_requirement <= 0 {
            return Err(FuturesError::InvalidMargin);
        }
        if strike_probability_bps > 10000 {
            return Err(FuturesError::InvalidStrikeProbability);
        }
        if expiry_ts <= env.ledger().timestamp() {
            return Err(FuturesError::InvalidExpiry);
        }

        let factory = get_futures_factory(&env).ok_or(FuturesError::NotInitialized)?;
        let factory_client = PredictionMarketFactoryClient::new(&env, &factory);

        let market_addr = factory_client.get_market(&call_id);
        let pm_client = PredictionMarketClient::new(&env, &market_addr);
        let call = pm_client.get_call(&call_id);

        if outcome < 1 || outcome > call.outcome_count {
            return Err(FuturesError::InvalidOutcome);
        }

        // Lock margin requirement from creator
        transfer_token(
            &env,
            &call.stake_token,
            &creator,
            &env.current_contract_address(),
            margin_requirement,
        );

        // Generate contract ID
        let counter = get_contract_counter(&env) + 1;
        set_contract_counter(&env, counter);

        let position = FuturesPosition {
            contract_id: counter,
            creator: creator.clone(),
            counterparty: None,
            call_id,
            outcome,
            strike_probability_bps,
            expiry_ts,
            margin_requirement,
            is_settled: false,
            status: FuturesStatus::Pending,
        };

        set_futures_position(&env, counter, &position);

        // Track active futures for the call ID
        let mut active_list = get_active_futures(&env, call_id);
        active_list.push_back(counter);
        set_active_futures(&env, call_id, &active_list);

        Ok(counter)
    }

    /// Accepts a futures contract as the short counterparty.
    /// Locks equal `margin_requirement` matching collateral from `counterparty`.
    pub fn accept_futures_counterparty(
        env: Env,
        counterparty: Address,
        contract_id: u64,
    ) -> Result<(), FuturesError> {
        counterparty.require_auth();

        let mut position = get_futures_position(&env, contract_id)
            .ok_or(FuturesError::ContractNotFound)?;

        if position.is_settled {
            return Err(FuturesError::ContractAlreadySettled);
        }
        if position.counterparty.is_some() {
            return Err(FuturesError::CounterpartyAlreadyAssigned);
        }
        if env.ledger().timestamp() >= position.expiry_ts {
            return Err(FuturesError::ContractExpired);
        }

        let factory = get_futures_factory(&env).ok_or(FuturesError::NotInitialized)?;
        let factory_client = PredictionMarketFactoryClient::new(&env, &factory);

        let market_addr = factory_client.get_market(&position.call_id);
        let pm_client = PredictionMarketClient::new(&env, &market_addr);
        let call = pm_client.get_call(&position.call_id);

        // Lock matching margin requirement from counterparty
        transfer_token(
            &env,
            &call.stake_token,
            &counterparty,
            &env.current_contract_address(),
            position.margin_requirement,
        );

        position.counterparty = Some(counterparty);
        position.status = FuturesStatus::Active;

        set_futures_position(&env, contract_id, &position);

        Ok(())
    }

    /// Settles the futures contract and distributes the payouts.
    /// Callable by anyone after `env.ledger().timestamp() >= expiry_ts`.
    pub fn settle_futures(env: Env, contract_id: u64) -> Result<(), FuturesError> {
        let mut position = get_futures_position(&env, contract_id)
            .ok_or(FuturesError::ContractNotFound)?;

        if position.is_settled {
            return Err(FuturesError::ContractAlreadySettled);
        }
        if position.counterparty.is_none() {
            return Err(FuturesError::NoCounterparty);
        }
        if env.ledger().timestamp() < position.expiry_ts {
            return Err(FuturesError::ContractNotExpired);
        }

        let factory = get_futures_factory(&env).ok_or(FuturesError::NotInitialized)?;
        let factory_client = PredictionMarketFactoryClient::new(&env, &factory);

        let market_addr = factory_client.get_market(&position.call_id);
        let pm_client = PredictionMarketClient::new(&env, &market_addr);
        let call = pm_client.get_call(&position.call_id);

        // Calculate pool ratios and current implied probability (in basis points)
        let mut total_stake: i128 = 0;
        for i in 1..=call.outcome_count {
            total_stake += call.outcome_stakes.get(i).unwrap_or(0);
        }

        if total_stake == 0 {
            return Err(FuturesError::Overflow);
        }

        let outcome_stake = call.outcome_stakes.get(position.outcome).unwrap_or(0);
        let current_bps = (outcome_stake
            .checked_mul(10000)
            .ok_or(FuturesError::Overflow)?
            .checked_div(total_stake)
            .ok_or(FuturesError::Overflow)?) as u32;

        let strike_bps = position.strike_probability_bps;
        let margin = position.margin_requirement;

        let (buyer_payout, seller_payout) = if current_bps > strike_bps {
            let diff = current_bps - strike_bps;
            let payout_delta = (margin as i128)
                .checked_mul(diff as i128)
                .ok_or(FuturesError::Overflow)?
                .checked_div(10000)
                .ok_or(FuturesError::Overflow)?;
            let payout_delta = core::cmp::min(payout_delta, margin);
            (margin + payout_delta, margin - payout_delta)
        } else if current_bps < strike_bps {
            let diff = strike_bps - current_bps;
            let payout_delta = (margin as i128)
                .checked_mul(diff as i128)
                .ok_or(FuturesError::Overflow)?
                .checked_div(10000)
                .ok_or(FuturesError::Overflow)?;
            let payout_delta = core::cmp::min(payout_delta, margin);
            (margin - payout_delta, margin + payout_delta)
        } else {
            (margin, margin)
        };

        let counterparty_addr = position.counterparty.clone().unwrap();

        // Perform transfers
        if buyer_payout > 0 {
            transfer_token(
                &env,
                &call.stake_token,
                &env.current_contract_address(),
                &position.creator,
                buyer_payout,
            );
        }
        if seller_payout > 0 {
            transfer_token(
                &env,
                &call.stake_token,
                &env.current_contract_address(),
                &counterparty_addr,
                seller_payout,
            );
        }

        // Mark as settled
        position.is_settled = true;
        position.status = FuturesStatus::Settled;
        set_futures_position(&env, contract_id, &position);

        // Remove from active tracking state
        let active_list = get_active_futures(&env, position.call_id);
        let mut new_list = Vec::new(&env);
        for id in active_list.iter() {
            if id != contract_id {
                new_list.push_back(id);
            }
        }
        set_active_futures(&env, position.call_id, &new_list);

        Ok(())
    }

    /// Seamlessly transfers long position ownership to a new owner.
    pub fn transfer_long_position(
        env: Env,
        contract_id: u64,
        new_owner: Address,
    ) -> Result<(), FuturesError> {
        let mut position = get_futures_position(&env, contract_id)
            .ok_or(FuturesError::ContractNotFound)?;

        position.creator.require_auth();

        if position.is_settled {
            return Err(FuturesError::ContractAlreadySettled);
        }

        position.creator = new_owner;
        set_futures_position(&env, contract_id, &position);

        Ok(())
    }

    /// Seamlessly transfers short position ownership to a new owner.
    pub fn transfer_short_position(
        env: Env,
        contract_id: u64,
        new_owner: Address,
    ) -> Result<(), FuturesError> {
        let mut position = get_futures_position(&env, contract_id)
            .ok_or(FuturesError::ContractNotFound)?;

        let counterparty = position.counterparty.clone().ok_or(FuturesError::NoCounterparty)?;
        counterparty.require_auth();

        if position.is_settled {
            return Err(FuturesError::ContractAlreadySettled);
        }

        position.counterparty = Some(new_owner);
        set_futures_position(&env, contract_id, &position);

        Ok(())
    }

    /// View function returning active futures contract IDs for a given call ID.
    pub fn get_active_futures(env: Env, call_id: u64) -> Vec<u64> {
        get_active_futures(&env, call_id)
    }

    /// View function returning the FuturesPosition struct details for a contract ID.
    pub fn get_futures_position(env: Env, contract_id: u64) -> Result<FuturesPosition, FuturesError> {
        get_futures_position(&env, contract_id).ok_or(FuturesError::ContractNotFound)
    }

    /// View function returning the configured factory address.
    pub fn get_factory(env: Env) -> Result<Address, FuturesError> {
        get_futures_factory(&env).ok_or(FuturesError::NotInitialized)
    }
}
