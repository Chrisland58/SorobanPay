"use client";

/**
 * UpdateSubscriptionForm.tsx — Issue #768
 *
 * Lets a subscriber change the amount and/or interval of an existing
 * subscription via the contract's `update_subscription` entry point, instead
 * of having to cancel and re-subscribe. The contract preserves the current
 * billing cycle (`next_payment` is untouched), so this doesn't trigger an
 * immediate extra charge.
 *
 * Standalone, prop-driven component — the caller supplies which subscription
 * is being edited (subscriber/merchant) and its current amount/interval to
 * pre-fill the form; it doesn't fetch or list subscriptions itself.
 */

import { useState, type FormEvent } from "react";
import { useWallet } from "@/hooks/useWallet";
import { buildAndSubmitUpdateSubscription } from "@/lib/transaction_builder";
import { buildExplorerUrl } from "@/hooks/useTransactionPoller";
import { MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS } from "@/lib/validation";
import { CONTRACT_ID, NETWORK_PASSPHRASE, RPC_URL } from "@/constants/network";
import { mapError } from "@/lib/errors";
import { useToast } from "@/components/Toast";

// ─── Shared styles (mirrors SubscriptionForm.tsx's input treatment) ──────────
const inputCls =
  "w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-base " +
  "text-white placeholder-gray-500 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 " +
  "disabled:opacity-50 min-h-[48px] transition-all duration-150";

export interface UpdateSubscriptionFormProps {
  /** Subscriber Stellar G-address — must match the connected wallet to sign. */
  subscriber: string;
  /** Merchant Stellar G-address for the subscription being edited. */
  merchant: string;
  /** Current payment amount (token's smallest unit) used to pre-fill the form. */
  currentAmount: string | number | bigint;
  /** Current interval in seconds, used to pre-fill the form. */
  currentInterval: number;
  /** Called with the confirmed transaction hash after a successful update. */
  onSuccess?: (txHash: string) => void;
  /** Called when the user dismisses the form without submitting. */
  onCancel?: () => void;
}

function daysFromSeconds(seconds: number): number {
  return Math.round(seconds / 86_400);
}

// ─── Confirmation modal ─────────────────────────────────────────────────────

