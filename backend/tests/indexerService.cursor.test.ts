/**
 * indexerService.cursor.test.ts  — Issue #1419
 *
 * Unit tests for EventIndexer cursor management (saving/loading from DB,
 * pagination) via IndexerStateService:
 *
 *   1. First run: starts from ledger 0, saves cursor after processing
 *   2. Resume: loads cursor from DB, starts from saved position
 *   3. Pagination: processes multiple pages of events
 *   4. Empty response: cursor not advanced, no error
 *   5. RPC error: cursor not advanced, retry on next poll
 *   6. DB save failure: error logged, cursor not lost (in-memory state preserved)
 *
 * DB and RPC are both mocked. Tests run under `npm run test` in backend/.
 * Coverage target for IndexerService cursor path: >= 85%.
 */

// --- Mock @stellar/stellar-sdk ------------------------------------------------

const mockServer = {
  getEvents: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn(() => mockServer),
  },
  xdr: {
    ScVal: { fromXDR: jest.fn() },
  },
  __mockServer: mockServer,
}));

// --- Mock prisma with in-memory client ----------------------------------------

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('./helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

// --- Mock AuditLogger ---------------------------------------------------------

jest.mock('../src/services/auditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({
    logPayment: jest.fn().mockResolvedValue(undefined),
  })),
}));

// --- Mock tracing (avoid OTel setup) ------------------------------------------

jest.mock('../src/lib/tracing', () => ({
  getTracer: jest.fn(),
  withSpan: jest.fn().mockImplementation(
    (_tracer: string, _name: string, fn: (span: object) => unknown) =>
      fn({ setAttributes: jest.fn() }),
  ),
  SpanKind: {},
}));

// --- Mock retryQueue ----------------------------------------------------------

jest.mock('../src/services/retryQueue', () => ({
  enqueueRetries: jest.fn().mockResolvedValue([]),
}));

// --- Mock emailService --------------------------------------------------------

jest.mock('../src/services/emailService', () => ({
  sendPaymentFailureEmail: jest.fn().mockResolvedValue(undefined),
  sendCancellationEmail: jest.fn().mockResolvedValue(undefined),
}));

// --- Mock redis ---------------------------------------------------------------

jest.mock('../src/lib/redis', () => ({
  publishCacheInvalidation: jest.fn().mockResolvedValue(undefined),
  cacheDeletePattern: jest.fn().mockResolvedValue(undefined),
  CacheKey: {},
}));

// --- Mock subscriptionStateService -------------------------------------------

jest.mock('../src/services/subscriptionStateService', () => ({
  applyEvent: jest.fn().mockResolvedValue(undefined),
}));

// --- backoff: controlled pass-through or rejection ---------------------------

const mockWithBackoff = jest.fn().mockImplementation((fn: () => unknown) => fn());
jest.mock('../src/lib/backoff', () => ({
  withBackoff: (...args: unknown[]) => mockWithBackoff(...args),
  isRpcRetryable: jest.fn().mockReturnValue(true),
}));

// --- Use REAL IndexerStateService wired to the in-memory Prisma mock ---------

jest.mock('../src/services/indexerStateService', () => {
  const real = jest.requireActual('../src/services/indexerStateService');
  return real;
});

// --- Imports ------------------------------------------------------------------

import { EventIndexer } from '../src/services/eventIndexer';
import { indexerStateService } from '../src/services/indexerStateService';
import { InMemoryPrismaClient } from './helpers/inMemoryDb';
import prisma from '../src/lib/prisma';

const db = prisma as unknown as InMemoryPrismaClient;

// --- Minimal ScVal stubs that satisfy scValToSymbol/scValToAddress/scValToAmount

class StubScVal {
  constructor(
    private _type: 'symbol' | 'address' | 'i128',
    private _value: string,
  ) {}

  sym() {
    if (this._type !== 'symbol') throw new Error('not symbol');
    return { toString: () => this._value };
  }

  address() {
    if (this._type !== 'address') throw new Error('not address');
    return { toString: () => this._value };
  }

  i128() {
    if (this._type !== 'i128') throw new Error('not i128');
    return { toString: () => this._value };
  }
}

function makeEvent(id: string, ledger: number, type = 'subscribe') {
  return {
    id,
    pagingToken: id,
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    inSuccessfulContractCall: true,
    contractId: 'CTEST',
    type: 'contract',
    topic: [
      new StubScVal('symbol', type),
      new StubScVal('address', 'GSUB001'),
      new StubScVal('address', 'GMERCH001'),
      new StubScVal('address', 'CTOK001'),
    ],
    value: new StubScVal('i128', '1000'),
    txHash: id,
  };
}

