/**
 * @jest-environment jsdom
 *
 * ClientDiagnosticsCard.test.tsx
 *
 * Automated verification of client support diagnostics metadata, copy behavior,
 * privacy notice, and strict absence of secrets (#1576).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ClientDiagnosticsCard, {
  buildSanitizedDiagnostics,
  assertDiagnosticsPayloadIsSafe,
  PRIVACY_NOTICE,
} from './ClientDiagnosticsCard';

jest.mock('@/constants/network', () => ({
  NETWORK_NAME: 'Testnet',
  CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  RPC_URL: 'https://soroban-testnet.stellar.org',
}));

describe('ClientDiagnosticsCard Support View (#1576)', () => {
  const MOCK_PUBLIC_ADDRESS = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  it('renders required runtime metadata: app version, browser, network, contract ID', () => {
    render(<ClientDiagnosticsCard connectedAddress={MOCK_PUBLIC_ADDRESS} />);

    expect(screen.getByText(/client support diagnostics/i)).toBeInTheDocument();
    expect(screen.getByTestId('diagnostics-json-preview')).toHaveTextContent('Testnet');
    expect(screen.getByTestId('diagnostics-json-preview')).toHaveTextContent('CAAAAA');
    expect(screen.getByText(PRIVACY_NOTICE)).toBeInTheDocument();
  });

  it('formats payload with copyable structure without exposing secrets', () => {
    const payload = buildSanitizedDiagnostics(MOCK_PUBLIC_ADDRESS, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36');
    const jsonStr = JSON.stringify(payload);

    expect(payload.browserSummary).toBe('Chrome');
    expect(payload.selectedNetwork).toBe('Testnet');
    expect(payload.contractIdentifier).toBe('CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(payload.connectedWalletAddress).toContain('GBBBBB');

    // Strict safety check
    expect(assertDiagnosticsPayloadIsSafe(jsonStr)).toBe(true);
  });

  it('proves that Stellar secret seeds, access tokens, and private keys are never included', () => {
    const unsafeSampleWithSecret = JSON.stringify({
      version: '1.0.0',
      seed: 'SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    });
    expect(assertDiagnosticsPayloadIsSafe(unsafeSampleWithSecret)).toBe(false);

    const unsafeSampleWithBearer = JSON.stringify({
      token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    });
    expect(assertDiagnosticsPayloadIsSafe(unsafeSampleWithBearer)).toBe(false);

    const actualDiagnostics = JSON.stringify(buildSanitizedDiagnostics(MOCK_PUBLIC_ADDRESS));
    expect(assertDiagnosticsPayloadIsSafe(actualDiagnostics)).toBe(true);
    expect(actualDiagnostics).not.toMatch(/\bS[A-Z2-7]{55}\b/);
  });

  it('supports clipboard copy interaction', async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<ClientDiagnosticsCard connectedAddress={MOCK_PUBLIC_ADDRESS} />);
    const copyBtn = screen.getByRole('button', { name: /copy diagnostics/i });

    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0][0]).toContain('Testnet');
  });
});
