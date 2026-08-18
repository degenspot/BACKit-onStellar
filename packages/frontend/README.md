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

## Wallet balances

Stake amounts are derived from the connected wallet's live Stellar balances. See
[docs/wallet-balances.md](docs/wallet-balances.md) for the stake-asset
configuration variables, the MAX calculation and the states the staking UI
distinguishes.
## Backend data

Market detail, staking, portfolio and payout screens read from the NestJS API
via the typed clients in `src/lib/backend`. Set `NEXT_PUBLIC_BACKEND_URL` to
point at it. See [docs/market-portfolio-data.md](docs/market-portfolio-data.md)
for the endpoints used, the monetary-unit rules and how to seed local data.
