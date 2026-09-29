import { describe, expect, it } from "vitest";
import {
  buildBadgeLabel,
  formatStroopsAsXlm,
} from "./gas-station-adapter";

describe("gas-station-adapter (#597)", () => {
  it("formats stroops as XLM", () => {
    expect(formatStroopsAsXlm(10_000_000)).toBe("1");
    expect(formatStroopsAsXlm(100_000)).toMatch(/^0\.01/);
  });

  it("builds sponsored badge with remaining count", () => {
    expect(
      buildBadgeLabel({ maxFree: 3, remainingFree: 3, canSponsor: true }),
    ).toContain("3/3 Free Transactions Left");
    expect(
      buildBadgeLabel({ maxFree: 3, remainingFree: 0, canSponsor: false }),
    ).toMatch(/exhausted/i);
  });
});
