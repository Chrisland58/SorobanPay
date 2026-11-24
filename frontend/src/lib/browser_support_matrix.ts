/**
 * browser_support_matrix.ts
 *
 * Support lifecycle matrix and validation engine for browser, OS, and wallet extension
 * combinations in SorobanPay.
 *
 * Provides:
 * - Tested support matrix with explicit OS, browser, wallet, and verified test dates.
 * - Actionable explanations and recovery paths for unsupported combinations (avoiding implied guarantees).
 * - Repeatable operational workflows for adding, dropping, or investigating combinations.
 */

export type SupportStatus = 'Supported' | 'Degraded' | 'Unsupported' | 'Experimental';

export type BrowserName =
  | 'Chrome'
  | 'Brave'
  | 'Firefox'
  | 'Edge'
  | 'Safari'
  | 'Mobile Chrome'
  | 'Mobile Safari'
  | 'Opera';

export type OperatingSystem = 'macOS' | 'Windows' | 'Linux' | 'iOS' | 'Android';

export type WalletExtension = 'Freighter' | 'LOBSTR' | 'xBull' | 'Albedo';

export interface SupportMatrixEntry {
  browser: BrowserName;
  os: OperatingSystem;
  wallet: WalletExtension;
  status: SupportStatus;
  testDate: string; // YYYY-MM-DD
  notes: string;
  actionableExplanation: string;
  recommendedAlternative?: string;
}

export interface LifecyclePhase {
  phase: string;
  description: string;
  steps: string[];
}

export interface LifecycleProcedure {
  action: 'add' | 'drop' | 'investigate';
  title: string;
  phases: LifecyclePhase[];
}

/**
 * Fully verified support lifecycle matrix for SorobanPay.
 * Every entry specifies exact OS, browser, extension, and last verified test date.
 */
