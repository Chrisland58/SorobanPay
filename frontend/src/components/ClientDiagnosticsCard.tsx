/**
 * ClientDiagnosticsCard.tsx
 *
 * User-triggered diagnostics view providing copyable public runtime metadata
 * for support requests, with clear privacy notice and secret exclusion (#1576).
 */

import React, { useState } from 'react';
import { NETWORK_NAME, CONTRACT_ID, RPC_URL } from '@/constants/network';

export interface DiagnosticsMetadata {
  appVersion: string;
  browserSummary: string;
  selectedNetwork: string;
  contractIdentifier: string;
  rpcEndpoint: string;
  connectedWalletAddress: string | null;
  timestamp: string;
}

export function buildSanitizedDiagnostics(
  connectedAddress: string | null = null,
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
): DiagnosticsMetadata {
  // Extract browser summary without leaking arbitrary hardware/OS internals
  let browser = 'Unknown Browser';
  if (/chrome|crios/i.test(userAgent)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(userAgent)) browser = 'Firefox';
  else if (/safari/i.test(userAgent)) browser = 'Safari';
  else if (/edg/i.test(userAgent)) browser = 'Edge';

  // Sanitize RPC endpoint (strip any embedded auth credentials)
  const sanitizedRpc = RPC_URL.replace(/(https?:\/\/)([^:@\s]+):([^:@\s]+)@/, '$1***:***@');

  return {
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
    browserSummary: browser,
    selectedNetwork: NETWORK_NAME,
    contractIdentifier: CONTRACT_ID,
    rpcEndpoint: sanitizedRpc,
    connectedWalletAddress: connectedAddress ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-6)}` : null,
    timestamp: new Date().toISOString(),
  };
}

/** Asserts that a diagnostics string contains zero secret keys, seeds, or bearer tokens */
export function assertDiagnosticsPayloadIsSafe(payload: string): boolean {
  // Stellar secret keys begin with 'S' and have 56 alphanumeric characters
  const hasSecretSeed = /\bS[A-Z2-7]{55}\b/.test(payload);
  const hasBearerToken = /bearer\s+[a-zA-Z0-9_\-\.]+/i.test(payload);
  const hasRawPrivateKey = /(private_key|secret_key|privateKey|secretKey)/i.test(payload);

  return !hasSecretSeed && !hasBearerToken && !hasRawPrivateKey;
}

export const PRIVACY_NOTICE =
  'Privacy Notice: This diagnostic payload contains only public application metadata and browser environment summaries. It never collects, transmits, or stores private keys, secret seed phrases, authentication tokens, or personal identifiers.';

export default function ClientDiagnosticsCard({ connectedAddress = null }: { connectedAddress?: string | null }) {
  const [copied, setCopied] = useState(false);
  const data = buildSanitizedDiagnostics(connectedAddress);
  const formattedJson = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(formattedJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900" data-testid="client-diagnostics-card">
      <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Client Support Diagnostics</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Share this runtime configuration with support engineers to reproduce wallet issues.</p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          aria-label="Copy diagnostics metadata"
        >
          {copied ? 'Copied to Clipboard!' : 'Copy Diagnostics'}
        </button>
      </div>

      <div className="mt-4 rounded-md bg-gray-50 p-4 text-xs font-mono dark:bg-gray-950">
        <pre data-testid="diagnostics-json-preview">{formattedJson}</pre>
      </div>

      <div className="mt-4 rounded-md bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
        <p>{PRIVACY_NOTICE}</p>
      </div>
    </div>
  );
}
