/**
 * #1386 — Correlation ID middleware.
 *
 * Attaches a unique correlation ID to every incoming HTTP request so that all
 * log lines emitted during that request's lifetime share the same ID, enabling
 * end-to-end tracing across indexer, API, and webhook worker services.
 *
 * Behaviour:
 *  - Accepts a forwarded correlation ID via the X-Correlation-Id request
 *    header (e.g. set by an upstream API gateway or load balancer).
 *  - Mints a new UUID v4 via crypto.randomUUID() when no header is present.
 *    (crypto.randomUUID() is available in Node 18+ without any extra package.)
 *  - Attaches `req.id`  — the correlation ID string.
 *  - Attaches `req.log` — a pino child logger pre-bound with { correlationId,
 *    method, path } so all downstream log calls include the correlation ID.
 *  - Echoes the correlation ID in the X-Correlation-Id response header so
 *    clients can reference it when reporting issues.
 *  - Emits `request.received` and `request.finished` structured log events.
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

declare global {
  // Augment Express Request so TypeScript knows about req.id and req.log
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** UUID correlation ID, either forwarded via header or freshly minted. */
      id: string;
      /** Pino child logger pre-bound with correlationId, method, and path. */
      log: ReturnType<typeof logger.child>;
    }
  }
}

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Accept a forwarded correlation ID (e.g., from an API gateway) or mint a
  // new UUID. Node 18+ crypto.randomUUID() needs no external dependency.
  const correlationId =
    (req.headers['x-correlation-id'] as string | undefined) ??
    crypto.randomUUID();

  req.id = correlationId;
  req.log = logger.child({
    correlationId,
    method: req.method,
    path: req.path,
  });

  // Propagate the correlation ID in the response so callers can reference it.
  res.setHeader('X-Correlation-Id', correlationId);

  req.log.info({ event: 'request.received' });

  res.on('finish', () => {
    req.log.info({
      event: 'request.finished',
      statusCode: res.statusCode,
    });
  });

  next();
}
