use soroban_sdk::{Bytes, BytesN, Env};

/// Canonical prefix for all SEP-10 challenge messages built by this contract.
pub const SEP10_MESSAGE_PREFIX: &[u8] = b"BACKit:SEP10:";

/// Build the canonical SEP-10 challenge message that a wallet must sign.
///
/// Format (all big-endian):
///   `b"BACKit:SEP10:"` | valid_until(8B) | `b":"` | home_domain
///
/// Mirrors the pattern used by `backit_shared::build_message` for oracle sigs.
pub fn build_sep10_message(env: &Env, valid_until: u32, home_domain: &Bytes) -> Bytes {
    let mut msg = Bytes::new(env);
    msg.append(&Bytes::from_slice(env, SEP10_MESSAGE_PREFIX));
    msg.append(&Bytes::from_slice(env, &valid_until.to_be_bytes()));
    msg.append(&Bytes::from_slice(env, b":"));
    msg.append(home_domain);
    msg
}

/// Verify a SEP-10 ed25519 token against a public key.
///
/// Returns `false` if the token has expired (current ledger sequence > `valid_until`).
/// Panics if the signature is cryptographically invalid — consistent with Soroban
/// auth patterns where `ed25519_verify` aborts the transaction on failure.
///
/// # Arguments
/// * `public_key`   – 32-byte ed25519 public key (the user's Stellar account key).
/// * `token`        – 64-byte ed25519 signature over the SEP-10 challenge message.
/// * `valid_until`  – Ledger sequence number after which the token is expired.
/// * `home_domain`  – Optional domain bytes included in the signed message.
pub fn verify_sep10_token_impl(
    env: &Env,
    public_key: &BytesN<32>,
    token: &BytesN<64>,
    valid_until: u32,
    home_domain: &Bytes,
) -> bool {
    if env.ledger().sequence() > valid_until {
        return false;
    }
    let message = build_sep10_message(env, valid_until, home_domain);
    env.crypto().ed25519_verify(public_key, &message, token);
    true
}
