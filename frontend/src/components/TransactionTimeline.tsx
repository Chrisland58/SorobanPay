'use client';

/**
 * TransactionTimeline.tsx
 *
 * Animated 4-step timeline showing the transaction journey after a
 * subscription is successfully created on Stellar / Soroban.
 *
 * Steps:
 *   1. Transaction signed (Freighter)
 *   2. Submitted to Stellar RPC
 *   3. Included in ledger
 *   4. Subscription active
 *
 * Each step animates in with a 500 ms sequential delay.
 * The final step links to Stellar Expert.
 * Animation is disabled when the user prefers reduced motion.
 *
 * Print styles: @media print — all steps shown statically with no animation.
 *
 * Issue: #1434
 */

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Delay between each step appearing, in milliseconds */
const STEP_DELAY_MS = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransactionTimelineProps {
  /** Stellar transaction hash — used to build the Stellar Expert link */
  txHash: string;
  /**
   * ISO-8601 timestamp when the SuccessCard mounted (i.e. when the tx was
   * confirmed). Each step timestamp is derived from this base.
   */
  confirmedAt?: string;
  /** "Testnet" or "Mainnet" — determines the Stellar Expert network slug */
  networkName?: string;
}

interface TimelineStep {
  id: string;
  icon: string;
  label: string;
  /** Offset in seconds from confirmedAt to display as the step timestamp */
  offsetSeconds: number;
  /** If true, a link to Stellar Expert is shown below the label */
  showExplorerLink?: boolean;
}

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS: TimelineStep[] = [
  {
    id: 'signed',
    icon: '✍️',
    label: 'Transaction signed in Freighter',
    offsetSeconds: -6,
  },
  {
    id: 'submitted',
    icon: '📡',
    label: 'Submitted to Stellar RPC',
    offsetSeconds: -4,
  },
  {
    id: 'included',
    icon: '📦',
    label: 'Included in ledger',
    offsetSeconds: -2,
  },
  {
    id: 'active',
    icon: '✅',
    label: 'Subscription active',
    offsetSeconds: 0,
    showExplorerLink: true,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function explorerUrl(txHash: string, networkName: string): string {
  const net = networkName.toLowerCase() === 'mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${net}/tx/${txHash}`;
}

function formatStepTime(baseIso: string, offsetSeconds: number): string {
  try {
    const base = new Date(baseIso);
    if (isNaN(base.getTime())) return '';
    const d = new Date(base.getTime() + offsetSeconds * 1000);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

// ── Step variants (Framer Motion) ─────────────────────────────────────────────

const stepVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0 },
};

const connectorVariants = {
  hidden: { scaleY: 0, originY: 0 },
  visible: { scaleY: 1, originY: 0 },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function TransactionTimeline({
  txHash,
  confirmedAt,
  networkName = 'Testnet',
}: TransactionTimelineProps) {
  const prefersReduced = useReducedMotion();

  // Track which steps have been revealed
  const [revealedCount, setRevealedCount] = useState(prefersReduced ? STEPS.length : 0);

  const baseTime = confirmedAt ?? new Date().toISOString();

  // Sequence steps with 500 ms delay each
  useEffect(() => {
    if (prefersReduced) {
      setRevealedCount(STEPS.length);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    let count = 0;

    function revealNext() {
      count += 1;
      setRevealedCount(count);
      if (count < STEPS.length) {
        timer = setTimeout(revealNext, STEP_DELAY_MS);
      }
    }

    // Kick off the first reveal immediately
    timer = setTimeout(revealNext, STEP_DELAY_MS);

    return () => clearTimeout(timer);
  }, [prefersReduced]);

  return (
    <section
      aria-label="Transaction timeline"
      className="space-y-0 print:space-y-2"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-green-300 mb-3">
        Transaction journey
      </p>

      <ol className="relative list-none m-0 p-0">
        {STEPS.map((step, idx) => {
          const isRevealed = idx < revealedCount;
          const isLast = idx === STEPS.length - 1;
          const timestamp = formatStepTime(baseTime, step.offsetSeconds);

          return (
            <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
              {/* Vertical connector line */}
              {!isLast && (
                <div className="absolute left-[17px] top-7 bottom-0 w-px overflow-hidden print:opacity-100">
                  <motion.div
                    className="w-full h-full bg-green-700/50"
                    variants={connectorVariants}
                    initial="hidden"
                    animate={isRevealed ? 'visible' : 'hidden'}
                    transition={
                      prefersReduced
                        ? { duration: 0 }
                        : { duration: 0.3, ease: 'easeOut', delay: 0.1 }
                    }
                    aria-hidden="true"
                  />
                </div>
              )}

              {/* Step content */}
              <motion.div
                className="flex gap-3 items-start w-full"
                variants={stepVariants}
                initial="hidden"
                animate={isRevealed ? 'visible' : 'hidden'}
                transition={
                  prefersReduced
                    ? { duration: 0 }
                    : { duration: 0.25, ease: 'easeOut' }
                }
                aria-hidden={!isRevealed}
              >
                {/* Icon bubble */}
                <div
                  className={[
                    'flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full border-2 text-base transition-all duration-300 print:opacity-100',
                    isRevealed
                      ? isLast
                        ? 'border-green-500 bg-green-900/60 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                        : 'border-green-600/70 bg-green-900/40'
                      : 'border-gray-700 bg-gray-800/60 opacity-30',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {step.icon}
                </div>

                {/* Label + timestamp */}
                <div className="pt-1 space-y-0.5">
                  <p
                    className={[
                      'text-sm font-medium transition-colors duration-300',
                      isRevealed
                        ? isLast
                          ? 'text-green-300'
                          : 'text-gray-200'
                        : 'text-gray-600',
                    ].join(' ')}
                  >
                    {step.label}
                  </p>

                  {timestamp && isRevealed && (
                    <p className="text-xs text-gray-500 tabular-nums" aria-label={`Step time: ${timestamp}`}>
                      {timestamp}
                    </p>
                  )}

                  {step.showExplorerLink && txHash && isRevealed && (
                    <a
                      href={explorerUrl(txHash, networkName)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded mt-0.5 print:text-blue-600"
                      aria-label={`View transaction ${txHash} on Stellar Expert (opens in new tab)`}
                    >
                      View on Stellar Expert
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        aria-hidden="true"
                      >
                        <path d="M2 10L10 2M10 2H4M10 2v6" />
                      </svg>
                    </a>
                  )}
                </div>
              </motion.div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default TransactionTimeline;
