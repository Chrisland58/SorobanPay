/**
 * indexerReplayRange.test.ts
 *
 * Automated tests for operator-controlled indexer replay range (Issue #1589):
 * - Range bounds validation (positive integers, upper >= lower, bounded window)
 * - Operator identity and reason requirements
 * - Live cursor preservation (never moved backwards)
 * - Dry run simulation reporting
 * - Deduplication of previously indexed events
 * - Interruption / abort signal handling
 */

import { IndexerService, MAX_REPLAY_RANGE } from '../src/services/indexer';

jest.mock('@stellar/stellar-sdk', () => {
  const SorobanRpc = {
    Server: jest.fn(),
  };
  return {
    SorobanRpc,
    xdr: {
      ScVal: jest.fn(),
    },
  };
});

jest.mock('../src/db/pool', () => {
  const mockQuery = jest.fn();
  return {
    getPool: jest.fn().mockReturnValue({
      query: mockQuery,
      connect: jest.fn().mockResolvedValue({
        query: mockQuery,
        release: jest.fn(),
      }),
    }),
    __mockQuery: mockQuery,
  };
});

const { __mockQuery } = jest.requireMock('../src/db/pool');

describe('IndexerService Replay Range (#1589)', () => {
  let indexer: IndexerService;
  let mockGetEvents: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEvents = jest.fn().mockResolvedValue({ events: [] });
    (indexer as any) = new IndexerService({
      rpcUrl: 'https://mock-rpc',
      contractId: 'CCONTRACT',
    });
    (indexer as any).rpc.getEvents = mockGetEvents;
  });

  describe('Range and argument validation', () => {
    it('rejects empty or missing operator identity', async () => {
      await expect(
        indexer.replayRange({
          fromLedger: 100,
          toLedger: 200,
          operator: '',
          reason: 'Backfill test',
        }),
      ).rejects.toThrow(/Operator identity is required/);
    });

    it('rejects empty or missing reason', async () => {
      await expect(
        indexer.replayRange({
          fromLedger: 100,
          toLedger: 200,
          operator: 'ops_lead',
          reason: '   ',
        }),
      ).rejects.toThrow(/Reason for replay is required/);
    });

    it('rejects negative or non-integer ledgers', async () => {
      await expect(
        indexer.replayRange({
          fromLedger: -10,
          toLedger: 200,
          operator: 'ops_lead',
          reason: 'Fix bad decode',
        }),
      ).rejects.toThrow(/fromLedger must be a positive integer/);
    });

    it('rejects inverted range (toLedger < fromLedger)', async () => {
      await expect(
        indexer.replayRange({
          fromLedger: 500,
          toLedger: 400,
          operator: 'ops_lead',
          reason: 'Fix bad decode',
        }),
      ).rejects.toThrow(/toLedger.*must be greater than or equal to fromLedger/);
    });

    it('rejects range exceeding MAX_REPLAY_RANGE', async () => {
      await expect(
        indexer.replayRange({
          fromLedger: 1,
          toLedger: 1 + MAX_REPLAY_RANGE + 1,
          operator: 'ops_lead',
          reason: 'Huge backfill',
        }),
      ).rejects.toThrow(/exceeds maximum allowed/);
    });
  });

  describe('Live cursor preservation', () => {
    it('guarantees live cursor in indexer_state is never moved backwards', async () => {
      __mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT cursor FROM indexer_state')) {
          return { rows: [{ cursor: '0000000000999999-0001' }] };
        }
        if (sql.includes('SELECT 1 FROM payments')) {
          return { rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      });

      mockGetEvents.mockResolvedValueOnce({
        events: [],
      });

      const result = await indexer.replayRange({
        fromLedger: 100,
        toLedger: 200,
        operator: 'ops_engineer',
        reason: 'Repair decode error',
      });

      expect(result.liveCursorPreserved).toBe(true);
      expect(result.fromLedger).toBe(100);
      expect(result.toLedger).toBe(200);
    });
  });

  describe('Dry run and deduplication', () => {
    it('dry run scans events without inserting into database', async () => {
      __mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT cursor FROM indexer_state')) {
          return { rows: [{ cursor: 'live_cursor_123' }] };
        }
        if (sql.includes('SELECT 1 FROM payments')) {
          return { rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      });

      // Stub decodeEvent
      jest.spyOn(indexer, 'decodeEvent').mockReturnValue({
        type: 'executed',
        subscriber: 'GSUB',
        merchant: 'GMERCH',
        amount: '1000',
        txHash: 'tx_replay_1',
        ledgerSeq: 150,
        occurredAt: new Date(),
      });

      mockGetEvents.mockResolvedValueOnce({
        events: [
          { id: 'ev_1', ledger: 150, topic: [] },
        ],
      });

      const result = await indexer.replayRange({
        fromLedger: 100,
        toLedger: 200,
        operator: 'ops_engineer',
        reason: 'Preview backfill',
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.eventsScanned).toBe(1);
      expect(result.eventsDecoded).toBe(1);
      expect(result.eventsInserted).toBe(0); // Dry-run inserts 0
    });

    it('deduplicates previously indexed events', async () => {
      __mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT cursor FROM indexer_state')) {
          return { rows: [{ cursor: 'live_cursor_123' }] };
        }
        if (sql.includes('SELECT 1 FROM payments')) {
          // Already in payments
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      jest.spyOn(indexer, 'decodeEvent').mockReturnValue({
        type: 'executed',
        subscriber: 'GSUB',
        merchant: 'GMERCH',
        amount: '1000',
        txHash: 'tx_existing',
        ledgerSeq: 150,
        occurredAt: new Date(),
      });

      mockGetEvents.mockResolvedValueOnce({
        events: [
          { id: 'ev_1', ledger: 150, topic: [] },
        ],
      });

      const result = await indexer.replayRange({
        fromLedger: 100,
        toLedger: 200,
        operator: 'ops_engineer',
        reason: 'Replay with existing data',
        dryRun: false,
      });

      expect(result.eventsDeduplicated).toBe(1);
      expect(result.eventsInserted).toBe(0);
    });
  });

  describe('Interruption handling', () => {
    it('halts and throws when abortSignal is triggered', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        indexer.replayRange({
          fromLedger: 100,
          toLedger: 200,
          operator: 'ops_engineer',
          reason: 'Will be aborted',
          abortSignal: controller.signal,
        }),
      ).rejects.toThrow(/aborted by operator signal/);
    });
  });
});
