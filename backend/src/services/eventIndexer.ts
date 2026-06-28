import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import prisma from '../lib/prisma';
import { AuditLogger } from './auditLogger';

const auditLogger = new AuditLogger();
const SUPPORTED_EVENT_TYPES = new Set(['subscribe', 'executed']);

function decodeScValSymbol(encoded: string): string | null {
  try {
    const scVal = xdr.ScVal.fromXDR(encoded, 'base64');
    return scVal.sym().toString();
  } catch {
    return null;
  }
}

function decodeScValAddress(encoded: string): string | null {
  try {
    const scVal = xdr.ScVal.fromXDR(encoded, 'base64');
    return scVal.address().toString();
  } catch {
    return null;
  }
}

function decodeScValAmount(encoded: string): string | null {
  try {
    const scVal = xdr.ScVal.fromXDR(encoded, 'base64');
    try {
      return scVal.i128().toString();
    } catch {
      return scVal.u64().toString();
    }
  } catch {
    return null;
  }
}

export class EventIndexer {
  private rpcUrl: string;
  private contractId: string;
  private server: SorobanRpc.Server;

  constructor(rpcUrl: string, contractId: string) {
    this.rpcUrl = rpcUrl;
    this.contractId = contractId;
    this.server = new SorobanRpc.Server(rpcUrl);
  }

  async fetchAndStoreEvents(startLedger?: number): Promise<void> {
    try {
      const eventsResponse = await this.server.getEvents({
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [this.contractId],
          },
        ],
        limit: 100,
      });

      const events = eventsResponse.events ?? [];
      if (events.length === 0) {
        console.log('No new events found');
        return;
      }

      console.log(`Found ${events.length} contract events`);

      for (const event of events) {
        await this.processEvent(event);
      }

      console.log('Events processed successfully');
    } catch (error) {
      console.error('Error fetching events:', error);
    }
  }

  private async processEvent(event: SorobanRpc.RawEvent): Promise<void> {
    try {
      const topics = event.topic;
      if (!topics || topics.length < 4) {
        return;
      }

      const eventType = decodeScValSymbol(topics[0]);
      if (!eventType || !SUPPORTED_EVENT_TYPES.has(eventType)) {
        return;
      }

      const subscriber = decodeScValAddress(topics[1]);
      const merchant = decodeScValAddress(topics[2]);
      const token = decodeScValAddress(topics[3]);
      const amount = decodeScValAmount(event.value);

      if (!subscriber || !merchant || !token || amount === null) {
        return;
      }

      const ledgerTimestamp = BigInt(event.ledger);
      const existingEvent = await prisma.event.findFirst({
        where: {
          type: eventType,
          subscriber,
          merchant,
          token,
          amount,
          ledgerTimestamp,
        },
      });

      if (existingEvent) {
        return;
      }

      await prisma.event.create({
        data: {
          type: eventType,
          subscriber,
          merchant,
          token,
          amount,
          ledgerTimestamp,
        },
      });

      if (eventType === 'executed') {
        await auditLogger.logPayment({
          eventType,
          subscriber,
          merchant,
          token,
          amount,
          transactionHash: event.id,
          ledger: ledgerTimestamp,
        });
      }

      console.log(`Stored event: ${eventType} for merchant ${merchant}`);
    } catch (error) {
      console.error('Error processing event:', error);
    }
  }
}
