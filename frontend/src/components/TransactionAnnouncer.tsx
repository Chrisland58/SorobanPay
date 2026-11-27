"use client";

import { useEffect, useRef, useState } from "react";

export type TransactionLifecycleState =
  | "idle"
  | "signing"
  | "submitted"
  | "confirmed"
  | "failed";

export interface TransactionAnnouncerProps {
  /** Current transaction lifecycle state */
  state: TransactionLifecycleState;
  /** Optional error detail when state is "failed" */
  errorMessage?: string;
  /** Optional custom next-action hint to override the default for the current state */
  nextAction?: string;
}

const DEFAULT_ANNOUNCEMENTS: Record<
  Exclude<TransactionLifecycleState, "idle">,
  { message: string; defaultNextAction: string }
> = {
  signing: {
    message: "Transaction awaiting signature.",
    defaultNextAction: "Check your wallet extension to approve or reject.",
  },
  submitted: {
    message: "Transaction submitted to the network.",
    defaultNextAction: "Waiting for on-chain confirmation.",
  },
  confirmed: {
    message: "Transaction confirmed on-chain.",
    defaultNextAction: "You can view the receipt or continue.",
  },
  failed: {
    message: "Transaction failed.",
    defaultNextAction: "Review the error details and try again.",
  },
};

/**
 * Announces transaction lifecycle state transitions to assistive technology
 * exactly once per transition, preventing repeated announcements during polling.
 *
 * - Polite live region (`role="status"`, `aria-live="polite"`) for signing, submitted, confirmed.
 * - Assertive live region (`role="alert"`, `aria-live="assertive"`) for failed.
 */
export function TransactionAnnouncer({
  state,
  errorMessage,
  nextAction,
}: TransactionAnnouncerProps) {
  const lastAnnouncedKeyRef = useRef<string>("");
  const [politeAnnouncement, setPoliteAnnouncement] = useState<string>("");
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState<string>("");

  useEffect(() => {
    if (state === "idle") {
      lastAnnouncedKeyRef.current = "idle";
      setPoliteAnnouncement("");
      setAssertiveAnnouncement("");
      return;
    }

    const dedupeKey =
      state === "failed"
        ? `${state}:${errorMessage ?? ""}:${nextAction ?? ""}`
        : `${state}:${nextAction ?? ""}`;

    if (lastAnnouncedKeyRef.current === dedupeKey) {
      return;
    }

    lastAnnouncedKeyRef.current = dedupeKey;

    const { message, defaultNextAction } = DEFAULT_ANNOUNCEMENTS[state];
    const actionText = nextAction ?? defaultNextAction;

    if (state === "failed") {
      const detail = errorMessage ? ` ${errorMessage}.` : "";
      setPoliteAnnouncement("");
      setAssertiveAnnouncement(`${message}${detail} ${actionText}`);
    } else {
      setAssertiveAnnouncement("");
      setPoliteAnnouncement(`${message} ${actionText}`);
    }
  }, [state, errorMessage, nextAction]);

  return (
    <div className="sr-only" data-testid="transaction-announcer">
      <div role="status" aria-live="polite" aria-atomic="true">
        {politeAnnouncement}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {assertiveAnnouncement}
      </div>
    </div>
  );
}
