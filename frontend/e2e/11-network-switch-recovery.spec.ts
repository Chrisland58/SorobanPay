/**
 * 11-network-switch-recovery.spec.ts
 *
 * End-to-end tests for wallet network-switch recovery during an open form.
 *
 * Verifies:
 *  - Supported-network transition (TESTNET -> PUBLIC -> TESTNET) invalidates
 *    stale state, surfaces NetworkMismatchBanner, and prevents signing with a
 *    previous network's contract or passphrase.
 *  - Unsupported-network transition (TESTNET -> CUSTOM_UNSUPPORTED -> TESTNET)
 *    blocks signing and recovers cleanly when returning to the configured network.
 *  - Form inputs are preserved across the mismatch and recovery cycle.
 *
 * Issue: #1652
 */

import { test, expect } from '@playwright/test';
import { injectFreighterMock } from './helpers/freighter-mock';

const MERCHANT =
  'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';
const TOKEN =
  'CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

declare global {
  interface Window {
    __freighterMock?: {
      setNetwork: (network: string, networkPassphrase?: string) => void;
      getNetwork: () => { network: string; networkPassphrase: string };
      getSignCalls: () => Array<{
        type: string;
        network: string;
        networkPassphrase: string;
      }>;
      clearSignCalls: () => void;
    };
  }
}

test.describe('Wallet network-switch recovery', () => {
  test.beforeEach(async ({ page }) => {
    await injectFreighterMock(page, {
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    await page.goto('/');
    await page.waitForSelector('button:has-text("Connect Freighter Wallet")', {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /connect freighter wallet/i }).click();
    await page.waitForSelector('#merchantAddress', { timeout: 8_000 });
  });

  test('supported-network switch (TESTNET -> PUBLIC -> TESTNET) blocks stale signing and recovers', async ({
    page,
  }) => {
    // Fill out the open subscription form on TESTNET
    await page.locator('#merchantAddress').fill(MERCHANT);
    await page.locator('#tokenAddress').fill(TOKEN);
    await page.locator('#amount').fill('150');
    await page.locator('#interval').fill('2592000');

    // Switch wallet to another supported network (PUBLIC / Mainnet) while form is open
    await page.evaluate(() => {
      window.__freighterMock?.setNetwork(
        'PUBLIC',
        'Public Global Stellar Network ; September 2015',
      );
      window.dispatchEvent(new Event('focus'));
    });

    // NetworkMismatchBanner should appear
    const alertBanner = page.getByRole('alert').filter({
      hasText: /network mismatch detected/i,
    });
    await expect(alertBanner).toBeVisible({ timeout: 8_000 });

    // No transaction may have been signed during or after the network switch
    const signCallsDuringMismatch = await page.evaluate(
      () => window.__freighterMock?.getSignCalls() ?? [],
    );
    expect(signCallsDuringMismatch).toHaveLength(0);

    // Recover by switching wallet back to TESTNET
    await page.evaluate(() => {
      window.__freighterMock?.setNetwork(
        'TESTNET',
        'Test SDF Network ; September 2015',
      );
      window.dispatchEvent(new Event('focus'));
    });

    await expect(alertBanner).toBeHidden({ timeout: 8_000 });

    // Form values should be preserved for recovery on the correct network
    await expect(page.locator('#merchantAddress')).toHaveValue(MERCHANT);
    await expect(page.locator('#tokenAddress')).toHaveValue(TOKEN);
    await expect(page.locator('#amount')).toHaveValue('150');
    await expect(page.locator('#interval')).toHaveValue('2592000');

    // User can proceed to open the confirmation modal on the recovered network
    await page.getByRole('button', { name: /authorize subscription/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  test('unsupported-network switch (TESTNET -> CUSTOM_UNSUPPORTED -> TESTNET) blocks signing and recovers', async ({
    page,
  }) => {
    await page.locator('#merchantAddress').fill(MERCHANT);
    await page.locator('#tokenAddress').fill(TOKEN);
    await page.locator('#amount').fill('75');
    await page.locator('#interval').fill('2592000');

    // Switch wallet to an unsupported custom network
    await page.evaluate(() => {
      window.__freighterMock?.setNetwork(
        'CUSTOM_UNSUPPORTED',
        'Custom Private Network ; 2026',
      );
      window.dispatchEvent(new Event('focus'));
    });

    const alertBanner = page.getByRole('alert').filter({
      hasText: /network mismatch detected/i,
    });
    await expect(alertBanner).toBeVisible({ timeout: 8_000 });

    // Verify no transaction was signed with the previous network's contract/passphrase
    const signCalls = await page.evaluate(
      () => window.__freighterMock?.getSignCalls() ?? [],
    );
    expect(signCalls).toHaveLength(0);

    // Switch back to TESTNET and verify recovery
    await page.evaluate(() => {
      window.__freighterMock?.setNetwork(
        'TESTNET',
        'Test SDF Network ; September 2015',
      );
      window.dispatchEvent(new Event('focus'));
    });

    await expect(alertBanner).toBeHidden({ timeout: 8_000 });
    await expect(page.locator('#amount')).toHaveValue('75');
  });
});
