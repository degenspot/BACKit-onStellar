import { describe, expect, it } from "vitest";
import { toStroops } from "../backend/amounts";
import {
  DEFAULT_MIN_STAKE_STROOPS,
  computeMaxStakeStroops,
  computePercentStakeStroops,
  parseFeeBuffer,
  parseStakeLimits,
  validateStakeAmount,
  type StakeLimits,
} from "./stakeLimits";

const OPEN: StakeLimits = { minStroops: toStroops("1"), maxStroops: null };
const CAPPED: StakeLimits = {
  minStroops: toStroops("1"),
  maxStroops: toStroops("100"),
};

describe("parseStakeLimits", () => {
  it("falls back to the contract default minimum", () => {
    expect(parseStakeLimits({})).toEqual({
      minStroops: DEFAULT_MIN_STAKE_STROOPS,
      maxStroops: null,
    });
  });

  it("reads decimal strings without touching a float", () => {
    expect(
      parseStakeLimits({
        NEXT_PUBLIC_MIN_STAKE: "2.5",
        NEXT_PUBLIC_MAX_STAKE_PER_USER: "1000.1234567",
      }),
    ).toEqual({
      minStroops: toStroops("2.5"),
      maxStroops: toStroops("1000.1234567"),
    });
  });

  it("treats zero and malformed maximums as unlimited", () => {
    expect(
      parseStakeLimits({ NEXT_PUBLIC_MAX_STAKE_PER_USER: "0" }).maxStroops,
    ).toBeNull();
    expect(
      parseStakeLimits({ NEXT_PUBLIC_MAX_STAKE_PER_USER: "lots" }).maxStroops,
    ).toBeNull();
  });

  it("keeps the default minimum when the override is malformed", () => {
    expect(parseStakeLimits({ NEXT_PUBLIC_MIN_STAKE: "-5" }).minStroops).toBe(
      DEFAULT_MIN_STAKE_STROOPS,
    );
  });
});

describe("parseFeeBuffer", () => {
  it("uses the override when it parses", () => {
    expect(parseFeeBuffer({ NEXT_PUBLIC_XLM_FEE_BUFFER: "0.25" }, 1n)).toBe(
      toStroops("0.25"),
    );
  });

  it("falls back otherwise", () => {
    expect(parseFeeBuffer({}, 1_000_000n)).toBe(1_000_000n);
    expect(parseFeeBuffer({ NEXT_PUBLIC_XLM_FEE_BUFFER: "??" }, 7n)).toBe(7n);
  });
});

describe("computeMaxStakeStroops", () => {
  it("is the whole spendable balance when no cap applies", () => {
    expect(computeMaxStakeStroops(toStroops("250.5"), OPEN)).toBe(
      toStroops("250.5"),
    );
  });

  it("preserves every stroop of the balance", () => {
    const spendable = toStroops("12.3456789");
    expect(computeMaxStakeStroops(spendable, OPEN)).toBe(spendable);
  });

  it("clamps to the contract maximum", () => {
    expect(computeMaxStakeStroops(toStroops("250.5"), CAPPED)).toBe(
      toStroops("100"),
    );
  });

  it("leaves a balance under the cap untouched", () => {
    expect(computeMaxStakeStroops(toStroops("40"), CAPPED)).toBe(
      toStroops("40"),
    );
  });

  it("is zero when the balance cannot reach the contract minimum", () => {
    expect(computeMaxStakeStroops(toStroops("0.9"), OPEN)).toBe(0n);
  });

  it("is zero for an empty or negative balance", () => {
    expect(computeMaxStakeStroops(0n, OPEN)).toBe(0n);
    expect(computeMaxStakeStroops(-5n, OPEN)).toBe(0n);
  });
});

