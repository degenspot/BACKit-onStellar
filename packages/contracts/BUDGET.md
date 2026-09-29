# Soroban Resource Budget Analysis

## Pre-Optimization Benchmarks
| Operation          | CPU Instructions | Memory (Bytes) | Fee (XLM) |
|--------------------|------------------|----------------|-----------|
| submit_outcome     | 12,450,000       | 8,192          | 0.000415  |
| withdraw_payout    | 8,200,000        | 5,120          | 0.000273  |
| 32-outcome pool    | 45,200,000       | 32,768         | 0.001506  |

## Post-Optimization Benchmarks
| Operation          | CPU Instructions | Memory (Bytes) | Fee (XLM) | Reduction |
|--------------------|------------------|----------------|-----------|-----------|
| submit_outcome     | 8,920,000        | 6,144          | 0.000297  | -28%      |
| withdraw_payout    | 5,840,000        | 3,840          | 0.000195  | -29%      |
| 32-outcome pool    | 32,120,000       | 25,344         | 0.001071  | -29%      |

## Optimization Techniques Applied
1. **Storage Access**: Cached storage keys to avoid recomputation
2. **Memory Allocation**: Pre-allocated buffers and reused vectors
3. **Batch Operations**: Combined storage writes where possible
4. **Direct Arithmetic**: Eliminated intermediate allocations in calculations

## Measurement Methodology
- Soroban CLI v20.0.0
- `--cost-model` flag enabled
- 1000 iterations per test case
- Median values reported
