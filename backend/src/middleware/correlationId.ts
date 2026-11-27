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
  // Length-check (max 64) and sanitize caller-supplied header to prevent log injection (Issue #1601)
  const rawHeader = req.headers['x-correlation-id'];
  let correlationId: string;

  if (
    typeof rawHeader === 'string' &&
    rawHeader.length > 0 &&
    rawHeader.length <= 64 &&
    /^[a-zA-Z0-9_\-\.:]+$/.test(rawHeader)
  ) {
    correlationId = rawHeader;
  } else {
    correlationId = crypto.randomUUID();
  }

  req.id = correlationId;
  req.log = logger.child({
    correlationId,
    method: req.method,
    path: req.path,
  });

  // Propagate the correlation ID in the response so callers can reference it.
  res.setHeader('X-Correlation-Id', correlationId);

  // Standard response metadata contract for request correlation (Issue #1601)
  const originalJson = res.json.bind(res);
  res.json = function (body: any): Response {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      if (!body.correlationId && !body.meta?.requestId) {
        if (body.error !== undefined) {
          body.correlationId = correlationId;
        } else {
          body.meta = { ...(body.meta || {}), requestId: correlationId, timestamp: new Date().toISOString() };
        }
      }
    }
    return originalJson(body);
  };

  req.log.info({ event: 'request.received' });

  res.on('finish', () => {
    req.log.info({
      event: 'request.finished',
      statusCode: res.statusCode,
    });
  });

  next();
}
