import { useEffect, useRef, useCallback, type RefObject, type KeyboardEvent } from 'react';

/**
 * Standard selector for keyboard-focusable elements within a dialog or drawer.
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/**
 * Module-level stack of active dialog IDs so nested dialogs only trap/handle
 * keyboard events for the topmost dialog and restore focus in LIFO order.
 */
const activeDialogStack: symbol[] = [];

export interface UseDialogFocusOptions {
  /** Whether the dialog/drawer is currently open. Defaults to `true` (for conditionally mounted modals). */
  isOpen?: boolean;
  /** Ref to the dialog/drawer container element. */
  containerRef: RefObject<HTMLElement | null>;
  /** Optional ref to the element that should receive initial focus when opened. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Optional explicit ref to restore focus to on close (overrides captured activeElement). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Optional fallback ref if the triggering element is no longer in the DOM on close. */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  /** Optional callback invoked when Escape is pressed on the topmost dialog. */
  onClose?: () => void;
}

/**
 * Returns true if the element is connected to the DOM and not hidden via display:none / visibility:hidden.
 */
function isElementFocusable(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
  return true;
}

/**
 * Resolves a meaningful fallback element when the original trigger is no longer connected.
 */
function resolveFallbackElement(fallbackRef?: RefObject<HTMLElement | null>): HTMLElement | null {
  if (isElementFocusable(fallbackRef?.current)) {
    return fallbackRef.current;
  }
  if (typeof document === 'undefined') return null;

  const mainEl = document.querySelector<HTMLElement>('main, [role="main"]');
  if (mainEl && mainEl.isConnected) {
    if (!mainEl.hasAttribute('tabindex')) {
      mainEl.setAttribute('tabindex', '-1');
    }
    return mainEl;
  }

  return null;
}

/**
 * Manages keyboard focus for modal dialogs and drawers:
 * - Captures the triggering element before opening
 * - Moves focus into the dialog on open
 * - Traps Tab / Shift+Tab within the topmost open dialog
 * - Handles Escape to close the topmost dialog
 * - Restores focus to the triggering element (or a meaningful fallback) on close/unmount
 */
export function useDialogFocus({
  isOpen = true,
  containerRef,
  initialFocusRef,
  returnFocusRef,
  fallbackFocusRef,
  onClose,
}: UseDialogFocusOptions) {
  const dialogIdRef = useRef<symbol>(Symbol('dialog'));
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const restoreFocus = useCallback(() => {
    const id = dialogIdRef.current;
    const idx = activeDialogStack.lastIndexOf(id);
    if (idx !== -1) {
      activeDialogStack.splice(idx, 1);
    }

    const target =
      (isElementFocusable(returnFocusRef?.current) ? returnFocusRef.current : null) ??
      (isElementFocusable(priorFocusRef.current) && priorFocusRef.current !== document.body
        ? priorFocusRef.current
        : null) ??
      resolveFallbackElement(fallbackFocusRef);

    priorFocusRef.current = null;

    if (target) {
      target.focus({ preventScroll: true });
    }
  }, [returnFocusRef, fallbackFocusRef]);

  useEffect(() => {
    if (!isOpen) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        restoreFocus();
      }
      return;
    }

    wasOpenRef.current = true;
    const id = dialogIdRef.current;

    // Capture the currently focused element before moving focus into the dialog
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    priorFocusRef.current = active instanceof HTMLElement ? active : null;

    if (!activeDialogStack.includes(id)) {
      activeDialogStack.push(id);
    }

    // Move focus into the dialog
    const initialTarget =
      (isElementFocusable(initialFocusRef?.current) ? initialFocusRef.current : null) ??
      containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      null;

    if (initialTarget) {
      initialTarget.focus({ preventScroll: true });
    } else if (containerRef.current) {
      if (!containerRef.current.hasAttribute('tabindex')) {
        containerRef.current.setAttribute('tabindex', '-1');
      }
      containerRef.current.focus({ preventScroll: true });
    }

    return () => {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        restoreFocus();
      }
    };
  }, [isOpen, containerRef, initialFocusRef, restoreFocus]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      // Only the topmost dialog in the stack should handle Escape / Tab trapping
      const topId = activeDialogStack[activeDialogStack.length - 1];
      if (topId !== dialogIdRef.current) return;

      if (e.key === 'Escape') {
        if (onCloseRef.current) {
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (e.key === 'Tab' && containerRef.current) {
        const focusables = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => isElementFocusable(el));

        if (focusables.length === 0) {
          e.preventDefault();
          containerRef.current.focus({ preventScroll: true });
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !containerRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !containerRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [containerRef],
  );

  return { handleKeyDown };
}
