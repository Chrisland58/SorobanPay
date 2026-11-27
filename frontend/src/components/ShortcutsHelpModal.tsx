'use client';

import { useDialogFocus } from '@/hooks/useDialogFocus';

/**
 * ShortcutsHelpModal.tsx
 *
 * Accessible modal that lists all registered keyboard shortcuts.
 * - Triggered by pressing "?" (shift+/)
 * - Closed via Escape, the × button, or clicking the backdrop
 * - Focus is trapped inside the modal while it is open
 * - Returns focus to the previously focused element on close
 * - Announces itself to screen readers via role="dialog" + aria-modal
 */

import { useEffect, useRef, useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { SHORTCUT_DEFINITIONS, type ShortcutDefinition } from '@/hooks/useKeyboardShortcuts';

interface ShortcutsHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<ShortcutDefinition['category'], string> = {
  actions: 'Actions',
  navigation: 'Navigation',
  modal: 'Interface',
};

const CATEGORY_ORDER: ShortcutDefinition['category'][] = ['actions', 'navigation', 'modal'];

/** Group shortcuts by category while preserving display order */
function groupShortcuts(
  defs: ShortcutDefinition[],
): Map<ShortcutDefinition['category'], ShortcutDefinition[]> {
  const map = new Map<ShortcutDefinition['category'], ShortcutDefinition[]>();
  for (const cat of CATEGORY_ORDER) {
    const items = defs.filter((d) => d.category === cat);
    if (items.length) map.set(cat, items);
  }
  return map;
}

/** Renders a single <kbd> key label */
function Key({ value }: { value: string }) {
  return (
    <kbd
      className="
        inline-flex items-center justify-center
        min-w-[2rem] px-1.5 py-0.5
        rounded border border-gray-500 bg-gray-700
        font-mono text-xs font-semibold text-gray-200
        shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.4)]
        select-none
      "
    >
      {value}
    </kbd>
  );
}

export default function ShortcutsHelpModal({ isOpen, onClose }: ShortcutsHelpModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  /** Element that had focus before the modal opened */
  // Register Escape to close when modal is open
  useHotkeys('escape', onClose, { enabled: isOpen, enableOnFormTags: true });

  // Focus management: move focus into modal on open, trap Tab/Escape, restore on close
  const { handleKeyDown } = useDialogFocus({
    isOpen,
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    onClose,
  });

  if (!isOpen) return null;

  const grouped = groupShortcuts(SHORTCUT_DEFINITIONS);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4"
      aria-hidden="false"
      onClick={onClose}
    >
      {/* Semi-transparent overlay */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        aria-describedby="shortcuts-modal-desc"
        className="
          relative z-10 flex h-dvh w-full max-w-none flex-col overflow-y-auto
          border border-gray-700 bg-gray-900 p-5 shadow-2xl
          sm:h-auto sm:max-w-md sm:rounded-2xl sm:p-6
          animate-in fade-in zoom-in-95 duration-150
        "
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2
              id="shortcuts-modal-title"
              className="text-lg font-bold text-white"
            >
              Keyboard Shortcuts
            </h2>
            <p
              id="shortcuts-modal-desc"
              className="text-xs text-gray-400 mt-0.5"
            >
              Shortcuts are disabled while typing in form fields.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close keyboard shortcuts help"
            className="
              rounded-lg p-1.5 text-gray-400 hover:text-white hover:bg-gray-700
              transition-colors focus:outline-none focus-visible:ring-2
              focus-visible:ring-blue-400
            "
          >
            {/* × icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Shortcut groups */}
        <div className="min-h-0 space-y-5 sm:min-h-fit">
          {Array.from(grouped.entries()).map(([category, shortcuts]) => (
            <section key={category} aria-labelledby={`shortcut-cat-${category}`}>
              <h3
                id={`shortcut-cat-${category}`}
                className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2"
              >
                {CATEGORY_LABELS[category]}
              </h3>
              <ul className="space-y-1.5" role="list">
                {shortcuts.map((s) => (
                  <li
                    key={s.key}
                    className="flex items-center justify-between gap-4 rounded-lg px-3 py-2 hover:bg-gray-800/60 transition-colors"
                  >
                    <span className="text-sm text-gray-200">{s.description}</span>
                    <Key value={s.key} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Footer hint */}
        <p className="mt-5 text-center text-xs text-gray-600">
          Press <Key value="?" /> or <Key value="Esc" /> to dismiss
        </p>
      </div>
    </div>
  );
}
