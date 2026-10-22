import type { Meta, StoryObj } from '@storybook/react';
import { ToastProvider, useToast } from '../components/Toast';

/**
 * Toast notification system for non-critical feedback.
 *
 * Issue: #1431 [UI/UX] Toast notification system for non-critical feedback
 *
 * Behaviour:
 *  - Appears bottom-right, stacks up to 3 toasts
 *  - Success / info / warning: auto-dismiss after 4 s
 *  - Error: requires manual dismiss (no auto-dismiss)
 *  - role="status" for success/info/warning, role="alert" for error
 */
const meta: Meta = {
  title: 'Components/Toast',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Non-disruptive toast notifications for non-critical feedback. ' +
          'Success/info/warning variants auto-dismiss after 4 s. ' +
          'Error toasts require manual dismiss and use `role="alert"` for ' +
          'assertive screen reader announcement. Maximum 3 visible at once.',
      },
    },
  },
  decorators: [
    (Story) => (
      <ToastProvider>
        <div className="min-h-screen bg-gray-950 p-8">
          <Story />
        </div>
      </ToastProvider>
    ),
  ],
};

export default meta;

// ─── Trigger buttons ──────────────────────────────────────────────────────────

function ToastTriggers() {
  const { showToast } = useToast();
  return (
    <div className="flex flex-col gap-4 max-w-sm">
      <h2 className="text-white font-bold text-lg">#1431 Toast Use Cases</h2>

      {/* Use case 1: Copied to clipboard */}
      <button
        type="button"
        onClick={() => showToast({ variant: 'success', message: 'Copied to clipboard' })}
        className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white px-4 py-3 text-sm font-medium text-left border border-gray-700 transition-colors"
      >
        ✓ &nbsp;<strong>Copied to clipboard</strong>
        <span className="block text-xs text-gray-400 mt-0.5">CopyButton click — auto-dismiss 4 s</span>
      </button>

      {/* Use case 2: Webhook registered */}
      <button
        type="button"
        onClick={() => showToast({ variant: 'success', message: 'Webhook registered' })}
        className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white px-4 py-3 text-sm font-medium text-left border border-gray-700 transition-colors"
      >
        ✓ &nbsp;<strong>Webhook registered</strong>
        <span className="block text-xs text-gray-400 mt-0.5">After successful webhook registration</span>
      </button>

      {/* Use case 3: Subscription updated */}
      <button
        type="button"
        onClick={() => showToast({ variant: 'success', message: 'Subscription updated' })}
        className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white px-4 py-3 text-sm font-medium text-left border border-gray-700 transition-colors"
      >
        ✓ &nbsp;<strong>Subscription updated</strong>
        <span className="block text-xs text-gray-400 mt-0.5">After update_subscription succeeds</span>
      </button>

      {/* Use case 4: Payment collected */}
      <button
        type="button"
        onClick={() => showToast({ variant: 'success', message: 'Payment collected' })}
        className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white px-4 py-3 text-sm font-medium text-left border border-gray-700 transition-colors"
      >
        ✓ &nbsp;<strong>Payment collected</strong>
        <span className="block text-xs text-gray-400 mt-0.5">After execute_payment succeeds</span>
      </button>

      {/* Error — manual dismiss */}
      <button
        type="button"
        onClick={() =>
          showToast({
            variant: 'error',
            message: 'Transfer failed',
            action: 'Check your token balance and retry.',
          })
        }
        className="rounded-lg bg-red-950 hover:bg-red-900 text-white px-4 py-3 text-sm font-medium text-left border border-red-800 transition-colors"
      >
        ✗ &nbsp;<strong>Error toast (manual dismiss)</strong>
        <span className="block text-xs text-red-400 mt-0.5">No auto-dismiss, role=&quot;alert&quot;</span>
      </button>

      {/* Warning */}
      <button
        type="button"
        onClick={() =>
          showToast({
            variant: 'warning',
            message: 'Allowance is low',
            action: 'Your SEP-41 allowance may not cover the next payment.',
          })
        }
        className="rounded-lg bg-yellow-950 hover:bg-yellow-900 text-white px-4 py-3 text-sm font-medium text-left border border-yellow-800 transition-colors"
      >
        ⚠ &nbsp;<strong>Warning toast</strong>
        <span className="block text-xs text-yellow-400 mt-0.5">Auto-dismiss 4 s, role=&quot;status&quot;</span>
      </button>

      {/* Stack limit */}
      <button
        type="button"
        onClick={() => {
          showToast({ variant: 'success', message: 'Toast 1' });
          showToast({ variant: 'success', message: 'Toast 2' });
          showToast({ variant: 'success', message: 'Toast 3' });
          showToast({ variant: 'info',    message: 'Toast 4 — oldest removed (max 3)' });
        }}
        className="rounded-lg bg-blue-950 hover:bg-blue-900 text-white px-4 py-3 text-sm font-medium text-left border border-blue-800 transition-colors"
      >
        ℹ &nbsp;<strong>Overflow test — max 3 visible</strong>
        <span className="block text-xs text-blue-400 mt-0.5">Fires 4 toasts; oldest is dropped</span>
      </button>
    </div>
  );
}

export const AllUseCases: StoryObj = {
  name: 'All Issue #1431 Use Cases',
  render: () => <ToastTriggers />,
};

// ─── Individual variant stories ───────────────────────────────────────────────

function SingleToastDemo({
  variant,
  message,
  action,
}: {
  variant: 'success' | 'error' | 'warning' | 'info';
  message: string;
  action?: string;
}) {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() => showToast({ variant, message, action })}
      className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 text-sm font-medium border border-gray-700"
    >
      Show {variant} toast
    </button>
  );
}

export const SuccessToast: StoryObj = {
  name: 'Success — auto-dismiss 4 s',
  render: () => <SingleToastDemo variant="success" message="Copied to clipboard" />,
};

export const ErrorToast: StoryObj = {
  name: 'Error — manual dismiss required',
  render: () => (
    <SingleToastDemo
      variant="error"
      message="Transfer failed"
      action="Check your token balance and retry."
    />
  ),
};

export const WarningToast: StoryObj = {
  name: 'Warning — auto-dismiss 4 s',
  render: () => (
    <SingleToastDemo
      variant="warning"
      message="Allowance is low"
      action="Your SEP-41 allowance may not cover the next payment."
    />
  ),
};

export const InfoToast: StoryObj = {
  name: 'Info — auto-dismiss 4 s',
  render: () => <SingleToastDemo variant="info" message="Syncing subscription state…" />,
};
