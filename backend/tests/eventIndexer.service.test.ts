import { MockRpcServer } from './helpers/mockRpcServer';
import { InMemoryPrismaClient } from './helpers/inMemoryDb';

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('./helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

import prisma from '../../src/lib/prisma';
import { EventIndexer } from '../src/services/eventIndexer';

const db = prisma as unknown as InMemoryPrismaClient;

describe('EventIndexer', () => {
  let mockRpc: MockRpcServer;

  beforeAll(async () => {
    mockRpc = new MockRpcServer();
    await mockRpc.start();
  });

  afterAll(async () => {
    await mockRpc.stop();
  });

  beforeEach(() => {
    db.reset();
  });

  it('stores subscribe and executed events from Soroban RPC', async () => {
    mockRpc.setEvents([
      {
        type: 'subscribe',
        subscriber: 'GSUB1',
        merchant: 'GMERCHANT1',
        token: 'CTOKEN1',
        amount: '1000',
        ledger: 10,
      },
      {
        type: 'executed',
        subscriber: 'GSUB1',
        merchant: 'GMERCHANT1',
        token: 'CTOKEN1',
        amount: '1000',
        ledger: 11,
      },
    ]);

    const indexer = new EventIndexer(mockRpc.baseUrl, 'CTEST');
    await indexer.fetchAndStoreEvents();

    const storedEvents = await db.event.findMany();
    expect(storedEvents).toHaveLength(2);
    expect(storedEvents.map((event) => event.type).sort()).toEqual(['executed', 'subscribe']);
    expect(storedEvents.map((event) => event.amount)).toEqual(['1000', '1000']);
  });

  it('ignores non-subscribe/executed events and skips duplicates', async () => {
    mockRpc.setEvents([
      {
        type: 'cancel',
        subscriber: 'GSUB1',
        merchant: 'GMERCHANT1',
        token: 'CTOKEN1',
        amount: '0',
        ledger: 12,
      },
      {
        type: 'subscribe',
        subscriber: 'GSUB1',
        merchant: 'GMERCHANT1',
        token: 'CTOKEN1',
        amount: '1000',
        ledger: 10,
      },
    ]);

    const indexer = new EventIndexer(mockRpc.baseUrl, 'CTEST');
    await indexer.fetchAndStoreEvents();
    await indexer.fetchAndStoreEvents();

    const storedEvents = await db.event.findMany();
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0].type).toBe('subscribe');
  });
});
