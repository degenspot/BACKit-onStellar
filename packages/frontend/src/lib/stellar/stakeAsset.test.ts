import { describe, expect, it } from "vitest";
import {
  describeStakeAsset,
  isValidAssetCode,
  isValidIssuer,
  marketAssetMatches,
  nativeStakeAsset,
  parseStakeAsset,
} from "./stakeAsset";

const CIRCLE_USDC = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const SDF_TEST_USDC =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

describe("issuer and code validation", () => {
  it("accepts well-formed Stellar account IDs", () => {
    expect(isValidIssuer(CIRCLE_USDC)).toBe(true);
    expect(isValidIssuer(SAC)).toBe(false); // contract ID, not an account
    expect(isValidIssuer("GA5Z")).toBe(false);
    expect(isValidIssuer(null)).toBe(false);
  });

  it("accepts classic asset codes only", () => {
    expect(isValidAssetCode("USDC")).toBe(true);
    expect(isValidAssetCode("yXLM")).toBe(true);
    expect(isValidAssetCode("THIRTEENCHARS")).toBe(false);
    expect(isValidAssetCode("US DC")).toBe(false);
    expect(isValidAssetCode("")).toBe(false);
  });
});

describe("parseStakeAsset", () => {
  it("defaults to the network's known USDC issuer", () => {
    const result = parseStakeAsset({}, "TESTNET");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.asset.code).toBe("USDC");
    expect(result.asset.issuer).toBe(SDF_TEST_USDC);
    expect(result.asset.id).toBe(`USDC:${SDF_TEST_USDC}`);
  });

  it("uses a different issuer per network", () => {
    const result = parseStakeAsset({}, "PUBLIC");
    expect(result.status === "ok" && result.asset.issuer).toBe(CIRCLE_USDC);
  });

  it("honours explicit code and issuer overrides", () => {
    const result = parseStakeAsset(
      {
        NEXT_PUBLIC_STAKE_ASSET_CODE: "EURC",
        NEXT_PUBLIC_STAKE_ASSET_ISSUER: CIRCLE_USDC,
        NEXT_PUBLIC_USDC_SAC_CONTRACT_ID: SAC,
      },
      "PUBLIC",
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.asset.code).toBe("EURC");
    expect(result.asset.sacContractId).toBe(SAC);
  });

  it("refuses to identify an asset by its code alone", () => {
    const result = parseStakeAsset({}, "FUTURENET");

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors.join(" ")).toMatch(/ISSUER is required/i);
  });

  it("rejects a malformed issuer", () => {
    const result = parseStakeAsset(
      { NEXT_PUBLIC_STAKE_ASSET_ISSUER: "not-an-account" },
      "TESTNET",
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors.join(" ")).toMatch(/not a valid Stellar account ID/i);
  });

  it("rejects a malformed SAC contract ID", () => {
    const result = parseStakeAsset(
      { NEXT_PUBLIC_USDC_SAC_CONTRACT_ID: "CNOPE" },
      "TESTNET",
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors.join(" ")).toMatch(/not a valid Stellar contract ID/i);
  });

  it("resolves XLM without an issuer", () => {
    const result = parseStakeAsset(
      { NEXT_PUBLIC_STAKE_ASSET_CODE: "XLM" },
      "FUTURENET",
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.asset).toEqual(nativeStakeAsset(null));
  });
});

describe("marketAssetMatches", () => {
  const asset = nativeStakeAsset();
  const usdc = parseStakeAsset({}, "TESTNET");

  it("compares codes case-insensitively", () => {
    expect(marketAssetMatches("xlm", asset)).toBe(true);
    expect(marketAssetMatches(" XLM ", asset)).toBe(true);
  });

  it("rules out a market denominated in another asset", () => {
    expect(usdc.status).toBe("ok");
    if (usdc.status !== "ok") return;
    expect(marketAssetMatches("EURC", usdc.asset)).toBe(false);
    expect(marketAssetMatches(null, usdc.asset)).toBe(false);
  });
});

describe("describeStakeAsset", () => {
  it("names the issuer so two same-ticker assets can be told apart", () => {
    const result = parseStakeAsset({}, "PUBLIC");
    expect(result.status === "ok" && describeStakeAsset(result.asset)).toBe(
      "USDC (GA5Z…KZVN)",
    );
  });

  it("has no issuer to show for XLM", () => {
    expect(describeStakeAsset(nativeStakeAsset())).toBe("XLM");
  });
});
