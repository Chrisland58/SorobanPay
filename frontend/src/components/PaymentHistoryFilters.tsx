'use client';

/**
 * PaymentHistoryFilters.tsx
 *
 * Filter panel for the payment history list.
 *
 * Controls:
 *  - Date range picker (from / to date inputs)
 *  - Event type multi-select (executed / failed / cancelled)
 *  - Merchant address search (debounced in the hook)
 *  - Amount range (min / max in token units)
 *  - Token contract address filter
 *  - "Clear all filters" button
 *
 * Filter state is managed externally via the usePaymentHistoryFilters hook
 * and persisted in the URL query string.
 *
 * Issue: #1435
 */

import type {
  PaymentHistoryFilterState,
  EventTypeFilter,
} from '@/hooks/usePaymentHistoryFilters';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PaymentHistoryFiltersProps {
  filters: PaymentHistoryFilterState;
  onFilterChange: <K extends keyof PaymentHistoryFilterState>(
    key: K,
    value: PaymentHistoryFilterState[K],
  ) => void;
  onToggleEventType: (type: EventTypeFilter) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
  /** Total unfiltered event count — shown in the result count badge */
  totalCount: number;
  /** Filtered event count */
  filteredCount: number;
}

// ── Event type options ────────────────────────────────────────────────────────

const EVENT_TYPE_OPTIONS: { value: EventTypeFilter; label: string; color: string }[] = [
  {
    value: 'executed',
    label: 'Executed',
    color: 'text-green-300 border-green-700/40 bg-green-900/20 data-[active=true]:bg-green-800/50',
  },
  {
    value: 'payment_transfer_failure',
    label: 'Failed',
    color: 'text-red-300 border-red-700/40 bg-red-900/20 data-[active=true]:bg-red-800/50',
  },
  {
    value: 'cancel',
    label: 'Cancelled',
    color: 'text-gray-300 border-gray-700 bg-gray-800/40 data-[active=true]:bg-gray-700/60',
  },
];

// ── Shared field label ────────────────────────────────────────────────────────

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-medium text-gray-400 mb-1"
    >
      {children}
    </label>
  );
}

// ── Shared text input ─────────────────────────────────────────────────────────

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  'aria-label': ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'date' | 'number';
  'aria-label'?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs text-gray-200 placeholder-gray-600
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                 [color-scheme:dark]"
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PaymentHistoryFilters({
  filters,
  onFilterChange,
  onToggleEventType,
  onClear,
  hasActiveFilters,
  totalCount,
  filteredCount,
}: PaymentHistoryFiltersProps) {
  return (
    <div
      aria-label="Payment history filters"
      className="rounded-2xl border border-gray-800 bg-gray-900/50 p-4 space-y-4"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 text-gray-400"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              d="M2 4h12M4 8h8M6 12h4"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-sm font-semibold text-gray-200">Filters</span>

          {hasActiveFilters && (
            <span
              aria-live="polite"
              className="ml-1 rounded-full bg-blue-700/40 border border-blue-600/40 px-2 py-0.5 text-xs font-medium text-blue-300"
            >
              {filteredCount} / {totalCount}
            </span>
          )}
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear all filters"
            className="text-xs text-gray-400 hover:text-white underline underline-offset-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Filter grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Date from */}
        <div>
          <Label htmlFor="filter-date-from">From date</Label>
          <TextInput
            id="filter-date-from"
            type="date"
            value={filters.dateFrom}
            onChange={(v) => onFilterChange('dateFrom', v)}
            aria-label="Filter from date"
          />
        </div>

        {/* Date to */}
        <div>
          <Label htmlFor="filter-date-to">To date</Label>
          <TextInput
            id="filter-date-to"
            type="date"
            value={filters.dateTo}
            onChange={(v) => onFilterChange('dateTo', v)}
            aria-label="Filter to date"
          />
        </div>

        {/* Merchant address search */}
        <div className="sm:col-span-2 lg:col-span-1">
          <Label htmlFor="filter-merchant">Merchant address</Label>
          <TextInput
            id="filter-merchant"
            value={filters.merchantSearch}
            onChange={(v) => onFilterChange('merchantSearch', v)}
            placeholder="Search by address or label…"
            aria-label="Search by merchant address"
          />
        </div>

        {/* Amount min */}
        <div>
          <Label htmlFor="filter-amount-min">Min amount</Label>
          <TextInput
            id="filter-amount-min"
            type="number"
            value={filters.amountMin}
            onChange={(v) => onFilterChange('amountMin', v)}
            placeholder="0"
            aria-label="Minimum payment amount"
          />
        </div>

        {/* Amount max */}
        <div>
          <Label htmlFor="filter-amount-max">Max amount</Label>
          <TextInput
            id="filter-amount-max"
            type="number"
            value={filters.amountMax}
            onChange={(v) => onFilterChange('amountMax', v)}
            placeholder="Any"
            aria-label="Maximum payment amount"
          />
        </div>

        {/* Token filter */}
        <div>
          <Label htmlFor="filter-token">Token contract</Label>
          <TextInput
            id="filter-token"
            value={filters.tokenFilter}
            onChange={(v) => onFilterChange('tokenFilter', v)}
            placeholder="Contract address (C…)"
            aria-label="Filter by token contract address"
          />
        </div>
      </div>

      {/* Event type multi-select */}
      <div>
        <p className="text-xs font-medium text-gray-400 mb-2" id="event-type-label">
          Event type
        </p>
        <div
          role="group"
          aria-labelledby="event-type-label"
          className="flex flex-wrap gap-2"
        >
          {EVENT_TYPE_OPTIONS.map((opt) => {
            const isActive = filters.eventTypes.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                role="checkbox"
                aria-checked={isActive}
                data-active={isActive}
                onClick={() => onToggleEventType(opt.value)}
                className={[
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                  opt.color,
                  isActive ? 'ring-1 ring-offset-1 ring-offset-gray-900 ring-current' : '',
                ].join(' ')}
              >
                {isActive && (
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 12 12"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default PaymentHistoryFilters;
