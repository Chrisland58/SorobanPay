import {
  getTokenDecimals,
  registerToken,
  formatTokenAmount,
  formatTokenWithSymbol,
  parseTokenAmount,
  parseTokenAmountOrDefault,
  isAmountWithinLimit,
  calculateShortfall,
  roundToDecimals,
  convertDecimals,
} from "./token_decimals";

describe("token_decimals utilities", () => {
  describe("Decimal Registry", () => {
    it("returns correct decimals for known tokens", () => {
      expect(getTokenDecimals("native")).toBe(7);
      expect(getTokenDecimals("XLM")).toBe(7);
      expect(getTokenDecimals("xlm")).toBe(7);
      expect(getTokenDecimals("USDC")).toBe(6);
      expect(getTokenDecimals("EURC")).toBe(6);
      expect(getTokenDecimals("UNKNOWN_TOKEN")).toBe(7);
    });

    it("registers custom token decimals", () => {
      registerToken("CUSTOM18", 18);
      expect(getTokenDecimals("CUSTOM18")).toBe(18);

      registerToken("ZERO_DEC", 0);
      expect(getTokenDecimals("ZERO_DEC")).toBe(0);

      registerToken("MICRO2", 2);
      expect(getTokenDecimals("MICRO2")).toBe(2);
    });

    it("throws on invalid decimal registrations", () => {
      expect(() => registerToken("INV_NEG", -1)).toThrow();
      expect(() => registerToken("INV_HIGH", 20)).toThrow();
    });
  });

  describe("Amount Formatting (Base Units -> Display)", () => {
    it("formats 0 decimal tokens correctly", () => {
      expect(formatTokenAmount(0n, 0)).toBe("0");
      expect(formatTokenAmount(42n, 0)).toBe("42");
      expect(formatTokenAmount(1_000_000n, 0)).toBe("1000000");
    });

    it("formats 2 decimal tokens correctly", () => {
      expect(formatTokenAmount(0n, 2)).toBe("0.00");
      expect(formatTokenAmount(5n, 2)).toBe("0.05");
      expect(formatTokenAmount(50n, 2)).toBe("0.50");
      expect(formatTokenAmount(1250n, 2)).toBe("12.50");
      expect(formatTokenAmount(1250n, 2, { trimTrailing: true })).toBe("12.5");
      expect(formatTokenAmount(1200n, 2, { trimTrailing: true })).toBe("12");
    });

    it("formats 7 decimal tokens (Stellar native) correctly", () => {
      expect(formatTokenAmount(1n, 7)).toBe("0.0000001");
      expect(formatTokenAmount(10_000_000n, 7)).toBe("1.0000000");
      expect(formatTokenAmount(50_000_000n, 7, { trimTrailing: true })).toBe("5");
      expect(formatTokenAmount(51_234_567n, 7)).toBe("5.1234567");
    });

    it("formats 18 decimal tokens (EVM standard) correctly", () => {
      const oneWhole18 = 10n ** 18n;
      expect(formatTokenAmount(oneWhole18, 18)).toBe("1.000000000000000000");
      expect(formatTokenAmount(oneWhole18, 18, { trimTrailing: true })).toBe("1");
      expect(formatTokenAmount(1n, 18)).toBe("0.000000000000000001");
      expect(formatTokenAmount(1_500_000_000_000_000_000n, 18, { trimTrailing: true })).toBe("1.5");
    });

    it("formats token amount with symbol", () => {
      expect(formatTokenWithSymbol(10_000_000n, 7, "XLM")).toBe("1 XLM");
      expect(formatTokenWithSymbol(1_000_000n, 6, "USDC")).toBe("1 USDC");
      expect(formatTokenWithSymbol(100n, 2)).toBe("1");
    });
  });

  describe("Amount Parsing (Display -> Base Units)", () => {
    it("parses 0 decimal tokens without floating point", () => {
      expect(parseTokenAmount("0", 0)).toBe(0n);
      expect(parseTokenAmount("100", 0)).toBe(100n);
      expect(parseTokenAmount("100.5", 0)).toBeNull(); // fractional not allowed for 0 decimals
    });

    it("parses 2 decimal tokens accurately", () => {
      expect(parseTokenAmount("0.01", 2)).toBe(1n);
      expect(parseTokenAmount("0.1", 2)).toBe(10n);
      expect(parseTokenAmount("1", 2)).toBe(100n);
      expect(parseTokenAmount("12.50", 2)).toBe(1250n);
      expect(parseTokenAmount("12.505", 2)).toBeNull(); // exceeds precision
    });

    it("parses 7 decimal tokens accurately", () => {
      expect(parseTokenAmount("0.0000001", 7)).toBe(1n);
      expect(parseTokenAmount("1", 7)).toBe(10_000_000n);
      expect(parseTokenAmount("5.00", 7)).toBe(50_000_000n);
      expect(parseTokenAmount("5.1234567", 7)).toBe(51_234_567n);
      expect(parseTokenAmount("0.00000001", 7)).toBeNull(); // 8 decimals rejected for 7-dec token
    });

    it("parses 18 decimal tokens accurately", () => {
      expect(parseTokenAmount("1", 18)).toBe(10n ** 18n);
      expect(parseTokenAmount("0.000000000000000001", 18)).toBe(1n);
      expect(parseTokenAmount("1.5", 18)).toBe(1_500_000_000_000_000_000n);
      expect(parseTokenAmount("0.0000000000000000001", 18)).toBeNull(); // 19 digits rejected
    });

    it("handles boundary, whitespace, and invalid inputs safely", () => {
      expect(parseTokenAmount("", 7)).toBeNull();
      expect(parseTokenAmount("   ", 7)).toBeNull();
      expect(parseTokenAmount("abc", 7)).toBeNull();
      expect(parseTokenAmount("-5.0", 7)).toBeNull();
      expect(parseTokenAmount("1.2.3", 7)).toBeNull();
      expect(parseTokenAmount("1e7", 7)).toBeNull();

      expect(parseTokenAmountOrDefault("invalid", 7, 100n)).toBe(100n);
      expect(parseTokenAmountOrDefault("5", 7, 100n)).toBe(50_000_000n);
    });
  });

  describe("Decimal Conversion Across Scales", () => {
    it("converts between different decimal scales", () => {
      // 6 decimals to 7 decimals: 1.000000 (1_000_000n) -> 10_000_000n
      expect(convertDecimals(1_000_000n, 6, 7)).toBe(10_000_000n);

      // 7 decimals to 6 decimals: 10_000_000n -> 1_000_000n
      expect(convertDecimals(10_000_000n, 7, 6)).toBe(1_000_000n);

      // 7 decimals to 6 decimals with truncation
      expect(convertDecimals(10_555_555n, 7, 6)).toBe(1_055_555n);

      // Same decimals
      expect(convertDecimals(500n, 7, 7)).toBe(500n);
    });

    it("rounds and truncates amounts to target decimal places", () => {
      expect(roundToDecimals(1_234_567n, 7, 6)).toBe(123_456n);
      expect(roundToDecimals(123_456n, 6, 7)).toBe(1_234_560n);
      expect(roundToDecimals(100n, 2, 2)).toBe(100n);
    });
  });

  describe("Amount Limits & Shortfalls", () => {
    it("checks amount limits correctly", () => {
      expect(isAmountWithinLimit(50n, 100n)).toBe(true);
      expect(isAmountWithinLimit(100n, 100n)).toBe(true);
      expect(isAmountWithinLimit(101n, 100n)).toBe(false);
    });

    it("calculates shortfalls accurately", () => {
      expect(calculateShortfall(100n, 80n)).toBe(20n);
      expect(calculateShortfall(100n, 100n)).toBe(0n);
      expect(calculateShortfall(100n, 150n)).toBe(0n);
    });
  });
});
