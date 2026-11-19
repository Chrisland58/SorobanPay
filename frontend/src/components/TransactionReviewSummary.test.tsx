/**
 * TransactionReviewSummary.test.tsx
 *
 * Unit tests for TransactionReviewSummary covering precision, Fixed vs. Estimated
 * labeling, boundary cases, failure handling, and keyboard/screen-reader accessibility.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  TransactionReviewSummary,
  formatTokenPrecision,
  formatRecurrence,
} from "@/components/TransactionReviewSummary";

const baseProps = {
  merchantAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  tokenSymbol: "USDC",
  tokenDecimals: 7,
  amount: "25.5",
  protocolFee: "0.25",
  networkFeeXlm: "0.00125",
  networkFeeStatus: "success" as const,
  intervalSeconds: 2592000,
};

describe("TransactionReviewSummary", () => {
  it("renders all material details with consistent token precision and Fixed/Estimated badges", () => {
    render(<TransactionReviewSummary {...baseProps} />);

    expect(screen.getByRole("heading", { name: /transaction review/i })).toBeInTheDocument();
    expect(screen.getByText(baseProps.merchantAddress)).toBeInTheDocument();
    expect(screen.getByText(/USDC/)).toBeInTheDocument();
    expect(screen.getByText("25.5000000 USDC")).toBeInTheDocument();
    expect(screen.getByText("0.2500000 USDC")).toBeInTheDocument();
    expect(screen.getByText("~0.0012500 XLM")).toBeInTheDocument();
    expect(screen.getByText("25.7500000 USDC + network fee")).toBeInTheDocument();
    expect(screen.getByText(/Every 30 days/i)).toBeInTheDocument();

    expect(screen.getAllByText("Fixed")).toHaveLength(2);
    expect(screen.getByText("Estimated")).toBeInTheDocument();
  });

  it("handles loading and error states for network fee estimation", () => {
    const { rerender } = render(
      <TransactionReviewSummary
        {...baseProps}
        networkFeeStatus="loading"
        networkFeeXlm={null}
      />,
    );
    expect(screen.getByText(/Estimating network fee/i)).toBeInTheDocument();

    rerender(
      <TransactionReviewSummary
        {...baseProps}
        networkFeeStatus="error"
        networkFeeXlm={null}
        networkFeeError="RPC timeout"
      />,
    );
    expect(
      screen.getByText(/Unavailable \(RPC timeout\) — Freighter will show final fee/i),
    ).toBeInTheDocument();
  });

  it("handles boundary values for precision and recurrence formatting", () => {
    expect(formatTokenPrecision("invalid", 7)).toBe("0.0000000");
    expect(formatTokenPrecision("-5", 2)).toBe("0.00");
    expect(formatTokenPrecision("12.345", 2)).toBe("12.35");
    expect(formatRecurrence(0)).toBe("Custom schedule");
    expect(formatRecurrence(3600)).toBe("Every 3,600 seconds");
  });

  it("invokes onBack and onConfirm and disables actions while submitting", () => {
    const onBack = vi.fn();
    const onConfirm = vi.fn();

    const { rerender } = render(
      <TransactionReviewSummary
        {...baseProps}
        onBack={onBack}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Sign" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(
      <TransactionReviewSummary
        {...baseProps}
        onBack={onBack}
        onConfirm={onConfirm}
        isSubmitting
      />,
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  });
});
