#![no_std]

use soroban_sdk::{Bytes, Env};

// ─── Outcome constants ────────────────────────────────────────────────────────

/// Outcome value representing an UP result.
pub const OUTCOME_UP: u32 = 1;
/// Outcome value representing a DOWN result.
pub const OUTCOME_DOWN: u32 = 2;

// ─── Fee constants ────────────────────────────────────────────────────────────

/// Maximum allowed fee in basis points (100 % = 10 000 bps).
pub const MAX_FEE_BPS: u32 = 10_000;

// ─── Message format ───────────────────────────────────────────────────────────

/// Prefix used in the canonical oracle message.
pub const MESSAGE_PREFIX: &[u8] = b"BACKit:Outcome:";

/// Build the canonical message that oracles sign.
///
/// Format (all big-endian):
///   `b"BACKit:Outcome:"` | call_id(8B) | `b":"` | outcome(1B) | `b":"` | price(16B) | `b":"` | timestamp(8B)
pub fn build_message(env: &Env, call_id: u64, outcome: u32, price: i128, timestamp: u64) -> Bytes {
    let mut msg = Bytes::new(env);

    msg.append(&Bytes::from_slice(env, MESSAGE_PREFIX));
    msg.append(&Bytes::from_slice(env, &call_id.to_be_bytes()));
    msg.append(&Bytes::from_slice(env, b":"));

    let outcome_byte: &[u8] = if outcome == OUTCOME_UP { b"1" } else { b"2" };
    msg.append(&Bytes::from_slice(env, outcome_byte));
    msg.append(&Bytes::from_slice(env, b":"));

    msg.append(&Bytes::from_slice(env, &price.to_be_bytes()));
    msg.append(&Bytes::from_slice(env, b":"));
    msg.append(&Bytes::from_slice(env, &timestamp.to_be_bytes()));

    msg
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/// Returns `true` if `call_id` is a valid (non-zero) call identifier.
#[inline]
pub fn validate_call_id(call_id: u64) -> bool {
    call_id > 0
}

/// Returns `true` if `outcome` is a valid outcome value (UP or DOWN).
#[inline]
pub fn is_valid_outcome(outcome: u32) -> bool {
    outcome == OUTCOME_UP || outcome == OUTCOME_DOWN
}

/// Returns `true` if `fee_bps` does not exceed [`MAX_FEE_BPS`].
#[inline]
pub fn is_valid_fee_bps(fee_bps: u32) -> bool {
    fee_bps <= MAX_FEE_BPS
}
