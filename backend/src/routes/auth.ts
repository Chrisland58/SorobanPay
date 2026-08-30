import { Router, Request, Response } from 'express';
import { authService } from '../services/authService';

const router = Router();

/**
 * POST /api/auth/challenge
 *
 * Body: { publicKey: string }
 *
 * Issues a SEP-10 challenge for the given Stellar public key.
 * The nonce is stored in Redis with a 5-minute TTL.
 */
router.post('/challenge', async (req: Request, res: Response) => {
  const { publicKey } = req.body as { publicKey?: string };

  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'publicKey is required' });
  }

  try {
    const result = await authService.createChallenge(publicKey);
    return res.json({ nonce: result.nonce, issuedAt: result.challenge.issuedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(400).json({ error: message });
  }
});

/**
 * POST /api/auth/verify
 *
 * Body: { publicKey: string; signedXdr: string }
 *
 * Verifies a signed SEP-10 challenge.  The challenge is consumed atomically
 * from Redis so it cannot be replayed.
 */
router.post('/verify', async (req: Request, res: Response) => {
  const { publicKey, signedXdr } = req.body as {
    publicKey?: string;
    signedXdr?: string;
  };

  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'publicKey is required' });
  }
  if (!signedXdr || typeof signedXdr !== 'string') {
    return res.status(400).json({ error: 'signedXdr is required' });
  }

  const result = await authService.verifyChallenge(publicKey, signedXdr);

  if (!result.success) {
    return res.status(401).json({ error: result.error });
  }

  return res.json({ success: true, publicKey: result.publicKey });
});

export default router;
