# Contract Budget Reference

This workspace now enforces Soroban budget ceilings in tests and CI for the
highest-risk execution paths in `call_registry` and `outcome_manager`.

## Important Limitation

`packages/contracts` currently depends on `soroban-sdk 23.x`.

In this SDK line, `env.cost_estimate()` and `budget()` live behind
`testutils`, which means they are available in unit tests but are not
available inside production Wasm builds. Because of that:

- Production contracts cannot call `env.budget().reset(...)` directly.
- Production contracts cannot emit real `BudgetConsumed` telemetry events with
  live CPU or memory counters.
- Budget protection is enforced through optimized code paths plus CI tests that
  run each hot function under explicit Soroban limits.

## Enforced Targets

The following ceilings are enforced by the new `stays_within_budget` tests.
These numbers are intentionally conservative to leave headroom for routine
state growth while still catching regressions.

| Contract | Function | Scenario | CPU Limit | Memory Limit |
| --- | --- | --- | ---: | ---: |
| `call_registry` | `stake_on_call` | single stake on an active two-outcome call | 6,000,000 | 80,000 bytes |
| `call_registry` | `get_calls_paginated` | first page of 10 existing calls | 2,500,000 | 25,000 bytes |
| `call_registry` | `get_call_stakers` | capped read of 50 unique stakers | 2,500,000 | 25,000 bytes |
| `outcome_manager` | `claim_payout` | single winner claim with 5% fee | 3,500,000 | 45,000 bytes |
| `outcome_manager` | `batch_claim_payouts` | 20 winners in one batch with 5% fee | 20,000,000 | 180,000 bytes |

## Regression Coverage

The workspace now includes two explicit categories of budget tests:

- `stays_within_budget`: verifies the hot function completes within its
  assigned CPU and memory ceiling.
- `exceeding_budget_fails`: verifies Soroban rejects the invocation when the
  configured limit is intentionally too low.

CI runs both categories in `.github/workflows/contracts.yml`.

## Optimization Notes

The budget work also includes code-path optimizations:

- `call_registry::stake_on_call`
  - Removes redundant config and user-stake reads.
  - Uses membership keys to avoid O(n) duplicate scans in
    `add_call_staker` and `add_staker_call`.
- `call_registry::get_call_stakers`
  - Caps the default response to 50 addresses.
  - Adds `get_call_stakers_paginated` for bounded follow-up reads.
- `call_registry::get_calls_paginated`
  - Iterates over a bounded id range without extra loop bookkeeping.
- `outcome_manager::claim_payout`
  - Hoists fee math into shared helpers.
- `outcome_manager::batch_claim_payouts`
  - Reuses shared payout math.
  - Aggregates fee transfer into a single escrow release instead of one call
    per winner.

## Refreshing The Table

When the Soroban SDK or contract logic changes:

1. Run `cargo test stays_within_budget -- --nocapture` in
   `packages/contracts`.
2. Update the limits in the test files if the new measurements are justified.
3. Update this table to match the enforced ceilings and scenarios.
