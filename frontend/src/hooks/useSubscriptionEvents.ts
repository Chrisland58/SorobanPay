"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Address, SorobanRpc, xdr } from "@stellar/stellar-sdk";
import { CONTRACT_ID, RPC_URL } from "@/constants/network";
import {
  decodeContractEvent,
  type DecodedContractEvent,
} from "@/lib/event_decoder";
import { stroopsToTokens } from "@/lib/utils";
import type { PaymentEvent } from "@/hooks/usePaymentHistory";

export type SubscriptionEventType =
  | "subscribe"
  | "executed"
  | "cancel"
  | "payment_transfer_failure";

export interface SubscriptionEvent extends PaymentEvent {
  eventType: SubscriptionEventType;
}

interface UseSubscriptionEventsOptions {
  publicKey: string | null | undefined;
  rpcUrl?: string;
  contractId?: string;
  pollIntervalMs?: number;
}

interface UseSubscriptionEventsResult {
  events: SubscriptionEvent[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

const EVENT_TYPES: SubscriptionEventType[] = [
  "subscribe",
  "executed",
  "cancel",
  "payment_transfer_failure",
];
const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);
const HISTORY_LEDGER_WINDOW = 10_000;
const PAGE_LIMIT = 1000;

type ActivityEvent = Extract<
  DecodedContractEvent,
  { type: SubscriptionEventType }
>;

function isActivityEvent(
  event: DecodedContractEvent,
): event is ActivityEvent {
  return EVENT_TYPE_SET.has(event.type);
}

function getEventAmount(event: ActivityEvent): string | null {
  return "amount" in event ? stroopsToTokens(event.amount) : null;
}

function toSubscriptionEvent(
  rawEvent: SorobanRpc.Api.RawEventResponse,
  event: ActivityEvent,
): SubscriptionEvent {
  return {
    id: rawEvent.id,
    ledger: rawEvent.ledger,
    timestamp: rawEvent.ledgerClosedAt ?? new Date(0).toISOString(),
    eventType: event.type,
    subscriber: event.subscriber,
    merchant: event.merchant,
    token: "token" in event ? event.token : "",
    amount: getEventAmount(event) ?? "—",
    amountStroops: "amount" in event ? event.amount.toString() : "",
    txHash: rawEvent.txHash ?? "",
  };
}

export function useSubscriptionEvents({
  publicKey,
  rpcUrl = RPC_URL,
  contractId = CONTRACT_ID,
  pollIntervalMs = 30_000,
}: UseSubscriptionEventsOptions): UseSubscriptionEventsResult {
  const [events, setEvents] = useState<SubscriptionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const previousPublicKeyRef = useRef<string | null | undefined>(publicKey);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (previousPublicKeyRef.current !== publicKey) {
      setEvents([]);
      setError(null);
      previousPublicKeyRef.current = publicKey;
    }

    if (!publicKey) {
      setEvents([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (!contractId) {
      setError("SorobanPay contract is not configured.");
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let requestInFlight = false;
    let historyLoaded = false;
    let lastLedgerSeen: number | null = null;

    const loadEvents = async (initialLoad: boolean) => {
      if (requestInFlight) return;
      requestInFlight = true;
      setIsLoading(true);
      setError(null);

      try {
        const server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
        const latestLedger = await server.getLatestLedger();
        const replaceHistory = initialLoad || !historyLoaded;
        const startLedger = replaceHistory
          ? Math.max(1, latestLedger.sequence - HISTORY_LEDGER_WINDOW)
          : Math.max(1, (lastLedgerSeen ?? latestLedger.sequence) - 1);
        const subscriberTopic = new Address(publicKey)
          .toScVal()
          .toXDR("base64");
        const filters: SorobanRpc.Server.GetEventsRequest["filters"] =
          EVENT_TYPES.map((type) => ({
            type: "contract",
            contractIds: [contractId],
            topics: [
              [
                xdr.ScVal.scvSymbol(type).toXDR("base64"),
                subscriberTopic,
              ],
            ],
          }));

        const response = await server.getEvents({
          startLedger,
          filters,
          limit: PAGE_LIMIT,
        });
        if (cancelled) return;

        const fetchedEvents: SubscriptionEvent[] = [];
        for (const rawEvent of response.events ?? []) {
          const decoded = decodeContractEvent(rawEvent);
          if (
            !isActivityEvent(decoded) ||
            decoded.subscriber !== publicKey
          ) {
            continue;
          }
          fetchedEvents.push(toSubscriptionEvent(rawEvent, decoded));
        }

        setEvents((currentEvents) => {
          const merged = new Map<string, SubscriptionEvent>();
          if (!replaceHistory) {
            for (const event of currentEvents) merged.set(event.id, event);
          }
          for (const event of fetchedEvents) merged.set(event.id, event);
          return [...merged.values()].sort(
            (left, right) =>
              right.ledger - left.ledger ||
              right.timestamp.localeCompare(left.timestamp),
          );
        });
        historyLoaded = true;
        lastLedgerSeen = latestLedger.sequence;
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Failed to load subscription events.",
          );
        }
      } finally {
        requestInFlight = false;
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadEvents(true);
    const intervalId = window.setInterval(
      () => void loadEvents(false),
      pollIntervalMs,
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [contractId, pollIntervalMs, publicKey, refreshKey, rpcUrl]);

  return { events, isLoading, error, refresh };
}
