/**
 * freighter-mock.ts
 *
 * Playwright helpers for mocking the Freighter browser extension.
 *
 * Strategy:
 *  1. addInitScript: sets window.freighter = true (short-circuits isConnected)
 *     and intercepts window.postMessage to handle the FREIGHTER_EXTERNAL_MSG_REQUEST
 *     / FREIGHTER_EXTERNAL_MSG_RESPONSE protocol used by @stellar/freighter-api.
 *  2. patchFreighterModuleInPage: called after page.goto() to patch the bundled
 *     wallet_manager functions via Next.js's webpack module registry, replacing any
 *     call to getPublicKey (absent in freighter-api v3) and injecting the mock key.
 *  3. switchFreighterAccountInPage: dynamically updates active mock public key to
 *     simulate user switching accounts in the browser extension (#1637).
 */

import type { Page } from '@playwright/test';

export const MOCK_PUBLIC_KEY =
  'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456789012';

export const MOCK_SECONDARY_KEY =
  'GXYZ9876543210FEDCBA9876543210FEDCBA9876543210FEDCBA987654321098';

/** Sentinel signed XDR the RPC mock will accept. */
export const MOCK_SIGNED_XDR = 'AAAA_MOCK_SIGNED_XDR==';

/** Injected before any page script runs. Patches window.postMessage. */
export const freighterInitScript = `
(function () {
  const DEFAULT_KEY = "${MOCK_PUBLIC_KEY}";
  const MOCK_XDR = "${MOCK_SIGNED_XDR}";

  // isConnected() checks window.freighter directly
  window.freighter = true;
  window.__FREIGHTER_MOCK_ACTIVE_KEY__ = DEFAULT_KEY;

  // freighter-api postMessage protocol
  // Request:  { source: "FREIGHTER_EXTERNAL_MSG_REQUEST",  messageId, type, ... }
  // Response: { source: "FREIGHTER_EXTERNAL_MSG_RESPONSE", messagedId, ... }
  // NOTE: "messagedId" (not "messageId") is a typo in the freighter-api source.
  const _origPost = window.postMessage.bind(window);
  window.postMessage = function (data, origin, transfer) {
    if (data && data.source === 'FREIGHTER_EXTERNAL_MSG_REQUEST') {
      const id   = data.messageId;
      const type = data.type;
      const activeKey = window.__FREIGHTER_MOCK_ACTIVE_KEY__ || DEFAULT_KEY;
      let resp   = { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: id };

      switch (type) {
        case 'REQUEST_CONNECTION_STATUS': resp = { ...resp, isConnected: true };                                           break;
        case 'REQUEST_ALLOWED_STATUS':    resp = { ...resp, isAllowed: true };                                             break;
        case 'SET_ALLOWED_STATUS':        resp = { ...resp, isAllowed: true };                                             break;
        case 'REQUEST_ACCESS':            resp = { ...resp, publicKey: activeKey };                                        break;
        case 'REQUEST_PUBLIC_KEY':        resp = { ...resp, publicKey: activeKey };                                        break;
        case 'SUBMIT_TRANSACTION':        resp = { ...resp, signedTransaction: MOCK_XDR, signerAddress: activeKey };       break;
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

/**
 * Dynamically switches the active Freighter account in the page and dispatches
 * the wallet change notification (#1637).
 */
export async function switchFreighterAccountInPage(page: Page, newKey: string): Promise<void> {
  await page.evaluate((key) => {
    (window as any).__FREIGHTER_MOCK_ACTIVE_KEY__ = key;
    window.dispatchEvent(new CustomEvent('freighter:accountChanged', { detail: { publicKey: key } }));
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
        type: 'ACCOUNT_CHANGED',
        publicKey: key,
      },
      source: window,
    }));
  }, newKey);
}

/**
 * After page.goto(), patches the bundled wallet_manager so that:
 *  - getPublicKey (missing in freighter-api v3) is shimmed to return MOCK_PUBLIC_KEY
 */
export async function patchWalletManagerInPage(page: Page): Promise<void> {
  await page.evaluate((defaultKey) => {
    const registry = (window as any).__webpack_modules__ ?? (window as any).webpackChunknextjs ?? null;
    if (!registry) return;

    for (const id of Object.keys(registry)) {
      const mod = registry[id];
      if (typeof mod !== 'function') continue;
      try {
        const m: any = { exports: {} };
        mod(m, m.exports, (r: any) => r);
        if (m.exports && typeof m.exports.connectWallet === 'function') {
          const orig = mod;
          registry[id] = function (module: any, exports: any, require: any) {
            orig(module, exports, require);
            module.exports.connectWallet = async function () {
              const active = (window as any).__FREIGHTER_MOCK_ACTIVE_KEY__ || defaultKey;
              return active;
            };
            if (typeof module.exports.getPublicKey === 'function') {
              module.exports.getPublicKey = async function () {
                const active = (window as any).__FREIGHTER_MOCK_ACTIVE_KEY__ || defaultKey;
                return { publicKey: active };
              };
            }
          };
        }
      } catch {
        // skip modules that throw during inspection
      }
    }
  }, MOCK_PUBLIC_KEY);
}
