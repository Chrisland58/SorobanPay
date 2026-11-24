/**
 * #1389 — Swagger UI docs route.
 *
 * Serves:
 *   GET /docs               — Interactive Swagger UI
 *   GET /docs/openapi.json  — Raw OpenAPI 3.0 JSON spec
 */

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '../lib/swagger';

const router = Router();

/**
 * @openapi
 * /docs/openapi.json:
 *   get:
 *     operationId: getOpenApiSpec
 *     summary: Download the raw OpenAPI 3.0 JSON specification
 *     tags: [Health]
 *     responses:
 *       "200":
 *         description: OpenAPI 3.0 specification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */

// Serve Swagger UI
router.use('/', swaggerUi.serve);
router.get(
  '/',
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'SorobanPay API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      showExtensions: true,
      tryItOutEnabled: true,
    },
  }),
);

// Expose raw JSON spec for tooling (code generation, validation, etc.)
router.get('/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(swaggerSpec);
});

export default router;
