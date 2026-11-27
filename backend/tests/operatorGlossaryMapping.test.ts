/**
 * operatorGlossaryMapping.test.ts
 *
 * Automated test suite for Operator State Transition Glossary (#1632).
 * Asserts mapping between Contract Events, Backend State Machine, Webhook Payloads,
 * and Merchant UI display labels, including exceptional outcome transitions.
 */

import {
  STATE_GLOSSARY,
  EXCEPTIONAL_OUTCOMES,
  getMerchantDisplayLabel,
  validateStateCoverage,
  resolveGlossaryTransition,
} from '../src/lib/operatorStateGlossary';
import { SubscriptionState, SubscriptionEventType } from '../src/lib/subscriptionStateMachine';

describe('Operator State Transition Glossary (#1632)', () => {
  describe('Canonical state mapping and completeness', () => {
    it('every documented state maps to an implementation constant and definition', () => {
      const coverage = validateStateCoverage();
      expect(coverage.allStatesMapped).toBe(true);
      expect(coverage.coveredStates).toEqual(['ACTIVE', 'PAUSED', 'OVERDUE', 'CANCELLED', 'EXPIRED']);

      for (const state of coverage.coveredStates) {
        const item = STATE_GLOSSARY[state];
        expect(item.canonicalState).toBe(state);
        expect(item.contractEquivalent).toBeDefined();
        expect(item.backendModelValue).toBe(state);
        expect(item.merchantDisplayLabel).toBeDefined();
        expect(item.definition.length).toBeGreaterThan(15);
      }
    });

    it('accurately identifies terminal states vs ongoing states', () => {
      expect(STATE_GLOSSARY.ACTIVE.isTerminal).toBe(false);
      expect(STATE_GLOSSARY.PAUSED.isTerminal).toBe(false);
      expect(STATE_GLOSSARY.OVERDUE.isTerminal).toBe(false);
      expect(STATE_GLOSSARY.CANCELLED.isTerminal).toBe(true);
      expect(STATE_GLOSSARY.EXPIRED.isTerminal).toBe(true);
    });

    it('maps intentionally different merchant display labels correctly', () => {
      expect(getMerchantDisplayLabel('ACTIVE')).toBe('Active');
      expect(getMerchantDisplayLabel('PAUSED')).toBe('Paused');
      // Intentional difference: OVERDUE is displayed as "Past Due" to merchants
      expect(getMerchantDisplayLabel('OVERDUE')).toBe('Past Due');
      expect(getMerchantDisplayLabel('CANCELLED')).toBe('Cancelled');
      expect(getMerchantDisplayLabel('EXPIRED')).toBe('Expired');
    });

    it('associates appropriate webhook event types with state transitions', () => {
      expect(STATE_GLOSSARY.ACTIVE.webhookEvents).toContain('payment.executed');
      expect(STATE_GLOSSARY.OVERDUE.webhookEvents).toContain('payment.failed');
      expect(STATE_GLOSSARY.CANCELLED.webhookEvents).toContain('subscription.cancelled');
    });
  });

  describe('State transitions and exceptional outcomes', () => {
    it('handles happy-path payment execution from ACTIVE state', () => {
      const res = resolveGlossaryTransition('ACTIVE', 'executed');
      expect(res.nextState).toBe('ACTIVE');
      expect(res.isTerminal).toBe(false);
      expect(res.isExceptional).toBe(false);
      expect(res.displayLabel).toBe('Active');
    });

    it('transitions to OVERDUE on payment_transfer_failure (exceptional outcome)', () => {
      const res = resolveGlossaryTransition('ACTIVE', 'payment_transfer_failure');
      expect(res.nextState).toBe('OVERDUE');
      expect(res.isTerminal).toBe(false);
      expect(res.isExceptional).toBe(true);
      expect(res.displayLabel).toBe('Past Due');
    });

    it('recovers from OVERDUE to ACTIVE upon successful payment retry', () => {
      const res = resolveGlossaryTransition('OVERDUE', 'executed');
      expect(res.nextState).toBe('ACTIVE');
      expect(res.isTerminal).toBe(false);
      expect(res.displayLabel).toBe('Active');
    });

    it('transitions to CANCELLED on cancel event', () => {
      const res = resolveGlossaryTransition('ACTIVE', 'cancel');
      expect(res.nextState).toBe('CANCELLED');
      expect(res.isTerminal).toBe(true);
      expect(res.displayLabel).toBe('Cancelled');
    });

    it('transitions to EXPIRED on ttl_expired event', () => {
      const res = resolveGlossaryTransition('ACTIVE', 'ttl_expired');
      expect(res.nextState).toBe('EXPIRED');
      expect(res.isTerminal).toBe(true);
      expect(res.displayLabel).toBe('Expired');
    });

    it('enforces terminal state restrictions: CANCELLED cannot transition via normal execution', () => {
      const res = resolveGlossaryTransition('CANCELLED', 'executed');
      expect(res.nextState).toBeNull();
      expect(res.isExceptional).toBe(true);
      expect(res.displayLabel).toBe('Invalid Transition');
    });

    it('allows re-subscribe from terminal states to reactivate account', () => {
      const resCancelled = resolveGlossaryTransition('CANCELLED', 'subscribe');
      expect(resCancelled.nextState).toBe('ACTIVE');

      const resExpired = resolveGlossaryTransition('EXPIRED', 'subscribe');
      expect(resExpired.nextState).toBe('ACTIVE');
    });
  });

  describe('Exceptional outcomes directory', () => {
    it('defines causes, system impacts, and operator actions for all exceptional paths', () => {
      expect(EXCEPTIONAL_OUTCOMES.length).toBeGreaterThanOrEqual(4);

      for (const item of EXCEPTIONAL_OUTCOMES) {
        expect(item.trigger).toBeDefined();
        expect(item.initialState).toBeDefined();
        expect(item.terminalOrResultState).toBeDefined();
        expect(item.cause.length).toBeGreaterThan(10);
        expect(item.systemImpact.length).toBeGreaterThan(10);
        expect(item.operatorAction.length).toBeGreaterThan(10);
      }
    });
  });
});
