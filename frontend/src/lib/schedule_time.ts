export interface DstStatus {
  observesDst: boolean;
  isDstActive: boolean;
  explanation: string;
}

export interface ScheduleTimeDisplay {
  /** Local formatted date/time including time zone abbreviation (e.g. "Mar 8, 2026, 03:00 AM EDT") */
  localLabel: string;
  /** Canonical UTC timestamp (e.g. "2026-03-08 07:00:00 UTC") */
  utcLabel: string;
  /** ISO-8601 UTC string for semantic <time dateTime="..."> */
  isoUtc: string;
  /** Resolved IANA time zone name (e.g. "America/New_York") */
  timeZone: string;
  /** Daylight-saving time status and user-facing explanation */
  dst: DstStatus;
}

export interface FormatScheduleTimeOptions {
  /** IANA time zone identifier (defaults to the runtime/browser time zone) */
  timeZone?: string;
  /** BCP 47 locale tag (defaults to 'en-US') */
  locale?: string;
}

function parseLedgerDate(input: number | string | Date | null | undefined): Date | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      return null;
    }
    const date = new Date(input * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  return null;
}

function resolveTimeZone(requested?: string): string {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (!requested) {
    return fallback;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: requested }).format(new Date(0));
    return requested;
  } catch {
    return fallback;
  }
}

/**
 * Returns the UTC offset in minutes for `date` in `timeZone`
 * (positive east of UTC, negative west of UTC).
 */
function getUtcOffsetMinutes(date: Date, timeZone: string): number {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone }));
  return Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
}

/**
 * Determines whether `timeZone` observes Daylight Saving Time and whether
 * DST is active at `date`, returning a concise user-facing explanation.
 */
export function getDstStatus(date: Date, timeZone?: string): DstStatus {
  const resolvedTz = resolveTimeZone(timeZone);
  const year = date.getUTCFullYear();
  const janOffset = getUtcOffsetMinutes(new Date(Date.UTC(year, 0, 1, 12, 0, 0)), resolvedTz);
  const julOffset = getUtcOffsetMinutes(new Date(Date.UTC(year, 6, 1, 12, 0, 0)), resolvedTz);
  const observesDst = janOffset !== julOffset;

  if (!observesDst) {
    return {
      observesDst: false,
      isDstActive: false,
      explanation:
        'Ledger timestamps are fixed in UTC. This time zone does not observe daylight saving time.',
    };
  }

  const currentOffset = getUtcOffsetMinutes(date, resolvedTz);
  const dstOffset = Math.max(janOffset, julOffset);
  const isDstActive = currentOffset === dstOffset;

  return {
    observesDst: true,
    isDstActive,
    explanation: isDstActive
      ? 'Ledger timestamps are fixed in UTC. Local time reflects active daylight saving time (DST) and shifts by 1 hour across spring/fall transitions.'
      : 'Ledger timestamps are fixed in UTC. Local time reflects standard time; daylight saving time (DST) transitions shift the local clock by 1 hour.',
  };
}

/**
 * Formats a ledger timestamp (Unix seconds, ISO string, or Date) into a
 * time-zone-aware local label, canonical UTC representation, and DST context.
 * Returns `null` for missing or invalid timestamps.
 */
export function formatScheduleTime(
  input: number | string | Date | null | undefined,
  options: FormatScheduleTimeOptions = {}
): ScheduleTimeDisplay | null {
  const date = parseLedgerDate(input);
  if (!date) {
    return null;
  }

  const timeZone = resolveTimeZone(options.timeZone);
  const locale = options.locale ?? 'en-US';

  const localLabel = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(date);

  const isoUtc = date.toISOString();
  const utcLabel = `${isoUtc.slice(0, 10)} ${isoUtc.slice(11, 19)} UTC`;
  const dst = getDstStatus(date, timeZone);

  return {
    localLabel,
    utcLabel,
    isoUtc,
    timeZone,
    dst,
  };
}
