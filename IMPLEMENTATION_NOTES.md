# Implementation: FE-019 … FE-022 (#596–#599)

## #596 Multi-wallet selector
- `WalletType`: freighter | lobstr | albedo | hana | rabet
- `detectWallets()` + `buildWalletConnectUri()` deep-link/QR fallback
- `WalletSelectorModal` lists all five, install links, Detected/Install badges, QR panel

## #597 Gas station banner
- `lib/gas-station-adapter.ts` — allowance + CPU/memory/stroops quote
- `GasFeeDisplay` shows “Sponsored by BackIt Gas Station (n/m Free…)” and fee breakdown + top-up link

## #599 Governance voting modal
- `governance-utils`, `useGovernance`, `GovernanceVotingModal` with quorum bar and For/Against/Abstain

## #598 Custom token import
- `token-registry` (validate, Horizon flags, localStorage)
- `CustomTokenImporter` classic + SAC modes with risk warnings

## Test
```bash
cd packages/frontend
pnpm test -- src/lib/gas-station-adapter.test.ts src/lib/governance-utils.test.ts src/lib/token-registry.test.ts src/hooks/useWallet.wallets.test.ts
```
