/**
 * #1390 — CSV export endpoint for payment history.
 *
 * GET /api/v1/payments/:merchant/export
 *   Query params:
 *     format  — "csv" (default) | "json"
 *
 * Features:
 *  - Streams response row-by-row to avoid buffering large datasets in memory
 *  - RFC 4180-compliant CSV with proper quoting/escaping
 *  - Content-Disposition: attachment; filename=payments-{merchant}-{date}.csv
 *  - Rate limited: 5 req/min per merchant address
 *
 * CSV columns:
 *   Date, Type, Subscriber, Amount (human-readable), Amount (raw), Token, Tx Hash, Nonce
 */

import { Router, Request, Response } from 'express';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma';

const router = Router();

// ---------------------------------------------------------------------------
// Rate limiter: 5 requests per minute per merchant address
// ---------------------------------------------------------------------------
const exportRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req: Request): string => {
    // Key per merchant address so different merchants don't share quota
    return (req.params.merchant as string) || req.ip || 'unknown';
  },
  message: { error: 'Rate limit exceeded. Maximum 5 export requests per minute per merchant.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  'Date',
  'Type',
  'Subscriber',
  'Amount (human-readable)',
  'Amount (raw)',
  'Token',
  'Tx Hash',
  'Nonce',
];

/** Escape a single CSV cell per RFC 4180. */
function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Produce a CRLF-terminated CSV row. */
function toCsvRow(cells: string[]): string {
  return cells.map(escapeCsvCell).join(',') + '\r\n';
}

/**
 * Convert a raw stroop amount (BigInt-compatible string) to a human-readable
 * decimal with 7 decimal places (Stellar standard).
 */
