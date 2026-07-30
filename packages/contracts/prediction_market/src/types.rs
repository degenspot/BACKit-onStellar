use soroban_sdk::{contracttype, Address, Bytes, BytesN, Map};

/// Describes the price-movement condition that determines the winning outcome.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ConditionType {
    TargetAbove(i128),
    TargetBelow(i128),
    PercentUp(u32),
    PercentDown(u32),
    Range(i128, i128),
}

/// Arguments supplied when the factory deploys a new market instance.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MarketInitArgs {
    pub stake_token: Address,
    pub stake_amount: i128,
    pub start_price: i128,
    pub end_ts: u64,
    pub token_address: Address,
    pub pair_id: Bytes,
    pub metadata_hash: BytesN<32>,
    pub condition: ConditionType,
    pub outcome_count: u32,
}

/// Mirrors `call_registry::Call` so `outcome_manager` can deserialize cross-contract.
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

/// Per-market configuration set at deploy time.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MarketConfig {
    pub call_id: u64,
    pub creator: Address,
    pub outcome_manager: Address,
    pub factory: Address,
    pub min_stake: i128,
    pub max_stake_per_user: i128,
    pub staking_cutoff_secs: u64,
    pub paused: bool,
    pub early_staker_bonus_window_secs: u64,
    pub early_staker_bonus_bps: u32,
    /// #465: bps (of the escrowed amount) paid to whoever calls
    /// `refund_expired_order` on an expired limit order, as a small
    /// incentive for permissionless cleanup. Not currently exposed via the
    /// constructor (there is no post-deploy config-mutation path anywhere
    /// else in this contract either), so it is set from
    /// `DEFAULT_EXPIRED_ORDER_REFUND_BPS` at construction time.
    pub expired_order_refund_bps: u32,
}

/// #465: A non-custodial limit order for staking on a prediction market
/// position. See `PredictionMarket::create_limit_order` for the exact
/// implied-probability fill semantics.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct LimitOrder {
    pub id: u64,
    pub user: Address,
    pub call_id: u64,
    pub outcome: u32,
    pub amount: i128,
    pub target_probability_bps: u32,
    pub created_at: u64,
    pub expires_at: u64,
}

/// Verification result for proof-of-reserve checks.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReserveVerification {
    pub balance_on_chain: i128,
    pub total_staked: i128,
    pub total_escrowed: i128,
    pub is_fully_reserved: bool,
    pub discrepancy: i128,
}

/// Record of an individual stake for early-bonus tracking.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StakeRecord {
    pub staker: Address,
    pub amount: i128,
    pub position: u32,
    pub stake_timestamp: u64,
    pub has_withdrawn: bool,
}
