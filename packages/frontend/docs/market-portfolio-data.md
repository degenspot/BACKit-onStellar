# Market and portfolio data

The market-detail and portfolio journeys read from the NestJS backend through
the typed clients in [`src/lib/backend`](../src/lib/backend). Nothing in these
journeys reads from in-memory mock records any more, so a restarted dev server
shows exactly what the database and the indexer hold.

## Backend endpoints used

| Journey          | Request                                               | Client              |
| ---------------- | ----------------------------------------------------- | ------------------- |
| Market detail    | `GET /calls/:id`                                      | `fetchMarket`       |
| Market activity  | `GET /calls/:id/stakes?limit=50`                      | `fetchMarketStakes` |
| Current odds     | derived from the market's persisted pool totals       | `deriveOdds`        |
| Portfolio stakes | `GET /users/:address/stakes?page&limit`               | `fetchPortfolio`    |
| Claim state      | `GET /users/:address/payouts`                         | `fetchPortfolio`    |
| Stake submission | `POST /calls/:id/stake/prepare` then `POST /relay/tx` | `submitStake`       |
| Payout claim     | `POST /calls/:id/claim/prepare` then `POST /relay/tx` | `claimPayout`       |

Odds are never fetched: a parimutuel market pays the whole pool to the winning
side, so a side's multiplier is `totalPool / sidePool`, computed from the
persisted `totalYesStake` / `totalNoStake` values. The same pool always yields
the same numbers.

## Monetary units

Amounts cross the wire as decimal strings (or JSON numbers on the endpoints
that still serialise them that way) and are converted immediately into integer
stroops (`bigint`, 7 decimals) by `src/lib/backend/amounts.ts`. No stake,
payout or pool total is ever held in a JavaScript float. Use `formatAmount` for
display and never feed a formatted string back into stake math.

## Running against a local backend

1. Start Postgres and Redis:

   ```bash
   docker compose up -d postgres redis
   ```

2. Start the API (defaults to `http://localhost:3000`):

   ```bash
   pnpm --filter @backit/backend start:dev
   ```

3. Point the frontend at it and run it on another port:

   ```bash
   # packages/frontend/.env.local
   NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
   ```

   ```bash
   pnpm --filter @backit/frontend dev -- --port 3001
   ```

## Seeding data to exercise the flow

The screens need at least one call, a few stakes and a payout claim. With the
backend running, insert them into its database (`psql $DATABASE_URL` or any SQL
client). Replace `G...` with the wallet you connect in the browser.

```sql
-- An open market with a two-sided pool
INSERT INTO calls (id, "creatorAddress", title, description, outcome,
                   "expiresAt", "createdAt", "updatedAt",
                   "totalYesStake", "totalNoStake", "stakeToken", status)
VALUES ('11111111-1111-4111-8111-111111111111', 'GCREATOR...', 'ETH > $3000 by Dec 31',
        'Thesis markdown goes here', 'PENDING', now() + interval '7 days',
        now(), now(), 15000, 8500, 'USDC', 'OPEN');

-- An active position for the connected wallet
INSERT INTO stakes (id, "callId", "userAddress", amount, position,
                    "createdAt", "updatedAt", "transactionHash")
VALUES (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'GYOURWALLET...',
        100, 'YES', now(), now(), 'tx-active-1');

-- A resolved market the wallet won (shows up as claimable)
INSERT INTO calls (id, "creatorAddress", title, description, outcome, "resolvedAt",
                   "expiresAt", "createdAt", "updatedAt",
                   "totalYesStake", "totalNoStake", "stakeToken", status)
VALUES ('22222222-2222-4222-8222-222222222222', 'GCREATOR...', 'BTC > $50k',
        'Resolved market', 'YES', now() - interval '1 day', now() - interval '1 day',
        now() - interval '5 days', now(), 1000, 1000, 'USDC', 'RESOLVED_YES');

INSERT INTO stakes (id, "callId", "userAddress", amount, position,
                    "createdAt", "updatedAt", "transactionHash", "profitLoss")
VALUES (gen_random_uuid(), '22222222-2222-4222-8222-222222222222', 'GYOURWALLET...',
        100, 'YES', now() - interval '4 days', now(), 'tx-won-1', 100);

-- Mark the payout as already claimed to see the "claimed" state
INSERT INTO payout_claims (id, "callId", "stakerAddress", amount, "txHash",
                           "claimedAt", status, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), '22222222-2222-4222-8222-222222222222', 'GYOURWALLET...',
        200, 'claim-tx-1', now(), 'CLAIMED', now(), now());
```

Delete the `payout_claims` row to flip the same position back to claimable.

## Tests

`pnpm --filter @backit/frontend test` runs the Vitest suite. The client tests
and the component tests stub `fetch`, so they exercise the same HTTP contract
without a running backend:

- `src/lib/backend/amounts.test.ts` — stroop conversion and formatting
- `src/lib/backend/markets.test.ts` — market loading, odds, activity
- `src/lib/backend/portfolio.test.ts` — stake/payout merge and claim states
- `src/components/PortfolioDashboard.test.tsx` — empty, active, claimable,
  claimed, transaction-failure and backend-outage states
- `src/app/calls/[id]/CallDetailClient.test.tsx` — loading, loaded, not found,
  backend unavailable

## Known API contract gaps

These are backend changes (out of scope for this work) that the clients already
expect:

- `GET /calls/:id` is not exposed by `CallsController`, although
  `CallsRepository.findVisibleById` exists.
- `GET /calls/:id/stakes` (recent stakes for a market) does not exist.
- `POST /calls/:id/stake/prepare` and `POST /calls/:id/claim/prepare` do not
  exist; only the generic relay submission (`POST /relay/tx`) does.
- The market detail payload has no `thesis`, `pairId`, `condition`,
  `conditionJson`, `currentPrice`, `startPrice` or `targetPrice` fields, so the
  header, chart and thesis sections render their empty states.
- `GET /users/:address/stakes` returns amounts as JSON numbers; decimal strings
  would remove the float round-trip the client currently has to absorb.
