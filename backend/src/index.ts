import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { validateConfig } from './lib/config';
import { EventIndexer } from './services/eventIndexer';
import { PayoutSummaryGenerator } from './services/payoutSummaryGenerator';
import { PaymentScheduler } from './services/paymentScheduler';
import summariesRouter from './routes/summaries';
import reconcileRouter from './routes/reconcile';
import { reconcile } from './services/reconciler';
import { PrismaSubscriptionDB, fetchChainEventsFromDB } from './services/reconciler';

const app = express();
const { port: PORT, rpcUrl, contractId } = config;

// Middleware
app.use(cors());
app.use(express.json());
app.use(apiLimiter);

// Routes
app.use('/api/summaries', summariesRouter);
app.use('/api/reconcile', reconcileRouter);

// Initialize services
const rpcUrl = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const contractId = process.env.CONTRACT_ID || '';
const networkPassphrase = process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

const eventIndexer = new EventIndexer(rpcUrl, contractId);
const summaryGenerator = new PayoutSummaryGenerator();

// Payment scheduler — only active when operator secret is configured
const operatorSecret = process.env.OPERATOR_SECRET;
const paymentScheduler = operatorSecret
  ? new PaymentScheduler(rpcUrl, contractId, operatorSecret, networkPassphrase)
  : null;

// Schedule jobs
// Fetch events every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('Fetching new events...');
  await eventIndexer.fetchAndStoreEvents();
});

// Execute due payments every minute
cron.schedule('* * * * *', async () => {
  if (!paymentScheduler) return;
  await paymentScheduler.processDuePayments();
});

// Generate daily summaries at 1 AM every day
cron.schedule('0 1 * * *', async () => {
  console.log('Generating daily summaries...');
  await summaryGenerator.generateDailySummaries();
});

// Generate weekly summaries at 2 AM every Sunday
cron.schedule('0 2 * * 0', async () => {
  console.log('Generating weekly summaries...');
  await summaryGenerator.generateWeeklySummaries();
});

// Run reconciliation every hour
cron.schedule('0 * * * *', async () => {
  console.log('Running reconciliation...');
  try {
    const [chainEvents, db] = await Promise.all([
      fetchChainEventsFromDB(),
      PrismaSubscriptionDB.load(),
    ]);
    const { repairs, errors } = reconcile(chainEvents, db);
    console.log(`Reconciliation complete: ${repairs.length} repairs, ${errors.length} errors`);
    if (errors.length > 0) console.warn('Reconciliation errors:', errors);
  } catch (err) {
    console.error('Reconciliation cron error:', err);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  if (!operatorSecret) {
    console.warn('[scheduler] OPERATOR_SECRET not set — payment scheduler disabled.');
  }
  // Initial fetch of events
  eventIndexer.fetchAndStoreEvents();
});
