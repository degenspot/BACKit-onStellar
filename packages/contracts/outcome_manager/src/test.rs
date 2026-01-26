use soroban_sdk::{Env, Bytes};

#[test]
fn test_ed25519_verification() {
    let env = Env::default();
    let (secret, public) = env.crypto().ed25519_keygen();

    let msg = Bytes::from_slice(&env, b"test-message");
    let sig = env.crypto().ed25519_sign(&secret, &msg);

    assert!(env.crypto().ed25519_verify(&public, &msg, &sig));
}
