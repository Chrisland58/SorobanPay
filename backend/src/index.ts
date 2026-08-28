import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { validateConfig } from './lib/config';
import { EventIndexer } from './services/eventIndexer';
import { PayoutSummaryGenerator } from './services/payoutSummaryGenerator';
import { PaymentScheduler } from './services/paymentScheduler';
import { PaymentStateMachine } from './services/paymentStateMachine';
import summariesRouter from './routes/summaries';
import subscriptionsRouter from './routes/subscriptions';
import auditLogsRouter from './routes/auditLogs';
import settlementsRouter from './routes/settlements';
import paymentsRouter from './routes/payments';
import { apiLimiter } from './middleware/rateLimiter';

const app = express();
const { port: PORT, rpcUrl, contractId } = config;

// Middleware
app.use(cors());
app.use(express.json());
app.use(apiLimiter);

// Routes
app.use('/api/summaries', summariesRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/settlements', settlementsRouter);
app.use('/api/payments', paymentsRouter);

// Initialize services
const rpcUrl = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const contractId = process.env.CONTRACT_ID || '';
const networkPassphrase = process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

const eventIndexer = new EventIndexer(rpcUrl, contractId);
const summaryGenerator = new PayoutSummaryGenerator();
const paymentStateMachine = new PaymentStateMachine();

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

// Process payment state machine timeouts every minute
cron.schedule('* * * * *', async () => {
  const count = await paymentStateMachine.processTimeouts();
  if (count > 0) console.log(`[state-machine] Timed out ${count} payment(s).`);
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