function UpdateConfirmModal({
  currentAmount,
  currentInterval,
  newAmount,
  newInterval,
  onConfirm,
  onCancel,
}: {
  currentAmount: string;
  currentInterval: number;
  newAmount: string;
  newInterval: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-5 text-white">
        <h3 id="update-confirm-title" className="text-lg font-bold">
          Confirm subscription update
        </h3>
        <p className="text-sm text-gray-400">
          Your current billing cycle is preserved — this won&apos;t trigger an
          extra charge.
        </p>

        <dl className="bg-gray-800/60 rounded-lg divide-y divide-gray-700 text-sm">
          <div className="flex flex-col gap-0.5 px-4 py-3">
            <dt className="text-xs text-gray-400 font-medium">Amount</dt>
            <dd className="text-sm text-gray-100">
              {currentAmount} <span className="text-gray-500">→</span>{" "}
              <span className="font-semibold text-white">{newAmount}</span>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 px-4 py-3">
            <dt className="text-xs text-gray-400 font-medium">Interval</dt>
            <dd className="text-sm text-gray-100">
              every {daysFromSeconds(currentInterval)} day
              {daysFromSeconds(currentInterval) !== 1 ? "s" : ""}{" "}
              <span className="text-gray-500">→</span>{" "}
              <span className="font-semibold text-white">
                every {daysFromSeconds(newInterval)} day
                {daysFromSeconds(newInterval) !== 1 ? "s" : ""}
              </span>
            </dd>
          </div>
        </dl>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-600 bg-gray-800/50 text-gray-300 hover:bg-gray-700 active:bg-gray-800 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
          >
            Go Back
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            Confirm & Authorize
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main form ────────────────────────────────────────────────────────────────

export default function UpdateSubscriptionForm({
  subscriber,
  merchant,
  currentAmount,
  currentInterval,
  onSuccess,
  onCancel,
}: UpdateSubscriptionFormProps) {
  const { publicKey } = useWallet();
  const { showToast } = useToast();

  const [amount, setAmount] = useState(String(currentAmount));
  const [interval, setInterval] = useState(String(currentInterval));
  const [amountError, setAmountError] = useState<string | null>(null);
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const walletMismatch = !!publicKey && publicKey !== subscriber;

  function validate(): boolean {
    let ok = true;
    const amountNum = Number(amount);
    if (!amount.trim() || !Number.isInteger(amountNum) || amountNum <= 0) {
      setAmountError("Amount must be a positive whole number.");
      ok = false;
    } else {
      setAmountError(null);
    }

    const intervalNum = Number(interval);
    if (!interval.trim() || !Number.isInteger(intervalNum)) {
      setIntervalError("Interval must be a whole number of seconds.");
      ok = false;
    } else if (intervalNum < MIN_INTERVAL_SECONDS) {
      setIntervalError(
        `Minimum interval is ${MIN_INTERVAL_SECONDS.toLocaleString()} seconds (1 day).`,
      );
      ok = false;
    } else if (intervalNum > MAX_INTERVAL_SECONDS) {
      setIntervalError(
        `Maximum interval is ${MAX_INTERVAL_SECONDS.toLocaleString()} seconds (365 days).`,
      );
      ok = false;
    } else {
      setIntervalError(null);
    }

    return ok;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    if (!publicKey || walletMismatch) return;
    setShowConfirm(true);
  }

  async function handleConfirm() {
    setShowConfirm(false);
    if (!publicKey) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const { txHash: hash } = await buildAndSubmitUpdateSubscription(
        {
          subscriber,
          merchant,
          newAmount: Number(amount),
          newInterval: Number(interval),
        },
        CONTRACT_ID,
        publicKey,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );
      setTxHash(hash);
      onSuccess?.(hash);
    } catch (err) {
      const mapped = mapError(err);
      setSubmitError(mapped.message);
      showToast({
        variant: "error",
        message: mapped.message,
        action: mapped.action,
        docsUrl: mapped.docsUrl,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!CONTRACT_ID) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-yellow-700/40 bg-yellow-950/30 p-4 text-sm text-yellow-200"
      >
        Contract not configured — set NEXT_PUBLIC_CONTRACT_ID.
      </div>
    );
  }

  if (txHash) {
    return (
      <div
        role="alert"
        className="rounded-xl bg-gradient-to-br from-green-900/60 to-green-800/30 border-2 border-green-600/60 p-5 text-sm space-y-4"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">
            ✓
          </span>
          <p className="font-semibold text-green-300 text-base">
            Subscription updated
          </p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
          <p className="text-gray-400 text-xs mb-1.5 font-medium">
            Transaction hash
          </p>
          <p className="text-gray-200 break-all font-mono text-xs leading-relaxed">
            {txHash}
          </p>
          <a
            href={buildExplorerUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-xs text-blue-400 hover:text-blue-300 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            View on Stellar Expert
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-6 text-white">
      {showConfirm && (
        <UpdateConfirmModal
          currentAmount={String(currentAmount)}
          currentInterval={currentInterval}
          newAmount={amount}
          newInterval={Number(interval)}
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <h2 className="text-lg font-bold mb-1">Update Subscription</h2>
      <p className="text-gray-400 text-sm mb-5">
        Change your payment amount or interval without cancelling — your
        current billing cycle is preserved.
      </p>

      {walletMismatch && (
        <div
          role="alert"
          className="mb-5 rounded-lg bg-yellow-900/30 border border-yellow-600/50 px-4 py-3 text-sm text-yellow-200"
        >
          Connected wallet ({publicKey}) doesn&apos;t match this
          subscription&apos;s subscriber ({subscriber}). Switch accounts in
          Freighter to make changes.
        </div>
      )}

      {submitError && (
        <div
          role="alert"
          className="mb-5 rounded-lg bg-red-900/30 border border-red-600/50 px-4 py-3 text-sm text-red-300"
        >
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="update-amount" className="block text-sm font-semibold text-gray-100 mb-2">
            New amount
          </label>
          <input
            id="update-amount"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={!!amountError}
            aria-describedby={amountError ? "update-amount-err" : undefined}
            className={`${inputCls} ${amountError ? "border-red-500 ring-1 ring-red-400/30" : ""}`}
          />
          {amountError && (
            <p id="update-amount-err" role="alert" className="mt-2 text-xs text-red-400 font-medium">
              {amountError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="update-interval" className="block text-sm font-semibold text-gray-100 mb-2">
            New interval (seconds)
          </label>
          <input
            id="update-interval"
            type="number"
            inputMode="numeric"
            min={MIN_INTERVAL_SECONDS}
            max={MAX_INTERVAL_SECONDS}
            step="1"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={!!intervalError}
            aria-describedby={intervalError ? "update-interval-err" : undefined}
            className={`${inputCls} ${intervalError ? "border-red-500 ring-1 ring-red-400/30" : ""}`}
          />
          <p className="mt-2 text-xs text-gray-400">
            {MIN_INTERVAL_SECONDS.toLocaleString()}–{MAX_INTERVAL_SECONDS.toLocaleString()} seconds
            (1–365 days).
          </p>
          {intervalError && (
            <p id="update-interval-err" role="alert" className="mt-2 text-xs text-red-400 font-medium">
              {intervalError}
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="flex-1 rounded-lg border border-gray-600 bg-gray-800/50 text-gray-300 hover:bg-gray-700 py-3 text-sm font-semibold transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting || !publicKey || walletMismatch}
            className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed py-3 text-sm font-semibold transition-colors min-h-[48px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {isSubmitting ? "Submitting…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

