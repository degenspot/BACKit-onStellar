use soroban_sdk::{token::StellarAssetClient, Address, Bytes, BytesN, Env};

/// Derives a deterministic 32-byte salt for a (call_id, outcome) pair.
pub fn share_token_salt(env: &Env, call_id: u64, outcome: u32) -> BytesN<32> {
    let mut raw = Bytes::from_slice(env, b"share:");
    raw.append(&Bytes::from_slice(env, &call_id.to_be_bytes()));
    raw.append(&Bytes::from_slice(env, &outcome.to_be_bytes()));
    env.crypto().sha256(&raw).into()
}

/// Deploy a SAC token for (call_id, outcome) using the contract's own address
/// as the admin, returning the new token's Address.
pub fn deploy_share_token(
    env: &Env,
    share_wasm_hash: &BytesN<32>,
    call_id: u64,
    outcome: u32,
) -> Address {
    let salt = share_token_salt(env, call_id, outcome);
    env.deployer()
        .with_current_contract(salt)
        .deploy_v2(share_wasm_hash.clone(), ())
}

/// Mint `amount` share tokens to `to`.
pub fn mint_shares(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

/// Burn `amount` share tokens from `from`.
/// The contract must be the token admin.
pub fn burn_shares(env: &Env, token: &Address, from: &Address, amount: i128) {
    StellarAssetClient::new(env, token).clawback(from, &amount);
}

/// Return the balance of share tokens held by `who`.
pub fn share_balance(env: &Env, token: &Address, who: &Address) -> i128 {
    soroban_sdk::token::Client::new(env, token).balance(who)
}
