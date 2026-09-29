import { describe, expect, it } from "vitest";
import { buildWalletConnectUri, detectWallets } from "./useWallet";

describe("multi-wallet detection helpers (#596)", () => {
  it("builds deep-link URIs per wallet", () => {
    expect(buildWalletConnectUri("lobstr")).toMatch(/^lobstr:\/\//);
    expect(buildWalletConnectUri("hana")).toMatch(/^hana:\/\//);
    expect(buildWalletConnectUri("rabet")).toMatch(/^rabet:\/\//);
    expect(buildWalletConnectUri("albedo")).toMatch(/albedo/);
  });

  it("detectWallets returns all five keys in browser-less env", async () => {
    const result = await detectWallets();
    expect(Object.keys(result).sort()).toEqual(
      ["albedo", "freighter", "hana", "lobstr", "rabet"].sort(),
    );
    expect(result.albedo).toBe(true);
  });
});
