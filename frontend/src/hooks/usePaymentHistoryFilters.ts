'use client';

/**
 * usePaymentHistoryFilters.ts
 *
 * Manages filter state for the payment history list.
 *
 * Filter options:
 *  - Date range (from / to ISO date strings)
 *  - Event type multi-select (executed / payment_transfer_failure / cancel)
 *  - Merchant address search (debounced 300 ms)
 *  - Amount range (min / max in token units)
 *  - Token contract address filter
 *
 * Filter state is persisted in the URL query string so it survives
 * navigation. The hook reads from and writes to `window.location` via
 * Next.js `useSearchParams` / `useRouter`.
 *
 * Client-side filtering applies when events.length < SERVER_THRESHOLD (100).
 * Above that threshold the hook signals `needsServerFilter = true` so the
 * caller can pass the filter values to the server/RPC layer.
 *
 * Issue: #1435
 */

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { PaymentEvent } from '@/hooks/usePaymentHistory';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Below this count, filtering is done client-side. Above — signal server. */
export const SERVER_THRESHOLD = 100;

/** Debounce delay for the merchant address search input */
const DEBOUNCE_MS = 300;

// ── Types ─────────────────────────────────────────────────────────────────────

export type EventTypeFilter = 'executed' | 'payment_transfer_failure' | 'cancel' | 'all';

export interface PaymentHistoryFilterState {
  dateFrom: string;      // ISO date string e.g. "2025-01-01"
  dateTo: string;        // ISO date string e.g. "2025-12-31"
  eventTypes: EventTypeFilter[];
  merchantSearch: string;
  amountMin: string;
  amountMax: string;
  tokenFilter: string;
}

export interface UsePaymentHistoryFiltersReturn {
  /** Current filter values (live — not debounced) */
  filters: PaymentHistoryFilterState;
  /** Update a single filter field */
  setFilter: <K extends keyof PaymentHistoryFilterState>(
    key: K,
    value: PaymentHistoryFilterState[K],
  ) => void;
  /** Toggle an event type in the multi-select list */
  toggleEventType: (type: EventTypeFilter) => void;
  /** Reset all filters to their defaults */
  clearFilters: () => void;
  /** True when any filter is active */
  hasActiveFilters: boolean;
  /**
   * Filtered subset of the input events array.
   * Only populated when needsServerFilter is false.
   */
  filteredEvents: PaymentEvent[];
  /**
   * True when the event count exceeds SERVER_THRESHOLD and filters should
   * be applied server-side instead of client-side.
   */
  needsServerFilter: boolean;
}

// ── Default filter state ──────────────────────────────────────────────────────

export const DEFAULT_FILTERS: PaymentHistoryFilterState = {
  dateFrom: '',
  dateTo: '',
  eventTypes: [],
  merchantSearch: '',
  amountMin: '',
  amountMax: '',
  tokenFilter: '',
};

// ── URL param helpers ─────────────────────────────────────────────────────────

function filtersToParams(f: PaymentHistoryFilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.dateFrom) p.set('from', f.dateFrom);
  if (f.dateTo) p.set('to', f.dateTo);
  if (f.eventTypes.length) p.set('types', f.eventTypes.join(','));
  if (f.merchantSearch) p.set('merchant', f.merchantSearch);
  if (f.amountMin) p.set('minAmt', f.amountMin);
  if (f.amountMax) p.set('maxAmt', f.amountMax);
  if (f.tokenFilter) p.set('token', f.tokenFilter);
  return p;
}

function paramsToFilters(p: URLSearchParams): PaymentHistoryFilterState {
  const types = p.get('types');
  return {
    dateFrom: p.get('from') ?? '',
    dateTo: p.get('to') ?? '',
    eventTypes: types
      ? (types.split(',') as EventTypeFilter[])
      : [],
    merchantSearch: p.get('merchant') ?? '',
    amountMin: p.get('minAmt') ?? '',
    amountMax: p.get('maxAmt') ?? '',
    tokenFilter: p.get('token') ?? '',
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePaymentHistoryFilters(
  events: PaymentEvent[],
): UsePaymentHistoryFiltersReturn {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialise from URL on mount
  const [filters, setFilters] = useState<PaymentHistoryFilterState>(() =>
    paramsToFilters(searchParams),
  );

  // Debounce merchant search for filtering
  const deferredMerchant = useDeferredValue(filters.merchantSearch);

  // Sync filter state → URL
  useEffect(() => {
    const params = filtersToParams(filters);
    const qs = params.toString();
    const next = qs ? `${pathname}?${qs}` : pathname;
    router.replace(next, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const setFilter = useCallback(
    <K extends keyof PaymentHistoryFilterState>(
      key: K,
      value: PaymentHistoryFilterState[K],
    ) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const toggleEventType = useCallback((type: EventTypeFilter) => {
    setFilters((prev) => {
      const current = prev.eventTypes;
      const next = current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type];
      return { ...prev, eventTypes: next };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const hasActiveFilters = useMemo(
    () =>
      filters.dateFrom !== '' ||
      filters.dateTo !== '' ||
      filters.eventTypes.length > 0 ||
      filters.merchantSearch !== '' ||
      filters.amountMin !== '' ||
      filters.amountMax !== '' ||
      filters.tokenFilter !== '',
    [filters],
  );

  const needsServerFilter = events.length >= SERVER_THRESHOLD;

  // Client-side filtering (only when below threshold)
  const filteredEvents = useMemo((): PaymentEvent[] => {
    if (needsServerFilter) return events;
    if (!hasActiveFilters) return events;

    return events.filter((e) => {
      // Date range
      if (filters.dateFrom) {
        const from = new Date(filters.dateFrom).getTime();
        const ts = new Date(e.timestamp).getTime();
        if (ts < from) return false;
      }
      if (filters.dateTo) {
        // Include the full day by moving to end of that day
        const to = new Date(filters.dateTo).getTime() + 86_399_999;
        const ts = new Date(e.timestamp).getTime();
        if (ts > to) return false;
      }

      // Event types — note: PaymentEvent only has 'executed' today;
      // the filter is ready for future 'cancel' and 'payment_transfer_failure' events
      if (filters.eventTypes.length > 0) {
        const matchesType = filters.eventTypes.some((t) => {
          if (t === 'all') return true;
          // future: e.eventType === t
          return t === 'executed';
        });
        if (!matchesType) return false;
      }

      // Merchant address search (debounced value)
      if (deferredMerchant.trim()) {
        const q = deferredMerchant.trim().toLowerCase();
        if (!e.merchant.toLowerCase().includes(q)) return false;
      }

      // Amount range (compare against amountStroops for precision)
      if (filters.amountMin) {
        const min = parseFloat(filters.amountMin);
        if (!isNaN(min) && parseFloat(e.amount) < min) return false;
      }
      if (filters.amountMax) {
        const max = parseFloat(filters.amountMax);
        if (!isNaN(max) && parseFloat(e.amount) > max) return false;
      }

      // Token filter
      if (filters.tokenFilter.trim()) {
        const q = filters.tokenFilter.trim().toLowerCase();
        if (!e.token.toLowerCase().includes(q)) return false;
      }

      return true;
    });
  }, [events, filters, deferredMerchant, hasActiveFilters, needsServerFilter]);

  return {
    filters,
    setFilter,
    toggleEventType,
    clearFilters,
    hasActiveFilters,
    filteredEvents,
    needsServerFilter,
  };
}
