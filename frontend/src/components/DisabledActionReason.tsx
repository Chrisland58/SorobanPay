'use client';

import React from 'react';

export interface DisabledReasonRule {
  /** Condition under which the action is blocked. */
  when: boolean;
  /** Concise explanation of why the action is currently disabled. */
  reason: string;
  /** Actionable next step to unblock the control. */
  nextStep: string;
}

export interface DisabledReasonResult {
  reason: string;
  nextStep: string;
}

/**
 * Evaluates ordered eligibility rules and returns the first matching
 * disabled reason and recovery path, or `null` when the action is eligible.
 */
export function getFirstDisabledReason(
  rules: DisabledReasonRule[]
): DisabledReasonResult | null {
  for (const rule of rules) {
    if (rule.when) {
      return { reason: rule.reason, nextStep: rule.nextStep };
    }
  }
  return null;
}

interface DisabledActionReasonProps {
  /** DOM id referenced by the controlled button's `aria-describedby`. */
  id: string;
  /** Concise explanation of why the action is disabled. */
  reason?: string | null;
  /** Relevant next step / recovery path for the user. */
  nextStep?: string | null;
  /** Optional extra Tailwind classes. */
  className?: string;
}

/**
 * Accessible inline explanation for a disabled critical action.
 * Renders nothing when `reason` is empty or omitted.
 */
export default function DisabledActionReason({
  id,
  reason,
  nextStep,
  className = '',
}: DisabledActionReasonProps) {
  if (!reason) {
    return null;
  }

  return (
    <p
      id={id}
      role="status"
      aria-live="polite"
      className={`mt-2 text-xs text-amber-300/90 flex items-start gap-1.5 ${className}`.trim()}
    >
      <span aria-hidden="true" className="shrink-0 leading-4">
        ⓘ
      </span>
      <span>
        <span className="font-medium">{reason}</span>
        {nextStep ? (
          <span className="text-gray-300"> {nextStep}</span>
        ) : null}
      </span>
    </p>
  );
}
