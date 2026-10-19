'use client';

/**
 * DataTable.tsx
 *
 * Generic responsive data table component for subscription and payment lists.
 *
 * Features:
 *  - Desktop: traditional <table> layout with sticky header on scroll
 *  - Mobile: card-based layout (stacked key-value pairs) below the `sm` breakpoint
 *  - Client-side column sorting (ascending / descending toggle)
 *  - Row selection with checkboxes for bulk actions
 *  - Sticky header via `sticky top-0` on <thead>
 *  - WCAG 2.1 AA: correct table ARIA roles, aria-sort, aria-label, scope
 *  - Fully generic via TypeScript generics — works for any row shape
 *
 * Usage:
 *   <DataTable
 *     columns={columns}
 *     rows={rows}
 *     getRowId={(row) => row.id}
 *     selectable
 *     onSelectionChange={(ids) => console.log(ids)}
 *   />
 */

import React, {
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc' | 'none';

export interface DataTableColumn<T> {
  /** Unique column key — must match a key of T or a custom accessor */
  key: string;
  /** Column header label */
  label: string;
  /** Whether this column is sortable (default: false) */
  sortable?: boolean;
  /** Alignment of cell content (default: 'left') */
  align?: 'left' | 'right' | 'center';
  /** Custom render function. Receives the row and returns a ReactNode. */
  render?: (row: T) => ReactNode;
  /**
   * Value extractor for sorting. Defaults to `(row as any)[key]`.
   * Return a string or number for comparison.
   */
  sortValue?: (row: T) => string | number;
  /** Additional className applied to each <td> / card value cell */
  cellClassName?: string;
}

export interface DataTableProps<T> {
  /** Column definitions */
  columns: DataTableColumn<T>[];
  /** Row data */
  rows: T[];
  /** Extract a stable unique ID from a row (used as React key + selection key) */
  getRowId: (row: T) => string;
  /** Enable row selection checkboxes */
  selectable?: boolean;
  /**
   * Called whenever the selection set changes.
   * Receives an array of selected row IDs.
   */
  onSelectionChange?: (selectedIds: string[]) => void;
  /** Pre-selected row IDs (controlled) */
  selectedIds?: string[];
  /** Accessible label for the table element */
  ariaLabel?: string;
  /** Show a loading skeleton instead of rows */
  isLoading?: boolean;
  /** Number of skeleton rows to render while loading (default: 5) */
  skeletonRowCount?: number;
  /** Message shown when rows is empty and not loading */
  emptyMessage?: string;
  /** Additional className on the outer wrapper */
  className?: string;
}

// ── Sort icon ─────────────────────────────────────────────────────────────────

function SortIcon({ direction }: { direction: SortDirection }) {
  if (direction === 'asc') {
    return (
      <svg
        aria-hidden="true"
        className="inline-block ml-1 h-3 w-3 text-blue-400"
        viewBox="0 0 12 12"
        fill="currentColor"
      >
        <path d="M6 2l4 7H2l4-7z" />
      </svg>
    );
  }
  if (direction === 'desc') {
    return (
      <svg
        aria-hidden="true"
        className="inline-block ml-1 h-3 w-3 text-blue-400"
        viewBox="0 0 12 12"
        fill="currentColor"
      >
        <path d="M6 10L2 3h8l-4 7z" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="inline-block ml-1 h-3 w-3 text-gray-600"
      viewBox="0 0 12 12"
      fill="currentColor"
    >
      <path d="M6 2l3 4H3l3-4zM6 10L3 6h6l-3 4z" />
    </svg>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonTableRow({ colCount }: { colCount: number }) {
  return (
    <tr aria-hidden="true" className="border-b border-gray-800">
      {Array.from({ length: colCount }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-3 w-3/4 animate-pulse rounded bg-gray-700"
            style={{ width: `${Math.floor(40 + Math.random() * 40)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard({ colCount }: { colCount: number }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-3"
    >
      {Array.from({ length: colCount }).map((_, i) => (
        <div key={i} className="flex justify-between gap-4">
          <div className="h-3 w-20 animate-pulse rounded bg-gray-700" />
          <div className="h-3 w-28 animate-pulse rounded bg-gray-700" />
        </div>
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <tr>
      <td
        colSpan={999}
        className="px-4 py-12 text-center text-gray-500 text-sm"
      >
        {message}
      </td>
    </tr>
  );
}

function EmptyCardState({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded-xl border border-dashed border-gray-700 bg-gray-900/30 p-10 text-center"
    >
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  selectable = false,
  onSelectionChange,
  selectedIds: controlledSelectedIds,
  ariaLabel = 'Data table',
  isLoading = false,
  skeletonRowCount = 5,
  emptyMessage = 'No data to display.',
  className = '',
}: DataTableProps<T>) {
  // ── Sort state ──────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('none');

  // ── Selection state (uncontrolled fallback) ─────────────────────────────────
  const [internalSelected, setInternalSelected] = useState<Set<string>>(
    new Set(controlledSelectedIds ?? []),
  );
  const selectedSet =
    controlledSelectedIds !== undefined
      ? new Set(controlledSelectedIds)
      : internalSelected;

  const setSelected = useCallback(
    (next: Set<string>) => {
      setInternalSelected(next);
      onSelectionChange?.(Array.from(next));
    },
    [onSelectionChange],
  );

  // ── Sorted rows ─────────────────────────────────────────────────────────────
  const sortedRows = useMemo(() => {
    if (!sortKey || sortDir === 'none') return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const getValue = col.sortValue ?? ((row: T) => (row as Record<string, unknown>)[sortKey] as string | number);
    return [...rows].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, columns]);

  // ── Sort handler ────────────────────────────────────────────────────────────
  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev !== key) {
        setSortDir('asc');
        return key;
      }
      setSortDir((d) => {
        if (d === 'asc') return 'desc';
        if (d === 'desc') return 'none';
        return 'asc';
      });
      return key;
    });
  }, []);

  // ── Selection handlers ──────────────────────────────────────────────────────
  const toggleRow = useCallback(
    (id: string) => {
      const next = new Set(selectedSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
    },
    [selectedSet, setSelected],
  );

  const allIds = useMemo(() => sortedRows.map(getRowId), [sortedRows, getRowId]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedSet.has(id));
  const someSelected = !allSelected && allIds.some((id) => selectedSet.has(id));

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }, [allSelected, allIds, setSelected]);

  // ── Column count (including optional checkbox column) ───────────────────────
  const colCount = columns.length + (selectable ? 1 : 0);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className={`w-full ${className}`}>
      {/* ── Desktop table (hidden on mobile) ── */}
      <div className="hidden sm:block overflow-x-auto rounded-2xl border border-gray-800">
        <table
          className="w-full border-collapse text-sm"
          aria-label={ariaLabel}
          aria-busy={isLoading}
        >
          {/* Sticky header */}
          <thead className="sticky top-0 z-10 bg-gray-900 shadow-sm">
            <tr className="border-b border-gray-700">
              {selectable && (
                <th
                  scope="col"
                  className="w-10 px-4 py-3 text-left"
                  aria-label="Select all rows"
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                    className="h-4 w-4 rounded border-gray-600 bg-gray-800 accent-blue-500 cursor-pointer"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    sortKey === col.key && sortDir !== 'none'
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : col.sortable
                        ? 'none'
                        : undefined
                  }
                  className={[
                    'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400',
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                    col.sortable ? 'cursor-pointer select-none hover:text-gray-200 transition-colors' : '',
                  ].join(' ')}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  onKeyDown={
                    col.sortable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSort(col.key);
                          }
                        }
                      : undefined
                  }
                  tabIndex={col.sortable ? 0 : undefined}
                >
                  {col.label}
                  {col.sortable && (
                    <SortIcon
                      direction={sortKey === col.key ? sortDir : 'none'}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: skeletonRowCount }).map((_, i) => (
                <SkeletonTableRow key={i} colCount={colCount} />
              ))
            ) : sortedRows.length === 0 ? (
              <EmptyState message={emptyMessage} />
            ) : (
              sortedRows.map((row) => {
                const id = getRowId(row);
                const isSelected = selectedSet.has(id);
                return (
                  <tr
                    key={id}
                    aria-selected={selectable ? isSelected : undefined}
                    className={[
                      'border-b border-gray-800/60 transition-colors',
                      isSelected
                        ? 'bg-blue-900/20 hover:bg-blue-900/30'
                        : 'hover:bg-gray-800/30',
                    ].join(' ')}
                  >
                    {selectable && (
                      <td className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                          aria-label={`Select row ${id}`}
                          className="h-4 w-4 rounded border-gray-600 bg-gray-800 accent-blue-500 cursor-pointer"
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={[
                          'px-4 py-3 text-gray-300 text-xs',
                          col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                          col.cellClassName ?? '',
                        ].join(' ')}
                      >
                        {col.render
                          ? col.render(row)
                          : String((row as Record<string, unknown>)[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards (hidden on sm+) ── */}
      <div className="sm:hidden space-y-3" role="list" aria-label={ariaLabel}>
        {isLoading ? (
          Array.from({ length: skeletonRowCount }).map((_, i) => (
            <SkeletonCard key={i} colCount={columns.length} />
          ))
        ) : sortedRows.length === 0 ? (
          <EmptyCardState message={emptyMessage} />
        ) : (
          sortedRows.map((row) => {
            const id = getRowId(row);
            const isSelected = selectedSet.has(id);
            return (
              <div
                key={id}
                role="listitem"
                aria-selected={selectable ? isSelected : undefined}
                className={[
                  'rounded-xl border p-4 space-y-2.5 transition-colors',
                  isSelected
                    ? 'border-blue-600/60 bg-blue-900/20'
                    : 'border-gray-800 bg-gray-900/40',
                ].join(' ')}
              >
                {selectable && (
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(id)}
                        aria-label={`Select row ${id}`}
                        className="h-4 w-4 rounded border-gray-600 bg-gray-800 accent-blue-500"
                      />
                      Select
                    </label>
                  </div>
                )}
                {columns.map((col) => (
                  <div
                    key={col.key}
                    className="flex items-start justify-between gap-3"
                  >
                    <span className="text-xs font-medium text-gray-500 shrink-0 w-24">
                      {col.label}
                    </span>
                    <span
                      className={[
                        'text-xs text-gray-200 text-right break-all',
                        col.cellClassName ?? '',
                      ].join(' ')}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '—')}
                    </span>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default DataTable;
