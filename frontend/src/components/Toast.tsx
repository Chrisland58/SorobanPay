'use client';

/**
 * Toast.tsx
 *
 * Auto-dismissing toast notification system.
 *
 * Issue: #1431 [UI/UX] Toast notification system for non-critical feedback
 *
 * Behaviour per issue spec:
 *  - Appears bottom-right, stacks vertically
 *  - Success / info / warning: auto-dismiss after 4 s
 *  - Error: requires manual dismiss (no auto-dismiss)
 *  - Maximum 3 toasts visible at once (oldest removed when limit exceeded)
 *  - role="status" for success/info/warning (polite), role="alert" for error (assertive)
 *
 * Accessibility:
 *  - role="status" + aria-live="polite"  for non-critical feedback
 *  - role="alert"  + aria-live="assertive" for errors
 *  - Dismiss button with aria-label
 *  - Shrinking progress bar communicates remaining time visually
 *
 * Usage:
 *   const { showToast } = useToast();
 *   showToast({ variant: 'success', message: 'Copied to clipboard' });
 *   showToast({ variant: 'error',   message: 'Transfer failed', action: 'Check balance and retry' });
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = 'error' | 'success' | 'warning' | 'info';

export interface ToastData {
  id: string;
  variant: ToastVariant;
  /** Main message describing what happened */
  message: string;
  /** Actionable guidance for the user */
  action?: string;
  /** Optional link to docs */
  docsUrl?: string;
  /**
   * Auto-dismiss delay in ms.
   * - success / info / warning: defaults to 4 000 ms
   * - error: defaults to Infinity (manual dismiss required)
   */
  duration?: number;
}

export interface ShowToastOptions {
  variant: ToastVariant;
  message: string;
  action?: string;
  docsUrl?: string;
  /** Override the default duration. Pass Infinity to require manual dismiss. */
  duration?: number;
}

interface ToastContextValue {
  showToast: (opts: ShowToastOptions) => void;
  dismissToast: (id: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of toasts shown simultaneously per issue spec. */
const MAX_TOASTS = 3;

/** Default auto-dismiss for non-error variants (ms). */
const SUCCESS_DURATION_MS = 4_000;

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

const NO_OP_TOAST: ToastContextValue = {
  showToast: () => {},
  dismissToast: () => {},
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  // Graceful fallback outside provider (e.g. in isolated component tests)
  return ctx ?? NO_OP_TOAST;
}

// ─── Resolve duration ─────────────────────────────────────────────────────────

function resolveDuration(opts: ShowToastOptions): number {
  if (opts.duration !== undefined) return opts.duration;
  // Error toasts require manual dismiss per issue spec
  if (opts.variant === 'error') return Infinity;
  return SUCCESS_DURATION_MS;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const VARIANT_STYLES: Record<
  ToastVariant,
  { container: string; icon: string; title: string }
> = {
  error: {
    container: 'bg-red-950/95 border-red-600/70 shadow-red-950/50',
    icon: '❌',
    title: 'text-red-300',
  },
  success: {
    container: 'bg-green-950/95 border-green-600/70 shadow-green-950/50',
    icon: '✓',
    title: 'text-green-300',
  },
  warning: {
    container: 'bg-yellow-950/95 border-yellow-600/70 shadow-yellow-950/50',
    icon: '⚠️',
    title: 'text-yellow-300',
  },
  info: {
    container: 'bg-blue-950/95 border-blue-600/70 shadow-blue-950/50',
    icon: 'ℹ️',
    title: 'text-blue-300',
  },
};

// ─── Single Toast item ────────────────────────────────────────────────────────

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastData;
  onDismiss: (id: string) => void;
}) {
  const styles = VARIANT_STYLES[toast.variant];
  const duration = toast.duration ?? (toast.variant === 'error' ? Infinity : SUCCESS_DURATION_MS);
  const isError = toast.variant === 'error';
  const progressRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss timer — errors are never auto-dismissed
  useEffect(() => {
    if (!isFinite(duration)) return;
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, isError, onDismiss]);

  // Shrinking progress bar (only for auto-dismiss toasts)
  useEffect(() => {
    if (!isFinite(duration)) return;
    const el = progressRef.current;
    if (!el) return;
    el.style.transition = `width ${duration}ms linear`;
    void el.offsetWidth; // force reflow
    el.style.width = '0%';
  }, [duration]);

  return (
    <div
      // role="alert" (assertive) for errors; role="status" (polite) for everything else
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`
        w-full max-w-sm rounded-xl border shadow-xl
        ${styles.container}
        overflow-hidden
      `}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <span className="text-lg flex-shrink-0 mt-0.5" aria-hidden="true">
            {styles.icon}
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold leading-snug ${styles.title}`}>
              {toast.message}
            </p>
            {toast.action && (
              <p className="mt-1 text-xs text-gray-300 leading-relaxed">
                {toast.action}
              </p>
            )}
            {toast.docsUrl && (
              <a
                href={toast.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block text-xs text-blue-400 hover:text-blue-300 underline
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
              >
                View troubleshooting docs ↗
              </a>
            )}
          </div>
          {/* Dismiss button — always visible for errors, visible on hover for others */}
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className={`
              flex-shrink-0 ml-1 -mt-0.5
              h-6 w-6 flex items-center justify-center
              rounded text-gray-400 hover:text-white
              hover:bg-white/10 transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50
              ${isError ? 'opacity-100' : 'opacity-60 hover:opacity-100'}
            `}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Auto-dismiss progress bar — hidden for error toasts */}
      {isFinite(duration) && (
        <div className="h-1 bg-white/10" aria-hidden="true">
          <div
            ref={progressRef}
            className="h-full bg-white/30 w-full"
          />
        </div>
      )}
    </div>
  );
}

// ─── Toast container ──────────────────────────────────────────────────────────

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-20 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-auto sm:bottom-6 sm:right-6"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────

let _idCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((opts: ShowToastOptions) => {
    const id = `toast-${++_idCounter}-${Date.now()}`;
    const duration = resolveDuration(opts);
    setToasts((prev) => {
      const updated = [...prev, { ...opts, id, duration }];
      // Cap at MAX_TOASTS — drop the oldest when the limit is exceeded
      return updated.length > MAX_TOASTS ? updated.slice(updated.length - MAX_TOASTS) : updated;
    });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}
