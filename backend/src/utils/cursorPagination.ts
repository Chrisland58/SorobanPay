/**
 * backend/src/utils/cursorPagination.ts
 *
 * Deterministic, stable cursor pagination for APIs (Issue #1582).
 *
 * Encodes composite ordering keys (timestamp, id) into opaque, tamper-evident
 * base64 cursors. Preserves strict deterministic pagination across equal
 * timestamps and concurrent database inserts.
 */

import { createHmac } from 'crypto';

const CURSOR_SECRET = process.env.CURSOR_SECRET || 'sorobanpay-cursor-internal-secret';

export class InvalidCursorError extends Error {
  constructor(message = 'Invalid, tampered, or expired cursor parameter') {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

export interface DecodedCursor {
  timestamp: string; // ISO 8601 string
  id: string;
}

export interface PageMetadata {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  total?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PageMetadata;
}

function computeSignature(payload: string): string {
  return createHmac('sha256', CURSOR_SECRET)
    .update(payload)
    .digest('base64url')
    .slice(0, 16);
}

/**
 * Encode an opaque cursor from a deterministic composite key (timestamp, id).
 */
export function encodeCursor(timestamp: Date | string | number, id: string | number): string {
  const tsStr = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  const idStr = String(id);
  const payload = JSON.stringify({ t: tsStr, i: idStr });
  const sig = computeSignature(payload);
  const raw = `${payload}.${sig}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/**
 * Decode and validate an opaque cursor string.
 * @throws InvalidCursorError if the cursor is malformed, has invalid JSON, or fails signature check.
 */
export function decodeCursor(cursorString: string): DecodedCursor {
  if (!cursorString || typeof cursorString !== 'string') {
    throw new InvalidCursorError('Cursor must be a non-empty string');
  }

  try {
    const raw = Buffer.from(cursorString, 'base64url').toString('utf8');
    const dotIdx = raw.lastIndexOf('.');
    if (dotIdx === -1) {
      throw new InvalidCursorError('Cursor format is invalid');
    }

    const payload = raw.slice(0, dotIdx);
    const sig = raw.slice(dotIdx + 1);

    const expectedSig = computeSignature(payload);
    if (sig !== expectedSig) {
      throw new InvalidCursorError('Cursor signature mismatch or tampered cursor');
    }

    const parsed = JSON.parse(payload) as { t?: string; i?: string };
    if (!parsed.t || !parsed.i || isNaN(new Date(parsed.t).getTime())) {
      throw new InvalidCursorError('Cursor contains invalid timestamp or identifier');
    }

    return {
      timestamp: parsed.t,
      id: parsed.i,
    };
  } catch (err) {
    if (err instanceof InvalidCursorError) throw err;
    throw new InvalidCursorError('Failed to parse cursor');
  }
}

/**
 * Build deterministic Prisma where clauses for cursor-based pagination.
 * Orders descending by (timestamp, id).
 */
export function buildCursorWhere(cursor: DecodedCursor | null, timestampField = 'createdAt', idField = 'id') {
  if (!cursor) return {};
  const cursorDate = new Date(cursor.timestamp);
  return {
    OR: [
      { [timestampField]: { lt: cursorDate } },
      {
        AND: [
          { [timestampField]: cursorDate },
          { [idField]: { lt: isNaN(Number(cursor.id)) ? cursor.id : Number(cursor.id) } },
        ],
      },
    ],
  };
}

/**
 * Wrap records into a standardized paginated response with next cursor.
 */
export function paginateRecords<T extends { id: string | number; createdAt?: Date | string; timestamp?: Date | string }>(
  records: T[],
  limit: number,
  total?: number,
): PaginatedResponse<T> {
  const hasMore = records.length > limit;
  const data = hasMore ? records.slice(0, limit) : records;

  let nextCursor: string | null = null;
  if (hasMore && data.length > 0) {
    const lastItem = data[data.length - 1];
    const ts = lastItem.createdAt ?? lastItem.timestamp ?? new Date().toISOString();
    nextCursor = encodeCursor(ts, lastItem.id);
  }

  return {
    data,
    pagination: {
      limit,
      hasMore,
      nextCursor,
      total,
    },
  };
}
