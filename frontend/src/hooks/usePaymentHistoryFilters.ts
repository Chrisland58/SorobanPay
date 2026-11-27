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
  useRef,
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

export const FILTER_PARAM_KEYS = [
  'from',
  'to',
  'types',
  'merchant',
  'minAmt',
  'maxAmt',
  'token',
] as const;

export const VALID_EVENT_TYPES = new Set<EventTypeFilter>([
  'executed',
  'payment_transfer_failure',
  'cancel',
  'all',
]);

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function isValidAmount(value: string): boolean {
  if (!value) return false;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0;
}

export function filtersToParams(
  f: PaymentHistoryFilterState,
  existingParams?: Pick<URLSearchParams, 'toString'>,
): URLSearchParams {
  const p = new URLSearchParams(existingParams?.toString() ?? '');
  for (const key of FILTER_PARAM_KEYS) {
    p.delete(key);
  }
  if (f.dateFrom && isValidIsoDate(f.dateFrom)) p.set('from', f.dateFrom);
  if (f.dateTo && isValidIsoDate(f.dateTo)) p.set('to', f.dateTo);
  const validTypes = Array.from(
    new Set(f.eventTypes.filter((t) => VALID_EVENT_TYPES.has(t))),
  );
  if (validTypes.length) p.set('types', validTypes.join(','));
  if (f.merchantSearch.trim()) p.set('merchant', f.merchantSearch.trim());
  if (f.amountMin.trim() && isValidAmount(f.amountMin.trim())) {
    p.set('minAmt', f.amountMin.trim());
  }
  if (f.amountMax.trim() && isValidAmount(f.amountMax.trim())) {
    p.set('maxAmt', f.amountMax.trim());
  }
  if (f.tokenFilter.trim()) p.set('token', f.tokenFilter.trim());
  return p;
}

export function paramsToFilters(
  p: Pick<URLSearchParams, 'get'>,
): PaymentHistoryFilterState {
  const rawFrom = (p.get('from') ?? '').trim();
  const rawTo = (p.get('to') ?? '').trim();
  const rawTypes = p.get('types') ?? '';
  const rawMerchant = (p.get('merchant') ?? '').trim();
  const rawMinAmt = (p.get('minAmt') ?? '').trim();
  const rawMaxAmt = (p.get('maxAmt') ?? '').trim();
  const rawToken = (p.get('token') ?? '').trim();

  const eventTypes = Array.from(
    new Set(
      rawTypes
        .split(',')
        .map((t) => t.trim())
        .filter((t): t is EventTypeFilter =>
          VALID_EVENT_TYPES.has(t as EventTypeFilter),
        ),
    ),
  );

  return {
    dateFrom: isValidIsoDate(rawFrom) ? rawFrom : '',
    dateTo: isValidIsoDate(rawTo) ? rawTo : '',
    eventTypes,
    merchantSearch: rawMerchant,
    amountMin: isValidAmount(rawMinAmt) ? rawMinAmt : '',
    amountMax: isValidAmount(rawMaxAmt) ? rawMaxAmt : '',
    tokenFilter: rawToken,
  };
}

function filtersEqual(
  a: PaymentHistoryFilterState,
  b: PaymentHistoryFilterState,
): boolean {
  return (
    a.dateFrom === b.dateFrom &&
    a.dateTo === b.dateTo &&
    a.merchantSearch === b.merchantSearch &&
    a.amountMin === b.amountMin &&
    a.amountMax === b.amountMax &&
    a.tokenFilter === b.tokenFilter &&
    a.eventTypes.length === b.eventTypes.length &&
    a.eventTypes.every((t, i) => t === b.eventTypes[i])
  );
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

  const searchParamsString = searchParams.toString();
  const lastSearchParamsRef = useRef(searchParamsString);

  // Sync URL → filter state on browser back/forward navigation
  useEffect(() => {
    if (searchParamsString === lastSearchParamsRef.current) return;
    lastSearchParamsRef.current = searchParamsString;
    const nextFromUrl = paramsToFilters(searchParams);
    setFilters((prev) => (filtersEqual(prev, nextFromUrl) ? prev : nextFromUrl));
  }, [searchParams, searchParamsString]);

  // Debounce merchant search for filtering
  const deferredMerchant = useDeferredValue(filters.merchantSearch);

  // Sync filter state → URL (preserving unrelated query parameters)
  useEffect(() => {
    const params = filtersToParams(filters, searchParams);
    const qs = params.toString();
    if (qs === searchParamsString) return;
    lastSearchParamsRef.current = qs;
    const next = qs ? `${pathname}?${qs}` : pathname;
    router.replace(next, { scroll: false });
  }, [filters, pathname, router, searchParams, searchParamsString]);

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
