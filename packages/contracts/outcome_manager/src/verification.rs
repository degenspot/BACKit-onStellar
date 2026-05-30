use soroban_sdk::{Bytes, BytesN, Env};

// Re-export build_message from the shared crate so existing call sites are unchanged.
pub use backit_shared::build_message;

/// Verify an ed25519 signature.
///
/// `env.crypto().ed25519_verify` panics on failure, which reverts the transaction.
pub fn verify_signature(
    env: &Env,
    public_key: &BytesN<32>,
    signature: &BytesN<64>,
    message: &Bytes,
) -> bool {
    env.crypto().ed25519_verify(public_key, message, signature);
    true
}
