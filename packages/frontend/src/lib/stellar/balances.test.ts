import { describe, expect, it } from "vitest";
import { toStroops } from "../backend/amounts";
import {
  BASE_RESERVE_STROOPS,
  DEFAULT_FEE_BUFFER_STROOPS,
  STALE_AFTER_MS,
  balanceLineMatchesAsset,
  computeReservedNativeStroops,
  deriveBalanceSnapshot,
  isSnapshotStale,
} from "./balances";
import type { HorizonAccount, HorizonBalanceLine } from "./horizon";
import {
  nativeStakeAsset,
  parseStakeAsset,
  type StakeAsset,
} from "./stakeAsset";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const IMPOSTOR = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ADDRESS = "GCSTAKER47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLL";

const usdcResult = parseStakeAsset({}, "TESTNET");
if (usdcResult.status !== "ok") throw new Error("test asset failed to resolve");
const USDC: StakeAsset = usdcResult.asset;

function nativeLine(
  overrides: Partial<HorizonBalanceLine> = {},
): HorizonBalanceLine {
  return {
    asset_type: "native",
    balance: "100.0000000",
    buying_liabilities: "0.0000000",
    selling_liabilities: "0.0000000",
    ...overrides,
  };
}

function usdcLine(
  overrides: Partial<HorizonBalanceLine> = {},
): HorizonBalanceLine {
  return {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER,
    balance: "250.5000000",
    buying_liabilities: "0.0000000",
    selling_liabilities: "0.0000000",
    limit: "922337203685.4775807",
    ...overrides,
  };
}

function account(overrides: Partial<HorizonAccount> = {}): HorizonAccount {
  return {
    id: ADDRESS,
    sequence: "1",
    subentry_count: 1,
    balances: [nativeLine(), usdcLine()],
    ...overrides,
  };
}

function snapshotOf(
  acc: HorizonAccount,
  asset: StakeAsset = USDC,
  fetchedAt = 1_000,
) {
  return deriveBalanceSnapshot({
    account: acc,
    asset,
    address: ADDRESS,
    fetchedAt,
  });
}

describe("balanceLineMatchesAsset", () => {
  it("requires both the code and the issuer to match", () => {
    expect(balanceLineMatchesAsset(usdcLine(), USDC)).toBe(true);
    expect(
      balanceLineMatchesAsset(usdcLine({ asset_issuer: IMPOSTOR }), USDC),
    ).toBe(false);
    expect(
      balanceLineMatchesAsset(usdcLine({ asset_code: "USDT" }), USDC),
    ).toBe(false);
  });

  it("never confuses the native asset with a credit asset", () => {
    expect(balanceLineMatchesAsset(nativeLine(), USDC)).toBe(false);
    expect(balanceLineMatchesAsset(usdcLine(), nativeStakeAsset())).toBe(false);
    expect(balanceLineMatchesAsset(nativeLine(), nativeStakeAsset())).toBe(
      true,
    );
  });
});

describe("computeReservedNativeStroops", () => {
  it("reserves two base entries plus every subentry", () => {
    expect(computeReservedNativeStroops(account({ subentry_count: 0 }))).toBe(
      2n * BASE_RESERVE_STROOPS,
    );
    expect(computeReservedNativeStroops(account({ subentry_count: 3 }))).toBe(
      5n * BASE_RESERVE_STROOPS,
    );
  });

  it("accounts for sponsored and sponsoring entries", () => {
    const sponsored = account({
      subentry_count: 2,
      num_sponsoring: 3,
      num_sponsored: 2,
    });
    expect(computeReservedNativeStroops(sponsored)).toBe(
      5n * BASE_RESERVE_STROOPS,
    );
  });
});

