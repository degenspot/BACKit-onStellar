import { describe, it, expect } from "vitest";
import { StellarDexService } from "../stellarDex.service";

describe("StellarDexService", () => {
  it("should stake in pool successfully", async () => {
    const service = new StellarDexService();
    const result = await service.stakeInLiquidityPool("pool123", 500);
    expect(result.success).toBe(true);
    expect(result.staked).toBe(500);
  });
});