export const SUPPORT_MATRIX: SupportMatrixEntry[] = [
  {
    browser: 'Chrome',
    os: 'macOS',
    wallet: 'Freighter',
    status: 'Supported',
    testDate: '2026-11-20',
    notes: 'Full synchronous injection and hardware wallet pass-through verified.',
    actionableExplanation: 'Supported. Ensure extension popups are allowed.',
  },
  {
    browser: 'Chrome',
    os: 'Windows',
    wallet: 'Freighter',
    status: 'Supported',
    testDate: '2026-11-20',
    notes: 'Verified on Chromium engine with Windows 11 and Freighter v5+.',
    actionableExplanation: 'Supported. Ensure extension popups are allowed.',
  },
  {
    browser: 'Chrome',
    os: 'Linux',
    wallet: 'Freighter',
    status: 'Supported',
    testDate: '2026-11-18',
    notes: 'Verified on Ubuntu 24.04 LTS.',
    actionableExplanation: 'Supported. Confirm Wayland popup permissions if applicable.',
  },
  {
    browser: 'Brave',
    os: 'macOS',
    wallet: 'Freighter',
    status: 'Supported',
    testDate: '2026-11-19',
    notes: 'Supported. Brave Shields may interfere if script blocking is aggressive.',
    actionableExplanation: 'Supported. If connection hangs, set Brave Shields to allow script injection from Freighter.',
    recommendedAlternative: 'Allow extension access in brave://settings/shields',
  },
  {
    browser: 'Brave',
    os: 'Windows',
    wallet: 'Freighter',
    status: 'Supported',
    testDate: '2026-11-19',
    notes: 'Supported with standard Shields profile.',
    actionableExplanation: 'Supported. Ensure Brave Shields allows extension popups for this origin.',
  },
  {
    browser: 'Firefox',
    os: 'macOS',
    wallet: 'Freighter',
    status: 'Supported',
    testDate: '2026-11-21',
    notes: 'Asynchronous content script injection handled via FE-36 polling loop.',
    actionableExplanation: 'Supported. App polls for Freighter injection up to 3 seconds. Ensure add-on is enabled.',
  },
  {
    browser: 'Firefox',
    os: 'Windows',
    wallet: 'Freighter',
    status: 'Supported',
    testDate: '2026-11-21',
    notes: 'Verified with Firefox 132+ and Freighter add-on.',
    actionableExplanation: 'Supported. Verify add-on permissions in about:addons.',
  },
  {
    browser: 'Firefox',
    os: 'Linux',
    wallet: 'Freighter',
    status: 'Supported',
    testDate: '2026-11-17',
    notes: 'Verified on Debian/Ubuntu with standard Firefox ESR/Stable.',
    actionableExplanation: 'Supported. Check that strict tracking protection does not block extension messages.',
  },
  {
    browser: 'Edge',
    os: 'Windows',
    wallet: 'Freighter',
    status: 'Degraded',
    testDate: '2026-11-15',
    notes: 'Chromium compatibility provides basic functionality, but SmartScreen may trigger warnings on popups.',
    actionableExplanation: 'Degraded: Edge Chromium runs Freighter from Chrome Web Store, but requires enabling third-party store extensions in edge://extensions.',
    recommendedAlternative: 'Enable "Allow extensions from other stores" in Edge settings or switch to Google Chrome.',
  },
  {
    browser: 'Edge',
    os: 'macOS',
    wallet: 'Freighter',
    status: 'Degraded',
    testDate: '2026-11-15',
    notes: 'Intermittent window focus loss during signing modal.',
    actionableExplanation: 'Degraded: Extension modal may lose focus. Keep browser window active during transaction signing.',
    recommendedAlternative: 'Use Chrome or Firefox on macOS for primary signing workflows.',
  },
  {
    browser: 'Safari',
    os: 'macOS',
    wallet: 'Freighter',
    status: 'Unsupported',
    testDate: '2026-11-10',
    notes: 'Freighter does not distribute an official Safari Web Extension (App Extension).',
    actionableExplanation: 'Unsupported: Freighter is not published for Safari. You can browse the app in read-only mode, but wallet connection requires Chrome, Brave, or Firefox.',
    recommendedAlternative: 'Open SorobanPay in Chrome, Brave, or Firefox on macOS.',
  },
  {
    browser: 'Mobile Safari',
    os: 'iOS',
    wallet: 'Freighter',
    status: 'Unsupported',
    testDate: '2026-11-10',
    notes: 'iOS Safari does not support desktop Freighter extension injection.',
    actionableExplanation: 'Unsupported: Browser extensions for Freighter are unavailable on iOS Safari. Use the read-only merchant portal or switch to a desktop browser.',
    recommendedAlternative: 'Use a desktop workstation with Chrome or Firefox for signing operations.',
  },
  {
    browser: 'Mobile Chrome',
    os: 'Android',
    wallet: 'Freighter',
    status: 'Unsupported',
    testDate: '2026-11-10',
    notes: 'Chrome Mobile for Android does not support Chrome Web Store extensions.',
    actionableExplanation: 'Unsupported: Android Chrome lacks extension architecture for Freighter. Mobile signing is not currently certified.',
    recommendedAlternative: 'Use desktop Chrome, Brave, or Firefox for transaction signing.',
  },
  {
    browser: 'Opera',
    os: 'Windows',
    wallet: 'Freighter',
    status: 'Degraded',
    testDate: '2026-11-08',
    notes: 'Requires Install Chrome Extensions add-on.',
    actionableExplanation: 'Degraded: Opera requires manual bridge installation to load Chrome Web Store extensions.',
    recommendedAlternative: 'Install Chrome Web Store Extension Bridge in Opera, or switch to Chrome directly.',
  },
  {
    browser: 'Chrome',
    os: 'macOS',
    wallet: 'xBull',
    status: 'Supported',
    testDate: '2026-11-12',
    notes: 'Supported via Stellar Wallets Kit adapter.',
    actionableExplanation: 'Supported. Select xBull from wallet modal.',
  },
  {
    browser: 'Chrome',
    os: 'macOS',
    wallet: 'LOBSTR',
    status: 'Supported',
    testDate: '2026-11-12',
    notes: 'Supported via WalletConnect / LOBSTR web signer bridge.',
    actionableExplanation: 'Supported. Follow the LOBSTR QR/app prompt to approve session.',
  },
  {
    browser: 'Chrome',
    os: 'macOS',
    wallet: 'Albedo',
    status: 'Supported',
    testDate: '2026-11-12',
    notes: 'Popup-based browser signing supported without extension installation.',
    actionableExplanation: 'Supported. Allow popups for albedo.link.',
  },
];

/**
 * Retrieve support matrix entry for a given browser, OS, and wallet.
 */
export function getSupportStatus(
  browser: string,
  os: string,
  wallet: string,
): SupportMatrixEntry | null {
  const normBrowser = browser.trim().toLowerCase();
  const normOs = os.trim().toLowerCase();
  const normWallet = wallet.trim().toLowerCase();

  return (
    SUPPORT_MATRIX.find(
      (entry) =>
        entry.browser.toLowerCase() === normBrowser &&
        entry.os.toLowerCase() === normOs &&
        entry.wallet.toLowerCase() === normWallet,
    ) ?? null
  );
}

/**
 * Evaluate support and produce actionable guidance for any combination.
 * Guaranteed to return an actionable explanation rather than an implied guarantee.
 */
export function evaluateSupport(params: {
  browser?: string;
  os?: string;
  wallet?: string;
}): {
  status: SupportStatus;
  explanation: string;
  isActionable: boolean;
  recommendedAlternative?: string;
  testDate?: string;
} {
  const browser = params.browser || 'Unknown';
  const os = params.os || 'Unknown';
  const wallet = params.wallet || 'Freighter';

  const entry = getSupportStatus(browser, os, wallet);
  if (entry) {
    return {
      status: entry.status,
      explanation: entry.actionableExplanation,
      isActionable: true,
      recommendedAlternative: entry.recommendedAlternative,
      testDate: entry.testDate,
    };
  }

  // Handle boundary / unknown combinations
  return {
    status: 'Unsupported',
    explanation:
      `The combination of ${browser} on ${os} with ${wallet} has not been certified by SorobanPay. ` +
      `No compatibility guarantees exist. To avoid failed transactions or stuck signing states, ` +
      `please use Chrome, Brave, or Firefox on desktop with the Freighter wallet.`,
    isActionable: true,
    recommendedAlternative: 'Switch to a verified environment (Chrome, Brave, or Firefox on macOS/Windows/Linux).',
  };
}

