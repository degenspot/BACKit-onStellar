import { describe, expect, it } from "vitest";
import { toStroops } from "../backend/amounts";
import {
  formatStakeAmount,
  formatXlmAmount,
  sanitizeAmountInput,
  toAmountInputValue,
  trimTrailingZeros,
} from "./format";

describe("trimTrailingZeros", () => {
  it("drops only fractional zeros", () => {
    expect(trimTrailingZeros("123.4500000")).toBe("123.45");
    expect(trimTrailingZeros("1200.0000000")).toBe("1200");
    expect(trimTrailingZeros("0.0000000")).toBe("0");
    expect(trimTrailingZeros("1000")).toBe("1000");
  });

  it("keeps significant trailing digits", () => {
    expect(trimTrailingZeros("0.0000001")).toBe("0.0000001");
    expect(trimTrailingZeros("0.1010000")).toBe("0.101");
  });
});

describe("toAmountInputValue", () => {
  it("renders stroops without trailing noise", () => {
    expect(toAmountInputValue(0n)).toBe("0");
    expect(toAmountInputValue(1n)).toBe("0.0000001");
    expect(toAmountInputValue(1_234_500_000n)).toBe("123.45");
    expect(toAmountInputValue(10_000_000n)).toBe("1");
  });

  it("round-trips through toStroops for every stroop", () => {
    const values = [
      0n,
      1n,
      9_999_999n,
      10_000_000n,
      123_456_789n,
      1_000_000_000_000n,
    ];
    for (const value of values) {
      expect(toStroops(toAmountInputValue(value))).toBe(value);
    }
  });

  it("does not lose the 7th decimal place", () => {
    const awkward = toStroops("4321.0000001");
    expect(toAmountInputValue(awkward)).toBe("4321.0000001");
    expect(toStroops(toAmountInputValue(awkward))).toBe(awkward);
  });
});

describe("sanitizeAmountInput", () => {
  it("strips anything that is not a digit or a decimal point", () => {
    expect(sanitizeAmountInput("1a2b3")).toBe("123");
    expect(sanitizeAmountInput("-50")).toBe("50");
    expect(sanitizeAmountInput("1,000.50")).toBe("1000.50");
  });

  it("keeps a single decimal point", () => {
    expect(sanitizeAmountInput("1.2.3")).toBe("1.23");
  });

  it("truncates beyond Stellar's 7 decimals rather than rounding", () => {
    expect(sanitizeAmountInput("1.123456789")).toBe("1.1234567");
    expect(toStroops(sanitizeAmountInput("1.99999999"))).toBe(
      toStroops("1.9999999"),
    );
  });

  it("restores the leading zero so the value stays parseable", () => {
    expect(sanitizeAmountInput(".5")).toBe("0.5");
    expect(toStroops(sanitizeAmountInput(".5"))).toBe(toStroops("0.5"));
  });

  it("allows an empty field while typing", () => {
    expect(sanitizeAmountInput("")).toBe("");
  });
});

describe("display formatting", () => {
  it("formats stake amounts consistently to two places", () => {
    expect(formatStakeAmount(toStroops("1234.5678"))).toBe("1,234.56");
    expect(formatStakeAmount(0n)).toBe("0.00");
  });

  it("formats XLM with four places", () => {
    expect(formatXlmAmount(toStroops("1.23456789"))).toBe("1.2345");
    expect(formatXlmAmount(5_000_000n)).toBe("0.5000");
  });
});
