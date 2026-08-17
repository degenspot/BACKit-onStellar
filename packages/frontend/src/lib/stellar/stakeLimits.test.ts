import { describe, expect, it } from "vitest";
import { fromStroops, toStroops } from "./amounts";
import {
  BASE_RESERVE_STROOPS,
  calculateMaxStakeStroops,
  requiredXlmReserveStroops,
  spendableXlmStroops,
  validateStake,
  type StakeLimits,
} from "./stakeLimits";

const NO_LIMITS: StakeLimits = { minStroops: 0n, maxStroops: null };
const FEE_BUFFER = toStroops("1");

describe("requiredXlmReserveStroops", () => {
  it("reserves two base entries for a bare account", () => {
    expect(requiredXlmReserveStroops({})).toBe(2n * BASE_RESERVE_STROOPS);
  });

  it("adds one entry per subentry and sponsorship", () => {
    expect(
      requiredXlmReserveStroops({ subentryCount: 3, numSponsoring: 1 }),
    ).toBe(6n * BASE_RESERVE_STROOPS);
  });

  it("discounts sponsored entries and never goes negative", () => {
    expect(requiredXlmReserveStroops({ numSponsored: 10 })).toBe(0n);
  });
});

describe("spendableXlmStroops", () => {
  it("subtracts the reserve and floors at zero", () => {
    expect(
      fromStroops(spendableXlmStroops(toStroops("5"), toStroops("1.5"))),
    ).toBe("3.5000000");
    expect(spendableXlmStroops(toStroops("0.5"), toStroops("1"))).toBe(0n);
  });
});

describe("calculateMaxStakeStroops", () => {
  it("uses the stake-asset balance when the asset is not XLM", () => {
    const max = calculateMaxStakeStroops({
      assetBalanceStroops: toStroops("250.75"),
      spendableXlmStroops: toStroops("10"),
      stakeAssetIsNative: false,
      limits: NO_LIMITS,
      feeBufferStroops: FEE_BUFFER,
    });
    expect(fromStroops(max)).toBe("250.7500000");
  });

  it("keeps the fee buffer back when staking XLM itself", () => {
    const max = calculateMaxStakeStroops({
      assetBalanceStroops: toStroops("10"),
      spendableXlmStroops: toStroops("10"),
      stakeAssetIsNative: true,
      limits: NO_LIMITS,
      feeBufferStroops: FEE_BUFFER,
    });
    expect(fromStroops(max)).toBe("9.0000000");
  });

  it("returns zero when XLM cannot cover the fee buffer", () => {
    expect(
      calculateMaxStakeStroops({
        assetBalanceStroops: toStroops("500"),
        spendableXlmStroops: toStroops("0.2"),
        stakeAssetIsNative: false,
        limits: NO_LIMITS,
        feeBufferStroops: FEE_BUFFER,
      }),
    ).toBe(0n);
  });

  it("caps at the contract maximum stake", () => {
    const max = calculateMaxStakeStroops({
      assetBalanceStroops: toStroops("500"),
      spendableXlmStroops: toStroops("10"),
      stakeAssetIsNative: false,
      limits: { minStroops: toStroops("1"), maxStroops: toStroops("100") },
      feeBufferStroops: FEE_BUFFER,
    });
    expect(fromStroops(max)).toBe("100.0000000");
  });

  it("returns zero when the balance is below the contract minimum", () => {
    expect(
      calculateMaxStakeStroops({
        assetBalanceStroops: toStroops("0.5"),
        spendableXlmStroops: toStroops("10"),
        stakeAssetIsNative: false,
        limits: { minStroops: toStroops("1"), maxStroops: null },
        feeBufferStroops: FEE_BUFFER,
      }),
    ).toBe(0n);
  });

  it("keeps full stroop precision", () => {
    const max = calculateMaxStakeStroops({
      assetBalanceStroops: toStroops("0.0000003"),
      spendableXlmStroops: toStroops("10"),
      stakeAssetIsNative: false,
      limits: NO_LIMITS,
      feeBufferStroops: FEE_BUFFER,
    });
    expect(fromStroops(max)).toBe("0.0000003");
  });
});

describe("validateStake", () => {
  const base = {
    amountStroops: toStroops("10"),
    spendableStakeStroops: toStroops("100"),
    limits: { minStroops: toStroops("1"), maxStroops: toStroops("50") },
    isConnected: true,
    marketIsActive: true,
    balanceReady: true,
    accountFunded: true,
    hasTrustline: true,
    hasFeeBalance: true,
  };

  it("accepts a valid stake", () => {
    expect(validateStake(base)).toEqual({ reason: "OK", canSubmit: true });
  });

  // `it.each` cannot serialise bigint table values, so the cases are named.
  type Overrides = Partial<Omit<typeof base, "amountStroops">> & {
    amountStroops?: bigint | null;
  };
  const blockingCases: Array<[string, Overrides, string]> = [
    ["wallet disconnected", { isConnected: false }, "WALLET_DISCONNECTED"],
    ["market closed", { marketIsActive: false }, "MARKET_CLOSED"],
    ["balance not loaded", { balanceReady: false }, "BALANCE_UNAVAILABLE"],
    ["account not funded", { accountFunded: false }, "ACCOUNT_NOT_FUNDED"],
    ["missing trustline", { hasTrustline: false }, "MISSING_TRUSTLINE"],
    ["no fee balance", { hasFeeBalance: false }, "INSUFFICIENT_FEE_BALANCE"],
    ["zero spendable balance", { spendableStakeStroops: 0n }, "ZERO_BALANCE"],
    ["empty amount", { amountStroops: null }, "AMOUNT_REQUIRED"],
    ["zero amount", { amountStroops: 0n }, "AMOUNT_NOT_POSITIVE"],
    ["below minimum", { amountStroops: toStroops("0.5") }, "BELOW_MINIMUM"],
    ["above maximum", { amountStroops: toStroops("60") }, "ABOVE_MAXIMUM"],
    [
      "above balance",
      {
        amountStroops: toStroops("40"),
        spendableStakeStroops: toStroops("30"),
      },
      "EXCEEDS_BALANCE",
    ],
  ];

  for (const [name, overrides, reason] of blockingCases) {
    it(`blocks submission when ${name}`, () => {
      expect(validateStake({ ...base, ...overrides })).toEqual({
        reason,
        canSubmit: false,
      });
    });
  }
});
