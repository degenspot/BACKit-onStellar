
// SPDX-License-Identifier: Apache-2.0
use soroban_sdk::{contract, contractimpl, symbol, vec, Env, Symbol, Address, Vec, IntoVal, Decimal, ContractError, contracterror};
use soroban_sdk::token::{TokenClient, Client as TokenClientImpl};
use soroban_sdk::uniques::UniquesClient;

#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ContractError {
    InvalidLeverage,
    InsufficientCollateral,
    LiquidationThresholdNotMet,
    InvalidPositionId,
    LiquidatorNotAuthorized,
    MarginExceedsLimit,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Position {
    pub user: Address,
    pub market_id: Symbol,
    pub size: Decimal,
    pub leverage: Decimal,
    pub is_long: bool,
    pub collateral: Decimal,
    pub entry_price: Decimal,
    pub liquidation_price: Decimal,
    pub liquidated: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FuturesContract {
    pub admin: Address,
    pub collateral_token: Address,
    pub maintenance_margin_ratio: Decimal,
    pub liquidator_bounty_percentage: Decimal,
    pub positions: Vec<Position>,
    pub mark_price: Decimal,
}

#[contract]
pub struct PredictionMarketFutures;

#[contractimpl]
impl PredictionMarketFutures {
    pub fn new(env: Env, admin: Address, collateral_token: Address) -> FuturesContract {
        let contract = FuturesContract {
            admin,
            collateral_token,
            maintenance_margin_ratio: Decimal::from_str(env, "0.05").unwrap(), // 5% maintenance margin
            liquidator_bounty_percentage: Decimal::from_str(env, "0.05").unwrap(), // 5% liquidator bounty
            positions: Vec::new(&env),
            mark_price: Decimal::from_str(env, "1.0").unwrap(),
        };
        env.storage().instance().set(&contract);
        contract
    }

    pub fn open_position(
        env: Env,
        this: Address,
        user: Address,
        market_id: Symbol,
        size: Decimal,
        leverage: Decimal,
        is_long: bool,
    ) -> Result<(), ContractError> {
        let contract = FuturesContract::from_storage(&env);
        let collateral_token = TokenClient::new(&env, &contract.collateral_token);

        // Validate leverage
        if leverage <= Decimal::from_str(&env, "1.0").unwrap() {
            return Err(ContractError::InvalidLeverage);
        }

        // Calculate required collateral
        let required_collateral = size * leverage * contract.maintenance_margin_ratio;
        let user_collateral = collateral_token.balance(&user);

        if user_collateral < required_collateral {
            return Err(ContractError::InsufficientCollateral);
        }

        // Create position
        let entry_price = if is_long {
            contract.mark_price
        } else {
            Decimal::from_str(&env, "1.0").unwrap() / contract.mark_price
        };

        let liquidation_price = if is_long {
            contract.mark_price * (Decimal::from_str(&env, "1.0").unwrap() - contract.maintenance_margin_ratio)
        } else {
            contract.mark_price / (Decimal::from_str(&env, "1.0").unwrap() - contract.maintenance_margin_ratio)
        };

        let position = Position {
            user,
            market_id,
            size,
            leverage,
            is_long,
            collateral: required_collateral,
            entry_price,
            liquidation_price,
            liquidated: false,
        };

        // Transfer collateral
        collateral_token.transfer(&user, &this, required_collateral)?;

        // Store position
        contract.positions.push_back(&env, &position);

        Ok(())
    }

    pub fn liquidate(
        env: Env,
        this: Address,
        position_id: u32,
        liquidator: Address,
    ) -> Result<Decimal, ContractError> {
        let contract = FuturesContract::from_storage(&env);
        let collateral_token = TokenClient::new(&env, &contract.collateral_token);

        // Check if position exists and is liquidatable
        if position_id >= contract.positions.len(&env) {
            return Err(ContractError::InvalidPositionId);
        }

        let position = contract.positions.get(&env, position_id).unwrap();
        if position.liquidated {
            return Err(ContractError::InvalidPositionId);
        }

        // Check liquidation condition
        let current_mark_price = contract.mark_price;
        let liquidation_threshold = if position.is_long {
            position.liquidation_price
        } else {
            position.liquidation_price
        };

        if (position.is_long && current_mark_price <= liquidation_threshold) ||
           (!position.is_long && current_mark_price >= liquidation_threshold) {
            return Err(ContractError::LiquidationThresholdNotMet);
        }

        // Liquidate position
        let recovered_collateral = position.collateral;
        let bounty = recovered_collateral * contract.liquidator_bounty_percentage;

        // Transfer recovered collateral to contract (cross-margin pool)
        collateral_token.transfer(&this, &this, recovered_collateral)?;

        // Transfer bounty to liquidator
        collateral_token.transfer(&this, &liquidator, bounty)?;

        // Mark position as liquidated
        let mut position = position.clone();
        position.liquidated = true;
        contract.positions.set(&env, position_id, &position);

        Ok(recovered_collateral)
    }

    pub fn update_mark_price(env: Env, this: Address, new_mark_price: Decimal) -> Result<(), ContractError> {
        let mut contract = FuturesContract::from_storage(&env);
        contract.mark_price = new_mark_price;
        env.storage().instance().set(&contract);
        Ok(())
    }
}
