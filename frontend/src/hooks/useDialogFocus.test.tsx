import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useDialogFocus } from './useDialogFocus';

function TestDialog({
  isOpen,
  onClose,
  useInitialRef = false,
  fallbackRef,
  empty = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  useInitialRef?: boolean;
  fallbackRef?: React.RefObject<HTMLElement | null>;
  empty?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef<HTMLButtonElement>(null);

  const { handleKeyDown } = useDialogFocus({
    isOpen,
    containerRef,
    initialFocusRef: useInitialRef ? initialRef : undefined,
    fallbackFocusRef: fallbackRef,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      onKeyDown={handleKeyDown}
      data-testid="dialog"
    >
      {!empty && (
        <>
          <button type="button" data-testid="first-btn">
            First
          </button>
          <button type="button" ref={initialRef} data-testid="second-btn">
            Second
          </button>
          <button type="button" onClick={onClose} data-testid="close-btn">
            Close
          </button>
        </>
      )}
    </div>
  );
}

describe('useDialogFocus', () => {
  it('moves focus into the dialog on open and restores to trigger on Escape and close button', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
            Open
          </button>
          <TestDialog isOpen={open} onClose={() => setOpen(false)} />
        </div>
      );
    }

    render(<Harness />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByTestId('first-btn'));

    // Dismiss via Escape
    fireEvent.keyDown(screen.getByTestId('dialog'), { key: 'Escape' });
    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // Re-open and dismiss via close button
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByTestId('first-btn'));
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(document.activeElement).toBe(trigger);
  });

  it('focuses initialFocusRef when provided and falls back to container when empty', () => {
    const { rerender } = render(<TestDialog isOpen={true} onClose={jest.fn()} useInitialRef />);
    expect(document.activeElement).toBe(screen.getByTestId('second-btn'));

    rerender(<TestDialog isOpen={false} onClose={jest.fn()} />);
    rerender(<TestDialog isOpen={true} onClose={jest.fn()} empty />);
    expect(document.activeElement).toBe(screen.getByTestId('dialog'));
  });

  it('traps Tab and Shift+Tab within the dialog', () => {
    render(<TestDialog isOpen={true} onClose={jest.fn()} />);
    const dialog = screen.getByTestId('dialog');
    const first = screen.getByTestId('first-btn');
    const close = screen.getByTestId('close-btn');

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('restores focus to fallbackFocusRef when the triggering element is removed from the DOM', () => {
    function Harness() {
      const [showTrigger, setShowTrigger] = useState(true);
      const [open, setOpen] = useState(false);
      const fallbackRef = useRef<HTMLButtonElement>(null);

      return (
        <div>
          <button type="button" ref={fallbackRef} data-testid="fallback">
            Fallback
          </button>
          {showTrigger && (
            <button
              type="button"
              data-testid="ephemeral-trigger"
              onClick={() => {
                setOpen(true);
                setShowTrigger(false);
              }}
            >
              Open
            </button>
          )}
          <TestDialog isOpen={open} onClose={() => setOpen(false)} fallbackRef={fallbackRef} />
        </div>
      );
    }

    render(<Harness />);
    const trigger = screen.getByTestId('ephemeral-trigger');
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByTestId('close-btn'));
    expect(document.activeElement).toBe(screen.getByTestId('fallback'));
  });

  it('restores focus in LIFO order for nested dialogs without losing page context', () => {
    function NestedHarness() {
      const [outerOpen, setOuterOpen] = useState(false);
      const [innerOpen, setInnerOpen] = useState(false);
      const outerRef = useRef<HTMLDivElement>(null);
      const innerRef = useRef<HTMLDivElement>(null);

      const outerFocus = useDialogFocus({
        isOpen: outerOpen,
        containerRef: outerRef,
        onClose: () => setOuterOpen(false),
      });
      const innerFocus = useDialogFocus({
        isOpen: innerOpen,
        containerRef: innerRef,
        onClose: () => setInnerOpen(false),
      });

      return (
        <div>
          <button type="button" data-testid="page-trigger" onClick={() => setOuterOpen(true)}>
            Open Outer
          </button>
          {outerOpen && (
            <div ref={outerRef} role="dialog" onKeyDown={outerFocus.handleKeyDown} data-testid="outer">
              <button type="button" data-testid="open-inner" onClick={() => setInnerOpen(true)}>
                Open Inner
              </button>
            </div>
          )}
          {innerOpen && (
            <div ref={innerRef} role="dialog" onKeyDown={innerFocus.handleKeyDown} data-testid="inner">
              <button type="button" data-testid="close-inner" onClick={() => setInnerOpen(false)}>
                Close Inner
              </button>
            </div>
          )}
        </div>
      );
    }

    render(<NestedHarness />);
    const pageTrigger = screen.getByTestId('page-trigger');
    pageTrigger.focus();
    fireEvent.click(pageTrigger);
    expect(document.activeElement).toBe(screen.getByTestId('open-inner'));

    fireEvent.click(screen.getByTestId('open-inner'));
    expect(document.activeElement).toBe(screen.getByTestId('close-inner'));

    // Closing inner dialog restores focus to outer dialog's trigger
    fireEvent.keyDown(screen.getByTestId('inner'), { key: 'Escape' });
    expect(screen.queryByTestId('inner')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('open-inner'));

    // Closing outer dialog restores focus to page trigger
    fireEvent.keyDown(screen.getByTestId('outer'), { key: 'Escape' });
    expect(screen.queryByTestId('outer')).toBeNull();
    expect(document.activeElement).toBe(pageTrigger);
  });
});
