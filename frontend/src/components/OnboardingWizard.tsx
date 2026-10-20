'use client';

/**
 * OnboardingWizard.tsx — Issue #1428
 *
 * First-time user onboarding wizard shown on first visit.
 * Five steps:
 *  1. Install Freighter (with detection — skip if already installed)
 *  2. Switch to the correct Stellar network
 *  3. Fund your wallet (Friendbot link on testnet)
 *  4. Create your first subscription (pre-filled demo merchant + amount)
 *  5. Completion screen with links to docs
 *
 * Acceptance criteria:
 *  ✅ Shown on first visit via localStorage flag (`sorobanpay-wizard-seen`)
 *  ✅ Each step has a clear CTA button
 *  ✅ Wizard skippable at any point via "Skip" button or Escape key
 *  ✅ Progress indicator: "Step N of 5" + filled dot stepper
 *  ✅ Accessible: keyboard navigable (Tab, Shift+Tab, Enter, Escape),
 *     focus trapped inside modal, role="dialog", aria-labelledby,
 *     aria-describedby, aria-modal="true", screen-reader compatible.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent,
} from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const WIZARD_STORAGE_KEY = 'sorobanpay-wizard-seen';
const DEMO_MERCHANT = 'GDEMOMERCHANT...STELLAR';
const DEMO_AMOUNT = '10.00';
const DEMO_INTERVAL = '30 days';
const DOCS_URL =
  'https://github.com/Chrisland58/SorobanPay#quick-start-testnet-demo--5-minutes';
const FREIGHTER_URL = 'https://www.freighter.app';
const FRIENDBOT_URL =
  'https://laboratory.stellar.org/#account-creator?network=test';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WizardStep {
  id: number;
  title: string;
  description: string;
  /** Emoji rendered as the visual icon for the step */
  icon: string;
  /** Primary CTA rendered below the description */
  cta?: {
    label: string;
    href?: string;
    external?: boolean;
  };
  /** Secondary detail note rendered below the CTA */
  note?: string;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

function buildSteps(freighterDetected: boolean): WizardStep[] {
  return [
    {
      id: 1,
      title: freighterDetected
        ? 'Freighter Detected ✓'
        : 'Install Freighter Wallet',
      description: freighterDetected
        ? 'Great — Freighter is already installed. You can move to the next step.'
        : 'Freighter is a non-custodial browser extension for Stellar. It manages your keys and signs transactions without ever exposing your seed phrase.',
      icon: freighterDetected ? '✅' : '🔐',
      cta: freighterDetected
        ? undefined
        : {
            label: 'Install Freighter →',
            href: FREIGHTER_URL,
            external: true,
          },
      note: freighterDetected
        ? undefined
        : 'After installing, reload this page and return here.',
    },
    {
      id: 2,
      title: 'Switch to Testnet',
      description:
        'Open the Freighter extension and click the network selector in the top-right corner. Choose "Testnet" to connect to the Stellar testnet — the same network this app is configured for.',
      icon: '🌐',
      note: 'The app reads NEXT_PUBLIC_NETWORK_PASSPHRASE from .env.local. Make sure it matches the network selected in Freighter.',
    },
    {
      id: 3,
      title: 'Fund Your Wallet',
      description:
        'Your testnet wallet needs XLM to pay transaction fees. Use Stellar Friendbot — a free faucet that funds testnet accounts instantly. Copy your public key from Freighter, paste it on the Friendbot page, and click Fund.',
      icon: '💰',
      cta: {
        label: 'Open Friendbot (Testnet Faucet) →',
        href: FRIENDBOT_URL,
        external: true,
      },
      note: 'Friendbot only works on testnet. For mainnet you need real XLM (~2 XLM minimum for the base reserve).',
    },
    {
      id: 4,
      title: 'Create Your First Subscription',
      description:
        'Everything is ready! Connect your wallet on this page, then fill in the subscription form below. We have pre-filled a demo merchant and amount so you can try it right away.',
      icon: '✨',
      note: `Demo merchant: ${DEMO_MERCHANT}\nDemo amount: ${DEMO_AMOUNT} / ${DEMO_INTERVAL}`,
    },
    {
      id: 5,
      title: "You're All Set 🎉",
      description:
        'Welcome to SorobanPay! Your subscriptions are fully on-chain — no custodians, no pre-authorised transaction arrays, just your signature on every payment.',
      icon: '🚀',
      cta: {
        label: 'Read the full docs →',
        href: DOCS_URL,
        external: true,
      },
      note: 'Questions? Open an issue on GitHub or check the FAQ in the docs.',
    },
  ];
}

// ─── Focus trap hook ──────────────────────────────────────────────────────────

