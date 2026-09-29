import { describe, expect, it, beforeEach } from "vitest";
import {
  isValidAssetCode,
  isValidStellarAddress,
  loadImportedTokens,
  saveImportedTokens,
  addImportedToken,
} from "./token-registry";

describe("token-registry (#598)", () => {
  beforeEach(() => {
    saveImportedTokens([]);
  });

  it("validates asset codes and addresses", () => {
    expect(isValidAssetCode("USDC")).toBe(true);
    expect(isValidAssetCode("")).toBe(false);
    expect(isValidStellarAddress("G" + "A".repeat(55))).toBe(true);
    expect(isValidStellarAddress("C" + "A".repeat(55))).toBe(true);
    expect(isValidStellarAddress("invalid")).toBe(false);
  });

  it("persists imported tokens", () => {
    addImportedToken({
      code: "USDC",
      issuer: "G" + "B".repeat(55),
      addedAt: Date.now(),
    });
    expect(loadImportedTokens()).toHaveLength(1);
    expect(loadImportedTokens()[0]!.code).toBe("USDC");
  });
});
