"use client";

/**
 * TransactionReviewSummary.tsx
 *
 * Accessible, mobile-friendly transaction review summary displayed before signing.
 * Shows subscription amount, protocol fee, network fee estimate, token, merchant,
 * and recurrence schedule with explicit units, consistent token precision, and
 * clear Fixed vs. Estimated indicators.
 */

export interface TransactionReviewSummaryProps {
  merchantAddress: string;
  tokenAddress: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  amount: string;
  protocolFee?: string | null;
  networkFeeXlm?: string | null;
  networkFeeStatus?: "idle" | "loading" | "success" | "error";
  networkFeeError?: string | null;
  intervalSeconds: string | number;
  subscriberAddress?: string;
  nextPaymentDate?: string;
  onConfirm?: () => void;
  onBack?: () => void;
  confirmLabel?: string;
  backLabel?: string;
  isSubmitting?: boolean;
}

/**
 * Formats a numeric string to a fixed number of decimal places.
 * Falls back to "0" with the requested precision if the input is invalid.
 */
export function formatTokenPrecision(
  value: string | number | null | undefined,
  decimals = 7,
): string {
  const safeDecimals = Math.max(0, Math.min(18, Math.floor(decimals)));
  const num = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(num) || num < 0) {
    return (0).toFixed(safeDecimals);
  }
  return num.toFixed(safeDecimals);
}

/**
 * Formats an interval in seconds into a human-readable recurrence schedule.
 */
export function formatRecurrence(intervalSeconds: string | number): string {
  const secs = Number(intervalSeconds);
  if (!Number.isFinite(secs) || secs <= 0) {
    return "Custom schedule";
  }
  const days = Math.round(secs / 86400);
  if (days >= 1) {
    return `Every ${days} day${days !== 1 ? "s" : ""} (${secs.toLocaleString()} s)`;
  }
  return `Every ${secs.toLocaleString()} seconds`;
}