/**
 * Repeatable lifecycle procedures for adding, dropping, or investigating browser-wallet combinations.
 */
export const LIFECYCLE_PROCEDURES: Record<'add' | 'drop' | 'investigate', LifecycleProcedure> = {
  add: {
    action: 'add',
    title: 'Procedure for Adding a New Browser-Wallet Combination',
    phases: [
      {
        phase: '1. Intake & Specification',
        description: 'Establish version requirements and market justification.',
        steps: [
          'Document target browser minimum version, operating system releases, and extension manifest version (MV3 vs MV2).',
          'Verify official extension store distribution link and developer signature.',
          'Open a tracking issue titled: "[Support] Evaluate <Browser> + <Wallet> support on <OS>".',
        ],
      },
      {
        phase: '2. Integration & Laboratory Testing',
        description: 'Execute end-to-end verification under isolated test conditions.',
        steps: [
          'Deploy local testnet contract or connect to Soroban Testnet.',
          'Execute connection request: test initial grant, rejected grant, and remembered allowance.',
          'Execute transaction simulation and signing: check popup focus, timeout resilience, and network passphrase parity.',
          'Validate asynchronous injection timing (check if wallet requires polling loop like Firefox).',
          'Document test date, browser build, OS build, and wallet extension version.',
        ],
      },
      {
        phase: '3. Automated Coverage & Documentation',
        description: 'Codify behavior in test suites and operational guides.',
        steps: [
          'Add entry to SUPPORT_MATRIX in frontend/src/lib/browser_support_matrix.ts.',
          'Add corresponding unit tests in frontend/src/lib/browser_support_matrix.test.ts.',
          'Update docs/browser-support.md and CHANGELOG.md.',
          'If experimental, label with explicit actionable caveats.',
        ],
      },
    ],
  },
  drop: {
    action: 'drop',
    title: 'Procedure for Deprecating or Dropping a Browser-Wallet Combination',
    phases: [
      {
        phase: '1. Impact Assessment',
        description: 'Review telemetry and active merchant usage.',
        steps: [
          'Analyze connection failure rates and user error reports for the combination.',
          'Confirm whether upstream deprecation (e.g. browser dropping Manifest V2) is the root cause.',
        ],
      },
      {
        phase: '2. Deprecation Notice Period',
        description: 'Communicate transition schedule to users and operators.',
        steps: [
          'Update status from "Supported" to "Degraded" in SUPPORT_MATRIX with a 30-day notice window.',
          'Include actionable deprecation explanation directing users to supported alternatives.',
          'Announce deprecation in CHANGELOG.md and release notes.',
        ],
      },
      {
        phase: '3. Hard Deprecation & Block',
        description: 'Mark combination unsupported and enforce explanatory UI banner.',
        steps: [
          'Update status in SUPPORT_MATRIX to "Unsupported".',
          'Provide clear recovery guidance in the UI preventing silent transaction submission failure.',
        ],
      },
    ],
  },
  investigate: {
    action: 'investigate',
    title: 'Procedure for Investigating Browser-Wallet Anomalies',
    phases: [
      {
        phase: '1. Triage & Incident Reproduction',
        description: 'Isolate environmental factors and reproduction steps.',
        steps: [
          'Collect user agent, operating system build, extension version, and console log export.',
          'Reproduce in clean browser profile without third-party extensions.',
          'Check for content script injection delays, popup blocker intercepts, or CORS/origin blocking.',
        ],
      },
      {
        phase: '2. Root Cause Classification',
        description: 'Categorize whether the issue is app logic, extension bug, or browser regression.',
        steps: [
          'Test against raw @stellar/freighter-api methods in isolation.',
          'Verify if the failure occurs on both Mainnet and Testnet.',
          'Determine if browser security policy (e.g. Brave Shields, Safari privacy) changed.',
        ],
      },
      {
        phase: '3. Remediation & Upstream Reporting',
        description: 'Implement defensive workaround or report upstream bug.',
        steps: [
          'If workaround exists: add defensive retry/polling in wallet_manager.ts with automated test coverage.',
          'If upstream issue: file issue on official wallet tracker and mark matrix entry "Degraded" with explanatory note.',
        ],
      },
    ],
  },
};

/**
 * Retrieve operational procedure for managing browser-wallet combinations.
 */
export function getLifecycleProcedure(action: 'add' | 'drop' | 'investigate'): LifecycleProcedure {
  return LIFECYCLE_PROCEDURES[action];
}
