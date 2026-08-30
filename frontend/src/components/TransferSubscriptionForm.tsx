"use client";

/**
 * TransferSubscriptionForm.tsx — Issue #770
 *
 * UI for the contract's `transfer_subscription` entry point, which atomically
 * reassigns an active subscription from one merchant to another — the
 * canonical mechanism for merchant key rotation, account merges, and business
 * sales (see transfer_subscription in contracts/subscription/src/lib.rs).
 *
 * Dual authorization: the contract requires signatures from BOTH `subscriber`
 * and `old_merchant`. This form signs with whichever role the connected
 * wallet is playing; if the other required party hasn't also authorized the
 * same call, submission fails on-chain with a clear error (there is no
 * multi-party co-signing/XDR exchange flow here — see the note rendered in
 * the form and the comment on buildAndSubmitTransferSubscription).
 *
 * Standalone, prop-driven component — the caller supplies the subscriber
 * whose subscription is being moved; old_merchant and new_merchant are
 * entered directly in the form per the issue's spec.
 */

import { useState, type FormEvent } from "react";
import { useWallet } from "@/hooks/useWallet";
import { buildAndSubmitTransferSubscription } from "@/lib/transaction_builder";
import { buildExplorerUrl } from "@/hooks/useTransactionPoller";
import { isValidGAddress } from "@/lib/validation";
import { CONTRACT_ID, NETWORK_PASSPHRASE, RPC_URL } from "@/constants/network";
import { mapError } from "@/lib/errors";
import { useToast } from "@/components/Toast";

const inputCls =
  "w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-base " +
  "text-white placeholder-gray-500 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 " +
  "disabled:opacity-50 min-h-[48px] transition-all duration-150";

export interface TransferSubscriptionFormProps {
  /** Subscriber Stellar G-address whose subscription is being reassigned. */
  subscriber: string;
  /** Pre-fills the "current merchant" field when the caller already knows it. */
  initialOldMerchant?: string;
  /** Called with the confirmed transaction hash after a successful transfer. */
  onSuccess?: (txHash: string) => void;
  /** Called when the user dismisses the form without submitting. */
  onCancel?: () => void;
}

interface FieldErrors {
  oldMerchant?: string;
  newMerchant?: string;
}

export default function TransferSubscriptionForm({
  subscriber,
  initialOldMerchant = "",
  onSuccess,
  onCancel,
}: TransferSubscriptionFormProps) {
  const { publicKey } = useWallet();
  const { showToast } = useToast();

  const [oldMerchant, setOldMerchant] = useState(initialOldMerchant);
  const [newMerchant, setNewMerchant] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const canSign =
    !!publicKey && (publicKey === subscriber || publicKey === oldMerchant.trim());

  function validate(): boolean {
    const errors: FieldErrors = {};
    const oldTrimmed = oldMerchant.trim();
    const newTrimmed = newMerchant.trim();

    if (!oldTrimmed) {
      errors.oldMerchant = "Current merchant address is required.";
    } else if (!isValidGAddress(oldTrimmed)) {
      errors.oldMerchant = "Must be a valid Stellar G-address (56 characters, starts with G).";
    }

    if (!newTrimmed) {
      errors.newMerchant = "New merchant address is required.";
    } else if (!isValidGAddress(newTrimmed)) {
      errors.newMerchant = "Must be a valid Stellar G-address (56 characters, starts with G).";
    } else if (oldTrimmed && newTrimmed === oldTrimmed) {
      // Mirrors the contract's SameMerchant error.
      errors.newMerchant = "New merchant must be different from the current merchant.";
    } else if (newTrimmed === subscriber) {
      // Mirrors the contract's SelfSubscription error.
      errors.newMerchant = "Subscriber cannot become their own merchant.";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    if (!publicKey) return;

    setIsSubmitting(true);
    try {
      const { txHash: hash } = await buildAndSubmitTransferSubscription(
        {
          subscriber,
          oldMerchant: oldMerchant.trim(),
          newMerchant: newMerchant.trim(),
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
            Subscription transferred
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
      <h2 className="text-lg font-bold mb-1">Transfer Subscription</h2>
      <p className="text-gray-400 text-sm mb-4">
        Move this subscription to a different merchant address. The
        subscription state (amount, interval, next payment) is preserved
        exactly — no billing-cycle reset occurs.
      </p>

      {/* Dual-authorization notice — Issue #770 limitation */}
      <div
        role="note"
        className="mb-5 rounded-lg bg-blue-900/20 border border-blue-700/40 px-4 py-3 text-xs text-blue-200 leading-relaxed"
      >
        This transfer requires signatures from <strong>both</strong> the
        subscriber and the current merchant. If the wallet connected here is
        only one of the two, the transaction will be rejected on-chain until
        the other party also authorizes it — there&apos;s no split
        sign-now-sign-later flow in this form yet.
      </div>

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
          <label className="block text-sm font-semibold text-gray-100 mb-2">
            Subscriber
          </label>
          <p className="break-all font-mono text-xs text-gray-400 bg-gray-800/50 rounded-lg px-4 py-3 border border-gray-700/50">
            {subscriber}
          </p>
        </div>

        <div>
          <label htmlFor="old-merchant" className="block text-sm font-semibold text-gray-100 mb-2">
            Current merchant (old_merchant)
          </label>
          <input
            id="old-merchant"
            type="text"
            placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
            autoComplete="off"
            value={oldMerchant}
            onChange={(e) => setOldMerchant(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={!!fieldErrors.oldMerchant}
            aria-describedby={fieldErrors.oldMerchant ? "old-merchant-err" : undefined}
            className={`${inputCls} ${fieldErrors.oldMerchant ? "border-red-500 ring-1 ring-red-400/30" : ""}`}
          />
          {fieldErrors.oldMerchant && (
            <p id="old-merchant-err" role="alert" className="mt-2 text-xs text-red-400 font-medium">
              {fieldErrors.oldMerchant}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="new-merchant" className="block text-sm font-semibold text-gray-100 mb-2">
            New merchant (new_merchant)
          </label>
          <input
            id="new-merchant"
            type="text"
            placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
            autoComplete="off"
            value={newMerchant}
            onChange={(e) => setNewMerchant(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={!!fieldErrors.newMerchant}
            aria-describedby={fieldErrors.newMerchant ? "new-merchant-err" : undefined}
            className={`${inputCls} ${fieldErrors.newMerchant ? "border-red-500 ring-1 ring-red-400/30" : ""}`}
          />
          {fieldErrors.newMerchant && (
            <p id="new-merchant-err" role="alert" className="mt-2 text-xs text-red-400 font-medium">
              {fieldErrors.newMerchant}
            </p>
          )}
        </div>

        {publicKey && !canSign && (
          <p role="alert" className="text-xs text-yellow-300">
            Connected wallet ({publicKey}) is neither the subscriber nor the
            current merchant — this transaction will fail to authorize.
          </p>
        )}

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
            disabled={isSubmitting || !publicKey}
            className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed py-3 text-sm font-semibold transition-colors min-h-[48px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {isSubmitting ? "Submitting…" : "Transfer Subscription"}
          </button>
        </div>
      </form>
    </div>
  );
}
