import {
  formatTokenAmount,
  formatTokenWithSymbol,
  getTokenDecimals,
  parseTokenAmount,
  parseTokenAmountOrDefault,
  registerToken,
} from "./token_decimals";

describe("token_decimals — amount conversion across varied decimal precisions", () => {
  const PRECISION_FIXTURES = [
    {
      name: "zero-decimal integer token",
      symbol: "VOTE",
      decimals: 0,
      input: "42",
      expectedBaseUnits: 42n,
      expectedSerialized: "42",
      expectedReceipt: "42 VOTE",
    },
    {
      name: "low-precision 2-decimal token",
      symbol: "CENTS",
      decimals: 2,
      input: "19.99",
      expectedBaseUnits: 1999n,
      expectedSerialized: "1999",
      expectedReceipt: "19.99 CENTS",
    },
    {
      name: "6-decimal stablecoin (USDC)",
      symbol: "USDC",
      decimals: 6,
      input: "0.1",
      expectedBaseUnits: 100_000n,
      expectedSerialized: "100000",
      expectedReceipt: "0.1 USDC",
    },
    {
      name: "7-decimal native Stellar token (XLM)",
      symbol: "XLM",
      decimals: 7,
      input: "0.0000001",
      expectedBaseUnits: 1n,
      expectedSerialized: "1",
      expectedReceipt: "0.0000001 XLM",
    },
    {
      name: "18-decimal high-precision token",
      symbol: "WETH",
      decimals: 18,
      input: "0.123456789012345678",
      expectedBaseUnits: 123_456_789_012_345_678n,
      expectedSerialized: "123456789012345678",
      expectedReceipt: "0.123456789012345678 WETH",
    },
    {
      name: "19-decimal max-boundary token",
      symbol: "MAX19",
      decimals: 19,
      input: "1.0000000000000000001",
      expectedBaseUnits: 10_000_000_000_000_000_001n,
      expectedSerialized: "10000000000000000001",
      expectedReceipt: "1.0000000000000000001 MAX19",
    },
  ];

  it.each(PRECISION_FIXTURES)(
    "round-trips $name ($decimals decimals) with exact bigint and string assertions",
    ({ symbol, decimals, input, expectedBaseUnits, expectedSerialized, expectedReceipt }) => {
      // 1. Frontend input -> contract base units
      const baseUnits = parseTokenAmount(input, decimals);
      expect(baseUnits).toBe(expectedBaseUnits);

      // 2. API JSON serialization -> deserialization
      const apiPayload = JSON.stringify({ amount: baseUnits!.toString(), decimals, symbol });
      const parsedPayload = JSON.parse(apiPayload) as { amount: string; decimals: number; symbol: string };
      expect(parsedPayload.amount).toBe(expectedSerialized);
      const contractUnits = BigInt(parsedPayload.amount);
      expect(contractUnits).toBe(expectedBaseUnits);

      // 3. Contract base units -> displayed receipt
      const receipt = formatTokenWithSymbol(contractUnits, parsedPayload.decimals, parsedPayload.symbol);
      expect(receipt).toBe(expectedReceipt);
    },
  );

  describe("non-binary-representable decimal fractions", () => {
    it("preserves exactness for 0.1 + 0.2 = 0.3 without float drift", () => {
      const a = parseTokenAmount("0.1", 7);
      const b = parseTokenAmount("0.2", 7);
      expect(a).toBe(1_000_000n);
      expect(b).toBe(2_000_000n);
      expect(formatTokenAmount(a! + b!, 7, { trimTrailing: true })).toBe("0.3");
    });

    it("preserves exactness above Number.MAX_SAFE_INTEGER", () => {
      const largeInput = "9007199254740993.1";
      const parsed = parseTokenAmount(largeInput, 7);
      expect(parsed).toBe(90_071_992_547_409_931_000_000n);
      expect(formatTokenAmount(parsed!, 7, { trimTrailing: true })).toBe(largeInput);
    });
  });

  describe("boundary and failure handling", () => {
    it("rejects excess fractional digits at the documented precision boundary", () => {
      expect(parseTokenAmount("1.1", 0)).toBeNull();
      expect(parseTokenAmount("1.123", 2)).toBeNull();
      expect(parseTokenAmount("0.1234567", 6)).toBeNull();
      expect(parseTokenAmount("0.00000001", 7)).toBeNull();
      expect(parseTokenAmount("0.12345678901234567890", 19)).toBeNull();
    });

    it("rejects invalid precision values (< 0, > 19, non-integer)", () => {
      expect(parseTokenAmount("10", -1)).toBeNull();
      expect(parseTokenAmount("10", 20)).toBeNull();
      expect(parseTokenAmount("10", 1.5)).toBeNull();
      expect(parseTokenAmount("10", Number.NaN)).toBeNull();

      expect(() => registerToken("BADNEG", -1)).toThrow(/Invalid decimals/);
      expect(() => registerToken("BADHIGH", 20)).toThrow(/Invalid decimals/);
      expect(() => formatTokenAmount(10n, -1)).toThrow(/Invalid decimals/);
    });

    it("rejects malformed input strings and falls back safely with parseTokenAmountOrDefault", () => {
      for (const bad of ["", "   ", ".", "-1", "abc", "1.2.3", "1e5"]) {
        expect(parseTokenAmount(bad, 7)).toBeNull();
        expect(parseTokenAmountOrDefault(bad, 7, 99n)).toBe(99n);
      }
    });

    it("resolves known token decimals and defaults unknown symbols to 7", () => {
      expect(getTokenDecimals("USDC")).toBe(6);
      expect(getTokenDecimals("xlm")).toBe(7);
      expect(getTokenDecimals("UNKNOWN_TOKEN")).toBe(7);
    });
  });
});
