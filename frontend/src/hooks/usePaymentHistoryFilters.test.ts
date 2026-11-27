/**
 * usePaymentHistoryFilters.test.ts
 *
 * Unit tests for URL query parameter serialization, validation,
 * browser back/forward navigation restoration, and reset behavior
 * in usePaymentHistoryFilters.
 *
 * Issue: #1662
 */

import { renderHook, act } from '@testing-library/react';
import {
  DEFAULT_FILTERS,
  filtersToParams,
  paramsToFilters,
  usePaymentHistoryFilters,
} from '@/hooks/usePaymentHistoryFilters';
import type { PaymentEvent } from '@/hooks/usePaymentHistory';

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();
let mockPathname = '/history';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

const SAMPLE_EVENTS: PaymentEvent[] = [
  {
    id: 'evt-1',
    txHash: '0xabc',
    timestamp: '2025-05-10T12:00:00.000Z',
    merchant: 'GMERCHANT1',
    amount: '10',
    amountStroops: '100000000',
    token: 'CUSDC',
    ledger: 100,
  },
  {
    id: 'evt-2',
    txHash: '0xdef',
    timestamp: '2025-06-15T12:00:00.000Z',
    merchant: 'GMERCHANT2',
    amount: '50',
    amountStroops: '500000000',
    token: 'CXLM',
    ledger: 101,
  },
];

describe('paramsToFilters', () => {
  it('parses valid filter query parameters', () => {
    const params = new URLSearchParams(
      'from=2025-01-01&to=2025-12-31&types=executed,cancel&merchant=GMERCH&minAmt=5&maxAmt=100&token=CUSDC',
    );
    expect(paramsToFilters(params)).toEqual({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      eventTypes: ['executed', 'cancel'],
      merchantSearch: 'GMERCH',
      amountMin: '5',
      amountMax: '100',
      tokenFilter: 'CUSDC',
    });
  });

  it('safely ignores invalid dates, event types, and amounts', () => {
    const params = new URLSearchParams(
      'from=not-a-date&to=2025-02-30&types=bogus,executed,unknown,executed&minAmt=-10&maxAmt=abc&merchant=%20%20&token=%20',
    );
    expect(paramsToFilters(params)).toEqual({
      dateFrom: '',
      dateTo: '',
      eventTypes: ['executed'],
      merchantSearch: '',
      amountMin: '',
      amountMax: '',
      tokenFilter: '',
    });
  });
});

describe('filtersToParams', () => {
  it('serializes only supported filter values and preserves unrelated params', () => {
    const existing = new URLSearchParams('tab=payments&page=2&from=2024-01-01');
    const next = filtersToParams(
      {
        ...DEFAULT_FILTERS,
        dateFrom: '2025-05-01',
        tokenFilter: 'CUSDC',
      },
      existing,
    );

    expect(next.get('tab')).toBe('payments');
    expect(next.get('page')).toBe('2');
    expect(next.get('from')).toBe('2025-05-01');
    expect(next.get('token')).toBe('CUSDC');
    expect(next.has('to')).toBe(false);
  });

  it('removes filter params on reset while keeping unrelated route state', () => {
    const existing = new URLSearchParams(
      'tab=payments&from=2025-05-01&types=executed&token=CUSDC',
    );
    const next = filtersToParams(DEFAULT_FILTERS, existing);
    expect(next.toString()).toBe('tab=payments');
  });
});

describe('usePaymentHistoryFilters', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPathname = '/history';
    mockSearchParams = new URLSearchParams();
  });

  it('does not produce an empty misleading result when URL has invalid filter values', () => {
    mockSearchParams = new URLSearchParams('types=invalid_status&from=bad-date&minAmt=-5');
    const { result } = renderHook(() => usePaymentHistoryFilters(SAMPLE_EVENTS));

    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.filteredEvents).toHaveLength(2);
  });

  it('preserves unrelated query params when updating and clearing filters', () => {
    mockSearchParams = new URLSearchParams('tab=overview&sort=desc');
    const { result } = renderHook(() => usePaymentHistoryFilters(SAMPLE_EVENTS));

    act(() => {
      result.current.setFilter('tokenFilter', 'CUSDC');
    });

    expect(mockReplace).toHaveBeenLastCalledWith(
      '/history?tab=overview&sort=desc&token=CUSDC',
      { scroll: false },
    );

    act(() => {
      result.current.clearFilters();
    });

    expect(mockReplace).toHaveBeenLastCalledWith('/history?tab=overview&sort=desc', {
      scroll: false,
    });
  });

  it('restores filter state on browser back/forward navigation', () => {
    mockSearchParams = new URLSearchParams('token=CUSDC');
    const { result, rerender } = renderHook(() =>
      usePaymentHistoryFilters(SAMPLE_EVENTS),
    );

    expect(result.current.filters.tokenFilter).toBe('CUSDC');
    expect(result.current.filteredEvents).toHaveLength(1);

    // Simulate browser back/forward updating searchParams
    mockSearchParams = new URLSearchParams('from=2025-06-01&types=executed');
    rerender();

    expect(result.current.filters.tokenFilter).toBe('');
    expect(result.current.filters.dateFrom).toBe('2025-06-01');
    expect(result.current.filters.eventTypes).toEqual(['executed']);
    expect(result.current.filteredEvents).toHaveLength(1);
    expect(result.current.filteredEvents[0].id).toBe('evt-2');
  });
});
