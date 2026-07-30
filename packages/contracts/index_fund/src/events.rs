use soroban_sdk::{Address, Env};

pub fn emit_index_deposit(env: &Env, user: &Address, usdc_amount: i128, index_tokens: i128) {
    env.events().publish(
        ("index_fund", "deposit"),
        (user.clone(), usdc_amount, index_tokens),
    );
}

pub fn emit_index_withdraw(env: &Env, user: &Address, index_amount: i128, usdc_out: i128) {
    env.events().publish(
        ("index_fund", "withdraw"),
        (user.clone(), index_amount, usdc_out),
    );
}

pub fn emit_index_rebalanced(env: &Env, keeper: &Address, markets_staked: u32, markets_claimed: u32) {
    env.events().publish(
        ("index_fund", "rebalanced"),
        (keeper.clone(), markets_staked, markets_claimed),
    );
}

pub fn emit_payout_claimed(env: &Env, call_id: u64, amount: i128) {
    env.events().publish(
        ("index_fund", "payout_claimed"),
        (call_id, amount),
    );
}
