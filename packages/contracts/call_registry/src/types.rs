use soroban_sdk::{contracttype, Address, Bytes, BytesN, Map};

/// Describes the price-movement condition that determines the winning outcome.
///
/// All price values use 7 decimal places (e.g. `1_0000000` = 1.0).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ConditionType {
    /// Resolves UP when the end price is strictly greater than `target`.
    /// `target` is an absolute price with 7 decimals.
    TargetAbove(i128),
    /// Resolves UP when the end price is strictly less than `target`.
    /// `target` is an absolute price with 7 decimals.
    TargetBelow(i128),
    /// Resolves UP when the end price has risen by at least `percent`% from
    /// the start price. `percent` is a whole-number percentage (e.g. `5` = 5%).
    PercentUp(u32),
    /// Resolves UP when the end price has fallen by at least `percent`% from
    /// the start price. `percent` is a whole-number percentage (e.g. `5` = 5%).
    PercentDown(u32),
    /// Resolves UP when the end price falls within `[min, max]` inclusive.
    /// Both `min` and `max` are absolute prices with 7 decimals.
    Range(i128, i128),
}

/// Arguments for initializing a new Call
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CallInitArgs {
    pub stake_token: Address,
    pub stake_amount: i128,
    pub start_price: i128,
    pub end_ts: u64,
    pub token_address: Address,
    pub pair_id: Bytes,
    pub ipfs_cid: Bytes,
    pub metadata_hash: BytesN<32>,
    pub condition: ConditionType,
    pub outcome_count: u32,
}

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
    /// 32-byte hash of the IPFS CID or metadata (replaces full bytes to save storage)
    pub metadata_hash: BytesN<32>,
    /// Number of possible outcomes (default: 2 for backward compatibility)
    pub outcome_count: u32,
    /// Map of outcome indices to total stake amounts
    pub outcome_stakes: Map<u32, i128>,
    /// Map of outcome indices to staker addresses and their stake amounts
    pub stakes: Map<u32, Map<Address, i128>>,
    /// Resolved outcome: 0 = unresolved, 1..outcome_count = specific outcome
    pub outcome: u32,
    /// Price at call creation
    pub start_price: i128,
    /// Final price after resolution
    pub end_price: i128,
    /// On-chain condition used for outcome evaluation
    pub condition: ConditionType,
    /// Whether the call has been settled
    pub settled: bool,
    /// Whether the call has been voided by admin (triggers full refunds)
    pub voided: bool,
    /// Creation timestamp
    pub created_at: u64,
    /// Whether the call has been cancelled by its creator
    pub cancelled: bool,
    /// Version counter incremented on each `update_call_metadata` call.
    pub metadata_version: u32,
    /// Map of outcome indices to the deployed share token contract addresses
    pub share_tokens: Map<u32, Address>,
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
    /// Protocol fee in basis points (e.g. 100 = 1%). Default: 0.
    pub fee_bps: u32,
    /// Maximum stake any single user may place per call per position.
    /// `0` means unlimited.
    pub max_stake_per_user: i128,
    /// Set of SAC token addresses approved for use as stake tokens.
    pub whitelisted_tokens: Map<Address, bool>,
    /// Minimum stake required for `create_call` and `stake_on_call`.
    /// Denominated in the smallest unit of the stake token (stroops for XLM).
    pub min_stake: i128,
    /// Reserved version field for future metadata schema migrations.
    pub metadata_version: u32,
    /// When true, create/stake/resolve operations are blocked.
    pub paused: bool,
    /// Number of seconds before `end_ts` during which staking is no longer
    /// accepted. Default: 300 (5 minutes). Set to 0 to disable the buffer.
    pub staking_cutoff_secs: u64,
    /// Wasm hash for the share token contract (if enabled)
    pub share_wasm_hash: Option<BytesN<32>>,
}

/// Contract-wide aggregated statistics for dashboards.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GlobalStats {
    /// Total number of calls ever created (never decrements).
    pub total_calls: u64,
    /// Cumulative stake volume across all calls, in the token's smallest unit.
    pub total_stake_volume: i128,
    /// Number of unique staker addresses that have ever staked on any call.
    pub total_unique_stakers: u64,
}

/// Statistics for a call
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CallStats {
    /// Map of outcome indices to total stake amounts
    pub outcome_stakes: Map<u32, i128>,
    /// Map of outcome indices to stake counts
    pub outcome_stake_counts: Map<u32, u32>,
    /// Total number of stakes across all outcomes
    pub total_stakes: u32,
}

/// Creator reputation statistics tracked on-chain
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CreatorStats {
    /// Total number of calls this address has ever created.
    pub total_created: u32,
    /// Total number of calls created by this address that have been resolved.
    pub total_resolved: u32,
    /// Number of resolved calls where the creator staked on the winning outcome.
    pub total_correct: u32,
}

/// Instance storage is capped at 64 KB. Warn when entry count exceeds this.
pub const INSTANCE_ENTRY_WARNING_THRESHOLD: u32 = 500;

/// Storage utilisation snapshot returned by `get_storage_stats`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StorageStats {
    /// Total calls ever created (mirrors CallCounter).
    pub call_count: u64,
    /// Number of entries currently tracked in instance storage.
    pub instance_entry_count: u32,
    /// Rough byte estimate for instance storage (entry_count × 128 bytes).
    pub estimated_instance_bytes: u32,
}
