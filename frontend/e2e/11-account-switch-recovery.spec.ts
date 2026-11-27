/**
 * 11-account-switch-recovery.spec.ts
 *
 * Playwright browser-level E2E test verifying account switching recovery
 * during wallet interaction flow (#1637).
 */

import { test, expect } from '@playwright/test';
import {
  freighterInitScript,
  patchWalletManagerInPage,
  switchFreighterAccountInPage,
  MOCK_PUBLIC_KEY,
  MOCK_SECONDARY_KEY,
} from '../tests/freighter-mock';

test.describe('Freighter Account Switch & Recovery Flow (#1637)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(freighterInitScript);
  });

  test('discards in-flight transaction when account is switched in wallet and recovers safely', async ({ page }) => {
    await page.goto('/subscribe');
    await patchWalletManagerInPage(page);

    // Initial account connection
    const connectBtn = page.getByRole('button', { name: /connect wallet/i });
    if (await connectBtn.isVisible()) {
      await connectBtn.click();
    }

    // Verify initial account badge
    await expect(page.getByText(new RegExp(MOCK_PUBLIC_KEY.slice(0, 4), 'i'))).toBeVisible();

    // Fill form
    await page.getByLabel(/merchant address/i).fill('GA' + 'A'.repeat(54));
    await page.getByLabel(/token contract address/i).fill('CA' + 'A'.repeat(54));
    await page.getByLabel(/amount/i).fill('50');

    // Switch account in wallet before or during active flow
    await switchFreighterAccountInPage(page, MOCK_SECONDARY_KEY);

    // Verify UI reflects new active account and discards previous state
    await page.waitForTimeout(500);
    const newAccountSub = MOCK_SECONDARY_KEY.slice(0, 4);
    await expect(page.getByText(new RegExp(newAccountSub, 'i'))).toBeVisible();

    // Verify form controls remain fully responsive
    const submitBtn = page.getByRole('button', { name: /authorize subscription/i });
    await expect(submitBtn).toBeEnabled();
  });
});
