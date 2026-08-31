import { rpc as SorobanRpc, xdr } from '@stellar/stellar-sdk';
import prisma from '../lib/prisma';
import { AuditLogger } from './auditLogger';

const auditLogger = new AuditLogger();

export class EventIndexer {
  private rpcUrl: string;
  private contractId: string;
  private server: SorobanRpc.Server;

  constructor(rpcUrl: string, contractId: string) {
    this.rpcUrl = rpcUrl;
    this.contractId = contractId;
    this.server = new SorobanRpc.Server(rpcUrl);
  }

  /**
   * BE-51: Read the saved cursor from IndexerState so the indexer can resume
   * from where it left off after a process restart.
   */
  private async loadCursor(): Promise<string | null> {
    const state = await (prisma as any).indexerState.findUnique({
      where: { id: 1 },
    });
    return state?.lastCursor ?? null;
  }

  /**
   * BE-51: Persist the new cursor atomically together with the processed events
   * inside a single database transaction to prevent duplicates on restart.
   */
  private async saveEventsAndCursor(
    eventsData: Array<Parameters<typeof prisma.event.create>[0]['data']>,
    newCursor: string,
  ): Promise<void> {
    await (prisma as any).$transaction(async (tx: any) => {
      for (const data of eventsData) {
        await tx.event.create({ data });
      }
      await tx.indexerState.upsert({
        where: { id: 1 },
        create: { id: 1, lastCursor: newCursor },
        update: { lastCursor: newCursor },
      });
    });
  }

  async fetchAndStoreEvents(startLedger?: number): Promise<void> {
    try {
      // BE-51: Load the saved cursor on every poll cycle.
      // If a cursor is available we pass it to getEvents() instead of
      // startLedger so we never reprocess already-handled ledger events.
      const savedCursor = await this.loadCursor();

      const filters: SorobanRpc.Server.GetEventsRequest['filters'] = [
        {
          type: 'contract',
          contractIds: [this.contractId],
        },
      ];

      // BE-51: Build the request with either cursor (resume) or startLedger
      // (first run). GetEventsRequest is a discriminated union — the cursor
      // variant cannot include startLedger and vice versa.
      let getEventsArgs: SorobanRpc.Server.GetEventsRequest;
      if (savedCursor) {
        getEventsArgs = { cursor: savedCursor, filters, limit: 100 };
      } else {
        // startLedger is required (number) in the ledger-range variant
        getEventsArgs = { startLedger: startLedger ?? 1, filters, limit: 100 };
      }

      const eventsResponse = await this.server.getEvents(getEventsArgs);

      if (!eventsResponse.events || eventsResponse.events.length === 0) {
        console.log('No new events found');
        return;
      }

      console.log(`Found ${eventsResponse.events.length} events`);

      // Parse all events first; skip those that fail or are already stored.
      const pendingEvents: Array<Parameters<typeof prisma.event.create>[0]['data']> = [];
      const pendingAuditLogs: Array<{
        eventType: string;
        subscriber: string;
        merchant: string;
        token: string;
        amount: string;
        transactionHash: string;
        ledger: bigint;
      }> = [];

      for (const event of eventsResponse.events) {
        const parsed = await this.parseEvent(event);
        if (!parsed) continue;

        const { eventType, subscriber, merchant, token, amount } = parsed;

        // Deduplication check before queuing
        const existing = await prisma.event.findFirst({
          where: {
            type: eventType,
            subscriber,
            merchant,
            token,
            amount,
            ledgerTimestamp: BigInt(event.ledger),
          },
        });
        if (existing) continue;

        pendingEvents.push({
          type: eventType,
          subscriber,
          merchant,
          token,
          amount,
          ledgerTimestamp: BigInt(event.ledger),
        });

        if (eventType === 'executed') {
          pendingAuditLogs.push({
            eventType,
            subscriber,
            merchant,
            token,
            amount,
            transactionHash: event.id,
            ledger: BigInt(event.ledger),
          });
        }
      }

      if (pendingEvents.length === 0) {
        console.log('All events already processed');
        return;
      }

      // BE-51: Use the pagingToken of the last event as the new cursor.
      // pagingToken is the opaque string the RPC returns for cursor-based
      // pagination; storing it lets us resume from exactly this position.
      const lastEvent = eventsResponse.events[eventsResponse.events.length - 1];
      const newCursor: string = (lastEvent as any).pagingToken ?? lastEvent.id;

      // BE-51: Save events and cursor atomically so a crash between the two
      // writes can never produce duplicates on the next startup.
      await this.saveEventsAndCursor(pendingEvents, newCursor);

      // Audit logs are best-effort; written outside the atomic transaction
      // because the AuditLog table has a unique constraint on transactionHash.
      for (const log of pendingAuditLogs) {
        await auditLogger.logPayment(log);
      }

      console.log(`Stored ${pendingEvents.length} events; cursor saved: ${newCursor}`);
    } catch (error) {
      console.error('Error fetching events:', error);
    }
  }

  private async parseEvent(event: any): Promise<{
    eventType: string;
    subscriber: string;
    merchant: string;
    token: string;
    amount: string;
  } | null> {
    try {
      const topics = event.topic;
      const value = event.value;

      if (!topics || topics.length < 4) {
        return null; // Skip invalid events
      }

      const eventTypeSymbol = xdr.ScVal.fromXDR(topics[0], 'base64');
      const eventType = eventTypeSymbol.sym().toString();

      const subscriberScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
      const subscriber = subscriberScVal.address().toString();

      const merchantScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
      const merchant = merchantScVal.address().toString();

      const tokenScVal = xdr.ScVal.fromXDR(topics[3], 'base64');
      const token = tokenScVal.address().toString();

      const amountScVal = xdr.ScVal.fromXDR(value, 'base64');
      let amount: string;
      try {
        amount = amountScVal.i128().toString();
      } catch {
        amount = amountScVal.u64().toString();
      }

      return { eventType, subscriber, merchant, token, amount };
    } catch (error) {
      console.error('Error parsing event:', error);
      return null;
    }
  }
}
