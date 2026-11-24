/**
 * operatorStateGlossary.ts
 *
 * Authoritative glossary mapping canonical states, transition triggers, terminal outcomes,
 * and merchant display labels across the Smart Contract, Backend State Machine,
 * Webhook Payloads, and Merchant UI.
 *
 * Implements acceptance criteria for Issue #1632.
 */

import {
  SubscriptionState,
  SubscriptionEventType,
  transition,
} from './subscriptionStateMachine';
import { WebhookEventType } from '../services/webhookNotifier';

export interface StateGlossaryItem {
  canonicalState: SubscriptionState;
  contractEquivalent: string;
  backendModelValue: string;
  webhookEvents: WebhookEventType[];
  merchantDisplayLabel: string;
  isTerminal: boolean;
  definition: string;
  transitionTriggers: SubscriptionEventType[];
}

export interface ExceptionalOutcomeEntry {
  trigger: SubscriptionEventType;
  initialState: SubscriptionState;
  terminalOrResultState: SubscriptionState;
  cause: string;
  systemImpact: string;
  operatorAction: string;
}

/**
 * Canonical dictionary mapping every documented state to implementation constants.
 */
export const STATE_GLOSSARY: Record<SubscriptionState, StateGlossaryItem> = {
  ACTIVE: {
    canonicalState: 'ACTIVE',
    contractEquivalent: 'SubscriptionData exists with next_payment >= current_ledger_time',
    backendModelValue: 'ACTIVE',
    webhookEvents: ['payment.executed'],
    merchantDisplayLabel: 'Active',
    isTerminal: false,
    definition: 'Subscription is in good standing. Scheduled charges are eligible to execute on or after next_payment.',
    transitionTriggers: ['subscribe', 'executed'],
  },
  PAUSED: {
    canonicalState: 'PAUSED',
    contractEquivalent: 'paused contract event / paused storage flag',
    backendModelValue: 'PAUSED',
    webhookEvents: [],
    merchantDisplayLabel: 'Paused',
    isTerminal: false,
    definition: 'Billing is temporarily suspended by subscriber or merchant request until an explicit resume.',
    transitionTriggers: ['cancel', 'ttl_expired', 'subscribe'],
  },
  OVERDUE: {
    canonicalState: 'OVERDUE',
    contractEquivalent: 'payment_transfer_failure contract event',
    backendModelValue: 'OVERDUE',
    webhookEvents: ['payment.failed'],
    merchantDisplayLabel: 'Past Due',
    isTerminal: false,
    definition: 'Payment execution failed (insufficient subscriber balance or allowance). A retry grace period is active.',
    transitionTriggers: ['payment_transfer_failure'],
  },
  CANCELLED: {
    canonicalState: 'CANCELLED',
    contractEquivalent: 'cancel contract event / storage entry deleted on-chain',
    backendModelValue: 'CANCELLED',
    webhookEvents: ['subscription.cancelled'],
    merchantDisplayLabel: 'Cancelled',
    isTerminal: true,
    definition: 'Terminated by subscriber or merchant. On-chain entry is removed. Cannot execute payments.',
    transitionTriggers: ['cancel'],
  },
  EXPIRED: {
    canonicalState: 'EXPIRED',
    contractEquivalent: 'ttl_expired / Soroban ledger archival',
    backendModelValue: 'EXPIRED',
    webhookEvents: [],
    merchantDisplayLabel: 'Expired',
    isTerminal: true,
    definition: 'Storage TTL reached 0 without extension, or horizon elapsed. Requires new subscription.',
    transitionTriggers: ['ttl_expired'],
  },
};

/**
 * Mapping of exceptional outcomes and operator recovery paths.
 */
export const EXCEPTIONAL_OUTCOMES: ExceptionalOutcomeEntry[] = [
  {
    trigger: 'payment_transfer_failure',
    initialState: 'ACTIVE',
    terminalOrResultState: 'OVERDUE',
    cause: 'Subscriber token balance or SEP-41 allowance is lower than required payment amount.',
    systemImpact: 'Next payment is deferred; webhook `payment.failed` is enqueued for merchant alerting.',
    operatorAction: 'Notify subscriber to replenish wallet or extend allowance before grace period expires.',
  },
  {
    trigger: 'payment_transfer_failure',
    initialState: 'OVERDUE',
    terminalOrResultState: 'OVERDUE',
    cause: 'Repeated payment failure during background retry worker execution.',
    systemImpact: 'Retry backoff increments; if max attempts exceeded, marked for manual review.',
    operatorAction: 'Check subscriber balance on Stellar expert; verify token contract status.',
  },
  {
    trigger: 'ttl_expired',
    initialState: 'ACTIVE',
    terminalOrResultState: 'EXPIRED',
    cause: 'Contract storage entry was not extended and was archived by Soroban network.',
    systemImpact: 'Entry cannot be read directly via get_subscription without state restoration.',
    operatorAction: 'Run restoreFootprint or prompt subscriber to re-subscribe.',
  },
  {
    trigger: 'cancel',
    initialState: 'OVERDUE',
    terminalOrResultState: 'CANCELLED',
    cause: 'Subscriber or merchant cancels subscription while in past-due state.',
    systemImpact: 'Pending retries are evicted from queue; webhook `subscription.cancelled` is dispatched.',
    operatorAction: 'Cease SaaS service delivery; reconcile outstanding balance in off-chain billing.',
  },
];

/**
 * Translate backend state to merchant user interface display label.
 * Specifically handles intentionally different user-facing terminology (e.g. OVERDUE -> 'Past Due').
 */
export function getMerchantDisplayLabel(state: SubscriptionState): string {
  const item = STATE_GLOSSARY[state];
  return item ? item.merchantDisplayLabel : state;
}

/**
 * Validate that every documented state maps to an implementation constant or event.
 */
export function validateStateCoverage(): {
  allStatesMapped: boolean;
  coveredStates: SubscriptionState[];
} {
  const canonicalStates: SubscriptionState[] = ['ACTIVE', 'PAUSED', 'OVERDUE', 'CANCELLED', 'EXPIRED'];
  const covered = canonicalStates.filter((st) => Boolean(STATE_GLOSSARY[st]));

  return {
    allStatesMapped: covered.length === canonicalStates.length,
    coveredStates: covered,
  };
}

/**
 * Predict next state and exceptional outcome based on event.
 */
export function resolveGlossaryTransition(
  currentState: SubscriptionState,
  event: SubscriptionEventType,
): {
  nextState: SubscriptionState | null;
  isTerminal: boolean;
  isExceptional: boolean;
  displayLabel: string;
} {
  const next = transition(currentState, event);
  if (!next) {
    return {
      nextState: null,
      isTerminal: false,
      isExceptional: true,
      displayLabel: 'Invalid Transition',
    };
  }

  const glossaryItem = STATE_GLOSSARY[next];
  const isExceptional = EXCEPTIONAL_OUTCOMES.some(
    (e) => e.initialState === currentState && e.trigger === event && e.terminalOrResultState === next,
  );

  return {
    nextState: next,
    isTerminal: glossaryItem.isTerminal,
    isExceptional,
    displayLabel: glossaryItem.merchantDisplayLabel,
  };
}