describe("computePercentStakeStroops", () => {
  it("truncates rather than rounding up past the balance", () => {
    const spendable = toStroops("10.0000001");
    expect(computePercentStakeStroops(spendable, 75, OPEN)).toBe(
      toStroops("7.5000000"),
    );
    expect(computePercentStakeStroops(spendable, 75, OPEN)).toBeLessThan(
      spendable,
    );
  });

  it("splits the balance at each preset", () => {
    const spendable = toStroops("400");
    expect(computePercentStakeStroops(spendable, 25, OPEN)).toBe(
      toStroops("100"),
    );
    expect(computePercentStakeStroops(spendable, 50, OPEN)).toBe(
      toStroops("200"),
    );
    expect(computePercentStakeStroops(spendable, 75, OPEN)).toBe(
      toStroops("300"),
    );
    expect(computePercentStakeStroops(spendable, 100, OPEN)).toBe(
      toStroops("400"),
    );
  });

  it("routes 100% through the MAX rules", () => {
    expect(computePercentStakeStroops(toStroops("250.5"), 100, CAPPED)).toBe(
      toStroops("100"),
    );
    expect(computePercentStakeStroops(toStroops("0.5"), 100, OPEN)).toBe(0n);
  });

  it("clamps a partial preset to the contract maximum", () => {
    expect(computePercentStakeStroops(toStroops("1000"), 50, CAPPED)).toBe(
      toStroops("100"),
    );
  });

  it("is zero without a balance", () => {
    expect(computePercentStakeStroops(0n, 50, OPEN)).toBe(0n);
  });
});

describe("validateStakeAmount", () => {
  const base = {
    spendableStroops: toStroops("100"),
    limits: OPEN,
    hasFeeBuffer: true,
    marketActive: true,
  };

  it("accepts an affordable amount inside the contract limits", () => {
    expect(
      validateStakeAmount({ ...base, amountStroops: toStroops("50") }),
    ).toEqual({ status: "ok" });
  });

  it("rejects a closed market before anything else", () => {
    expect(
      validateStakeAmount({
        ...base,
        amountStroops: null,
        marketActive: false,
      }),
    ).toEqual({ status: "error", problem: "market-closed" });
  });

  it("rejects a non-positive or unparseable amount", () => {
    expect(validateStakeAmount({ ...base, amountStroops: null })).toEqual({
      status: "error",
      problem: "invalid-amount",
    });
    expect(validateStakeAmount({ ...base, amountStroops: 0n })).toEqual({
      status: "error",
      problem: "invalid-amount",
    });
  });

  it("rejects an amount below the contract minimum", () => {
    expect(
      validateStakeAmount({ ...base, amountStroops: toStroops("0.5") }),
    ).toEqual({ status: "error", problem: "below-minimum" });
  });

  it("rejects an amount above the contract maximum", () => {
    expect(
      validateStakeAmount({
        ...base,
        amountStroops: toStroops("101"),
        spendableStroops: toStroops("1000"),
        limits: CAPPED,
      }),
    ).toEqual({ status: "error", problem: "above-maximum" });
  });

  it("rejects an amount above the spendable balance", () => {
    expect(
      validateStakeAmount({ ...base, amountStroops: toStroops("100.0000001") }),
    ).toEqual({ status: "error", problem: "exceeds-balance" });
  });

  it("rejects a wallet that cannot pay the network fee", () => {
    expect(
      validateStakeAmount({
        ...base,
        amountStroops: toStroops("50"),
        hasFeeBuffer: false,
      }),
    ).toEqual({ status: "error", problem: "insufficient-fee" });
  });

  it("does not block on an unknown balance", () => {
    expect(
      validateStakeAmount({
        ...base,
        amountStroops: toStroops("999999"),
        spendableStroops: null,
      }),
    ).toEqual({ status: "ok" });
  });

  it("allows spending the balance down to the last stroop", () => {
    expect(
      validateStakeAmount({ ...base, amountStroops: toStroops("100") }),
    ).toEqual({ status: "ok" });
  });
});
