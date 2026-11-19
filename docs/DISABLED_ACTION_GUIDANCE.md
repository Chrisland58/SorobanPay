# Disabled Action Inline Explanations

Critical actions (such as submitting, updating, or transferring a subscription) must never appear disabled without an inline explanation and recovery path.

## Pattern

1. **Derive reasons from the same eligibility rules** using `getFirstDisabledReason` in `frontend/src/components/DisabledActionReason.tsx`.
2. **Render `<DisabledActionReason />` adjacent to the disabled button** with a unique `id`.
3. **Link the button via `aria-describedby`** when disabled so keyboard and screen-reader users receive both the reason and the next step.
