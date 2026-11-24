# Browser, Accessibility, and Wallet Extension Support Lifecycle

SorobanPay can be browsed without a wallet. The [Freighter](https://www.freighter.app) browser extension (or supported Stellar Wallets Kit adapters) is required to connect an account and sign transactions. RPC reads, simulation, and transaction submission use the configured Soroban RPC endpoint; wallet extensions are used for account delegation and cryptographic signing.

## Tested Browser and Wallet Support Matrix

The table below records the tested combinations of web browser, operating system, and wallet extension, along with verification dates and explicit, actionable explanations for unsupported or degraded combinations.

> [!IMPORTANT]
> Unsupported combinations display an explicit, actionable explanation and recovery path rather than an implied guarantee. Do not assume unlisted browser-wallet pairs are compatible.

| Browser | Operating System | Wallet Extension | Support Status | Last Verified Date | Actionable Explanation & Recovery Guidance |
|---|---|---|---|---|---|
| Chrome | macOS | Freighter | **Supported** | 2026-11-20 | Supported with full extension popup handling. Allow popups if prompted. |
| Chrome | Windows | Freighter | **Supported** | 2026-11-20 | Supported on Chromium engine with Windows 11. |
| Chrome | Linux | Freighter | **Supported** | 2026-11-18 | Supported on Ubuntu 24.04 LTS / Wayland / X11. |
| Brave | macOS | Freighter | **Supported** | 2026-11-19 | Supported. If injection hangs, allow extension script access in Brave Shields (`brave://settings/shields`). |
| Brave | Windows | Freighter | **Supported** | 2026-11-19 | Supported with standard Shields profile. Ensure extension popups are allowed. |
| Firefox | macOS | Freighter | **Supported** | 2026-11-21 | Supported. App polls up to 3 seconds for asynchronous content-script injection (FE-36). Ensure add-on is enabled. |
| Firefox | Windows | Freighter | **Supported** | 2026-11-21 | Supported. Verify add-on permissions in `about:addons`. |
| Firefox | Linux | Freighter | **Supported** | 2026-11-17 | Supported. Ensure strict tracking protection does not isolate extension background scripts. |
| Edge (Chromium) | Windows | Freighter | **Degraded** | 2026-11-15 | **Degraded**: Requires enabling "Allow extensions from other stores" in `edge://extensions` to install from Chrome Web Store. Intermittent SmartScreen prompts may occur. |
| Edge (Chromium) | macOS | Freighter | **Degraded** | 2026-11-15 | **Degraded**: Potential window focus loss during signing modal. Keep browser active or switch to Chrome/Firefox. |
| Opera | Windows | Freighter | **Degraded** | 2026-11-08 | **Degraded**: Requires installing the Chrome Extensions compatibility bridge in Opera before installing Freighter. |
| Safari (desktop) | macOS | Freighter | **Unsupported** | 2026-11-10 | **Unsupported**: Freighter does not release an official Safari App Extension. You may view the app in read-only mode, but transactions cannot be signed. **Action**: Open SorobanPay in Chrome, Brave, or Firefox. |
| Mobile Safari | iOS | Freighter | **Unsupported** | 2026-11-10 | **Unsupported**: Mobile Safari does not support desktop Freighter extensions. Mobile extension signing is not available. **Action**: View read-only portal or use a desktop workstation for transaction signing. |
| Mobile Chrome | Android | Freighter | **Unsupported** | 2026-11-10 | **Unsupported**: Chrome on Android does not support Chrome Web Store extensions. **Action**: Use desktop Chrome, Brave, or Firefox for signing transactions. |
| Chrome | macOS | xBull | **Supported** | 2026-11-12 | Supported via Stellar Wallets Kit adapter. Select xBull from wallet modal. |
| Chrome | macOS | LOBSTR | **Supported** | 2026-11-12 | Supported via WalletConnect / LOBSTR web signer bridge. Approve prompt on mobile app. |
| Chrome | macOS | Albedo | **Supported** | 2026-11-12 | Supported via Albedo web popup. Allow popups for `albedo.link`. |

No minimum browser versions are claimed: the repository does not define or verify a version-specific support floor. Use a current stable browser release. The configured Playwright projects are Chromium, Firefox, WebKit, mobile Chrome, mobile Safari, and tablet emulation. This provides automated UI coverage, not certification of unlisted browser/version or extension combinations.

Serve the app from `http://localhost` during development or `https://` in production. Do not open it from `file://`; extension access and browser APIs require a served origin.

---

## Repeatable Lifecycle Process for Browser-Wallet Combinations

Maintainers and contributors follow this repeatable process when adding, deprecating/dropping, or investigating a browser-wallet combination.

### 1. Adding a New Browser-Wallet Combination

1. **Intake & Scope Definition**:
   - Establish minimum target browser version, operating system releases, and extension manifest specification (Manifest V3 vs V2).
   - Verify official vendor distribution link, extension store integrity, and developer signature.
   - Open a tracking issue: `[Support] Evaluate <Browser> + <Wallet> on <OS>`.
2. **Laboratory & Testnet Verification**:
   - Run local testnet or connect to Soroban Testnet.
   - Test account connection: verify initial permission grant, user denial, and silent session restore (`restoreWalletSession`).
   - Test transaction signing: verify simulation result display, popup focus preservation, signing timeout handling, and network passphrase parity.
   - Verify asynchronous injection timing (determine if polling loop or custom event listener is required).
   - Record test date, browser build, OS build, and wallet extension version.
3. **Automated Coverage & Documentation**:
   - Add entry with explicit test date and actionable notes in `frontend/src/lib/browser_support_matrix.ts`.
   - Add automated test assertions in `frontend/src/lib/browser_support_matrix.test.ts`.
   - Update `docs/browser-support.md` and document the addition in `CHANGELOG.md`.

### 2. Dropping or Deprecating a Combination

1. **Impact Assessment**:
   - Analyze user reports and error logs for the combination to assess affected active volume.
   - Confirm whether upstream deprecation (e.g. browser platform removing an API, or vendor discontinuing an extension) requires removal.
2. **Deprecation Phase (30-day window)**:
   - Change status in `SUPPORT_MATRIX` from `Supported` to `Degraded`.
   - Update `actionableExplanation` with a clear deprecation schedule and recommended alternatives.
   - Announce in release notes and `CHANGELOG.md`.
3. **Hard Deprecation / Drop**:
   - Update status to `Unsupported` in `SUPPORT_MATRIX`.
   - Ensure the UI returns an actionable explanation that explains why the combination cannot be used and directs the user to supported alternatives.

### 3. Investigating Support Anomalies and Regressions

1. **Triage & Environment Isolation**:
   - Collect user agent, operating system version, extension version, and browser console output.
   - Reproduce the anomaly in a clean browser profile without conflicting third-party extensions.
   - Inspect whether failure is caused by content-script injection latency, popup blocker rules, or cross-origin restrictions.
2. **Root Cause Classification**:
   - Test directly with isolated `@stellar/freighter-api` calls to distinguish between SorobanPay app logic and upstream wallet bugs.
   - Test across both Testnet and Mainnet to rule out RPC provider issues.
   - Check browser security release notes (e.g. tracking protection changes, cookie/storage sandboxing).
3. **Remediation & Upstream Escalation**:
   - If an in-app workaround is possible: implement defensive polling/retry in `wallet_manager.ts` and add unit test coverage.
   - If upstream bug: submit an issue to the wallet repository (e.g. Stellar Freighter GitHub) and update the matrix status to `Degraded` with an explanatory note and workaround.

## Keyboard support

Interactive controls use native browser keyboard behavior, and `frontend/src/app/globals.css` provides a visible `:focus-visible` outline. On the landing and app pages, the keyboard-shortcuts dialog lists these shortcuts:

| Key | Action |
|---|---|
| `?` | Open or close the shortcut help dialog |
| `N` | Focus the new subscription form |
| `H` | Jump to payment history |
| `M` | Jump to the merchant portal |
| `D` | Jump to the dashboard section when present; the help currently labels this as coming soon |
| `Escape` | Close an open dialog or cancel the current modal action |

Navigation shortcuts are disabled while focus is in a form control. Dialogs provide keyboard close behavior and focus handling. The section-jump shortcuts request smooth scrolling; see the reduced-motion note below.

## Screen readers

The interface uses semantic form labels and table headers, accessible names for wallet/status controls, and ARIA dialog, alert, status, and live-region roles for dynamic feedback. The Playwright accessibility spec checks selected roles, labels, and keyboard flows. It does not run a screen reader or establish WCAG conformance. Screen-reader and browser combinations have not been formally certified; report a specific control, browser, and assistive technology when an announcement or navigation issue occurs.

## Reduced motion

The global stylesheet responds to `prefers-reduced-motion: reduce` by shortening CSS animations and transitions and disabling CSS smooth scrolling. Components including the confirmation modal and empty state also use Framer Motion's reduced-motion preference. This is not a blanket guarantee for every third-party animation: keyboard section navigation explicitly requests smooth scrolling and may still animate. Follow the operating system's reduced-motion setting and report remaining motion with the browser and action that triggered it.

## Installing Freighter

### Chrome and Brave

1. Open the [Chrome Web Store listing](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk).
2. Install Freighter and confirm its icon appears in the browser toolbar.

### Firefox

1. Open the [Firefox Add-ons listing](https://addons.mozilla.org/en-US/firefox/addon/freighter/).
2. Install Freighter and confirm its icon appears in the toolbar.

For first-time setup, create or import a wallet in the extension and store its recovery phrase securely. Never share a recovery phrase or enter it into SorobanPay.

## Connect and select a network

1. Set `NEXT_PUBLIC_NETWORK_PASSPHRASE` in `frontend/.env.local` to the network of the deployed contract. Restart the dev server after changing configuration.
2. Set Freighter to the same network:

| Network | Passphrase in `.env.local` | Freighter selector |
|---|---|---|
| Testnet | `Test SDF Network ; September 2015` | Testnet |
| Mainnet | `Public Global Stellar Network ; September 2015` | Mainnet |

3. Open SorobanPay from `http://localhost:3000` or the deployed HTTPS site and select **Connect**.
4. Approve the connection in Freighter. The wallet badge should show **Connected**; the public key is used as the subscriber address.

Use [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test) to fund a Testnet account. Mainnet accounts need sufficient XLM for the network reserve and fees, as well as the token being used. To change accounts, remove the site under Freighter's connected-site settings and reconnect.

## Verify and recover

Start the app from the repository root:

```bash
cd frontend
npm run dev
```

Expected result: the app is available at `http://localhost:3000`. For the existing browser-based accessibility smoke spec, run this from `frontend/`:

```bash
npm run test:e2e -- e2e/05-accessibility.spec.ts
```

Expected result: the selected Playwright browser projects exercise keyboard help, dialog attributes, form error announcements, and related UI checks using the Freighter mock. A passing run does not verify a real extension or replace manual screen-reader checks. If Playwright reports missing browser binaries, install the configured browsers with `npx playwright install` from `frontend/` and retry. Tests were not run while preparing this support record.

| Symptom | Recovery |
|---|---|
| Freighter is not detected | Confirm the extension is installed and enabled, reload the served app, and allow a few seconds for Firefox injection. Do not use a `file://` URL. |
| Freighter popup is blocked | Allow extension popups for the app origin and temporarily disable conflicting wallet extensions. In Brave, check Shields for that site. |
| Transaction reports a network mismatch | Match Freighter's selected network to `NEXT_PUBLIC_NETWORK_PASSPHRASE` and the deployed contract. |
| Keyboard shortcut does not run while typing | This is intentional for shortcuts that navigate the page; move focus outside the form control and retry. Use the visible controls as an alternative. |
| Motion remains when reduced motion is enabled | Check the OS/browser reduced-motion setting. If section navigation still animates, report the shortcut and browser because that scroll currently requests smooth behavior explicitly. |
| Screen-reader output is missing or confusing | Verify the browser/assistive-technology pair and report the control and expected versus actual announcement; the automated spec checks only selected ARIA behavior. |

The wallet integration is isolated in `frontend/src/lib/wallet_manager.ts`; it detects Freighter, requests site access, and signs transactions. Other chain operations use the RPC endpoint configured through `NEXT_PUBLIC_RPC_URL`.
