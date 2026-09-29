//! Treasury module with multi-bucket dynamic fee split

use soroban_sdk::{contract, contractimpl, symbol, vec, Address, Env, Symbol, Vec};
use crate::storage::{get_split_ratios, set_split_ratios, get_admin, SAC_BURN_INTERFACE};

pub const PROTOCOL_TREASURY: Symbol = symbol!("protocol_treasury");
pub const CREATOR_INCENTIVES: Symbol = symbol!("creator_incentives");
pub const TOKEN_BUYBACK: Symbol = symbol!("token_buyback");
pub const SAC_BURN: Symbol = symbol!("sac_burn");

/// Fee split ratios (basis points, sum must equal 10000)
#[derive(Clone, Debug)]
pub struct FeeSplit {
    pub protocol_treasury: u32,
    pub creator_incentives: u32,
    pub token_buyback: u32,
    pub sac_burn: u32,
}

impl FeeSplit {
    pub fn validate(&self) -> bool {
        self.protocol_treasury + self.creator_incentives + self.token_buyback + self.sac_burn == 10000
    }
}

pub fn distribute_fees(e: &Env, amount: u128) -> Result<(), Error> {
    let ratios = get_split_ratios(e)?;
    if !ratios.validate() {
        return Err(Error::InvalidSplitRatios);
    }

    // Calculate amounts for each bucket
    let protocol_amount = (amount as u128 * ratios.protocol_treasury as u128) / 10000;
    let creator_amount = (amount as u128 * ratios.creator_incentives as u128) / 10000;
    let buyback_amount = (amount as u128 * ratios.token_buyback as u128) / 10000;
    let burn_amount = (amount as u128 * ratios.sac_burn as u128) / 10000;

    // Transfer to respective buckets (implementation depends on token contract)
    // This is a placeholder for actual transfer logic
    e.events().publish(
        (PROTOCOL_TREASURY, symbol!("deposit")),
        (protocol_amount, get_admin(e)?),
    );

    e.events().publish(
        (CREATOR_INCENTIVES, symbol!("deposit")),
        (creator_amount, get_admin(e)?),
    );

    e.events().publish(
        (TOKEN_BUYBACK, symbol!("deposit")),
        (buyback_amount, get_admin(e)?),
    );

    // SAC burn
    if burn_amount > 0 {
        SAC_BURN_INTERFACE.burn(e, &get_admin(e)?, &burn_amount)?;
    }

    Ok(())
}

pub fn update_split_ratios(e: &Env, caller: Address, new_ratios: FeeSplit) -> Result<(), Error> {
    if caller != get_admin(e)? {
        return Err(Error::Unauthorized);
    }
    if !new_ratios.validate() {
        return Err(Error::InvalidSplitRatios);
    }
    set_split_ratios(e, &new_ratios);
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Invalid split ratios: sum must be 10000")]
    InvalidSplitRatios,
    #[error("Unauthorized")]
    Unauthorized,
    #[error("SAC burn failed")]
    SacBurnFailed,
}
