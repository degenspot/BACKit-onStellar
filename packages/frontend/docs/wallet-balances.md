# Wallet balances and safe maximum stake

The staking UI reads the connected wallet's real balances from Horizon instead
of assuming a fixed amount. Everything the user can select — the 25/50/75%
presets, MAX, and whether the stake button is enabled — is derived from that
balance, the account reserve and the contract stake limits.

## Pieces

| File                                     | Responsibility                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/lib/stellar/amounts.ts`             | 7-decimal stroop conversion (`bigint`), input clamping, display formatting           |
| `src/lib/stellar/network.ts`             | Network + stake-asset resolution and issuer-aware balance matching                   |
| `src/lib/stellar/stakeLimits.ts`         | Reserve, spendable balance, MAX calculation and the single stake-validation rule set |
| `src/hooks/useWalletBalances.ts`         | Loads the Horizon account for the active address/network                             |
| `src/components/WalletBalanceNotice.tsx` | Renders exactly one blocking state at a time                                         |

## Asset identification

The stake asset is matched on **issuer and asset code** (or `asset_type: native`
for XLM), never on the code alone — any account can issue an asset called
`USDC`, and matching on the symbol would let a worthless look-alike balance
drive the stake amount. The SAC contract id is carried alongside for contract
calls. A non-native asset configured without an issuer is treated as a
deployment misconfiguration and staking stays disabled.

## MAX calculation

```
reserve       = (2 + subentries + sponsoring - sponsored) * 0.5 XLM
spendableXlm  = max(nativeBalance - reserve, 0)
available     = stakeAssetIsNative ? max(spendableXlm - feeBuffer, 0)
                                   : stakeAssetBalance
max           = min(available, contractMaxStake)   // when a max is configured
max           = max >= contractMinStake ? max : 0  // an unsubmittable MAX is 0
```

`feeBuffer` defaults to 1 XLM (`NEXT_PUBLIC_XLM_FEE_BUFFER`), because Soroban
invocations cost far more than the classic 100-stroop base fee. When the
spendable XLM cannot cover the buffer, MAX is zero and the UI explains why.

All arithmetic is `bigint` stroop math, so MAX is exactly submittable: the
preview never rounds to a value the contract would reject.

## States the UI distinguishes

Disconnected wallet, account not funded, missing trustline, stale balance,
Horizon outage, zero balance, insufficient XLM for fees, market closed, amount
below the contract minimum, amount above the contract maximum, and amount above
the spendable balance. Each has its own message; `validateStake` is the single
source of truth for the disabled state of the submit button.

## Refreshing

Balances reload when the connected address or the wallet's network changes, and
after a successful stake. Concurrent loads for the same address/network/asset
key are de-duplicated, so a re-render or a double refresh issues one request.
A load failure keeps the last good snapshot and flags it as stale rather than
showing zero for a funded wallet.

## Configuration

| Variable                                                       | Default            | Purpose                                          |
| -------------------------------------------------------------- | ------------------ | ------------------------------------------------ |
| `NEXT_PUBLIC_STELLAR_NETWORK`                                  | `TESTNET`          | Network used when the wallet does not report one |
| `NEXT_PUBLIC_HORIZON_URL` (`_PUBLIC` / `_TESTNET`)             | SDF Horizon        | Horizon endpoint                                 |
| `NEXT_PUBLIC_STAKE_ASSET_CODE` (`_PUBLIC` / `_TESTNET`)        | `USDC`             | Stake asset code                                 |
| `NEXT_PUBLIC_STAKE_ASSET_ISSUER` (`_PUBLIC` / `_TESTNET`)      | Circle USDC issuer | Stake asset issuer                               |
| `NEXT_PUBLIC_STAKE_ASSET_CONTRACT_ID` (`_PUBLIC` / `_TESTNET`) | unset              | SAC id for contract calls                        |
| `NEXT_PUBLIC_MIN_STAKE`                                        | `0`                | Contract `min_stake`, decimal string             |
| `NEXT_PUBLIC_MAX_STAKE_PER_USER`                               | unset              | Contract `max_stake_per_user`, decimal string    |
| `NEXT_PUBLIC_XLM_FEE_BUFFER`                                   | `1`                | XLM held back for fees                           |

`StakingInterface` also accepts `stakeAsset` and `stakeLimits` props so a market
can pin its own asset or limits without touching the environment.

## Testing locally

```bash
pnpm --filter @backit/frontend test
```

Unit tests cover decimal conversion, reserve/spendable maths and the MAX
calculation; component tests stub Horizon and assert each disabled/error state.
To exercise it manually, connect a Freighter testnet account, fund it at
https://friendbot.stellar.org, and add a testnet USDC trustline. Removing the
trustline, draining XLM below the reserve, or leaving the account unfunded
each reproduces one of the states above.

## Known limitation

The contract's per-user cap is reputation-weighted
(`reputation::effective_stake_limit` in `call_registry`), which the frontend
cannot compute. MAX uses the configured absolute `max_stake_per_user` and
`min_stake`, so a reputation-limited wallet can still have a stake rejected
on-chain; the failure is surfaced inline. Reading the live contract config is
backend/contract work and out of scope here.
