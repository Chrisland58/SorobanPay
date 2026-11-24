import type { Meta, StoryObj } from '@storybook/react';
import {
  EmptyPaymentHistory,
  EmptyMerchantSubscribers,
  EmptySubscriptions,
  EmptyNotifications,
  EmptyWebhookList,
  EmptyFilteredResults,
  EmptyAnalyticsState,
  EmptyPlansList,
} from '../components/EmptyState';

/**
 * Empty state components for all data-fetching views.
 *
 * Each variant includes:
 *  - An inline SVG illustration (dark/light mode compatible)
 *  - A descriptive, action-oriented message
 *  - A primary CTA button to guide the user to the next step
 *  - role="status" + aria-label for accessible announcements (WCAG 1.3.1)
 *
 * Issue: #1429 [UI/UX] Empty states for all data-fetching components
 */
const meta: Meta = {
  title: 'Components/EmptyState',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Informative empty states used when a data-fetching component returns ' +
          'zero results. Each variant provides an illustration, descriptive copy, ' +
          'and a CTA to guide the user forward. All variants use `role="status"` ' +
          'and a non-empty `aria-label` for screen reader accessibility.',
      },
    },
  },
};

export default meta;

// ─── Payment History ──────────────────────────────────────────────────────────

/**
 * Shown in the Payment History section when no executed payments exist yet.
 * Copy: "No payments yet. Create your first subscription above."
 */
export const PaymentHistory: StoryObj = {
  name: 'Payment History — empty',
  render: () => (
    <div className="w-[480px] bg-gray-950 p-8 rounded-2xl">
      <EmptyPaymentHistory onCreateSubscription={() => alert('Navigate to subscription form')} />
    </div>
  ),
};

// ─── Merchant Portal ──────────────────────────────────────────────────────────

/**
 * Shown in the Merchant Portal when the connected merchant has no subscribers.
 * Copy: "No subscribers yet. Share your merchant address to get started."
 */
export const MerchantPortal: StoryObj = {
  name: 'Merchant Portal — no subscribers',
  render: () => (
    <div className="w-[480px] bg-gray-950 p-8 rounded-2xl">
      <EmptyMerchantSubscribers
        onShareLink={() => alert('Share merchant address')}
        onViewQR={() => alert('Show QR code')}
      />
    </div>
  ),
};

// ─── My Subscriptions ─────────────────────────────────────────────────────────

/**
 * Shown in the My Subscriptions list when the wallet has no active subscriptions.
 * Copy: "You have no active subscriptions. Create one above."
 */
export const MySubscriptions: StoryObj = {
  name: 'My Subscriptions — empty',
  render: () => (
    <div className="w-[480px] bg-gray-950 p-8 rounded-2xl">
      <EmptySubscriptions onCreate={() => alert('Navigate to subscription form')} />
    </div>
  ),
};

// ─── Notifications ────────────────────────────────────────────────────────────

/**
 * Shown in the Notification Centre when there are no unread notifications.
 * Copy: "No notifications."
 */
export const Notifications: StoryObj = {
  name: 'Notifications — empty',
  render: () => (
    <div className="w-[480px] bg-gray-950 p-8 rounded-2xl">
      <EmptyNotifications onExplore={() => alert('Navigate to subscriptions')} />
    </div>
  ),
};

// ─── Webhook List ─────────────────────────────────────────────────────────────

/**
 * Shown in the admin Webhook List when no webhook endpoints are registered.
 */
export const WebhookList: StoryObj = {
  name: 'Webhook List — empty',
  render: () => (
    <div className="w-[480px] bg-gray-950 p-8 rounded-2xl">
      <EmptyWebhookList onAddWebhook={() => alert('Open add-webhook form')} />
    </div>
  ),
};

// ─── Filtered Results ─────────────────────────────────────────────────────────

/**
 * Shown when a search or filter query returns zero results.
 */
export const FilteredResults: StoryObj = {
  name: 'Filtered Results — no matches',
  render: () => (
    <div className="w-[480px] bg-gray-950 p-8 rounded-2xl">
      <EmptyFilteredResults
        onClearFilters={() => alert('Clear filters')}
        onResetSearch={() => alert('Reset search')}
      />
    </div>
  ),
};

// ─── Analytics ───────────────────────────────────────────────────────────────

/**
 * Shown in the Analytics Dashboard when no payment data has been recorded yet.
 */
export const Analytics: StoryObj = {
  name: 'Analytics — no data',
  render: () => (
    <div className="w-[480px] bg-gray-950 p-8 rounded-2xl">
      <EmptyAnalyticsState onGetStarted={() => alert('Open integration guide')} />
    </div>
  ),
};

// ─── Plans List ───────────────────────────────────────────────────────────────

/**
 * Shown in the Plans section when a merchant has not created any pricing tiers.
 */
export const PlansList: StoryObj = {
  name: 'Plans List — empty',
  render: () => (
    <div className="w-[480px] bg-gray-950 p-8 rounded-2xl">
      <EmptyPlansList
        onCreatePlan={() => alert('Create plan')}
        onImportTemplates={() => alert('Browse templates')}
      />
    </div>
  ),
};

// ─── All variants stacked ─────────────────────────────────────────────────────

/**
 * All four issue-specified empty states rendered side-by-side for visual QA.
 */
export const AllIssueVariants: StoryObj = {
  name: 'All Issue #1429 Variants',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="bg-gray-950 min-h-screen p-8">
      <h1 className="text-white text-2xl font-bold mb-8">#1429 Empty State Variants</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-gray-400 text-xs uppercase tracking-widest mb-4">Payment History</p>
          <EmptyPaymentHistory onCreateSubscription={() => {}} />
        </div>
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-gray-400 text-xs uppercase tracking-widest mb-4">Merchant Portal</p>
          <EmptyMerchantSubscribers onShareLink={() => {}} />
        </div>
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-gray-400 text-xs uppercase tracking-widest mb-4">My Subscriptions</p>
          <EmptySubscriptions onCreate={() => {}} />
        </div>
        <div className="bg-gray-900 rounded-2xl p-4">
          <p className="text-gray-400 text-xs uppercase tracking-widest mb-4">Notifications</p>
          <EmptyNotifications />
        </div>
      </div>
    </div>
  ),
};
