# Dialog & Drawer Keyboard Focus Management

All modal dialogs and slide-over drawers in SorobanPay use the shared `useDialogFocus` hook (`frontend/src/hooks/useDialogFocus.ts`) to ensure predictable keyboard navigation and WCAG 2.1 focus-management compliance.

## Behavior

1. **Focus on Open**: When a dialog or drawer opens, the currently focused element (`document.activeElement`) is captured, and focus moves to `initialFocusRef` (if provided), the first focusable element inside `containerRef`, or `containerRef` itself (`tabIndex="-1"`).
2. **Focus Containment**: `Tab` and `Shift+Tab` wrap within the topmost open dialog/drawer.
3. **Dismissal**: Pressing `Escape` invokes `onClose` on the topmost open dialog/drawer only.
4. **Focus Restoration**: On close (via `Escape`, close button, or completion/unmount), focus is restored in order of preference to:
   - `returnFocusRef` (if provided and connected to the DOM)
   - The captured triggering element (if still connected to the DOM)
   - `fallbackFocusRef` (if provided and connected)
   - The page's `<main>` / `[role="main"]` landmark
5. **Nested & Sequential Dialogs**: An internal LIFO stack tracks open dialogs so nested modals restore focus to their parent modal on close, and sequential modals restore focus to the page trigger.
