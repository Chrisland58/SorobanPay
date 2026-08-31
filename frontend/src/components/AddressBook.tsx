"use client";

/**
 * AddressBook.tsx
 *
 * A modal component that lets users save and select frequently-used Stellar
 * addresses (merchants and token contracts).  Designed to be opened from any
 * address input field; calls onSelect(address) when the user picks an entry.
 *
 * Storage: entries are persisted to localStorage under the key
 * "sorobanpay:addressBook" so they survive page refreshes.
 *
 * Usage:
 *   <AddressBook
 *     isOpen={open}
 *     onClose={() => setOpen(false)}
 *     onSelect={(addr) => setMerchantAddress(addr)}
 *     title="Select merchant address"
 *   />
 */

import { useState, useEffect, useCallback, type KeyboardEvent } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AddressEntry {
  id: string;
  label: string;
  address: string;
  addedAt: number; // Unix timestamp ms
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

const STORAGE_KEY = "sorobanpay:addressBook";

function loadEntries(): AddressEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AddressEntry[];
  } catch {
    return [];
  }
}

function saveEntries(entries: AddressEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage quota exceeded or unavailable — fail silently
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AddressBookProps {
  /** Controls modal visibility */
  isOpen: boolean;
  /** Called when the modal should close */
  onClose: () => void;
  /**
   * Called with the selected address string when the user picks an entry.
   * The modal closes automatically after selection.
   */
  onSelect: (address: string) => void;
  /** Optional title shown in the modal header */
  title?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddressBook({
  isOpen,
  onClose,
  onSelect,
  title = "Address Book",
}: AddressBookProps) {
  const [entries, setEntries] = useState<AddressEntry[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [addError, setAddError] = useState("");
  const [search, setSearch] = useState("");

  // Load entries from localStorage when the modal opens
  useEffect(() => {
    if (isOpen) {
      setEntries(loadEntries());
      setSearch("");
      setLabelInput("");
      setAddressInput("");
      setAddError("");
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const handleSelect = useCallback(
    (entry: AddressEntry) => {
      onSelect(entry.address);
      onClose();
    },
    [onSelect, onClose],
  );

  function handleAdd() {
    const label = labelInput.trim();
    const address = addressInput.trim();

    if (!address) {
      setAddError("Address is required.");
      return;
    }
    // Basic Stellar address format check (G… account or C… contract)
    if (!/^[GC][A-Z2-7]{55}$/.test(address)) {
      setAddError("Enter a valid 56-character Stellar address (G… or C…).");
      return;
    }
    if (entries.some((e) => e.address === address)) {
      setAddError("This address is already saved.");
      return;
    }

    const newEntry: AddressEntry = {
      id: `${Date.now()}-${Math.random()}`,
      label: label || address.slice(0, 8) + "…",
      address,
      addedAt: Date.now(),
    };

    const updated = [...entries, newEntry];
    setEntries(updated);
    saveEntries(updated);
    setLabelInput("");
    setAddressInput("");
    setAddError("");
  }

  function handleDelete(id: string) {
    const updated = entries.filter((e) => e.id !== id);
    setEntries(updated);
    saveEntries(updated);
  }

  function handleAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  const filtered = search.trim()
    ? entries.filter(
        (e) =>
          e.label.toLowerCase().includes(search.toLowerCase()) ||
          e.address.toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="address-book-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-5 text-white max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 id="address-book-title" className="text-lg font-bold">
            📒 {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close address book"
            className="text-gray-400 hover:text-white transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Search */}
        <input
          type="search"
          placeholder="Search by label or address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          aria-label="Search saved addresses"
        />

        {/* Address list */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
          {filtered.length === 0 ? (
            <p className="text-center text-gray-500 text-sm py-6">
              {entries.length === 0
                ? "No saved addresses yet. Add one below."
                : "No addresses match your search."}
            </p>
          ) : (
            filtered.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700 rounded-lg px-3 py-2.5 transition-colors group"
              >
                <button
                  type="button"
                  onClick={() => handleSelect(entry)}
                  className="flex-1 text-left min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                  aria-label={`Select address ${entry.label}`}
                >
                  <p className="text-sm font-medium text-white truncate">
                    {entry.label}
                  </p>
                  <p className="text-xs text-gray-400 font-mono truncate">
                    {entry.address}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(entry.id)}
                  aria-label={`Remove ${entry.label} from address book`}
                  className="shrink-0 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded p-1"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add new entry */}
        <div className="border-t border-gray-700 pt-4 space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            Save new address
          </p>
          <input
            type="text"
            placeholder="Label (optional)"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={handleAddKeyDown}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            aria-label="Label for new address"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="G… or C… address"
              value={addressInput}
              onChange={(e) => {
                setAddressInput(e.target.value);
                if (addError) setAddError("");
              }}
              onKeyDown={handleAddKeyDown}
              aria-invalid={!!addError}
              aria-describedby={addError ? "add-error" : undefined}
              className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              aria-label="Stellar address to save"
            />
            <button
              type="button"
              onClick={handleAdd}
              className="shrink-0 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 px-4 py-2 text-sm font-semibold transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              Save
            </button>
          </div>
          {addError && (
            <p id="add-error" role="alert" className="text-xs text-red-400 font-medium">
              {addError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
