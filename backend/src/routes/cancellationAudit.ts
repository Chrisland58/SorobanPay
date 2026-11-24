/**
 * #1382 — Cancellation audit trail REST routes.
 *
 * Endpoints (all require admin JWT via requireAdmin middleware):
 *   GET /api/v1/admin/cancellations         — paginated audit log
 *   GET /api/v1/admin/cancellations/export  — CSV download
 */
import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/adminAuth';
import { listCancellations } from '../services/cancellationAuditService';

const router = Router();

// All cancellation audit routes require admin JWT
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// GET /api/v1/admin/cancellations
// ---------------------------------------------------------------------------
/**
 * Returns paginated cancellation audit records with optional filters.
 *
 * Query params:
 *   merchant   {string}  — filter by merchant address
 *   subscriber {string}  — filter by subscriber address
 *   network    {string}  — filter by network (testnet | mainnet)
 *   from       {string}  — ISO 8601 date lower bound (inclusive)
 *   to         {string}  — ISO 8601 date upper bound (inclusive)
 *   limit      {number}  — records per page (default: 50, max: 200)
 *   offset     {number}  — pagination offset (default: 0)
 *
 * Response 200: { data: CancellationAuditRecord[], total, limit, offset }
 * Response 400: invalid filter value
 * Response 401: missing or invalid admin JWT
 */
router.get('/', async (req: Request, res: Response) => {
  const merchantAddress   = req.query.merchant   as string | undefined;
  const subscriberAddress = req.query.subscriber as string | undefined;
  const network           = req.query.network    as string | undefined;
  const fromParam         = req.query.from        as string | undefined;
  const toParam           = req.query.to          as string | undefined;
  const limit  = Math.min(200, Math.max(1, parseInt((req.query.limit  as string) ?? '50',  10)));
  const offset = Math.max(0,               parseInt((req.query.offset as string) ?? '0',   10));

  // Validate network filter
  if (network && !['testnet', 'mainnet'].includes(network)) {
    return res.status(400).json({ error: 'network must be testnet or mainnet' });
  }

  // Validate date filters
  let from: Date | undefined;
  let to: Date | undefined;

  if (fromParam) {
    from = new Date(fromParam);
    if (isNaN(from.getTime())) {
      return res.status(400).json({ error: 'from must be a valid ISO 8601 date' });
    }
  }
  if (toParam) {
    to = new Date(toParam);
    if (isNaN(to.getTime())) {
      return res.status(400).json({ error: 'to must be a valid ISO 8601 date' });
    }
  }

  try {
    const result = await listCancellations({
      merchantAddress,
      subscriberAddress,
      network,
      from,
      to,
      limit,
      offset,
    });

    return res.json(result);
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to fetch cancellation audit records' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/cancellations/export
// ---------------------------------------------------------------------------
/**
 * Exports matching cancellation audit records as a CSV file.
 * Accepts the same query filters as GET /.
 * Fetches up to 10,000 records per export for safety.
 *
 * Response headers:
 *   Content-Type: text/csv
 *   Content-Disposition: attachment; filename="cancellations-YYYY-MM-DD.csv"
 */
router.get('/export', async (req: Request, res: Response) => {
  const merchantAddress   = req.query.merchant   as string | undefined;
  const subscriberAddress = req.query.subscriber as string | undefined;
  const network           = req.query.network    as string | undefined;
  const fromParam         = req.query.from        as string | undefined;
  const toParam           = req.query.to          as string | undefined;

  if (network && !['testnet', 'mainnet'].includes(network)) {
    return res.status(400).json({ error: 'network must be testnet or mainnet' });
  }

  let from: Date | undefined;
  let to: Date | undefined;

  if (fromParam) {
    from = new Date(fromParam);
    if (isNaN(from.getTime())) {
      return res.status(400).json({ error: 'from must be a valid ISO 8601 date' });
    }
  }
  if (toParam) {
    to = new Date(toParam);
    if (isNaN(to.getTime())) {
      return res.status(400).json({ error: 'to must be a valid ISO 8601 date' });
    }
  }

  try {
    // Fetch up to 10 000 records for a single export
    const result = await listCancellations({
      merchantAddress,
      subscriberAddress,
      network,
      from,
      to,
      limit: 10000,
      offset: 0,
    });

    const CSV_COLUMNS = [
      'id',
      'network',
      'contractId',
      'subscriberAddress',
      'merchantAddress',
      'tokenAddress',
      'amount',
      'intervalSeconds',
      'nextPaymentAt',
      'cancelledAt',
      'ledger',
      'transactionHash',
      'reason',
      'source',
      'createdAt',
    ] as const;

    /** Escape a CSV cell value: wrap in quotes if it contains commas, quotes, or newlines. */
    const escapeCell = (val: unknown): string => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = CSV_COLUMNS.join(',');
    const rows = result.data.map((r) =>
      [
        r.id,
        r.network,
        r.contractId,
        r.subscriberAddress,
        r.merchantAddress,
        r.tokenAddress,
        r.amount,
        r.intervalSeconds?.toString() ?? '',
        r.nextPaymentAt?.toISOString()  ?? '',
        r.cancelledAt.toISOString(),
        r.ledger.toString(),
        r.transactionHash,
        r.reason,
        r.source,
        r.createdAt.toISOString(),
      ]
        .map(escapeCell)
        .join(','),
    );

    const csv      = [header, ...rows].join('\n');
    const filename = `cancellations-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to export cancellation audit records' });
  }
});

export default router;
