'use client';

import React, { useId, useState } from 'react';
import { formatScheduleTime } from '../lib/schedule_time';

export interface ScheduleTimeProps {
  /** Ledger timestamp: Unix seconds, ISO-8601 string, or Date */
  timestamp: number | string | Date | null | undefined;
  /** Optional IANA time zone override (defaults to user's configured/browser time zone) */
  timeZone?: string;
  /** Optional locale override */
  locale?: string;
  /** Additional CSS classes for the wrapper */
  className?: string;
}

/**
 * Displays a scheduled payment time in the user's local time zone with an
 * explicit time zone identifier and an accessible toggle to inspect the
 * canonical UTC timestamp and daylight-saving time behavior.
 */
export function ScheduleTime({
  timestamp,
  timeZone,
  locale,
  className = '',
}: ScheduleTimeProps) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsId = useId();
  const formatted = formatScheduleTime(timestamp, { timeZone, locale });

  if (!formatted) {
    return <span className={`text-gray-600 ${className}`.trim()}>—</span>;
  }

  return (
    <span className={`inline-flex flex-col gap-1 ${className}`.trim()}>
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <time
          dateTime={formatted.isoUtc}
          title={`Canonical UTC: ${formatted.utcLabel}`}
        >
          {formatted.localLabel}
        </time>
        <button
          type="button"
          onClick={() => setShowDetails((prev) => !prev)}
          aria-expanded={showDetails}
          aria-controls={detailsId}
          aria-label={`Inspect canonical UTC timestamp and time zone details (${formatted.utcLabel})`}
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          UTC
        </button>
      </span>
      {showDetails && (
        <span
          id={detailsId}
          role="region"
          aria-label="Schedule time zone details"
          className="block rounded border border-gray-700 bg-gray-900/95 px-2.5 py-2 text-xs text-gray-300 space-y-1 max-w-xs"
        >
          <span className="block">
            <strong className="text-gray-200">Canonical UTC:</strong>{' '}
            <code className="text-blue-300">{formatted.utcLabel}</code>
          </span>
          <span className="block">
            <strong className="text-gray-200">Time zone:</strong>{' '}
            {formatted.timeZone}
          </span>
          <span className="block text-gray-400">{formatted.dst.explanation}</span>
        </span>
      )}
    </span>
  );
}
