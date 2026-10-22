'use client';

/**
 * SuccessCard.tsx
 *
 * Standalone success confirmation card shown after a subscription is created.
 * Extracted from SubscriptionForm to allow isolated Storybook documentation.
 *
 * Displays:
 *  - Transaction hash
 *  - Subscription summary (amount, interval, merchant)
 *  - "What happens next" guidance
 *  - A button to create another subscription
 */

import { useState, useCallback } from 'react';
import { downloadReceipt } from './SubscriptionReceipt';

export interface SuccessCardData {
  /** Stellar transaction hash (hex or base64) */
  txHash: string;
  /** Merchant's Stellar public key */
  merchant: string;
  /** Subscriber's Stellar public key */
  subscriber?: string;
  /** SEP-41 token contract address */
  token: string;
  /** Payment amount in token units */
  amount: string;
  /** Billing interval in seconds */
  interval: string;
  /** Next payment timestamp or formatted date string */
  nextPayment?: number | string;
}

export interface SuccessCardProps {
  /** Subscription data to display */
  data: SuccessCardData;
  /** Callback when user clicks "Create another subscription" */
  onReset?: () => void;
}

export function SuccessCard({ data, onReset }: SuccessCardProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const days = Math.round(Number(data.interval) / 86400);

  const nextPaymentDate = data.nextPayment
    ? typeof data.nextPayment === 'number'
      ? new Date(data.nextPayment * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : data.nextPayment
    : new Date(Date.now() + (Number(data.interval) || 86400) * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const passphrase = typeof process !== "undefined" ? (process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "") : "";
  const network = passphrase.includes("Test SDF") ? "testnet" : "public";
  const explorerUrl = `https://stellar.expert/explorer/${network}/tx/${data.txHash}`;

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      await downloadReceipt({
        txHash: data.txHash,
        merchant: data.merchant,
        subscriber: data.subscriber || "Connected Wallet",
        token: data.token,
        amount: data.amount,
        interval: data.interval,
        issuedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('PDF download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = useCallback(async () => {
    const shareText = `SorobanPay Subscription Receipt:\nAmount: ${data.amount} tokens\nMerchant: ${data.merchant}\nNext payment: ${nextPaymentDate}\nVerify on Stellar Expert: ${explorerUrl}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'SorobanPay Subscription Receipt',
          text: shareText,
          url: explorerUrl,
        });
        return;
      } catch {
        // Fall back to clipboard if share was dismissed or failed
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(shareText);
      setShareFeedback('Receipt copied to clipboard!');
      setTimeout(() => setShareFeedback(null), 3000);
    }
  }, [data, nextPaymentDate, explorerUrl]);

  return (
    <div
      role="alert"
      className="w-full max-w-lg mx-auto rounded-xl bg-gradient-to-br from-green-900/60 to-green-800/30 border-2 border-green-600/60 p-5 sm:p-6 text-sm space-y-4 shadow-lg text-white"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">✓</span>
        <p className="font-semibold text-green-300 text-base sm:text-lg">
          Subscription created successfully!
        </p>
      </div>

      {/* Tx hash */}
      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
        <p className="text-gray-400 text-xs mb-1.5 font-medium">Transaction hash</p>
        <p className="text-gray-200 break-all font-mono text-xs leading-relaxed">
          {data.txHash}
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-gray-300 bg-gray-800/30 rounded-lg p-3">
        <span className="text-gray-400 font-medium">Amount</span>
        <span className="font-medium">{data.amount} tokens</span>
        <span className="text-gray-400 font-medium">Interval</span>
        <span className="font-medium">
          every {days} day{days !== 1 ? 's' : ''}
        </span>
        <span className="text-gray-400 font-medium">Next Payment</span>
        <span className="font-medium text-green-300">{nextPaymentDate}</span>
        <span className="text-gray-400 font-medium break-all">Merchant</span>
        <span className="break-all font-mono text-xs">{data.merchant}</span>
      </div>

      {/* Explorer link */}
      <div className="text-center pt-1">
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 hover:underline"
        >
          View transaction on Stellar Expert ↗
        </a>
      </div>

      {/* Share / PDF action buttons */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={isDownloading}
          aria-label="Download subscription receipt as PDF"
          className="flex items-center justify-center gap-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 py-2.5 px-3 text-xs font-semibold text-gray-200 transition-colors"
        >
          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {isDownloading ? 'Generating PDF…' : 'Download PDF'}
        </button>

        <button
          type="button"
          onClick={handleShare}
          aria-label="Share subscription receipt"
          className="flex items-center justify-center gap-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 py-2.5 px-3 text-xs font-semibold text-gray-200 transition-colors"
        >
          <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          Share Receipt
        </button>
      </div>

      {shareFeedback && (
        <p role="status" aria-live="polite" className="text-center text-xs text-green-300 font-medium">
          {shareFeedback}
        </p>
      )}

      {/* Next steps */}
      <div className="border-t border-green-800/60 pt-4 space-y-2.5">
        <p className="text-green-300 font-semibold text-xs uppercase tracking-widest">
          What happens next
        </p>
        <ul className="list-disc list-inside space-y-2 text-gray-300 text-xs leading-relaxed">
          <li>The merchant can collect the first payment immediately.</li>
          <li>
            Subsequent payments are collectible every {days} day
            {days !== 1 ? 's' : ''}.
          </li>
          <li>
            To cancel, call{' '}
            <code className="bg-gray-800 px-1.5 py-0.5 rounded text-green-300 text-xs">
              cancel(subscriber, merchant)
            </code>{' '}
            on the contract, or revoke the token allowance via your wallet.
          </li>
          <li>Your wallet remains non-custodial — the contract never holds your funds.</li>
        </ul>
      </div>

      <button
        onClick={onReset}
        className="w-full rounded-lg border-2 border-green-600/70 text-green-300
                   hover:bg-green-900/40 active:bg-green-900/60
                   py-3 sm:py-4 text-sm font-semibold transition-all duration-150
                   min-h-[48px] focus:outline-none focus:ring-2 focus:ring-green-500
                   hover:shadow-lg"
      >
        Create another subscription
      </button>
    </div>
  );
}

export default SuccessCard;
