import type { Meta, StoryObj } from '@storybook/react';
import {
  SkeletonBlock,
  SkeletonLine,
  SkeletonBadge,
  SkeletonRow,
  SkeletonCard,
  SkeletonForm,
  SkeletonPaymentHistory,
  SkeletonMerchantSubscriberList,
  SkeletonSubscriptionList,
  SkeletonSubscriptionDetail,
  SkeletonTokenBalance,
  SkeletonFeeSimulation,
  SkeletonWallet,
  PageLoadingSkeleton,
} from '../components/Skeleton';

/**
 * Skeleton screen components for all async data-fetching views.
 *
 * Design rules:
 *  - Shape matches the loaded content layout
 *  - `animate-pulse` via Tailwind `motion-safe:animate-pulse`
 *  - `aria-busy="true"` on every loading container
 *  - Shown for a minimum of 200 ms (see `useMinLoadingDuration`)
 *
 * Issue: #1430 [UI/UX] Loading skeleton screens for all async components
 */
const meta: Meta = {
  title: 'Components/Skeleton',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    backgrounds: { default: 'dark' },
    docs: {
      description: {
        component:
          'Animated skeleton placeholder screens used instead of spinners while ' +
          'async data loads. Each component mirrors the shape of its loaded counterpart ' +
          'to minimise layout shift. All containers use `aria-busy="true"` for ' +
          'accessibility. Use `useMinLoadingDuration(isLoading)` to prevent a flash ' +
          'when data arrives in under 200 ms.',
      },
    },
  },
};

export default meta;

// ─── Primitives ───────────────────────────────────────────────────────────────

/** The base building block — a pulsing rounded rectangle. */
export const Block: StoryObj = {
  name: 'Primitive — SkeletonBlock',
  render: () => (
    <div className="flex flex-col gap-3 w-64 bg-gray-900 p-6 rounded-xl">
      <SkeletonBlock className="h-4 w-full" />
      <SkeletonBlock className="h-4 w-3/4" />
      <SkeletonBlock className="h-4 w-1/2" />
    </div>
  ),
};

/** Single line of placeholder text at different widths. */
export const Lines: StoryObj = {
  name: 'Primitive — SkeletonLine',
  render: () => (
    <div className="flex flex-col gap-2.5 w-72 bg-gray-900 p-6 rounded-xl">
      <SkeletonLine width="w-full" height="h-5" />
      <SkeletonLine width="w-3/4" height="h-4" />
      <SkeletonLine width="w-1/2" height="h-3" />
    </div>
  ),
};

/** Pill / badge placeholder. */
export const Badge: StoryObj = {
  name: 'Primitive — SkeletonBadge',
  render: () => (
    <div className="flex gap-3 bg-gray-900 p-6 rounded-xl">
      <SkeletonBadge />
      <SkeletonBadge className="w-16" />
      <SkeletonBadge className="w-10" />
    </div>
  ),
};

// ─── Payment History ──────────────────────────────────────────────────────────

/**
 * Payment History table rows skeleton.
 * Shown while `usePaymentHistory` is fetching executed-payment events.
 * Each row mirrors: tx hash | amount | timestamp | status badge.
 */
export const PaymentHistory: StoryObj = {
  name: 'Payment History — table rows',
  render: () => (
    <div className="w-[560px] bg-gray-950 p-6 rounded-2xl">
      <SkeletonPaymentHistory rows={5} />
    </div>
  ),
};

// ─── Merchant Portal ──────────────────────────────────────────────────────────

/**
 * Merchant Portal subscriber list skeleton.
 * Shown while `useMerchantSubscriptions` is loading subscriber data.
 * Each row mirrors: checkbox | address | amount | interval | next payment | status | collect button.
 */
export const MerchantPortal: StoryObj = {
  name: 'Merchant Portal — subscriber list',
  render: () => (
    <div className="w-[760px] bg-gray-950 p-6 rounded-2xl">
      <SkeletonMerchantSubscriberList rows={5} />
    </div>
  ),
};

// ─── My Subscriptions ─────────────────────────────────────────────────────────

/**
 * My Subscriptions list skeleton.
 * Shown while subscription state is being fetched from the chain.
 * Each card mirrors: merchant address + badge | amount + interval | next payment | actions.
 */
export const MySubscriptions: StoryObj = {
  name: 'My Subscriptions — list',
  render: () => (
    <div className="w-[520px] bg-gray-950 p-6 rounded-2xl">
      <SkeletonSubscriptionList cards={3} />
    </div>
  ),
};

