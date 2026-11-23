# SorobanPay Backend

Backend service for merchant payout scheduling and event indexing for SorobanPay.

## Features

- **Event Indexing**: Fetches and stores Soroban contract events (subscribe, executed)
- **Payout Summaries**: Generates daily and weekly payout summaries for merchants
- **Scheduled Jobs**: Automatically fetches events and generates summaries on a schedule
- **API Endpoints**: Provides REST API to retrieve payout summaries

## Tech Stack

- Node.js with TypeScript
- Express.js
- Prisma ORM
- PostgreSQL
- node-cron for scheduling
- @stellar/stellar-sdk for Soroban interaction

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm or yarn

### Installation

1. Install dependencies:
```bash
cd backend
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
```
Edit `.env` and fill in the required values. All variables are documented with descriptions inside `.env.example`.

3. Set up the database:
```bash
npx prisma migrate dev
```

4. Generate Prisma client:
```bash
npx prisma generate
```

5. Run the server:
```bash
npm run dev
```

## API Endpoints

### Get Summaries for Merchant
```
GET /api/summaries/merchant/:merchantAddress?type=daily|weekly
```

### Get Summary by ID
```
GET /api/summaries/:id
```

## Scheduled Jobs

- **Event Fetching**: Every 5 minutes
- **Daily Summaries**: 1:00 AM every day
- **Weekly Summaries**: 2:00 AM every Sunday

## Event Indexer Recovery

The EventIndexer tracks its position using the highest `ledgerTimestamp` stored in the `Event` table. If the process crashes, it auto-resumes from `MAX(ledgerTimestamp) - 2` ledgers (the safe replay bound) on the next start — no manual cursor reset is needed.

For detailed recovery procedures, including read-only diagnosis queries, state-changing recovery steps, a testnet walkthrough with expected console output, and verification steps before resuming normal operation, see [`docs/indexer-recovery.md`](docs/indexer-recovery.md).

Relevant methods on `EventIndexer`:

| Method | Description |
|---|---|
| `getCheckpoint()` | Returns `MAX(ledgerTimestamp)` from the Event table, or `0` if empty |
| `getSafeReplayLedger(checkpoint, buffer?)` | Returns `checkpoint - buffer` (default buffer = 2), minimum 0 |

## Project Structure

```
backend/
├── src/
│   ├── generated/
│   │   └── prisma/          # Prisma client
│   ├── lib/
│   │   └── prisma.ts        # Prisma client initialization
│   ├── routes/
│   │   └── summaries.ts     # API routes for summaries
│   ├── services/
│   │   ├── eventIndexer.ts  # Event indexing service
│   │   └── payoutSummaryGenerator.ts  # Summary generation service
│   └── index.ts             # Main entry point
├── prisma/
│   └── schema.prisma        # Database schema
├── package.json
├── tsconfig.json
└── README.md
```
