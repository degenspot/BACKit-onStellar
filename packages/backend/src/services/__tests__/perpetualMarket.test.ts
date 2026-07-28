import { describe, it, expect } from "vitest";
import { PerpetualMarketService } from "../perpetualMarket.service";

describe("PerpetualMarketService", () => {
  it("should calculate funding rate correctly", () => {
    const service = new PerpetualMarketService();
    expect(service.calculateFundingRate(100, 100)).toBe(0);
    expect(service.calculateFundingRate(200, 100)).toBeGreaterThan(0);
  });
});
