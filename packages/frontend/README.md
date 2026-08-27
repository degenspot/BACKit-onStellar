# @backit/frontend

Next.js frontend for BACKit prediction market platform.

## Getting Started

```bash
pnpm install
pnpm dev
```

The development server will start on http://localhost:3000.

## Tech Stack

- Next.js (App Router)
- React
- TypeScript
- Tailwind CSS
- @stellar/stellar-sdk
- Freighter Wallet integration

## Available Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint
- `pnpm type-check` - Run TypeScript type checking
- `pnpm test` - Run the Vitest unit and component suite
- `pnpm test:e2e` - Run the Playwright end-to-end suite

## Backend data

Market detail, staking, portfolio and payout screens read from the NestJS API
via the typed clients in `src/lib/backend`. Set `NEXT_PUBLIC_BACKEND_URL` to
point at it. See [docs/market-portfolio-data.md](docs/market-portfolio-data.md)
for the endpoints used, the monetary-unit rules and how to seed local data.

## Wallet balances and stake limits

The staking screen reads live account data from Horizon through
`useWalletBalances` (`src/hooks/useWalletBalances.ts`), built on the pure
helpers in `src/lib/stellar`. Percentage presets and MAX are derived from the
spendable stake-asset balance — never from a constant — and MAX also respects
the contract's minimum/maximum stake and, when staking XLM, the account
reserve plus a fee buffer.

The stake asset is identified by **asset code _and_ issuer**, never by symbol
alone, so a same-ticker impostor asset is not counted as a balance:

| Variable                           | Default                                          | Purpose                                                                                                                  |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_STAKE_ASSET_CODE`     | `USDC`                                           | Asset code the pools are denominated in.                                                                                 |
| `NEXT_PUBLIC_STAKE_ASSET_ISSUER`   | Circle USDC on mainnet, SDF test USDC on testnet | Issuing account. Required for any credit asset; without it the screen reports a configuration error instead of guessing. |
| `NEXT_PUBLIC_USDC_SAC_CONTRACT_ID` | Per-network default                              | SAC wrapper used by the Soroban contracts.                                                                               |
| `NEXT_PUBLIC_MIN_STAKE`            | `0.1`                                            | Contract `min_stake`, as a decimal string.                                                                               |
| `NEXT_PUBLIC_MAX_STAKE_PER_USER`   | unset (unlimited)                                | Contract `max_stake_per_user`; `0` also means unlimited.                                                                 |
| `NEXT_PUBLIC_XLM_FEE_BUFFER`       | `0.1`                                            | XLM kept spendable so the stake transaction can pay its fee.                                                             |

Balances are read from `NEXT_PUBLIC_HORIZON_URL` for the configured network and
re-read after a wallet or network change and after a successful stake. Reads
are keyed by `network|address`, so concurrent consumers share one request.