function toHumanAmount(raw: string): string {
  try {
    const n = BigInt(raw);
    const isNeg = n < 0n;
    const abs = isNeg ? -n : n;
    const wholePart = abs / 10_000_000n;
    const fracPart = abs % 10_000_000n;
    const fracStr = String(fracPart).padStart(7, '0').replace(/0+$/, '') || '0';
    return `${isNeg ? '-' : ''}${wholePart}.${fracStr}`;
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Streaming Prisma reader
// ---------------------------------------------------------------------------

/**
 * Create a Node.js Readable that yields payment rows from Prisma in batches.
 * Tries the Payment model first (preferred); falls back to the Event table
 * when the Payment model is not available (older schema).
 */
function createPaymentReadable(merchantAddress: string, batchSize = 500): Readable {
  let offset = 0;
  let done = false;

  return new Readable({
    objectMode: true,
    async read() {
      if (done) {
        this.push(null);
        return;
      }
      try {
        let rows: unknown[];

        try {
          // Prefer the normalised Payment model
          rows = await (prisma as any).payment.findMany({
            where: { merchant: merchantAddress },
            orderBy: { timestamp: 'asc' },
            take: batchSize,
            skip: offset,
          });
        } catch {
          // Fallback: derive from Event table (executed events only)
          rows = await prisma.event.findMany({
            where: { merchant: merchantAddress, type: 'executed' },
            orderBy: { ledgerTimestamp: 'asc' },
            take: batchSize,
            skip: offset,
          });
        }

        if ((rows as unknown[]).length === 0) {
          done = true;
          this.push(null);
          return;
        }

        offset += (rows as unknown[]).length;
        for (const row of rows as unknown[]) {
          this.push(row);
        }
        if ((rows as unknown[]).length < batchSize) {
          done = true;
        }
      } catch (err) {
        this.destroy(err as Error);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Row normaliser — handles both Payment model and Event model shapes
// ---------------------------------------------------------------------------

interface NormalisedRow {
  date: string;
  type: string;
  subscriber: string;
  amountHuman: string;
  amountRaw: string;
  token: string;
  txHash: string;
  nonce: string;
}

function normaliseRow(record: Record<string, unknown>): NormalisedRow {
  // Date: prefer Payment.timestamp over ledgerTimestamp
  let date: string;
  if (record.timestamp instanceof Date) {
    date = record.timestamp.toISOString();
  } else if (record.timestamp) {
    date = new Date(record.timestamp as string).toISOString();
  } else if (record.ledgerTimestamp != null) {
    date = new Date(Number(record.ledgerTimestamp as bigint) * 1000).toISOString();
  } else {
    date = new Date().toISOString();
  }

  const amountRaw = String(record.amount ?? '0');

  return {
    date,
    type: String(record.status ?? record.type ?? 'executed'),
    subscriber: String(record.subscriber ?? ''),
    amountHuman: toHumanAmount(amountRaw),
    amountRaw,
    token: String(record.token ?? ''),
    txHash: String(record.txHash ?? record.transactionHash ?? ''),
    nonce: record.paymentNonce != null ? String(record.paymentNonce) : '',
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/v1/payments/{merchant}/export:
 *   get:
 *     operationId: exportPaymentHistory
 *     summary: Export payment history as CSV or JSON (streaming)
 *     description: |
 *       Streams payment rows directly to the HTTP response to handle large
 *       datasets without memory pressure. CSV format follows RFC 4180.
 *       Rate limited to 5 requests per minute per merchant.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: merchant
 *         in: path
 *         required: true
 *         schema:
 *           $ref: "#/components/schemas/Address"
 *         description: Merchant Stellar address
 *       - name: format
 *         in: query
 *         schema:
 *           type: string
 *           enum: [csv, json]
 *           default: csv
 *         description: Export format
 *     responses:
 *       "200":
 *         description: Payment export (CSV or JSON)
 *         headers:
 *           Content-Disposition:
 *             schema:
 *               type: string
 *               example: attachment; filename="payments-GMERCHA-2024-01-15.csv"
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: "#/components/schemas/CsvExportRow"
 *       "400":
 *         description: Invalid parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 *       "429":
 *         description: Rate limit exceeded (5 req/min per merchant)
 */
router.get('/:merchant/export', exportRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const { merchant } = req.params;
  const format = ((req.query.format as string) ?? 'csv').toLowerCase();

  if (!merchant) {
    res.status(400).json({ error: 'merchant path parameter is required' });
    return;
  }

  if (!['csv', 'json'].includes(format)) {
    res.status(400).json({ error: 'format must be "csv" or "json"' });
    return;
  }

  const dateStamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const source = createPaymentReadable(merchant);

  // ── CSV export ────────────────────────────────────────────────────────────
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payments-${merchant.slice(0, 8)}-${dateStamp}.csv"`,
    );

    // Write header immediately so the client sees columns right away
    res.write(toCsvRow(CSV_COLUMNS));

    const csvTransform = new Transform({
      objectMode: true,
      transform(record: Record<string, unknown>, _encoding, callback) {
        const row = normaliseRow(record);
        callback(null, toCsvRow([
          row.date,
          row.type,
          row.subscriber,
          row.amountHuman,
          row.amountRaw,
          row.token,
          row.txHash,
          row.nonce,
        ]));
      },
    });

    try {
      await pipeline(source, csvTransform, res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      }
    }
    return;
  }

  // ── JSON export ───────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="payments-${merchant.slice(0, 8)}-${dateStamp}.json"`,
  );

  const jsonTransform = new Transform({
    objectMode: true,
    transform(record: Record<string, unknown>, _encoding, callback) {
      callback(null, normaliseRow(record));
    },
  });

  res.write('[');
  let first = true;

  await new Promise<void>((resolve, reject) => {
    source.pipe(jsonTransform);

    jsonTransform.on('data', (row: NormalisedRow) => {
      res.write((first ? '' : ',') + JSON.stringify(row));
      first = false;
    });

    jsonTransform.on('end', () => {
      res.write(']');
      res.end();
      resolve();
    });

    jsonTransform.on('error', reject);
    source.on('error', reject);
  }).catch(() => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed' });
    } else {
      res.write(']');
      res.end();
    }
  });
});

export default router;
