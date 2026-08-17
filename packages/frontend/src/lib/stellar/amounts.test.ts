import { describe, expect, it } from "vitest";
import {
  InvalidAmountError,
  clampInputPrecision,
  formatStroops,
  fromStroops,
  maxStroops,
  minStroops,
  parseAmountInput,
  percentOf,
  toStroops,
} from "./amounts";

describe("toStroops / fromStroops", () => {
  it("converts decimal strings to stroops", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
    expect(toStroops("1234.5678901")).toBe(12_345_678_901n);
  });

  it("truncates sub-stroop precision instead of rounding", () => {
    expect(toStroops("0.00000019")).toBe(1n);
  });

  it("round-trips without losing precision", () => {
    expect(fromStroops(toStroops("9007199254.7401993"))).toBe(
      "9007199254.7401993",
    );
    expect(fromStroops(0n)).toBe("0.0000000");
  });

  it("rejects malformed values", () => {
    expect(() => toStroops("1,5")).toThrow(InvalidAmountError);
    expect(() => toStroops("abc")).toThrow(InvalidAmountError);
  });
});

describe("parseAmountInput", () => {
  it("returns null for empty or invalid input", () => {
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("   ")).toBeNull();
    expect(parseAmountInput("12abc")).toBeNull();
  });

  it("parses valid input", () => {
    expect(parseAmountInput("12.5")).toBe(125_000_000n);
  });
});

describe("clampInputPrecision", () => {
  it("keeps at most seven decimals while typing", () => {
    expect(clampInputPrecision("1.123456789")).toBe("1.1234567");
    expect(clampInputPrecision("42")).toBe("42");
    expect(clampInputPrecision("42.")).toBe("42.");
  });
});

describe("formatStroops", () => {
  it("formats with grouping and truncation", () => {
    expect(formatStroops(toStroops("1234567.899"))).toBe("1,234,567.89");
    expect(formatStroops(toStroops("12.5"), { grouping: false })).toBe("12.50");
    expect(formatStroops(toStroops("12.5"), { decimals: 0 })).toBe("12");
    expect(formatStroops(toStroops("-3.25"))).toBe("-3.25");
  });
});

describe("percentOf", () => {
  it("computes exact percentages of a balance", () => {
    const balance = toStroops("1000.0000003");
    expect(fromStroops(percentOf(balance, 25))).toBe("250.0000000");
    expect(fromStroops(percentOf(balance, 100))).toBe("1000.0000003");
  });

  it("truncates rather than exceeding the balance", () => {
    // 1 stroop split three ways can only give zero.
    expect(percentOf(1n, 25)).toBe(0n);
  });

  it("rejects nonsense percentages", () => {
    expect(() => percentOf(10n, -5)).toThrow(InvalidAmountError);
    expect(() => percentOf(10n, 2.5)).toThrow(InvalidAmountError);
  });
});

describe("minStroops / maxStroops", () => {
  it("picks the expected bound", () => {
    expect(minStroops(5n, 9n)).toBe(5n);
    expect(maxStroops(5n, 9n)).toBe(9n);
  });
});
