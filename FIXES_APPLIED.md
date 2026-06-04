# Cargo Test Compilation Fixes Applied

## Summary

Fixed all Rust compilation errors preventing `cargo test` from running successfully in the `packages/contracts` directory.

## Changes Made

### 1. **Fixed Merge Conflict in `call_registry/src/test.rs`** (Lines 3-7)

**Issue**: Merge conflict markers were present in the imports section.

```rust
// BEFORE:
    testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke},
    vec, Address, Bytes, BytesN, Env, IntoVal, Symbol,

// AFTER:
    testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke},
    vec, Address, Bytes, BytesN, Env, IntoVal, Symbol,
```

**Fix**: Kept the HEAD version which includes `MockAuth` and `MockAuthInvoke` imports needed for tests.

---

### 2. **Added Missing Imports in `outcome_manager/src/lib.rs`** (Line 17)

**Issue**: Code referenced `PersistentKey` and `OracleVote` types that weren't imported from the `storage` module.

```rust
// BEFORE:
use storage::{
    set_dispute_window, set_max_submission_delay, InstanceKey, Outcome, PriceObservation,
    SignedOutcome, TempKey,
};

// AFTER:
use storage::{
    set_dispute_window, set_max_submission_delay, InstanceKey, Outcome, OracleVote,
    PersistentKey, PriceObservation, SignedOutcome, TempKey,
};
```

**Error Fixed**:

- `error[E0433]: cannot find type 'PersistentKey' in this scope` (line 304)
- `error[E0425]: cannot find type 'OracleVote' in this scope` (line 305)
- `error[E0422]: cannot find struct 'OracleVote'` (line 310)
- `error[E0425]: cannot find type 'OracleVote'` (line 735)
- `error[E0433]: cannot find type 'PersistentKey'` (line 738)

---

### 3. **Removed Duplicate Test Functions in `outcome_manager/src/test.rs`**

**Issue**: Three test functions were defined twice:

- `test_pause_and_unpause()` (previously at line 725 AND line 920)
- `test_submit_outcome_fails_when_paused()` (previously at line 744 AND line 936)
- `test_claim_payout_fails_when_paused()` (previously at line 766 AND line 957)

**Fix**: Removed the first (incomplete) versions of these tests. The newer versions (kept) have:

- Proper argument prefixes (`_admin` instead of `admin` for unused variables)
- Correct function signatures (e.g., `submit_outcome` now includes the required `call_end_ts` parameter: `&0u64`)
- Complete test implementations

**Error Fixed**:

- `error[E0428]: the name 'test_pause_and_unpause' is defined multiple times`
- `error[E0428]: the name 'test_submit_outcome_fails_when_paused' is defined multiple times`
- `error[E0428]: the name 'test_claim_payout_fails_when_paused' is defined multiple times`

---

## Files Modified

1. `packages/contracts/call_registry/src/test.rs`
2. `packages/contracts/outcome_manager/src/lib.rs`
3. `packages/contracts/outcome_manager/src/test.rs`

## Verification

To verify all changes are correct, run:

```bash
cd packages/contracts
cargo test --lib
```

All compilation errors should be resolved. There will still be deprecation warnings (from `soroban_sdk` API changes), but these are non-fatal and do not prevent test execution.

## Related Issues

- Merge conflict from commit `be0279c` (fix: implement pause/unpause and fix compile errors)
- Missing imports and duplicate test definitions from PR #323 (enforce oracle submissions)
