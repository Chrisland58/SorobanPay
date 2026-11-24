/**
 * backend/prisma/seed.ts
 *
 * Development / CI seed script for SorobanPay (#1379).
 *
 * Populates all five core tables with representative test data using upserts,
 * so the script is safe to run multiple times without creating duplicates.
 *
 * Usage:
 *   npx ts-node backend/prisma/seed.ts
 *   # or add to package.json:  "seed": "ts-node prisma/seed.ts"
 */

import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

// ─── Seed constants ───────────────────────────────────────────────────────────

const MERCHANTS = [
  'GMERCHANT001AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'GMERCHANT002BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
];

const SUBSCRIBERS = [
  'GSUBSCRIBER01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'GSUBSCRIBER02BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  'GSUBSCRIBER03CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
];

const TOKENS = [
  'CUSDC0000000000000000000000000000000000000000000000A',
  'CXLM00000000000000000000000000000000000000000000000B',
];

const MONTH_S = 2_592_000;
const WEEK_S  =   604_800;
const nowS    = Math.floor(Date.now() / 1000);

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Seeding SorobanPay database…');

  // ── 1. Subscriptions ───────────────────────────────────────────────────────
  await prisma.subscription.upsert({
    where: {
      subscriber_merchant_token: {
        subscriber: SUBSCRIBERS[0],
        merchant: MERCHANTS[0],
        token: TOKENS[0],
      },
    },
    update: {},
    create: {
      subscriber:  SUBSCRIBERS[0],
      merchant:    MERCHANTS[0],
      token:       TOKENS[0],
      amount:      '1000000',            // 1 USDC (6 decimals)
      interval:    BigInt(MONTH_S),
      nextPayment: BigInt(nowS + MONTH_S),
      status:      'ACTIVE',
    },
  });

  await prisma.subscription.upsert({
    where: {
      subscriber_merchant_token: {
        subscriber: SUBSCRIBERS[1],
        merchant: MERCHANTS[0],
        token: TOKENS[0],
      },
    },
    update: {},
    create: {
      subscriber:  SUBSCRIBERS[1],
      merchant:    MERCHANTS[0],
      token:       TOKENS[0],
      amount:      '5000000',            // 5 USDC
      interval:    BigInt(WEEK_S),
      nextPayment: BigInt(nowS + WEEK_S),
      status:      'ACTIVE',
    },
  });

  await prisma.subscription.upsert({
    where: {
      subscriber_merchant_token: {
        subscriber: SUBSCRIBERS[2],
        merchant: MERCHANTS[1],
        token: TOKENS[1],
      },
    },
    update: {},
    create: {
      subscriber:   SUBSCRIBERS[2],
      merchant:     MERCHANTS[1],
      token:        TOKENS[1],
      amount:       '10000000',          // 10 XLM
      interval:     BigInt(MONTH_S),
      nextPayment:  BigInt(nowS - 5 * 86_400),  // 5 days overdue
      status:       'OVERDUE',
      overdueSince: new Date(Date.now() - 5 * 24 * 3600 * 1000),
    },
  });

  // ── 2. Payments ────────────────────────────────────────────────────────────
  const paymentSeeds = [
    {
      subscriber:   SUBSCRIBERS[0],
      merchant:     MERCHANTS[0],
      token:        TOKENS[0],
      amount:       '1000000',
      eventType:    'executed',
      txHash:       'seed_tx_0000000000000000000000000000000000000000000000001',
      paymentNonce: 1,
      timestamp:    new Date(Date.now() - 30 * 24 * 3600 * 1000),
    },
    {
      subscriber:   SUBSCRIBERS[0],
      merchant:     MERCHANTS[0],
      token:        TOKENS[0],
      amount:       '1000000',
      eventType:    'executed',
      txHash:       'seed_tx_0000000000000000000000000000000000000000000000002',
      paymentNonce: 2,
      timestamp:    new Date(),
    },
    {
      subscriber:   SUBSCRIBERS[1],
      merchant:     MERCHANTS[0],
      token:        TOKENS[0],
      amount:       '5000000',
      eventType:    'executed',
      txHash:       'seed_tx_0000000000000000000000000000000000000000000000003',
      paymentNonce: 1,
      timestamp:    new Date(Date.now() - 7 * 24 * 3600 * 1000),
    },
    {
      subscriber:   SUBSCRIBERS[2],
      merchant:     MERCHANTS[1],
      token:        TOKENS[1],
      amount:       '10000000',
      eventType:    'failed',
      txHash:       'seed_tx_0000000000000000000000000000000000000000000000004',
      paymentNonce: 1,
      timestamp:    new Date(Date.now() - 5 * 24 * 3600 * 1000),
    },
  ] as const;

  for (const p of paymentSeeds) {
    await prisma.payment.upsert({
      where: { txHash: p.txHash },
      update: {},
      create: p,
    });
  }

  // ── 3. IndexerState (singleton) ────────────────────────────────────────────
  await prisma.indexerState.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, cursor: null, lastIndexedLedger: 0 },
  });

  // ── 4. Webhooks ────────────────────────────────────────────────────────────
  const webhook1 = await prisma.webhookEndpoint.upsert({
    where: {
      merchant_url: {
        merchant: MERCHANTS[0],
        url: 'https://example-merchant.com/webhooks/soroban',
      },
    },
    update: {},
    create: {
      merchant: MERCHANTS[0],
      url:      'https://example-merchant.com/webhooks/soroban',
      events:   'payment.executed,payment.failed,subscription.cancelled',
      active:   true,
      secret:   'dev_seed_secret_replace_in_production_000000000000000000001',
    },
  });

  const webhook2 = await prisma.webhookEndpoint.upsert({
    where: {
      merchant_url: {
        merchant: MERCHANTS[1],
        url: 'https://another-merchant.io/hooks',
      },
    },
    update: {},
    create: {
      merchant: MERCHANTS[1],
      url:      'https://another-merchant.io/hooks',
      events:   'payment.executed',
      active:   true,
      secret:   'dev_seed_secret_replace_in_production_000000000000000000002',
    },
  });

  // ── 5. Webhook deliveries ──────────────────────────────────────────────────
  await prisma.webhookDelivery.upsert({
    where: { deliveryId: 'seed-delivery-0000-0000-0000-000000000001' },
    update: {},
    create: {
      deliveryId:    'seed-delivery-0000-0000-0000-000000000001',
      webhookId:     webhook1.id,
      eventId:       'evt_seed_0000000000000000000000000000000000000000000001',
      url:           webhook1.url,
      merchant:      MERCHANTS[0],
      event:         'payment.executed',
      payload:       JSON.stringify({
        type:       'payment.executed',
        subscriber: SUBSCRIBERS[0],
        merchant:   MERCHANTS[0],
        token:      TOKENS[0],
        amount:     '1000000',
      }),
      statusCode:    200,
      status:        'delivered',
      attempts:      1,
      lastAttemptAt: new Date(),
      success:       true,
    },
  });

  await prisma.webhookDelivery.upsert({
    where: { deliveryId: 'seed-delivery-0000-0000-0000-000000000002' },
    update: {},
    create: {
      deliveryId:    'seed-delivery-0000-0000-0000-000000000002',
      webhookId:     webhook2.id,
      eventId:       'evt_seed_0000000000000000000000000000000000000000000002',
      url:           webhook2.url,
      merchant:      MERCHANTS[1],
      event:         'payment.failed',
      payload:       JSON.stringify({
        type:       'payment.failed',
        subscriber: SUBSCRIBERS[2],
        merchant:   MERCHANTS[1],
        token:      TOKENS[1],
        amount:     '10000000',
      }),
      statusCode:    503,
      status:        'failed',
      attempts:      3,
      lastAttemptAt: new Date(),
      success:       false,
      error:         'Service Unavailable',
    },
  });

  console.log('✅  Seed complete.');
  console.log(`    Subscriptions:     3`);
  console.log(`    Payments:          ${paymentSeeds.length}`);
  console.log(`    IndexerState:      1  (singleton id=1)`);
  console.log(`    WebhookEndpoints:  2`);
  console.log(`    WebhookDeliveries: 2`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('❌  Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
