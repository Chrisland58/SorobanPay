"use client";

import PaymentHistoryTable from "@/components/PaymentHistoryTable";
import { useWallet } from "@/hooks/useWallet";
import { useSubscriptionEvents } from "@/hooks/useSubscriptionEvents";
import { NETWORK_NAME } from "@/constants/network";

const PREVIEW_EVENT_COUNT = 5;

export function PaymentHistory() {
  const { publicKey } = useWallet();
  const { events, isLoading, error, refresh } = useSubscriptionEvents({
    publicKey,
  });

  return (
    <PaymentHistoryTable
      events={events.slice(0, PREVIEW_EVENT_COUNT)}
      isLoading={isLoading}
      error={error}
      hasMore={false}
      onLoadMore={refresh}
      onRefresh={refresh}
      isConnected={!!publicKey}
      networkName={NETWORK_NAME}
    />
  );
}

export default PaymentHistory;
