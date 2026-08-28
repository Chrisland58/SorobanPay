/**
 * admin.ts — Express router for /api/v1/admin routes
 *
 * All routes require admin authentication (check X-Admin-Token header).
 * In production, replace ADMIN_SECRET check with a proper auth middleware.
 */

import { Router, Request, Response, NextFunction } from 'express';

const router = Router();

// ── Auth middleware ────────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(requireAdmin);

// ── GET /api/v1/admin/metrics ──────────────────────────────────────────────────

/**
 * Returns protocol-wide metrics snapshot.
 * Response shape:
 * {
 *   totalSubscriptions: number;
 *   activeSubscriptions: number;
 *   totalVolumeUsd: string;
 *   totalFeesCollected: string;
 *   activeTenants: number;
 *   snapshotAt: string; // ISO 8601
 * }
 */
router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    // TODO: replace with real Prisma query
    // const metrics = await prisma.adminMetrics.findFirst({ orderBy: { snapshotAt: 'desc' } });
    res.json({
      totalSubscriptions:  0,
      activeSubscriptions: 0,
      totalVolumeUsd:      '0.000000',
      totalFeesCollected:  '0.000000',
      activeTenants:       0,
      snapshotAt:          new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/v1/admin/tenants ──────────────────────────────────────────────────

/**
 * Returns paginated list of tenants.
 * Query params: page (default 1), pageSize (default 20)
 * Response shape:
 * {
 *   tenants: Tenant[];
 *   total: number;
 *   page: number;
 *   pageSize: number;
 * }
 */
router.get('/tenants', async (req: Request, res: Response) => {
  try {
    const page     = Math.max(1, parseInt(String(req.query.page     ?? '1'),  10));
    const pageSize = Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10));
    // TODO: replace with real Prisma query
    // const [tenants, total] = await prisma.$transaction([
    //   prisma.tenant.findMany({ skip: (page - 1) * pageSize, take: pageSize }),
    //   prisma.tenant.count(),
    // ]);
    res.json({ tenants: [], total: 0, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/v1/admin/tenants/:id ───────────────────────────────────────────

/**
 * Activate or deactivate a tenant.
 * Body: { isActive: boolean }
 */
router.patch('/tenants/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { isActive } = req.body as { isActive?: boolean };
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive (boolean) is required' });
  }
  try {
    // TODO: replace with real Prisma update
    // const tenant = await prisma.tenant.update({ where: { id }, data: { isActive } });
    res.json({ id, isActive });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/v1/admin/protocol-fee ────────────────────────────────────────────

/**
 * Returns the default protocol fee in basis points.
 * Response: { feeBps: number }
 */
router.get('/protocol-fee', async (_req: Request, res: Response) => {
  try {
    // TODO: read from config table / env
    res.json({ feeBps: parseInt(process.env.DEFAULT_PROTOCOL_FEE_BPS ?? '50', 10) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/v1/admin/protocol-fee ──────────────────────────────────────────

/**
 * Update the default protocol fee.
 * Body: { feeBps: number }  — must be 0–10000
 */
router.patch('/protocol-fee', async (req: Request, res: Response) => {
  const { feeBps } = req.body as { feeBps?: number };
  if (typeof feeBps !== 'number' || feeBps < 0 || feeBps > 10_000) {
    return res.status(400).json({ error: 'feeBps must be a number between 0 and 10000' });
  }
  try {
    // TODO: persist to config table
    res.json({ feeBps });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
