"use client";

/**
 * TransactionProgressIndicator.tsx
 *
 * Replaces simple spinner with informative progress indicator showing
 * current transaction state, steps completed, and estimated time remaining.
 * Provides better UX during transaction confirmation waiting.
 */

export interface TransactionProgressStep {
  /** Step ID */
  id: string;
  /** Display label */
  label: string;
  /** Step status */
  status: "pending" | "in-progress" | "completed" | "error";
  /** Optional error message */
  error?: string;
}

export interface TransactionProgressIndicatorProps {
  /** Transaction title */
  title: string;
  /** Transaction description */
  description?: string;
  /** Progress steps */
  steps: TransactionProgressStep[];
  /** Current step index */
  currentStepIndex: number;
  /** Whether to show explorer link */
  showExplorerLink?: boolean;
  /** Explorer URL (if showExplorerLink) */
  explorerUrl?: string;
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;
  /** Whether transaction has failed */
  isFailed?: boolean;
  /** Error message if failed */
  errorMessage?: string;
}

function getStepIcon(status: TransactionProgressStep["status"]) {
  switch (status) {
    case "completed":
      return (
        <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      );
    case "in-progress":
      return (
        <svg className="w-5 h-5 text-blue-500 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      );
    case "error":
      return (
        <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
      );
    default:
      return (
        <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
  }
}

function formatTimeRemaining(seconds?: number): string {
  if (!seconds) return "";
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes}m`;
}

export function TransactionProgressIndicator({
  title,
  description,
  steps,
  currentStepIndex,
  showExplorerLink = false,
  explorerUrl,
  estimatedTimeRemaining,
  isFailed = false,
  errorMessage,
}: TransactionProgressIndicatorProps) {
  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const totalSteps = steps.length;
  const progressPercent = Math.round((completedSteps / totalSteps) * 100);

  return (
    <div className="w-full max-w-lg mx-auto p-6">
      {/* Header */}
      <div className="mb-6 text-center">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between items-end mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Progress
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {completedSteps}/{totalSteps}
            {estimatedTimeRemaining && (
              <span className="ml-2">
                {formatTimeRemaining(estimatedTimeRemaining)}
              </span>
            )}
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isFailed ? "bg-red-500" : "bg-blue-500"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Steps timeline */}
      <div className="mb-6 space-y-3">
        {steps.map((step, index) => (
          <div key={step.id} className="flex gap-4">
            {/* Icon */}
            <div className="flex-shrink-0 pt-0.5">{getStepIcon(step.status)}</div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p
                  className={`font-medium ${
                    step.status === "completed"
                      ? "text-green-600 dark:text-green-400"
                      : step.status === "error"
                        ? "text-red-600 dark:text-red-400"
                        : step.status === "in-progress"
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-gray-600 dark:text-gray-400"
                  }`}
                >
                  {step.label}
                </p>
                <span
                  className={`text-xs font-semibold px-2 py-1 rounded ${
                    step.status === "completed"
                      ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
                      : step.status === "error"
                        ? "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
                        : step.status === "in-progress"
                          ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                  }`}
                >
                  {step.status === "completed"
                    ? "Done"
                    : step.status === "in-progress"
                      ? "In Progress"
                      : step.status === "error"
                        ? "Failed"
                        : "Pending"}
                </span>
              </div>

              {/* Error message for this step */}
              {step.error && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                  {step.error}
                </p>
              )}

              {/* Divider line (except last step) */}
              {index < steps.length - 1 && (
                <div
                  className="mt-3 ml-2.5 h-3 w-0.5 bg-gray-200 dark:bg-gray-700"
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Error state */}
      {isFailed && errorMessage && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
            Transaction Failed
          </p>
          <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
        </div>
      )}

      {/* Explorer link */}
      {showExplorerLink && explorerUrl && (
        <div className="mb-6 text-center">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium"
          >
            View on Explorer
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        </div>
      )}

      {/* Info text */}
      <div className="text-center text-xs text-gray-500 dark:text-gray-400">
        <p>
          {isFailed
            ? "Please try again or contact support if the issue persists."
            : "Please wait while your transaction is being confirmed on the blockchain."}
        </p>
      </div>
    </div>
  );
}
