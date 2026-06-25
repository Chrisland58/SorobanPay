import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { validateConfig } from './lib/config';
import { EventIndexer } from './services/eventIndexer';
import { PayoutSummaryGenerator } from './services/payoutSummaryGenerator';
import summariesRouter from './routes/summaries';
import { buildHealthRouter } from './routes/health';

// Validate config first — exits with a clear error if anything is missing/wrong
const config = (() => {
  try {
    return validateConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
})();

const app = express();
const { port: PORT, rpcUrl, contractId } = config;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/summaries', summariesRouter);
app.use('/health', buildHealthRouter(rpcUrl, contractId));

const eventIndexer = new EventIndexer(rpcUrl, contractId);
const summaryGenerator = new PayoutSummaryGenerator();

// Schedule jobs
// Fetch events every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('Fetching new events...');
  await eventIndexer.fetchAndStoreEvents();
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

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  // Initial fetch of events
  eventIndexer.fetchAndStoreEvents();
});