// ─── Subscription Detail ──────────────────────────────────────────────────────

/**
 * Single subscription detail skeleton — shown while a specific subscription's
 * on-chain data (next payment date, amount, interval) is being fetched.
 */
export const SubscriptionDetail: StoryObj = {
  name: 'Subscription Detail — next payment date',
  render: () => (
    <div className="w-[480px] bg-gray-950 p-6 rounded-2xl">
      <SkeletonSubscriptionDetail />
    </div>
  ),
};

// ─── Token Balance ────────────────────────────────────────────────────────────

/**
 * Token balance display skeleton.
 * Shown while the SEP-41 token balance is being read from the Soroban RPC.
 */
export const TokenBalance: StoryObj = {
  name: 'Token Balance — display',
  render: () => (
    <div className="w-[320px] bg-gray-950 p-6 rounded-2xl">
      <SkeletonTokenBalance />
    </div>
  ),
};

// ─── Wallet ───────────────────────────────────────────────────────────────────

/** Wallet connection area skeleton — shown while detecting Freighter. */
export const Wallet: StoryObj = {
  name: 'Wallet — connection area',
  render: () => (
    <div className="w-[360px] bg-gray-950 p-4 rounded-2xl">
      <SkeletonWallet />
    </div>
  ),
};

// ─── Fee Simulation ───────────────────────────────────────────────────────────

/** Fee simulation result skeleton — shown while simulateTransaction is pending. */
export const FeeSimulation: StoryObj = {
  name: 'Fee Simulation — result',
  render: () => (
    <div className="w-[340px] bg-gray-950 p-6 rounded-2xl">
      <SkeletonFeeSimulation />
    </div>
  ),
};

// ─── Form ─────────────────────────────────────────────────────────────────────

/** Full subscription form skeleton — shown while contract config is loading. */
export const Form: StoryObj = {
  name: 'Subscription Form — full skeleton',
  render: () => (
    <div className="w-[520px] bg-gray-950 p-4 rounded-2xl">
      <SkeletonForm />
    </div>
  ),
};

// ─── Card ─────────────────────────────────────────────────────────────────────

/** Card skeleton — generic subscription or history card placeholder. */
export const Card: StoryObj = {
  name: 'Generic Card',
  render: () => (
    <div className="w-[420px] bg-gray-950 p-6 rounded-2xl">
      <SkeletonCard lines={4} />
    </div>
  ),
};

// ─── Row ─────────────────────────────────────────────────────────────────────

/** Row skeleton — generic table/list row placeholder. */
export const Row: StoryObj = {
  name: 'Generic Row',
  render: () => (
    <div className="w-[520px] bg-gray-950 p-6 rounded-2xl space-y-3">
      <SkeletonRow columns={4} />
      <SkeletonRow columns={4} />
      <SkeletonRow columns={4} />
    </div>
  ),
};

// ─── Full page ────────────────────────────────────────────────────────────────

/** Full page skeleton — initial load before first render. */
export const FullPage: StoryObj = {
  name: 'Full Page Skeleton',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="bg-gray-950 min-h-screen">
      <PageLoadingSkeleton />
    </div>
  ),
};

// ─── All #1430 issue skeletons ────────────────────────────────────────────────

/**
 * All five issue-specified skeleton components rendered together for visual QA.
 */
export const AllIssueSkeletons: StoryObj = {
  name: 'All Issue #1430 Skeletons',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="bg-gray-950 min-h-screen p-8 space-y-10">
      <h1 className="text-white text-2xl font-bold">#1430 Skeleton Screens</h1>

      <section>
        <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-4">Payment History — table rows</h2>
        <SkeletonPaymentHistory rows={3} />
      </section>

      <section>
        <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-4">Merchant Portal — subscriber list</h2>
        <SkeletonMerchantSubscriberList rows={3} />
      </section>

      <section>
        <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-4">My Subscriptions — list</h2>
        <SkeletonSubscriptionList cards={2} />
      </section>

      <section>
        <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-4">Token Balance Display</h2>
        <SkeletonTokenBalance className="max-w-sm" />
      </section>

      <section>
        <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-4">Subscription Detail — next payment date</h2>
        <SkeletonSubscriptionDetail className="max-w-lg" />
      </section>
    </div>
  ),
};