function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;

    const el = ref.current;
    const focusable = el.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Auto-focus first focusable element
    first?.focus();

    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Tab') return;
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [ref, active]);
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface OnboardingWizardProps {
  /** Whether Freighter is currently detected in the browser */
  freighterInstalled?: boolean;
  /** Called when the wizard is dismissed */
  onClose?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingWizard({
  freighterInstalled = false,
  onClose,
}: OnboardingWizardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [hasCompleted, setHasCompleted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const steps = buildSteps(freighterInstalled);
  const totalSteps = steps.length;

  // ── Initialise from localStorage ──────────────────────────────────────────
  useEffect(() => {
    try {
      const seen = localStorage.getItem(WIZARD_STORAGE_KEY);
      if (!seen) {
        setIsOpen(true);
      } else {
        setHasCompleted(true);
      }
    } catch {
      // localStorage may be unavailable in some environments; degrade gracefully
      setIsOpen(true);
    }
  }, []);

  // ── Close handler ──────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    try {
      localStorage.setItem(WIZARD_STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
    setIsOpen(false);
    setHasCompleted(true);
    onClose?.();
  }, [onClose]);

  // ── Escape key ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleClose]);

  // ── Focus trap ─────────────────────────────────────────────────────────────
  useFocusTrap(dialogRef, isOpen);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const goNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep((s) => s + 1);
    } else {
      handleClose();
    }
  };

  const goPrev = () => {
    if (currentStep > 1) setCurrentStep((s) => s - 1);
  };

  const goToStep = (n: number) => setCurrentStep(n);

  // ── Body scroll lock ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  const stepData = steps.find((s) => s.id === currentStep)!;
  const progress = (currentStep / totalSteps) * 100;

  // ── Re-open button (shown after first close) ───────────────────────────────
  const reopenButton = hasCompleted && !isOpen && (
    <div className="fixed bottom-6 right-6 z-40">
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Reopen onboarding wizard"
        title="Open the onboarding guide"
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 hover:bg-brand-500
                   active:bg-brand-700 px-4 py-2 text-xs font-semibold text-white shadow-lg
                   transition-colors duration-150
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <span aria-hidden="true" className="text-sm">?</span>
        Guide
      </button>
    </div>
  );

  if (!isOpen) return reopenButton ?? null;

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fadeIn"
        aria-hidden="true"
        onClick={handleClose}
      />

      {/* ── Dialog ── */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        aria-describedby="wizard-desc"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 pointer-events-none"
      >
        <div
          className="w-full max-w-lg pointer-events-auto animate-fadeIn
                     bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header bar ── */}
          <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
            {/* Step counter */}
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-widest">
              Step{' '}
              <span className="text-brand-400 font-bold">{currentStep}</span>
              {' '}of{' '}
              <span className="text-neutral-300">{totalSteps}</span>
            </span>

            {/* Close / skip */}
            <button
              onClick={handleClose}
              aria-label="Skip onboarding"
              className="rounded p-1 text-neutral-500 hover:text-neutral-200 transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1
                     0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414
                     1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586
                     10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {/* ── Progress bar ── */}
          <div
            className="mx-6 h-1.5 rounded-full bg-neutral-700 overflow-hidden"
            role="progressbar"
            aria-valuenow={currentStep}
            aria-valuemin={1}
            aria-valuemax={totalSteps}
            aria-label={`Step ${currentStep} of ${totalSteps}`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400
                         transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* ── Body ── */}
          <div className="px-6 pt-6 pb-2 space-y-4">
            {/* Icon + title */}
            <div className="flex items-center gap-3">
              <span className="text-4xl flex-shrink-0" aria-hidden="true">
                {stepData.icon}
              </span>
              <h2
                id="wizard-title"
                className="text-xl font-bold text-white leading-tight"
              >
                {stepData.title}
              </h2>
            </div>

            {/* Description */}
            <p
              id="wizard-desc"
              className="text-neutral-300 leading-relaxed text-sm"
            >
              {stepData.description}
            </p>

            {/* Note */}
            {stepData.note && (
              <div className="rounded-lg bg-neutral-800 border border-neutral-700 px-4 py-3">
                <p className="text-xs text-neutral-400 font-mono whitespace-pre-line leading-relaxed">
                  {stepData.note}
                </p>
              </div>
            )}

            {/* CTA */}
            {stepData.cta && (
              <a
                href={stepData.cta.href}
                target={stepData.cta.external ? '_blank' : undefined}
                rel={stepData.cta.external ? 'noopener noreferrer' : undefined}
                className="block w-full text-center rounded-lg bg-brand-600 hover:bg-brand-500
                           active:bg-brand-700 px-4 py-3 text-sm font-semibold text-white
                           transition-colors duration-150
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {stepData.cta.label}
              </a>
            )}
          </div>

          {/* ── Dot stepper ── */}
          <div
            className="flex items-center justify-center gap-1.5 px-6 pt-4"
            role="tablist"
            aria-label="Wizard steps"
          >
            {steps.map((step) => {
              const isActive = step.id === currentStep;
              const isCompleted = step.id < currentStep;
              return (
                <button
                  key={step.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`Go to step ${step.id}: ${step.title}`}
                  onClick={() => goToStep(step.id)}
                  className={[
                    'rounded-full transition-all duration-300',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                    isActive
                      ? 'w-6 h-2 bg-brand-400'
                      : isCompleted
                      ? 'w-2 h-2 bg-brand-600 hover:bg-brand-500'
                      : 'w-2 h-2 bg-neutral-600 hover:bg-neutral-500',
                  ].join(' ')}
                />
              );
            })}
          </div>

          {/* ── Navigation footer ── */}
          <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-6">
            <button
              onClick={goPrev}
              disabled={currentStep === 1}
              aria-label="Previous step"
              className="px-4 py-2 text-sm font-semibold text-neutral-300
                         hover:text-white disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors rounded
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              ← Back
            </button>

            <button
              onClick={handleClose}
              aria-label="Skip onboarding wizard"
              className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors
                         rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Skip
            </button>

            <button
              onClick={goNext}
              aria-label={
                currentStep === totalSteps ? 'Finish onboarding' : 'Next step'
              }
              className="px-4 py-2 text-sm font-semibold text-white
                         hover:text-brand-300 transition-colors rounded
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {currentStep === totalSteps ? 'Finish →' : 'Next →'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Screen-reader live region for step changes ── */}
      <div role="status" aria-live="polite" className="sr-only">
        Step {currentStep} of {totalSteps}: {stepData.title}
      </div>
    </>
  );
}
