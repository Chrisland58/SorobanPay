/**
 * freighter-mock.ts
 *
 * Playwright helpers for mocking the Freighter browser wallet extension in E2E tests.
 *
 * Strategy:
 *  1. `freighterInitScript` — injected via page.addInitScript() BEFORE any page
 *     script runs. Patches window.postMessage to intercept the
 *     FREIGHTER_EXTERNAL_MSG_REQUEST / FREIGHTER_EXTERNAL_MSG_RESPONSE protocol
 *     used by @stellar/freighter-api, and sets window.freighter = true to
 *     short-circuit the isConnected() check.
 *  2. `injectConnectedWallet` — calls page.addInitScript with the above script.
 *
 * FE-48: E2E tests with Playwright
 */

import type { Page } from '@playwright/test';

/** Mock Stellar public key returned by all Freighter API calls. */
export const MOCK_PUBLIC_KEY =
  'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

/** Sentinel signed XDR returned by SUBMIT_TRANSACTION mocks. */
export const MOCK_SIGNED_XDR = 'AAAA_MOCK_SIGNED_XDR_E2E==';

export interface FreighterMockOptions {
  /** Initial network name returned by GET_NETWORK / GET_NETWORK_DETAILS (default: 'TESTNET'). */
  network?: string;
  /** Initial network passphrase (default: 'Test SDF Network ; September 2015'). */
  networkPassphrase?: string;
}

/**
 * Build an init script injected before page scripts run.
 * Patches window.postMessage to respond to all Freighter API message types
 * and exposes `window.__freighterMock` for dynamic network-switch testing.
 */
export function buildFreighterInitScript(options: FreighterMockOptions = {}): string {
  const initialNetwork = options.network ?? 'TESTNET';
  const initialPassphrase = options.networkPassphrase ?? 'Test SDF Network ; September 2015';

  return `
(function () {
  const MOCK_KEY = "${MOCK_PUBLIC_KEY}";
  const MOCK_XDR = "${MOCK_SIGNED_XDR}";

  const state = {
    network: ${JSON.stringify(initialNetwork)},
    networkPassphrase: ${JSON.stringify(initialPassphrase)},
    signCalls: [],
  };

  window.__freighterMock = {
    setNetwork(network, networkPassphrase) {
      state.network = network;
      state.networkPassphrase = networkPassphrase || '';
    },
    getNetwork() {
      return { network: state.network, networkPassphrase: state.networkPassphrase };
    },
    getSignCalls() {
      return state.signCalls.slice();
    },
    clearSignCalls() {
      state.signCalls.length = 0;
    },
  };

  // isConnected() checks window.freighter directly
  window.freighter = true;

  // @stellar/freighter-api postMessage protocol:
  // Request:  { source: 'FREIGHTER_EXTERNAL_MSG_REQUEST', messageId, type, ... }
  // Response: { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId, ... }
  // NOTE: "messagedId" (no 'g' typo) is how the library spells it.
  const _origPost = window.postMessage.bind(window);
  window.postMessage = function (data, origin, transfer) {
    if (data && data.source === 'FREIGHTER_EXTERNAL_MSG_REQUEST') {
      const id   = data.messageId;
      const type = data.type;
      let resp   = { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: id };

      switch (type) {
        case 'REQUEST_CONNECTION_STATUS': resp = { ...resp, isConnected: true };                                          break;
        case 'REQUEST_ALLOWED_STATUS':    resp = { ...resp, isAllowed: true };                                            break;
        case 'SET_ALLOWED_STATUS':        resp = { ...resp, isAllowed: true };                                            break;
        case 'REQUEST_ACCESS':            resp = { ...resp, publicKey: MOCK_KEY };                                        break;
        case 'REQUEST_PUBLIC_KEY':        resp = { ...resp, publicKey: MOCK_KEY };                                        break;
        case 'GET_ADDRESS':               resp = { ...resp, address: MOCK_KEY };                                          break;
        case 'GET_NETWORK':               resp = { ...resp, network: state.network, networkPassphrase: state.networkPassphrase }; break;
        case 'GET_NETWORK_DETAILS':       resp = { ...resp, network: state.network, networkPassphrase: state.networkPassphrase, networkUrl: 'https://soroban-testnet.stellar.org' }; break;
        case 'SUBMIT_TRANSACTION':
          state.signCalls.push({ type, network: state.network, networkPassphrase: data.networkPassphrase || (data.opts && data.opts.networkPassphrase) || state.networkPassphrase });
          resp = { ...resp, signedTransaction: MOCK_XDR, signerAddress: MOCK_KEY };
          break;
        case 'SIGN_TRANSACTION':
          state.signCalls.push({ type, network: state.network, networkPassphrase: data.networkPassphrase || (data.opts && data.opts.networkPassphrase) || state.networkPassphrase });
          resp = { ...resp, signedTransaction: MOCK_XDR };
          break;
        default:                          resp = { ...resp };
      }

      Promise.resolve().then(() => {
        window.dispatchEvent(new MessageEvent('message', { data: resp, source: window }));
      });
      return;
    }
    return _origPost(data, origin, transfer);
  };
})();
`;
}

/**
 * Default init script injected before page scripts run.
 */
export const freighterInitScript = buildFreighterInitScript();

/**
 * Inject the Freighter mock into the page before navigation.
 * Call this before page.goto() to ensure the script runs before any page code.
 */
export async function injectFreighterMock(
  page: Page,
  options: FreighterMockOptions = {},
): Promise<void> {
  await page.addInitScript(buildFreighterInitScript(options));
}

/**
 * Navigate to a URL with Freighter already mocked.
 * Convenience wrapper that calls injectFreighterMock + page.goto().
 */
export async function gotoWithFreighterMock(
  page: Page,
  url: string,
): Promise<void> {
  await injectFreighterMock(page);
  await page.goto(url);
}
