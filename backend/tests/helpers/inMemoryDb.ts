/**
 * inMemoryDb.ts
 *
 * Lightweight in-process stand-in for Prisma + PostgreSQL.
 * Implements only the methods exercised in integration tests.
 * Satisfies the SubscriptionDB interface from reconciler.ts.
 */

import type { SubscriptionDB, StoredSubscription } from '../../reconciler';

// ── In-memory subscription store ──────────────────────────────────────────────

export class InMemorySubscriptionDB implements SubscriptionDB {
  private store = new Map<string, StoredSubscription>();

  private key(subscriber: string, merchant: string, token: string) {
    return `${subscriber}:${merchant}:${token}`;
  }

  get(subscriber: string, merchant: string, token: string): StoredSubscription | undefined {
    return this.store.get(this.key(subscriber, merchant, token));
  }

  upsert(record: StoredSubscription): void {
    this.store.set(this.key(record.subscriber, record.merchant, record.token), record);
  }

  delete(subscriber: string, merchant: string, token: string): void {
    this.store.delete(this.key(subscriber, merchant, token));
  }

  all(): StoredSubscription[] {
    return Array.from(this.store.values());
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

// ── In-memory event/summary store (Prisma-compatible shapes) ─────────────────

export interface StoredEvent {
  id: number;
  type: string;
  subscriber: string;
  merchant: string;
  token: string | null;
  amount: string;
  ledgerTimestamp: bigint;
  createdAt: Date;
}

export interface StoredSummary {
  id: number;
  merchant: string;
  startDate: Date;
  endDate: Date;
  totalAmount: string;
  paymentCount: number;
  currency: string;
  type: string;
  createdAt: Date;
}

// BE-53: webhook endpoint and delivery shapes
export interface StoredWebhookEndpoint {
  id: number;
  merchant: string;
  url: string;
  active: boolean;
  events: string;
  createdAt: Date;
}

export interface StoredWebhookDelivery {
  id: number;
  url: string;
  merchant: string;
  event: string;
  payload: string;
  statusCode: number;
  attempt: number;
  success: boolean;
  error?: string;
  createdAt: Date;
}

/** Minimal Prisma-compatible client for use in integration tests. */
export class InMemoryPrismaClient {
  private events: StoredEvent[] = [];
  private summaries: StoredSummary[] = [];
  private webhookEndpoints: StoredWebhookEndpoint[] = [];
  private webhookDeliveries: StoredWebhookDelivery[] = [];
  private nextEventId = 1;
  private nextSummaryId = 1;
  private nextEndpointId = 1;
  private nextDeliveryId = 1;

  event = {
    findFirst: async (args: { where: Partial<StoredEvent> }) => {
      return this.events.find((e) => this.matchesEvent(e, args.where as any)) ?? null;
    },
    findMany: async (args?: { where?: Partial<StoredEvent & { createdAt?: { gte?: Date; lte?: Date } }> }) => {
      if (!args?.where) return [...this.events];
      return this.events.filter((e) => {
        const { createdAt, ...rest } = args.where as any;
        if (!this.matchesEvent(e, rest)) return false;
        if (createdAt?.gte && e.createdAt < createdAt.gte) return false;
        if (createdAt?.lte && e.createdAt > createdAt.lte) return false;
        return true;
      });
    },
    create: async (args: { data: Omit<StoredEvent, 'id' | 'createdAt'> }) => {
      const record: StoredEvent = {
        ...args.data,
        id: this.nextEventId++,
        createdAt: new Date(),
      };
      this.events.push(record);
      return record;
    },
  };

  payoutSummary = {
    findUnique: async (args: { where: { id: number } }) => {
      return this.summaries.find((s) => s.id === args.where.id) ?? null;
    },
    findFirst: async (args: { where: Partial<StoredSummary> }) => {
      return this.summaries.find((s) => this.matchesSummary(s, args.where as any)) ?? null;
    },
    findMany: async (args?: { where?: Partial<StoredSummary>; orderBy?: object }) => {
      if (!args?.where) return [...this.summaries];
      return this.summaries.filter((s) => this.matchesSummary(s, args.where!));
    },
    create: async (args: { data: Omit<StoredSummary, 'id' | 'createdAt'> }) => {
      const record: StoredSummary = {
        ...args.data,
        id: this.nextSummaryId++,
        createdAt: new Date(),
      };
      this.summaries.push(record);
      return record;
    },
    update: async (args: { where: { id: number }; data: Partial<StoredSummary> }) => {
      const idx = this.summaries.findIndex((s) => s.id === args.where.id);
      if (idx === -1) throw new Error(`Summary ${args.where.id} not found`);
      this.summaries[idx] = { ...this.summaries[idx], ...args.data };
      return this.summaries[idx];
    },
  };

  // BE-53: webhook endpoint table
  webhookEndpoint = {
    findMany: async (args?: { where?: Partial<StoredWebhookEndpoint> }) => {
      if (!args?.where) return [...this.webhookEndpoints];
      return this.webhookEndpoints.filter((ep) =>
        Object.entries(args.where!).every(([k, v]) => (ep as any)[k] === v),
      );
    },
    create: async (args: { data: Omit<StoredWebhookEndpoint, 'id' | 'createdAt'> }) => {
      const record: StoredWebhookEndpoint = {
        ...args.data,
        id: this.nextEndpointId++,
        createdAt: new Date(),
      };
      this.webhookEndpoints.push(record);
      return record;
    },
  };

  // BE-53: webhook delivery table
  webhookDelivery = {
    create: async (args: { data: Omit<StoredWebhookDelivery, 'id' | 'createdAt'> }) => {
      const record: StoredWebhookDelivery = {
        ...args.data,
        id: this.nextDeliveryId++,
        createdAt: new Date(),
      };
      this.webhookDeliveries.push(record);
      return record;
    },
    findMany: async (args?: { where?: Partial<StoredWebhookDelivery> }) => {
      if (!args?.where) return [...this.webhookDeliveries];
      return this.webhookDeliveries.filter((d) =>
        Object.entries(args.where!).every(([k, v]) => (d as any)[k] === v),
      );
    },
  };

  private matchesEvent(record: StoredEvent, where: Record<string, any>): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      return String((record as any)[k]) === String(v);
    });
  }

  private matchesSummary(record: StoredSummary, where: Record<string, any>): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      return String((record as any)[k]) === String(v);
    });
  }

  /** Seed events directly for test setup. */
  seedEvents(events: Omit<StoredEvent, 'id' | 'createdAt'>[]): void {
    for (const e of events) {
      this.events.push({ ...e, id: this.nextEventId++, createdAt: new Date() });
    }
  }

  /** Seed webhook endpoints directly for test setup. */
  seedEndpoints(endpoints: Omit<StoredWebhookEndpoint, 'id' | 'createdAt'>[]): void {
    for (const ep of endpoints) {
      this.webhookEndpoints.push({ ...ep, id: this.nextEndpointId++, createdAt: new Date() });
    }
  }

  reset(): void {
    this.events = [];
    this.summaries = [];
    this.webhookEndpoints = [];
    this.webhookDeliveries = [];
    this.nextEventId = 1;
    this.nextSummaryId = 1;
    this.nextEndpointId = 1;
    this.nextDeliveryId = 1;
  }
}
