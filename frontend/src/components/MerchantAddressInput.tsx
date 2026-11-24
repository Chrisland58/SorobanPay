'use client';

/**
 * MerchantAddressInput.tsx
 *
 * Merchant address text field with an integrated address-book dropdown.
 *
 * Features:
 *  - Address book entries surfaced as a searchable dropdown on focus or typing
 *  - Shows label + truncated address per option
 *  - "Add to address book" button when the current value is a valid G-address
 *    and is not already saved
 *  - Opens the full AddressBookModal for management
 *  - Keyboard navigation: ArrowDown/Up to move, Enter to select, Escape to close
 *  - Accessible: combobox ARIA pattern (role="combobox", role="listbox", etc.)
 *  - Works standalone — bring your own useAddressBook hook result
 *
 * Issue: #1436
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
} from 'react';
import type { AddressBookEntry, UseAddressBookReturn } from '@/hooks/useAddressBook';
import { AddressBookModal } from '@/components/AddressBookModal';
import { truncateAddress } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MerchantAddressInputProps {
  /** Current field value */
  value: string;
  /** Called when the value changes (typed or picked from dropdown) */
  onChange: (value: string) => void;
  /** Address book hook result */
  addressBook: UseAddressBookReturn;
  /** HTML id for the input element */
  id?: string;
  /** Whether the field has a validation error */
  hasError?: boolean;
  /** aria-describedby value */
  ariaDescribedBy?: string;
  /** Additional className on the outer wrapper */
  className?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidGAddress(v: string): boolean {
  return v.startsWith('G') && v.trim().length === 56;
}

function filterEntries(
  entries: AddressBookEntry[],
  query: string,
): AddressBookEntry[] {
  if (!query.trim()) return entries;
  const q = query.toLowerCase();
  return entries.filter(
    (e) =>
      e.label.toLowerCase().includes(q) ||
      e.address.toLowerCase().includes(q),
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MerchantAddressInput({
  value,
  onChange,
  addressBook,
  id = 'merchant-address-input',
  hasError = false,
  ariaDescribedBy,
  className = '',
}: MerchantAddressInputProps) {
  const {
    entryList,
    addEntry,
    updateEntry,
    deleteEntry,
    importBook,
    exportBook,
    entries,
    getLabel,
  } = addressBook;

  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [addedFeedback, setAddedFeedback] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listId = `${id}-listbox`;

  const options = filterEntries(entryList, value);
  const canAdd = isValidGAddress(value) && !entries[value.trim()];
  const savedLabel = getLabel(value.trim());

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Scroll active option into view
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const li = listRef.current.children[activeIndex] as HTMLElement | undefined;
    li?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const openDropdown = useCallback(() => {
    if (entryList.length > 0) {
      setIsOpen(true);
      setActiveIndex(-1);
    }
  }, [entryList.length]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
  }, []);

  const selectOption = useCallback(
    (entry: AddressBookEntry) => {
      onChange(entry.address);
      closeDropdown();
      inputRef.current?.focus();
    },
    [onChange, closeDropdown],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      onChange(v);
      const filtered = filterEntries(entryList, v);
      setIsOpen(filtered.length > 0);
      setActiveIndex(-1);
    },
    [onChange, entryList],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          openDropdown();
        }
        return;
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, options.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, -1));
          break;
        case 'Enter':
          if (activeIndex >= 0 && options[activeIndex]) {
            e.preventDefault();
            selectOption(options[activeIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          closeDropdown();
          break;
        case 'Tab':
          closeDropdown();
          break;
      }
    },
    [isOpen, activeIndex, options, openDropdown, selectOption, closeDropdown],
  );

  const handleAddToBook = useCallback(() => {
    const label = prompt('Enter a label for this address:');
    if (label?.trim()) {
      addEntry(value.trim(), label.trim());
      setAddedFeedback(true);
      setTimeout(() => setAddedFeedback(false), 2500);
    }
  }, [value, addEntry]);

  const inputBase =
    'w-full rounded-lg border bg-gray-800/60 px-3 py-2.5 pr-10 text-sm text-gray-100 ' +
    'placeholder-gray-600 focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-blue-400 transition-colors';
  const inputCls = hasError
    ? `${inputBase} border-red-600/70 focus-visible:ring-red-400`
    : `${inputBase} border-gray-700`;

  const activeOptionId =
    activeIndex >= 0 && options[activeIndex]
      ? `${listId}-option-${activeIndex}`
      : undefined;

  return (
    <>
      <div ref={wrapperRef} className={`relative ${className}`}>
        {/* Input */}
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-haspopup="listbox"
          aria-describedby={ariaDescribedBy}
          aria-invalid={hasError}
          value={value}
          onChange={handleInputChange}
          onFocus={openDropdown}
          onKeyDown={handleKeyDown}
          placeholder="GABC…WXYZ"
          autoComplete="off"
          spellCheck={false}
          className={inputCls}
        />

        {/* Address book icon button */}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Open address book"
          onClick={() => {
            closeDropdown();
            setIsModalOpen(true);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5
                     text-gray-500 hover:text-gray-300 hover:bg-gray-700/50
                     transition-colors focus:outline-none focus-visible:ring-2
                     focus-visible:ring-blue-400"
          title="Address book"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
          </svg>
        </button>

        {/* Dropdown listbox */}
        {isOpen && options.length > 0 && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Saved merchant addresses"
            className="absolute z-30 mt-1 w-full rounded-xl border border-gray-700
                       bg-gray-900 shadow-xl overflow-hidden max-h-56 overflow-y-auto"
          >
            {options.map((entry, idx) => {
              const isActive = idx === activeIndex;
              return (
                <li
                  key={entry.address}
                  id={`${listId}-option-${idx}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(entry);
                  }}
                  className={[
                    'flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors',
                    isActive
                      ? 'bg-blue-700/30 text-white'
                      : 'hover:bg-gray-800 text-gray-200',
                  ].join(' ')}
                >
                  <span className="text-base shrink-0" aria-hidden="true">👤</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{entry.label}</p>
                    <p className="text-xs font-mono text-gray-500 truncate">
                      {truncateAddress(entry.address, 8)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Saved label indicator */}
        {savedLabel && !isOpen && (
          <p className="mt-1 text-xs text-green-400">
            📒 <span className="font-medium">{savedLabel}</span>
          </p>
        )}

        {/* "Add to address book" CTA */}
        {canAdd && !isOpen && (
          <div className="mt-1.5">
            {addedFeedback ? (
              <p className="text-xs text-green-400" role="status">
                ✓ Saved to address book
              </p>
            ) : (
              <button
                type="button"
                onClick={handleAddToBook}
                className="inline-flex items-center gap-1 text-xs text-blue-400
                           hover:text-blue-300 underline underline-offset-2 transition-colors
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                aria-label="Add this address to your address book"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3 w-3"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                    clipRule="evenodd"
                  />
                </svg>
                Add to address book
              </button>
            )}
          </div>
        )}
      </div>

      {/* Full address book modal */}
      <AddressBookModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        entries={entries}
        entryList={entryList}
        addEntry={addEntry}
        updateEntry={updateEntry}
        deleteEntry={deleteEntry}
        importBook={importBook}
        exportBook={exportBook}
        prefilledAddress={isValidGAddress(value) ? value : undefined}
      />
    </>
  );
}

export default MerchantAddressInput;