function ValueTypeBadge({ type }: { type: "Fixed" | "Estimated" }) {
  const isFixed = type === "Fixed";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isFixed
          ? "bg-blue-900/50 text-blue-200 border border-blue-700/50"
          : "bg-amber-900/40 text-amber-200 border border-amber-700/50"
      }`}
    >
      {type}
    </span>
  );
}

export function TransactionReviewSummary({
  merchantAddress,
  tokenAddress,
  tokenSymbol = "tokens",
  tokenDecimals = 7,
  amount,
  protocolFee = "0",
  networkFeeXlm = null,
  networkFeeStatus = "idle",
  networkFeeError = null,
  intervalSeconds,
  subscriberAddress,
  nextPaymentDate,
  onConfirm,
  onBack,
  confirmLabel = "Confirm & Sign",
  backLabel = "Back",
  isSubmitting = false,
}: TransactionReviewSummaryProps) {
  const formattedAmount = formatTokenPrecision(amount, tokenDecimals);
  const formattedProtocolFee = formatTokenPrecision(protocolFee ?? "0", tokenDecimals);
  const totalTokenCost = formatTokenPrecision(
    Number(formattedAmount) + Number(formattedProtocolFee),
    tokenDecimals,
  );
  const recurrenceText = formatRecurrence(intervalSeconds);

  const renderNetworkFee = () => {
    if (networkFeeStatus === "loading") {
      return (
        <span className="text-gray-300 italic" aria-busy="true">
          Estimating network fee…
        </span>
      );
    }
    if (networkFeeStatus === "error" || (networkFeeStatus !== "idle" && !networkFeeXlm)) {
      return (
        <span className="text-amber-300">
          Unavailable{networkFeeError ? ` (${networkFeeError})` : ""} — Freighter will show final fee
        </span>
      );
    }
    if (networkFeeXlm) {
      return (
        <span>
          ~{formatTokenPrecision(networkFeeXlm, 7)} XLM
        </span>
      );
    }
    return (
      <span className="text-gray-400">
        Estimated at signing in Freighter (XLM)
      </span>
    );
  };

  return (
    <section
      aria-labelledby="tx-review-heading"
      className="rounded-xl bg-gray-900/80 border border-gray-700 p-4 sm:p-5 space-y-4 text-white"
    >
      <div>
        <h3 id="tx-review-heading" className="text-base sm:text-lg font-bold text-white">
          Transaction Review
        </h3>
        <p className="text-xs sm:text-sm text-gray-400 mt-0.5">
          Verify all recipient, schedule, and fee details before signing.
        </p>
      </div>

      <dl className="rounded-lg bg-gray-800/60 border border-gray-700/80 divide-y divide-gray-700/60 text-sm">
        {subscriberAddress && (
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 px-4 py-3">
            <dt className="text-xs text-gray-400 font-semibold shrink-0">Subscriber</dt>
            <dd className="font-mono text-xs text-gray-100 break-all sm:text-right">
              {subscriberAddress}
            </dd>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 px-4 py-3">
          <dt className="text-xs text-gray-400 font-semibold shrink-0">Recipient (Merchant)</dt>
          <dd className="font-mono text-xs text-gray-100 break-all sm:text-right">
            {merchantAddress}
          </dd>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 px-4 py-3">
          <dt className="text-xs text-gray-400 font-semibold shrink-0">Token</dt>
          <dd className="font-mono text-xs text-gray-100 break-all sm:text-right">
            <span className="font-sans font-semibold text-white mr-1.5">{tokenSymbol}</span>
            <span className="text-gray-400">({tokenAddress})</span>
          </dd>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3">
          <dt className="text-xs text-gray-400 font-semibold shrink-0">Recurrence Schedule</dt>
          <dd className="font-mono text-xs sm:text-sm text-gray-100 sm:text-right">
            {recurrenceText}
          </dd>
        </div>

        {nextPaymentDate && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3">
            <dt className="text-xs text-gray-400 font-semibold shrink-0">Next Payment Eligible</dt>
            <dd className="font-mono text-xs sm:text-sm text-gray-100 sm:text-right">
              {nextPaymentDate}
            </dd>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3">
          <dt className="flex items-center gap-2 text-xs text-gray-400 font-semibold shrink-0">
            <span>Subscription Amount</span>
            <ValueTypeBadge type="Fixed" />
          </dt>
          <dd className="font-mono text-sm font-semibold text-white tabular-nums sm:text-right">
            {formattedAmount} {tokenSymbol}
          </dd>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3">
          <dt className="flex items-center gap-2 text-xs text-gray-400 font-semibold shrink-0">
            <span>Protocol Fee</span>
            <ValueTypeBadge type="Fixed" />
          </dt>
          <dd className="font-mono text-sm text-gray-200 tabular-nums sm:text-right">
            {formattedProtocolFee} {tokenSymbol}
          </dd>
        </div>

        <div
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3"
          aria-live="polite"
        >
          <dt className="flex items-center gap-2 text-xs text-gray-400 font-semibold shrink-0">
            <span>Network Fee</span>
            <ValueTypeBadge type="Estimated" />
          </dt>
          <dd className="font-mono text-xs sm:text-sm text-gray-200 tabular-nums sm:text-right">
            {renderNetworkFee()}
          </dd>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3 bg-gray-800/90">
          <dt className="text-xs text-gray-200 font-bold uppercase tracking-wider shrink-0">
            Total Per Payment
          </dt>
          <dd className="font-mono text-sm font-bold text-green-300 tabular-nums sm:text-right">
            {totalTokenCost} {tokenSymbol} + network fee
          </dd>
        </div>
      </dl>

      {(onBack || onConfirm) && (
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              disabled={isSubmitting}
              className="flex-1 rounded-lg border border-gray-600 bg-gray-800/60 text-gray-200 hover:bg-gray-700 disabled:opacity-50 py-3 px-4 text-sm font-semibold min-h-[44px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              {backLabel}
            </button>
          )}
          {onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSubmitting}
              className="flex-1 rounded-lg bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:opacity-50 py-3 px-4 text-sm font-semibold text-white min-h-[44px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
            >
              {isSubmitting ? "Submitting…" : confirmLabel}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
