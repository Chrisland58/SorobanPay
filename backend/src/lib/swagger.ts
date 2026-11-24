/**
 * #1389 — OpenAPI / Swagger specification generator.
 *
 * Generates the OpenAPI 3.0 spec by combining a base definition with
 * JSDoc @openapi annotations from route files.
 *
 * Served at:
 *   GET /docs               — Swagger UI
 *   GET /docs/openapi.json  — Raw OpenAPI JSON spec
 */

import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'SorobanPay Backend API',
      description: [
        'REST API for the SorobanPay recurring-payment protocol on Stellar Soroban.',
        '',
        'Merchants authenticate via a SEP-10 style challenge-response flow:',
        '1. `GET /api/v1/auth/challenge?account=G…` — obtain unsigned challenge XDR',
        '2. Sign the returned transaction with Freighter (or your private key)',
        '3. `POST /api/v1/auth/token { transaction: "<signed-XDR>" }` — exchange for JWT',
        '4. Include `Authorization: Bearer <token>` on all protected endpoints',
        '',
        'Rate limit: **100 requests / minute per IP** (HTTP 429 on breach).',
      ].join('\n'),
      version: '1.0.0',
      contact: {
        name: 'SorobanPay',
        url: 'https://github.com/Chrisland58/SorobanPay',
      },
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Local development' },
      { url: 'https://api.sorobanpay.example.com', description: 'Production (placeholder)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'JWT issued by `POST /api/v1/auth/token`. Include as `Authorization: Bearer <token>`. Tokens expire after 24 hours.',
        },
      },
      schemas: {
        Address: {
          type: 'string',
          pattern: '^G[A-Z2-7]{55}$',
          example: 'GABC1234MERCHANT5678EXAMPLE000000000000000000000000000XYZ',
        },
        IsoDate: {
          type: 'string',
          format: 'date',
          example: '2024-01-15',
        },
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
        PaginatedMeta: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
        },
        Subscription: {
          type: 'object',
          required: ['subscriber', 'merchant', 'token', 'amount', 'status'],
          properties: {
            subscriber: { $ref: '#/components/schemas/Address' },
            merchant: { $ref: '#/components/schemas/Address' },
            token: { $ref: '#/components/schemas/Address' },
            amount: { type: 'string', description: 'Payment amount in stroops', example: '10000000' },
            status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'OVERDUE', 'CANCELLED', 'EXPIRED'] },
            interval: { type: 'integer', nullable: true, description: 'Payment interval in seconds' },
            nextPaymentDue: { type: 'integer', nullable: true, description: 'Unix timestamp of next payment' },
            lastPaymentAt: { type: 'string', nullable: true },
            createdAt: { type: 'string', nullable: true },
          },
        },
        Payment: {
          type: 'object',
          required: ['id', 'subscriber', 'merchant', 'token', 'amount', 'ledgerTimestamp', 'type'],
          properties: {
            id: { type: 'integer' },
            subscriber: { $ref: '#/components/schemas/Address' },
            merchant: { $ref: '#/components/schemas/Address' },
            token: { $ref: '#/components/schemas/Address' },
            amount: { type: 'string', example: '10000000' },
            type: { type: 'string', enum: ['executed', 'payment_transfer_failure'] },
            ledgerTimestamp: { type: 'string', description: 'Unix timestamp in seconds (as string)' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        MrrDataPoint: {
          type: 'object',
          properties: {
            month: { type: 'string', description: 'YYYY-MM', example: '2024-01' },
            label: { type: 'string', example: 'Jan 24' },
            revenue: { type: 'string', description: 'Total revenue in stroops for the month', example: '100000000' },
            paymentCount: { type: 'integer' },
          },
        },
        RevenueAnalytics: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['30d', '90d', 'all'] },
            merchant: { $ref: '#/components/schemas/Address' },
            mrr: { type: 'array', items: { $ref: '#/components/schemas/MrrDataPoint' } },
            activeSubscribers: { type: 'integer' },
            totalRevenue: { type: 'string', description: 'Total revenue for the period (stroops)' },
            successRate: { type: 'integer', minimum: 0, maximum: 100 },
            executedCount: { type: 'integer' },
            failureCount: { type: 'integer' },
            events: { type: 'array', description: 'Raw events used to compute metrics' },
          },
        },
        WebhookEndpoint: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            merchant: { $ref: '#/components/schemas/Address' },
            url: { type: 'string', format: 'uri' },
            active: { type: 'boolean' },
            events: { type: 'string', description: 'Comma-separated event types', example: 'payment.executed,payment.failed' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        WebhookDelivery: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            eventId: { type: 'string', description: 'Stable event identifier (idempotency key)' },
            deliveryId: { type: 'string', description: 'Unique per delivery attempt' },
            url: { type: 'string' },
            merchant: { $ref: '#/components/schemas/Address' },
            event: { type: 'string' },
            statusCode: { type: 'integer' },
            attempt: { type: 'integer' },
            success: { type: 'boolean' },
            error: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        TtlHealthEntry: {
          type: 'object',
          properties: {
            subscriber: { $ref: '#/components/schemas/Address' },
            merchant: { $ref: '#/components/schemas/Address' },
            token: { $ref: '#/components/schemas/Address' },
            amount: { type: 'string' },
            status: { type: 'string' },
            lastPaymentAt: { type: 'string', nullable: true, format: 'date-time' },
            daysSincePayment: { type: 'integer', nullable: true },
            ttlRisk: { type: 'string', enum: ['HIGH', 'MEDIUM'] },
          },
        },
        CsvExportRow: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date-time' },
            type: { type: 'string' },
            subscriber: { $ref: '#/components/schemas/Address' },
            amountHuman: { type: 'string' },
            amountRaw: { type: 'string' },
            token: { $ref: '#/components/schemas/Address' },
            txHash: { type: 'string' },
            nonce: { type: 'integer', nullable: true },
          },
        },
      },
    },
    tags: [
      { name: 'Health', description: 'Service health checks' },
      { name: 'Auth', description: 'SEP-10 merchant authentication' },
      { name: 'Subscriptions', description: 'Subscription queries and management' },
      { name: 'Payments', description: 'Payment history and CSV export' },
      { name: 'Analytics', description: 'Revenue and usage analytics' },
      { name: 'Webhooks', description: 'Webhook endpoint management and delivery logs' },
      { name: 'Admin', description: 'Administrative endpoints (admin JWT required)' },
      { name: 'Reports', description: 'Payment reports and streaming CSV/JSON export' },
    ],
  },
  // Scan route files for @openapi JSDoc annotations
  apis: [
    path.join(__dirname, '../routes/*.ts'),
    path.join(__dirname, '../routes/*.js'),
    // compiled output
    path.join(__dirname, '../routes/*.d.ts'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
export default swaggerSpec;