// --- Setup / teardown ---------------------------------------------------------

beforeEach(async () => {
  db.reset();
  mockServer.getEvents.mockReset();
  mockWithBackoff.mockReset();
  mockWithBackoff.mockImplementation((fn: () => unknown) => fn());
  await indexerStateService.clearState();
});

// --- 1. First run: starts from ledger 0, saves cursor after processing --------

describe('IndexerService cursor: first run', () => {
  it('uses startLedger when no cursor exists', async () => {
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(mockServer.getEvents).toHaveBeenCalledTimes(1);
    const callArg = mockServer.getEvents.mock.calls[0][0];
    expect(callArg.startLedger).toBeDefined();
    expect(callArg.cursor).toBeUndefined();
  });

  it('saves cursor after processing first batch', async () => {
    const event = makeEvent('first-run-001', 50);
    mockServer.getEvents.mockResolvedValue({ events: [event] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    const cursor = await indexerStateService.getLastCursor();
    expect(cursor).toBe('first-run-001');
  });

  it('saves last processed ledger after first batch', async () => {
    const event = makeEvent('first-run-002', 75);
    mockServer.getEvents.mockResolvedValue({ events: [event] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    const ledger = await indexerStateService.getLastProcessedLedger();
    expect(ledger).toBe(75);
  });

  it('cursor equals the id of the last event in the batch', async () => {
    const events = [
      makeEvent('event-1', 10),
      makeEvent('event-2', 11),
      makeEvent('event-3', 12),
    ];
    mockServer.getEvents.mockResolvedValue({ events });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(await indexerStateService.getLastCursor()).toBe('event-3');
  });

  it('last ledger equals the max ledger in the batch', async () => {
    const events = [
      makeEvent('ml-1', 10),
      makeEvent('ml-2', 15),
      makeEvent('ml-3', 20),
    ];
    mockServer.getEvents.mockResolvedValue({ events });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(await indexerStateService.getLastProcessedLedger()).toBe(20);
  });

  it('stores events from the first batch', async () => {
    const event = makeEvent('first-store-001', 50, 'subscribe');
    mockServer.getEvents.mockResolvedValue({ events: [event] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    const stored = await db.event.findMany();
    expect(stored).toHaveLength(1);
  });
});

// --- 2. Resume: loads cursor from DB, starts from saved position --------------

describe('IndexerService cursor: resume', () => {
  it('uses saved cursor instead of startLedger on restart', async () => {
    await indexerStateService.saveState('cursor-from-previous-run', 100);
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    const callArg = mockServer.getEvents.mock.calls[0][0];
    expect(callArg.cursor).toBe('cursor-from-previous-run');
    expect(callArg.startLedger).toBeUndefined();
  });

  it('resumes from exactly the saved cursor position', async () => {
    const savedCursor = 'ledger-200-event-5';
    await indexerStateService.saveState(savedCursor, 200);
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(mockServer.getEvents.mock.calls[0][0].cursor).toBe(savedCursor);
  });

  it('advances cursor after resuming from saved position', async () => {
    await indexerStateService.saveState('old-cursor', 100);

    const newEvent = makeEvent('new-event-after-resume', 101);
    mockServer.getEvents.mockResolvedValue({ events: [newEvent] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(await indexerStateService.getLastCursor()).toBe('new-event-after-resume');
  });

  it('advances ledger after resuming', async () => {
    await indexerStateService.saveState('old-cursor', 100);

    const newEvent = makeEvent('resume-advance-001', 150);
    mockServer.getEvents.mockResolvedValue({ events: [newEvent] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(await indexerStateService.getLastProcessedLedger()).toBe(150);
  });

  it('multiple restarts always resume from the latest saved cursor', async () => {
    for (let run = 1; run <= 3; run++) {
      const event = makeEvent(`run${run}-event`, run * 100);
      mockServer.getEvents.mockResolvedValue({ events: [event] });

      const indexer = new EventIndexer('http://rpc.test', 'CTEST');
      await indexer.fetchAndStoreEventsWithCursor();
    }

    expect(await indexerStateService.getLastCursor()).toBe('run3-event');
    expect(await indexerStateService.getLastProcessedLedger()).toBe(300);
  });
});

// --- 3. Pagination: processes multiple pages of events -----------------------

describe('IndexerService cursor: pagination', () => {
  it('processes all events in a batch of 10', async () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent(`page1-event-${i}`, 100 + i),
    );
    mockServer.getEvents.mockResolvedValue({ events });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(await db.event.findMany()).toHaveLength(10);
  });

  it('cursor set to last event id after large batch', async () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      makeEvent(`batch-event-${i.toString().padStart(3, '0')}`, 200 + i),
    );
    mockServer.getEvents.mockResolvedValue({ events });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(await indexerStateService.getLastCursor()).toBe('batch-event-049');
  });

  it('second poll uses cursor from first poll', async () => {
    const page1Events = Array.from({ length: 5 }, (_, i) =>
      makeEvent(`page1-event-${i}`, 100 + i),
    );
    mockServer.getEvents.mockResolvedValueOnce({ events: page1Events });

    const indexer1 = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer1.fetchAndStoreEventsWithCursor();
    expect(await indexerStateService.getLastCursor()).toBe('page1-event-4');

    const page2Events = Array.from({ length: 5 }, (_, i) =>
      makeEvent(`page2-event-${i}`, 110 + i),
    );
    mockServer.getEvents.mockResolvedValueOnce({ events: page2Events });

    const indexer2 = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer2.fetchAndStoreEventsWithCursor();

    const secondCallArg = mockServer.getEvents.mock.calls[1][0];
    expect(secondCallArg.cursor).toBe('page1-event-4');
    expect(await indexerStateService.getLastCursor()).toBe('page2-event-4');
  });

  it('does not create duplicate events across two poll cycles', async () => {
    const initialEvents = Array.from({ length: 3 }, (_, i) =>
      makeEvent(`dedup-event-${i}`, 300 + i),
    );
    mockServer.getEvents.mockResolvedValueOnce({ events: initialEvents });

    const indexer1 = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer1.fetchAndStoreEventsWithCursor();
    expect(await db.event.findMany()).toHaveLength(3);

    // Same events again (deduplication must prevent re-insert)
    mockServer.getEvents.mockResolvedValueOnce({ events: initialEvents });

    const indexer2 = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer2.fetchAndStoreEventsWithCursor();

    expect(await db.event.findMany()).toHaveLength(3);
  });
});

// --- 4. Empty response: cursor not advanced, no error ------------------------

describe('IndexerService cursor: empty response', () => {
  it('does not throw on empty events response', async () => {
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await expect(indexer.fetchAndStoreEventsWithCursor()).resolves.toBeUndefined();
  });

  it('does not advance cursor when no events returned', async () => {
    await indexerStateService.saveState('cursor-before-empty', 50);
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(await indexerStateService.getLastCursor()).toBe('cursor-before-empty');
  });

  it('does not advance ledger when no events returned', async () => {
    await indexerStateService.saveState('some-cursor', 99);
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(await indexerStateService.getLastProcessedLedger()).toBe(99);
  });

  it('writes no events when response is empty', async () => {
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(await db.event.findMany()).toHaveLength(0);
  });

  it('makes exactly one getEvents call for empty response', async () => {
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEventsWithCursor();

    expect(mockServer.getEvents).toHaveBeenCalledTimes(1);
  });
});

// --- 5. RPC error: cursor not advanced, retry on next poll -------------------

describe('IndexerService cursor: RPC error', () => {
  it('throws when RPC getEvents rejects after retries exhausted', async () => {
    mockWithBackoff.mockRejectedValue(new Error('RPC connection refused'));

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await expect(indexer.fetchAndStoreEventsWithCursor()).rejects.toThrow(
      /RPC connection refused/i,
    );
  });

  it('does not advance cursor when RPC error occurs', async () => {
    await indexerStateService.saveState('cursor-before-error', 200);
    mockWithBackoff.mockRejectedValue(new Error('Network timeout'));

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await expect(indexer.fetchAndStoreEventsWithCursor()).rejects.toThrow();

    expect(await indexerStateService.getLastCursor()).toBe('cursor-before-error');
  });

  it('does not advance ledger when RPC error occurs', async () => {
    await indexerStateService.saveState('cursor-x', 250);
    mockWithBackoff.mockRejectedValue(new Error('Network timeout'));

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await expect(indexer.fetchAndStoreEventsWithCursor()).rejects.toThrow();

    expect(await indexerStateService.getLastProcessedLedger()).toBe(250);
  });

  it('stores no events when RPC error occurs', async () => {
    mockWithBackoff.mockRejectedValue(new Error('RPC 503'));

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await expect(indexer.fetchAndStoreEventsWithCursor()).rejects.toThrow();

    expect(await db.event.findMany()).toHaveLength(0);
  });

  it('resumes from saved cursor on the next poll after RPC error', async () => {
    const savedCursor = 'cursor-before-rpc-error';
    await indexerStateService.saveState(savedCursor, 300);

    // First call fails
    mockWithBackoff.mockRejectedValueOnce(new Error('Transient RPC error'));
    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await expect(indexer.fetchAndStoreEventsWithCursor()).rejects.toThrow();

    // Restore for the next poll
    mockWithBackoff.mockImplementation((fn: () => unknown) => fn());
    const event = makeEvent('recovery-event-001', 301);
    mockServer.getEvents.mockResolvedValue({ events: [event] });

    const indexer2 = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer2.fetchAndStoreEventsWithCursor();

    expect(mockServer.getEvents.mock.calls[0][0].cursor).toBe(savedCursor);
    expect(await indexerStateService.getLastCursor()).toBe('recovery-event-001');
  });
});

// --- 6. DB save failure: error logged, cursor not lost -----------------------

describe('IndexerService cursor: DB save failure', () => {
  it('throws when saveState fails after processing events', async () => {
    const event = makeEvent('db-fail-event-001', 400);
    mockServer.getEvents.mockResolvedValue({ events: [event] });

    const saveStateSpy = jest
      .spyOn(indexerStateService, 'saveState')
      .mockRejectedValue(new Error('DB write failed'));

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await expect(indexer.fetchAndStoreEventsWithCursor()).rejects.toThrow(/DB write failed/i);

    saveStateSpy.mockRestore();
  });

  it('cursor remains at last good value when DB save fails', async () => {
    await indexerStateService.saveState('cursor-before-db-fail', 399);

    const event = makeEvent('db-fail-event-002', 400);
    mockServer.getEvents.mockResolvedValue({ events: [event] });

    const saveStateSpy = jest
      .spyOn(indexerStateService, 'saveState')
      .mockRejectedValue(new Error('DB write failed'));

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await expect(indexer.fetchAndStoreEventsWithCursor()).rejects.toThrow();

    // Cursor must NOT have moved
    expect(await indexerStateService.getLastCursor()).toBe('cursor-before-db-fail');

    saveStateSpy.mockRestore();
  });

  it('retries from last good cursor after DB failure is resolved', async () => {
    await indexerStateService.saveState('good-cursor', 450);

    const saveStateSpy = jest
      .spyOn(indexerStateService, 'saveState')
      .mockRejectedValueOnce(new Error('DB write failed'))
      .mockResolvedValue(undefined);

    const event1 = makeEvent('attempt-1-event', 451);
    mockServer.getEvents
      .mockResolvedValueOnce({ events: [event1] })
      .mockResolvedValueOnce({ events: [event1] });

    // First attempt fails to save cursor
    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await expect(indexer.fetchAndStoreEventsWithCursor()).rejects.toThrow();
    expect(await indexerStateService.getLastCursor()).toBe('good-cursor');

    // Second attempt succeeds
    const indexer2 = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer2.fetchAndStoreEventsWithCursor();
    expect(await indexerStateService.getLastCursor()).toBe('attempt-1-event');

    saveStateSpy.mockRestore();
  });
});

// --- Polling lifecycle --------------------------------------------------------

describe('IndexerService cursor: polling lifecycle', () => {
  it('startPolling triggers at least one fetchAndStoreEventsWithCursor call', async () => {
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    indexer.startPolling(10_000); // long interval — only first immediate tick runs

    await new Promise((r) => setTimeout(r, 50));
    indexer.stopPolling();

    expect(mockServer.getEvents).toHaveBeenCalledTimes(1);
  });

  it('stopPolling prevents additional ticks after stop', async () => {
    let callCount = 0;
    mockServer.getEvents.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ events: [] });
    });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    indexer.startPolling(50);

    await new Promise((r) => setTimeout(r, 20));
    indexer.stopPolling();
    const countAtStop = callCount;

    await new Promise((r) => setTimeout(r, 200));
    expect(callCount).toBe(countAtStop);
  });
});
