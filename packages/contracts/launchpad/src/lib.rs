#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchpadMarket {
    pub call_id: u64,
    pub creator: Address,
    pub incentive_pool: i128,
    pub total_staked: i128,
    pub created_at: u64,
}

#[contract]
pub struct LaunchpadContract;

#[contractimpl]
impl LaunchpadContract {
    pub fn launch_market_with_incentives(
        env: Env,
        creator: Address,
        call_id: u64,
        incentive_pool: i128,
        _incentive_vesting_secs: u64,
    ) -> LaunchpadMarket {
        creator.require_auth();
        let market = LaunchpadMarket {
            call_id,
            creator,
            incentive_pool,
            total_staked: 0,
            created_at: env.ledger().timestamp(),
        };
        env.storage().instance().set(&call_id, &market);
        market
    }

    pub fn get_launchpad_market(env: Env, call_id: u64) -> Option<LaunchpadMarket> {
        env.storage().instance().get(&call_id)
    }

    pub fn get_incentive_estimate(env: Env, call_id: u64, stake_amount: i128) -> i128 {
        if let Some(market) = Self::get_launchpad_market(env, call_id) {
            let total = market.total_staked + stake_amount;
            if total > 0 {
                return (market.incentive_pool * stake_amount) / total;
            }
        }
        0
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Env, testutils::Address as _};

    #[test]
    fn test_launchpad_estimate() {
        let env = Env::default();
        let contract_id = env.register(LaunchpadContract, ());
        let client = LaunchpadContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        env.mock_all_auths();

        let market = client.launch_market_with_incentives(&user, &100, &1000, &3600);
        assert_eq!(market.call_id, 100);

        let estimate = client.get_incentive_estimate(&100, &500);
        assert_eq!(estimate, 1000);
    }
}
