use soroban_sdk::{Env, Bytes, BytesN};

pub fn build_message(
    env: &Env,
    call_id: u64,
    outcome: u32,
    price: i128,
    timestamp: u64,
) -> Bytes {
    let mut msg = Bytes::new(env);

    msg.append(&Bytes::from_slice(env, b"BACKit:Outcome:"));
    msg.append(&Bytes::from_slice(env, &call_id.to_be_bytes()));
    msg.append(&Bytes::from_slice(env, b":"));

    let outcome_byte = if outcome == 0 { b"0" } else { b"1" };
    msg.append(&Bytes::from_slice(env, outcome_byte));
    msg.append(&Bytes::from_slice(env, b":"));

    msg.append(&Bytes::from_slice(env, &price.to_be_bytes()));
    msg.append(&Bytes::from_slice(env, b":"));

    msg.append(&Bytes::from_slice(env, &timestamp.to_be_bytes()));

    msg
}

pub fn verify_signature(
    env: &Env,
    public_key: &BytesN<32>,
    signature: &BytesN<64>,
    message: &Bytes,
) -> bool {
    env.crypto().ed25519_verify(public_key, message, signature);
    true
}
