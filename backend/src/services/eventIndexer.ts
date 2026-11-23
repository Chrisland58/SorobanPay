import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
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
   * Returns the last processed ledger by reading MAX(ledgerTimestamp) from the
   * Event table. Returns 0 when no events have been stored yet.
   */
  async getCheckpoint(): Promise<number> {
    const result = await prisma.event.findFirst({
      orderBy: { ledgerTimestamp: 'desc' },
      select: { ledgerTimestamp: true },
    });
    if (!result) return 0;
    return Number(result.ledgerTimestamp);
  }

  /**
   * Returns the safe ledger from which replay should start.
   * Subtracts `buffer` (default 2) from `checkpoint` to cover in-flight events
   * that may have been fetched but not yet written before a crash.
   * Never returns a value below 0.
   */
  getSafeReplayLedger(checkpoint: number, buffer: number = 2): number {
    return Math.max(0, checkpoint - buffer);
  }

  /**
   * Fetches events from the Soroban RPC and stores them in the database.
   *
   * When `startLedger` is omitted the method auto-resolves it from the current
   * checkpoint minus the replay buffer, so a process restart after a crash
   * requires no operator intervention.
   */
  async fetchAndStoreEvents(startLedger?: number): Promise<void> {
    try {
      // Auto-resolve start ledger from checkpoint when not supplied
      let resolvedStartLedger = startLedger;
      if (resolvedStartLedger === undefined) {
        const checkpoint = await this.getCheckpoint();
        resolvedStartLedger = this.getSafeReplayLedger(checkpoint);
      }

      let events: SorobanRpc.GetEventsResponse = {
        events: [],
        latestLedger: 0,
      };

      // Fetch events for the contract
      const eventsResponse = await this.server.getEvents({
        startLedger: resolvedStartLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [this.contractId],
          },
        ],
        limit: 100,
      });

      events = eventsResponse;

      if (!events.events || events.events.length === 0) {
        console.log('No new events found');
        return;
      }

      console.log(`Found ${events.events.length} events`);

      // Process and store events
      for (const event of events.events) {
        await this.processEvent(event);
      }

      console.log('Events processed successfully');
    } catch (error) {
      console.error('Error fetching events:', error);
    }
  }

  private async processEvent(event: SorobanRpc.RawEvent): Promise<void> {
    try {
      // Parse the event topics and value
      const topics = event.topic;
      const value = event.value;

      if (!topics || topics.length < 4) {
        return; // Skip invalid events
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
      } catch (e) {
        // If it's not i128, try u64
        amount = amountScVal.u64().toString();
      }

      // Check if event already exists
      const existingEvent = await prisma.event.findFirst({
        where: {
          type: eventType,
          subscriber: subscriber,
          merchant: merchant,
          token: token,
          amount: amount,
          ledgerTimestamp: BigInt(event.ledger),
        },
      });

      if (existingEvent) {
        return; // Skip duplicate
      }

      // Store the event
      await prisma.event.create({
        data: {
          type: eventType,
          subscriber: subscriber,
          merchant: merchant,
          token: token,
          amount: amount,
          ledgerTimestamp: BigInt(event.ledger),
        },
      });

      // Persist audit log for every executed payment
      if (eventType === 'executed') {
        await auditLogger.logPayment({
          eventType,
          subscriber,
          merchant,
          token,
          amount,
          transactionHash: event.id, // Soroban event ID is unique per transaction
          ledger: BigInt(event.ledger),
        });
      }

      console.log(`Stored event: ${eventType} for merchant ${merchant}`);
    } catch (error) {
      console.error('Error processing event:', error);
    }
  }
}
