use soroban_sdk::{contracttype, Address, Bytes, Map};

/// Represents a prediction call with all its metadata
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    /// Unique identifier for the call
    pub id: u64,
    /// Address of the creator who initiated the call
    pub creator: Address,
    /// Token address used for staking
    pub stake_token: Address,
    /// Amount of stake required to participate
    pub stake_amount: i128,
    /// Timestamp when the call ends
    pub end_ts: u64,
    /// Token pair being predicted (e.g., USDC/XLM)
    pub token_address: Address,
    /// DexScreener pair ID for price data
    pub pair_id: Bytes,
    /// IPFS content hash for call metadata
    pub ipfs_cid: Bytes,
    /// Current total stake on UP position
    pub total_up_stake: i128,
    /// Current total stake on DOWN position
    pub total_down_stake: i128,
    /// Map of staker addresses to their stake amounts for UP position
    pub up_stakes: Map<Address, i128>,
    /// Map of staker addresses to their stake amounts for DOWN position
    pub down_stakes: Map<Address, i128>,
    /// Resolved outcome: 0 = unresolved, 1 = UP, 2 = DOWN
    pub outcome: u32,
    /// Price at call creation
    pub start_price: i128,
    /// Final price after resolution
    pub end_price: i128,
    /// Whether the call has been settled
    pub settled: bool,
    /// Creation timestamp
    pub created_at: u64,
}

/// Enum representing stake positions on a call
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum StakePosition {
    Up = 1,
    Down = 2,
}

impl StakePosition {
    /// Convert u32 to StakePosition
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            1 => Some(StakePosition::Up),
            2 => Some(StakePosition::Down),
            _ => None,
        }
    }

    /// Convert StakePosition to u32
    pub fn to_u32(&self) -> u32 {
        match self {
            StakePosition::Up => 1,
            StakePosition::Down => 2,
        }
    }
}

/// Configuration for the contract
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractConfig {
    /// Admin address with privileged operations
    pub admin: Address,
    /// Address that can submit call outcomes
    pub outcome_manager: Address,
}

/// Statistics for a call
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CallStats {
    pub total_up_stake: i128,
    pub total_down_stake: i128,
    pub total_stakes: u32,
    pub up_stake_count: u32,
    pub down_stake_count: u32,
}