describe("deriveBalanceSnapshot — credit stake asset", () => {
  it("reads the trustline balance for the configured issuer", () => {
    const snapshot = snapshotOf(account());

    expect(snapshot.stakeAssetStroops).toBe(toStroops("250.5"));
    expect(snapshot.spendableStakeStroops).toBe(toStroops("250.5"));
    expect(snapshot.hasTrustline).toBe(true);
    expect(snapshot.assetId).toBe(USDC.id);
  });

  it("ignores a same-ticker balance from another issuer", () => {
    const snapshot = snapshotOf(
      account({
        balances: [nativeLine(), usdcLine({ asset_issuer: IMPOSTOR })],
      }),
    );

    expect(snapshot.hasTrustline).toBe(false);
    expect(snapshot.stakeAssetStroops).toBeNull();
    expect(snapshot.spendableStakeStroops).toBe(0n);
  });

  it("reports a missing trustline as unknown rather than zero balance", () => {
    const snapshot = snapshotOf(account({ balances: [nativeLine()] }));

    expect(snapshot.hasTrustline).toBe(false);
    expect(snapshot.trustlineUnauthorized).toBe(false);
    expect(snapshot.stakeAssetStroops).toBeNull();
  });

  it("treats an unauthorized trustline as unspendable", () => {
    const snapshot = snapshotOf(
      account({ balances: [nativeLine(), usdcLine({ is_authorized: false })] }),
    );

    expect(snapshot.hasTrustline).toBe(false);
    expect(snapshot.trustlineUnauthorized).toBe(true);
    expect(snapshot.spendableStakeStroops).toBe(0n);
  });

  it("subtracts selling liabilities locked by open offers", () => {
    const snapshot = snapshotOf(
      account({
        balances: [
          nativeLine(),
          usdcLine({ selling_liabilities: "50.5000000" }),
        ],
      }),
    );

    expect(snapshot.stakeAssetStroops).toBe(toStroops("250.5"));
    expect(snapshot.spendableStakeStroops).toBe(toStroops("200"));
  });

  it("does not take the XLM fee buffer out of a credit balance", () => {
    const snapshot = snapshotOf(account());
    expect(snapshot.spendableStakeStroops).toBe(snapshot.stakeAssetStroops);
  });

  it("holds back the base reserve from spendable XLM", () => {
    const snapshot = snapshotOf(account({ subentry_count: 1 }));

    // 100 XLM − (2 + 1) × 0.5 XLM reserve
    expect(snapshot.reservedNativeStroops).toBe(toStroops("1.5"));
    expect(snapshot.spendableNativeStroops).toBe(toStroops("98.5"));
    expect(snapshot.hasFeeBuffer).toBe(true);
  });

  it("flags an account that cannot cover the fee buffer", () => {
    const snapshot = snapshotOf(
      account({ balances: [nativeLine({ balance: "1.0500000" }), usdcLine()] }),
    );

    // 1.05 XLM − 1.5 XLM reserve → nothing spendable
    expect(snapshot.spendableNativeStroops).toBe(0n);
    expect(snapshot.hasFeeBuffer).toBe(false);
    expect(snapshot.feeBufferStroops).toBe(DEFAULT_FEE_BUFFER_STROOPS);
  });

  it("treats a missing native line as a zero XLM balance", () => {
    const snapshot = snapshotOf(account({ balances: [usdcLine()] }));

    expect(snapshot.nativeStroops).toBe(0n);
    expect(snapshot.spendableNativeStroops).toBe(0n);
    expect(snapshot.hasFeeBuffer).toBe(false);
  });
});

describe("deriveBalanceSnapshot — native stake asset", () => {
  const XLM = nativeStakeAsset();

  it("keeps both the reserve and the fee buffer out of the spendable amount", () => {
    const snapshot = snapshotOf(account({ subentry_count: 1 }), XLM);

    // 100 − 1.5 reserve − 0.1 fee buffer
    expect(snapshot.spendableNativeStroops).toBe(toStroops("98.5"));
    expect(snapshot.spendableStakeStroops).toBe(toStroops("98.4"));
    expect(snapshot.hasTrustline).toBe(true);
  });

  it("never reports a negative spendable amount", () => {
    const snapshot = snapshotOf(
      account({
        subentry_count: 0,
        balances: [nativeLine({ balance: "0.5000000" })],
      }),
      XLM,
    );

    expect(snapshot.spendableNativeStroops).toBe(0n);
    expect(snapshot.spendableStakeStroops).toBe(0n);
  });

  it("subtracts native selling liabilities", () => {
    const snapshot = snapshotOf(
      account({
        subentry_count: 0,
        balances: [nativeLine({ selling_liabilities: "40.0000000" })],
      }),
      XLM,
    );

    // 100 − 1.0 reserve − 40 liabilities − 0.1 fee buffer
    expect(snapshot.spendableStakeStroops).toBe(toStroops("58.9"));
  });
});

describe("isSnapshotStale", () => {
  it("goes stale only once the threshold elapses", () => {
    const snapshot = snapshotOf(account(), USDC, 10_000);

    expect(isSnapshotStale(snapshot, 10_000)).toBe(false);
    expect(isSnapshotStale(snapshot, 10_000 + STALE_AFTER_MS - 1)).toBe(false);
    expect(isSnapshotStale(snapshot, 10_000 + STALE_AFTER_MS)).toBe(true);
  });
});
