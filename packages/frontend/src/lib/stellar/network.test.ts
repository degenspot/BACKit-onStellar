import { describe, expect, it } from "vitest";
import {
  describeAsset,
  findAssetBalance,
  normaliseNetwork,
  resolveNetworkConfig,
  type HorizonBalanceLine,
} from "./network";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const IMPOSTOR = "GIMPOSTORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const balances: HorizonBalanceLine[] = [
  { asset_type: "native", balance: "42.5000000" },
  {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: IMPOSTOR,
    balance: "999999.0000000",
  },
  {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER,
    balance: "250.7500000",
  },
];

describe("normaliseNetwork", () => {
  it("maps wallet spellings onto a known network", () => {
    expect(normaliseNetwork("TESTNET")).toBe("TESTNET");
    expect(normaliseNetwork("Test SDF Network")).toBe("TESTNET");
    expect(normaliseNetwork("PUBLIC")).toBe("PUBLIC");
    expect(normaliseNetwork("mainnet")).toBe("PUBLIC");
  });
});

describe("resolveNetworkConfig", () => {
  it("resolves horizon and asset defaults per network", () => {
    const config = resolveNetworkConfig("PUBLIC");
    expect(config.horizonUrl).toBe("https://horizon.stellar.org");
    expect(config.stakeAsset.code).toBe("USDC");
    expect(config.stakeAsset.issuer).toBe(ISSUER);
    expect(config.configError).toBeNull();
  });

  it("treats XLM as the native asset", () => {
    const config = resolveNetworkConfig("TESTNET", { code: "XLM" });
    expect(config.stakeAsset.isNative).toBe(true);
    expect(config.stakeAsset.issuer).toBeNull();
  });

  it("reports a configuration error for an issuer-less non-native asset", () => {
    const config = resolveNetworkConfig("TESTNET", {
      code: "EURC",
      issuer: null,
      isNative: false,
    });
    expect(config.configError).toMatch(/no issuer configured/i);
  });
});

describe("findAssetBalance", () => {
  it("matches on issuer and code, not on the code alone", () => {
    const line = findAssetBalance(balances, {
      code: "USDC",
      issuer: ISSUER,
      contractId: null,
      isNative: false,
    });
    expect(line?.balance).toBe("250.7500000");
  });

  it("ignores a same-code asset from another issuer", () => {
    const line = findAssetBalance(balances, {
      code: "USDC",
      issuer: "GSOMEONEELSEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      contractId: null,
      isNative: false,
    });
    expect(line).toBeUndefined();
  });

  it("matches the native balance by asset type", () => {
    const line = findAssetBalance(balances, {
      code: "XLM",
      issuer: null,
      contractId: null,
      isNative: true,
    });
    expect(line?.balance).toBe("42.5000000");
  });
});

describe("describeAsset", () => {
  it("includes a truncated issuer for non-native assets", () => {
    expect(
      describeAsset({
        code: "USDC",
        issuer: ISSUER,
        contractId: null,
        isNative: false,
      }),
    ).toBe("USDC (GA5Z…KZVN)");
    expect(
      describeAsset({
        code: "XLM",
        issuer: null,
        contractId: null,
        isNative: true,
      }),
    ).toBe("XLM");
  });
});
