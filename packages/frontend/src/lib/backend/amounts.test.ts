import { describe, expect, it } from "vitest";
import {
  AmountFormatError,
  amountFromApi,
  divideToDecimalString,
  formatAmount,
  fromStroops,
  optionalAmountFromApi,
  sumStroops,
  toStroops,
} from "./amounts";

describe("toStroops", () => {
  it("converts whole and fractional decimal strings", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
    expect(toStroops("1234.5678901")).toBe(12_345_678_901n);
  });

  it("truncates precision beyond 7 decimals instead of rounding", () => {
    expect(toStroops("0.00000019")).toBe(1n);
  });

  it("handles negative amounts", () => {
    expect(toStroops("-2.5")).toBe(-25_000_000n);
  });

  it("rejects malformed input", () => {
    expect(() => toStroops("abc")).toThrow(AmountFormatError);
    expect(() => toStroops("")).toThrow(AmountFormatError);
    expect(() => toStroops("1,5")).toThrow(AmountFormatError);
  });
});

describe("fromStroops", () => {
  it("round-trips decimal strings", () => {
    expect(fromStroops(toStroops("1234.5678901"))).toBe("1234.5678901");
    expect(fromStroops(0n)).toBe("0.0000000");
    expect(fromStroops(-1n)).toBe("-0.0000001");
  });

  it("keeps precision a float would lose", () => {
    const stroops = toStroops("9007199254.7401993");
    expect(fromStroops(stroops)).toBe("9007199254.7401993");
  });
});

describe("amountFromApi", () => {
  it("accepts decimal strings, numbers and bigints", () => {
    expect(amountFromApi("10.5")).toBe(105_000_000n);
    expect(amountFromApi(10.5)).toBe(105_000_000n);
    expect(amountFromApi(42n)).toBe(42n);
  });

  it("treats missing values as zero and rejects junk", () => {
    expect(amountFromApi(null)).toBe(0n);
    expect(amountFromApi(undefined)).toBe(0n);
    expect(() => amountFromApi(Number.NaN)).toThrow(AmountFormatError);
    expect(() => amountFromApi({})).toThrow(AmountFormatError);
  });

  it("distinguishes absent from zero via optionalAmountFromApi", () => {
    expect(optionalAmountFromApi(null)).toBeNull();
    expect(optionalAmountFromApi("0")).toBe(0n);
  });
});

describe("sumStroops", () => {
  it("adds exactly where float addition drifts", () => {
    const values = [toStroops("0.1"), toStroops("0.2")];
    expect(fromStroops(sumStroops(values))).toBe("0.3000000");
  });
});

describe("divideToDecimalString", () => {
  it("truncates to the requested precision", () => {
    expect(divideToDecimalString(10n, 3n, 4)).toBe("3.3333");
    expect(divideToDecimalString(1n, 3n, 0)).toBe("0");
  });

  it("throws on division by zero", () => {
    expect(() => divideToDecimalString(1n, 0n, 2)).toThrow("Division by zero");
  });
});

describe("formatAmount", () => {
  it("formats with grouping and two decimals by default", () => {
    expect(formatAmount(toStroops("1234567.891"))).toBe("1,234,567.89");
    expect(formatAmount(toStroops("-12.5"))).toBe("-12.50");
    expect(formatAmount(toStroops("12.5"), { grouping: false })).toBe("12.50");
  });
});
