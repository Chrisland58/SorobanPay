import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { redisCache } from '../lib/redisCache';

const router = Router();

// Cache TTL for summary data — summaries are aggregated periodically and
// don't change frequently, so 60 seconds is safe.
const SUMMARIES_CACHE_TTL = 60;

// Get all summaries for a merchant
router.get('/merchant/:merchantAddress', async (req: Request, res: Response) => {
  try {
    const merchantAddress = req.params.merchantAddress as string;
    const rawType = req.query.type; // Optional: filter by type (daily/weekly)
    const type = Array.isArray(rawType) ? rawType[0] : rawType;

    const where: Record<string, unknown> = { merchant: merchantAddress };
    if (type) {
      where.type = type;
    }

    // Issue #1444 — cache summaries (MRR analytics) in Redis
    const cacheKey = `summaries:${merchantAddress}:${type ?? 'all'}`;
    const cached = await redisCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const summaries = await prisma.payoutSummary.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Store in Redis for subsequent requests
    await redisCache.set(cacheKey, summaries, SUMMARIES_CACHE_TTL);

    res.json(summaries);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summaries' });
  }
});

// Get a specific summary by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Issue #1444 — cache individual summary lookups
    const cacheKey = `summary:${id}`;
    const cached = await redisCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const summary = await prisma.payoutSummary.findUnique({
      where: { id: parseInt(id) },
    });

    if (!summary) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    await redisCache.set(cacheKey, summary, SUMMARIES_CACHE_TTL);

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

export default router;
