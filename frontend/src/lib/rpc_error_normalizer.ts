/**
 * rpc_error_normalizer.ts
 *
 * Normalizes every Soroban RPC error shape — contract errors, RPC-layer
 * failures, Freighter signing rejections, and network faults — into a
 * single structured `NormalizedRpcError` used by both the frontend UI
 * (SubscriptionForm) and the transaction layer (transaction_builder).
 *
 * ## Error taxonomy
 *
 * | Category          | Source / pattern                                    |
 * |-------------------|-----------------------------------------------------|
 * | Contract errors   | `error(contract, #N)` or contract error name in msg |
 * | Simulation errors | `Transaction preparation failed`                    |
 * | Submission errors | `Transaction submission failed`                     |
 * | Polling timeout   | `confirmation timeout`                              |
 * | On-chain failure  | `Transaction failed on-chain`                       |
 * | Freighter signing | `user declined` / `rejected` / `signing failed`     |
 * | Wrong network     | `passphrase` / `network mismatch` / `wrong network` |
 * | Insufficient funds| `insufficient balance` / `not enough` / `underfunded`|
 * | Token allowance   | `allowance` / `transfer from` / `spend limit`       |
 * | Network / fetch   | `fetch` / `network` / `failed to fetch` / `rpc`     |
 * | Unknown           | anything else                                       |
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Canonical error categories emitted by the normalizer.
 *
 * Use `category` for programmatic branching (e.g. deciding whether to
 * re-enable the submit button immediately vs. prompting the user to act).
 */
export type FrontendErrorCategory =
  | 'wallet_rejection'
  | 'unavailable_rpc'
  | 'simulation_failure'
  | 'ledger_execution_failure'
  | 'unknown';

export interface DiagnosticContext {
  category: FrontendErrorCategory;
  recoveryPath: string;
  sanitizedDetail: string;
}

export interface FrontendErrorState {
  category: FrontendErrorCategory;
  title: string;
  message: string;
  nextSteps: string;
  retryable: boolean;
  diagnosticContext: DiagnosticContext;
}

export type RpcErrorCategory =
  | FrontendErrorCategory
  | 'contract_error'       // on-chain ContractError (known code or name)
  | 'simulation_failed'    // prepareTransaction / simulation rejected
  | 'submission_failed'    // sendTransaction returned ERROR status
  | 'onchain_failed'       // transaction confirmed but returned FAILED status
  | 'confirmation_timeout' // polling timed out — tx may still confirm
  | 'signing_rejected'     // Freighter popup dismissed or declined
  | 'wrong_network'        // Freighter / app network passphrase mismatch
  | 'insufficient_funds'   // subscriber XLM or token balance too low
  | 'allowance_too_low'    // token allowance for contract is insufficient
  | 'network_error';       // fetch / RPC connection failure

/**
 * Structured error produced by `normalizeRpcError`.
 *
 * All fields are safe to display in the UI. Sensitive technical details,
 * provider credentials, and secret keys are sanitized in `rawMessage`.
 */
export interface NormalizedRpcError {
  /** Machine-readable category for switch/if branching in UI and retry logic. */
  category: RpcErrorCategory;

  /** High-level typed frontend failure category. */
  failureCategory: FrontendErrorCategory;

  /**
   * Short, user-facing title.
   * Example: "Signing cancelled"
   */
  title: string;

  /**
   * One-sentence explanation of what happened.
   * Example: "The Freighter pop-up was dismissed."
   */
  summary: string;

  /**
   * Actionable step the user can take to resolve or retry.
   * May include code snippets or references to UI controls.
   */
  action: string;

  /**
   * When true the same inputs can be resubmitted without modification.
   * When false the user needs to change something before retrying.
   *
   * Used by the form to decide whether to show a "Retry" shortcut.
   */
  retryable: boolean;

  /**
   * When this is a known contract error, the numeric code (1–17).
   * Undefined for non-contract errors.
   */
  contractCode?: number;

  /**
   * The sanitized error message as a string.
   * Redacts passwords, API keys, tokens, and private keys.
   */
  rawMessage: string;

  /**
   * Diagnostic context for troubleshooting without leaking secrets.
   */
  diagnosticContext: DiagnosticContext;
}

// ─── Contract error code map ──────────────────────────────────────────────────

/**
 * Complete mapping of every ContractError code defined in
 * `contracts/subscription/src/error.rs` (codes 1–17).
 */
interface ContractErrorDef {
  title: string;
  summary: string;
  action: string;
  retryable: boolean;
}

const CONTRACT_ERROR_DEFS: Record<number, ContractErrorDef> = {
  1: {
    title: 'Invalid amount',
    summary: 'The contract rejected the amount — it must be greater than zero.',
    action: 'Enter a positive integer amount and resubmit.',
    retryable: false,
  },
  2: {
    title: 'Interval too short',
    summary:
      'The payment interval is below the 1-day minimum (86 400 seconds).',
    action:
      'Enter an interval of at least 86 400 seconds (1 day).',
    retryable: false,
  },
  3: {
    title: 'Interval too long',
    summary:
      'The payment interval exceeds the 1-year maximum (31 536 000 seconds).',
    action:
      'Enter an interval of at most 31 536 000 seconds (365 days).',
    retryable: false,
  },
  4: {
    title: 'No active subscription',
    summary:
      'No subscription was found for this subscriber / merchant pair.',
    action:
      'Check that the correct merchant address is entered, or create a new subscription.',
    retryable: false,
  },
  5: {
    title: 'Payment not due yet',
    summary:
      'The payment interval has not elapsed since the last collection.',
    action:
      'Wait until the next scheduled payment date before retrying.',
    retryable: false,
  },
  6: {
    title: 'Authorisation failed',
    summary: 'The contract rejected the transaction signature.',
    action:
      'Ensure the connected Freighter account matches the subscriber address and retry.',
    retryable: true,
  },
  7: {
    title: 'Transfer failed',
    summary:
      'The subscriber has insufficient token balance to cover this payment.',
    action:
      'Top up your token balance then retry.',
    retryable: false,
  },
  8: {
    title: 'Invalid timestamp',
    summary:
      'The ledger timestamp is zero or would overflow when computing the next payment date.',
    action:
      'This is a temporary chain condition. Retry in a few seconds.',
    retryable: true,
  },
  9: {
    title: 'Amount too large',
    summary:
      'The requested amount exceeds the contract maximum of 10¹⁸ token units.',
    action:
      'Enter a smaller amount and resubmit.',
    retryable: false,
  },
  10: {
    title: 'Self-subscription not allowed',
    summary: 'The subscriber and merchant addresses must be different accounts.',
    action: 'Use a different merchant address.',
    retryable: false,
  },
  11: {
    title: 'Invalid token address',
    summary:
      'The token address must not be the SorobanPay contract address itself.',
    action: 'Enter the correct SEP-41 token contract address.',
    retryable: false,
  },
  12: {
    title: 'Empty batch',
    summary:
      'batch_execute_payment was called with no subscribers.',
    action: 'Provide at least one subscriber address in the batch.',
    retryable: false,
  },
  13: {
    title: 'Batch too large',
    summary:
      'batch_execute_payment supports at most 50 subscribers per call.',
    action: 'Split the batch into chunks of 50 or fewer and retry each.',
    retryable: false,
  },
  14: {
    title: 'Insufficient allowance',
    summary:
      'The SEP-41 token allowance granted to this contract is below the subscription amount.',
    action:
      'Approve a higher token allowance by calling token.approve(contract_id, amount) before subscribing.',
    retryable: false,
  },
  15: {
    title: 'Contract already migrated',
    summary: 'The contract schema is already at the latest version.',
    action: 'No migration is needed.',
    retryable: false,
  },
  16: {
    title: 'Not admin',
    summary: 'Only the stored admin address may call migrate().',
    action: 'Sign with the admin account.',
    retryable: false,
  },
  17: {
    title: 'Contract not initialized',
    summary: 'The contract admin has not been set — initialize() must be called first.',
    action: 'Deploy or re-initialize the contract before use.',
    retryable: false,
  },
};

// ─── Contract error name → code map ──────────────────────────────────────────

/**
 * Allows matching error *names* as they appear in stringified SDK errors,
 * e.g. `"AmountMustBePositive"` or `"intervaltoo"` (lowercased substring).
 */
const CONTRACT_ERROR_NAME_MAP: Array<[RegExp, number]> = [
  [/amountmustbepositive/i,    1],
  [/intervaltoo\s*short/i,     2],
  [/intervaltoo\s*long/i,      3],
  [/intervaltoo/i,             2], // fallback when "short"/"long" absent
  [/noactivesubscription/i,    4],
  [/paymentnotdue/i,           5],
  [/\bunauthorized\b/i,        6],
  [/transferfailed/i,          7],
  [/invalidtimestamp/i,        8],
  [/amounttoolarge/i,          9],
  [/selfsubscription/i,        10],
  [/invalidtokenaddress/i,     11],
  [/emptybatch/i,              12],
  [/batchtoolarge/i,           13],
  [/insufficientallowance/i,   14],
  [/alreadymigrated/i,         15],
  [/notadmin/i,                16],
  [/notinitialized/i,          17],
];

// ─── Numeric code extraction ──────────────────────────────────────────────────

/**
 * Try to extract `N` from patterns like:
 *   - `error(contract, #N)`
 *   - `HostError: contract error #N`
 *   - `contract error code N`
 */
function extractContractCode(msg: string): number | undefined {
  const patterns = [
    /error\s*\(\s*contract\s*,\s*#(\d+)\s*\)/i,
    /contract\s+error\s+#(\d+)/i,
    /contract\s+error\s+code\s+(\d+)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(msg);
    if (m) {
      const code = parseInt(m[1], 10);
      if (code >= 1 && code <= 17) return code;
    }
  }
  return undefined;
}

// ─── Public normalizer ────────────────────────────────────────────────────────

/**
 * Convert any thrown value from the Soroban transaction pipeline into a
 * `NormalizedRpcError`.
 *
 * Pass the caught value directly — the function handles `Error` objects,
 * plain strings, and anything else.
 *
 * @example
 * ```ts
 * try {
 *   await buildAndSubmitSubscribe(…);
 * } catch (err) {
 *   const normalized = normalizeRpcError(err);
 *   // normalized.category, .title, .summary, .action, .retryable
 * }
 * ```
 */
/**
 * Redacts sensitive credentials, private keys, authorization tokens,
 * and secret query parameters so raw provider details are never exposed to users.
 */
export function sanitizeSensitiveDetails(message: string): string {
  if (!message || typeof message !== 'string') return '';
  return message
    // 1. Basic auth in URLs: https://user:pass@host -> https://***:***@host
    .replace(/(https?:\/\/)([^:\/\s@]+):([^@\/\s]+)@/gi, '$1***:***@')
    // 2. Sensitive query params: ?api_key=..., &token=..., &secret=..., etc.
    .replace(/([?&](?:api[-_]?key|key|token|secret|access[-_]?token|password)=)([^&"'\s]+)/gi, '$1[REDACTED]')
    // 3. Bearer or auth tokens
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.~+/]+=*/gi, '$1[REDACTED]')
    // 4. Stellar secret seed keys (S...)
    .replace(/\bS[A-Z2-7]{55}\b/g, '[SECRET_KEY_REDACTED]')
    // 5. Authorization header patterns
    .replace(/(authorization:\s*)(basic|bearer)\s+[A-Za-z0-9_\-\.~+/]+=*/gi, '$1$2 [REDACTED]');
}

export function toFrontendErrorCategory(category: RpcErrorCategory): FrontendErrorCategory {
  switch (category) {
    case 'signing_rejected':
    case 'wallet_rejection':
      return 'wallet_rejection';
    case 'network_error':
    case 'confirmation_timeout':
    case 'unavailable_rpc':
      return 'unavailable_rpc';
    case 'simulation_failed':
    case 'simulation_failure':
      return 'simulation_failure';
    case 'contract_error':
    case 'onchain_failed':
    case 'submission_failed':
    case 'ledger_execution_failure':
      return 'ledger_execution_failure';
    default:
      return 'unknown';
  }
}

export function getRecoveryPath(category: FrontendErrorCategory): string {
  switch (category) {
    case 'wallet_rejection':
      return 'Re-prompt wallet signing';
    case 'unavailable_rpc':
      return 'Failover or retry after checking connectivity';
    case 'simulation_failure':
      return 'Adjust form inputs or approve required token allowance';
    case 'ledger_execution_failure':
      return 'Inspect ledger meta result and update contract state/inputs';
    case 'unknown':
    default:
      return 'Safe fallback retry';
  }
}

function buildResult(
  category: RpcErrorCategory,
  title: string,
  summary: string,
  action: string,
  retryable: boolean,
  rawMessage: string,
  contractCode?: number,
): NormalizedRpcError {
  const failureCategory = toFrontendErrorCategory(category);
  return {
    category,
    failureCategory,
    title,
    summary,
    action,
    retryable,
    contractCode,
    rawMessage,
    diagnosticContext: {
      category: failureCategory,
      recoveryPath: getRecoveryPath(failureCategory),
      sanitizedDetail: rawMessage,
    },
  };
}

/**
 * Normalizes every Soroban RPC error shape into a single structured
 * `NormalizedRpcError`.
 *
 * Pass the caught value directly — the function handles `Error` objects,
 * plain strings, and anything else.
 *
 * @example
 * ```ts
 * try {
 *   await buildAndSubmitSubscribe(…);
 * } catch (err) {
 *   const normalized = normalizeRpcError(err);
 *   // normalized.category, .failureCategory, .title, .summary, .action, .retryable
 * }
 * ```
 */
export function normalizeRpcError(err: unknown): NormalizedRpcError {
  const rawOriginal =
    err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const rawMessage = sanitizeSensitiveDetails(rawOriginal);
  const msg = rawMessage.toLowerCase();

  // ── 1. Contract error by numeric code (highest-priority — most precise) ─────
  const contractCode = extractContractCode(rawMessage);
  if (contractCode !== undefined) {
    const def = CONTRACT_ERROR_DEFS[contractCode];
    if (def) {
      return buildResult(
        'contract_error',
        def.title,
        def.summary,
        def.action,
        def.retryable,
        rawMessage,
        contractCode,
      );
    }
  }

  // ── 2. Contract error by name ─────────────────────────────────────────────
  for (const [re, code] of CONTRACT_ERROR_NAME_MAP) {
    if (re.test(rawMessage)) {
      const def = CONTRACT_ERROR_DEFS[code];
      if (def) {
        return buildResult(
          'contract_error',
          def.title,
          def.summary,
          def.action,
          def.retryable,
          rawMessage,
          code,
        );
      }
    }
  }

  // ── 3. Freighter signing rejection / wallet rejection ───────────────────────
  if (
    msg.includes('user declined') ||
    msg.includes('user rejected') ||
    msg.includes('signing failed') ||
    msg.includes('wallet rejection') ||
    msg.includes('rejected') // generic Freighter rejection
  ) {
    return buildResult(
      'signing_rejected',
      'Signing cancelled',
      'The Freighter pop-up was dismissed or the signing request was rejected.',
      'Click "Authorize Subscription" again and approve the transaction in the Freighter pop-up. To use a different account, switch accounts in Freighter first.',
      true,
      rawMessage,
    );
  }

  // ── 4. Wrong network ──────────────────────────────────────────────────────
  if (
    msg.includes('wrong network') ||
    msg.includes('network mismatch') ||
    msg.includes('passphrase')
  ) {
    return buildResult(
      'wrong_network',
      'Wrong network',
      'Freighter is configured for a different network than the app expects.',
      'Open Freighter, click the network selector, and switch to the network that matches NEXT_PUBLIC_NETWORK_PASSPHRASE in your .env.local, then retry.',
      true,
      rawMessage,
    );
  }

  // ── 5. Simulation failure (transaction_builder prepareTransaction) ─────────
  if (
    msg.includes('transaction preparation failed') ||
    msg.includes('simulation failed') ||
    msg.includes('simulation failure')
  ) {
    return buildResult(
      'simulation_failed',
      'Simulation failed',
      'The Soroban RPC could not simulate the transaction or inject resource fees.',
      'Check that the contract address and network are correct. If the problem persists, the RPC node may be congested — retry in a moment.',
      true,
      rawMessage,
    );
  }

  // ── 6. Submission failure (transaction_builder sendTransaction ERROR) ──────
  if (msg.includes('transaction submission failed')) {
    return buildResult(
      'submission_failed',
      'Transaction submission failed',
      'The Soroban RPC rejected the transaction envelope at submission time.',
      'This is often a transient RPC issue. Retry the transaction. If it persists, inspect the XDR in the technical details for a specific cause.',
      true,
      rawMessage,
    );
  }

  // ── 7. On-chain failure (polling found FAILED status) ─────────────────────
  if (
    msg.includes('transaction failed on-chain') ||
    msg.includes('ledger execution failure') ||
    msg.includes('execution failure')
  ) {
    return buildResult(
      'onchain_failed',
      'Transaction failed on-chain',
      'The transaction was included in the ledger but the contract invocation reverted.',
      'Inspect the result meta XDR in the technical details to identify the contract error, then correct the inputs.',
      false,
      rawMessage,
    );
  }

  // ── 8. Polling timeout ────────────────────────────────────────────────────
  if (
    msg.includes('confirmation timeout') ||
    msg.includes('timed out') ||
    msg.includes('timeout')
  ) {
    return buildResult(
      'confirmation_timeout',
      'Transaction timed out',
      'The network did not confirm the transaction within the expected window.',
      'The transaction may still confirm — wait a minute before resubmitting to avoid a duplicate. You can look up the transaction hash in Stellar Expert to check its status.',
      true,
      rawMessage,
    );
  }

  // ── 9. Insufficient balance ───────────────────────────────────────────────
  if (
    msg.includes('insufficient balance') ||
    msg.includes('not enough') ||
    msg.includes('underfunded')
  ) {
    return buildResult(
      'insufficient_funds',
      'Insufficient balance',
      'Your wallet does not have enough tokens or XLM to cover this transaction.',
      'Top up your account. On testnet use Stellar Friendbot; on mainnet transfer XLM or the relevant token to your address.',
      false,
      rawMessage,
    );
  }

  // ── 10. Token allowance ───────────────────────────────────────────────────
  if (
    msg.includes('allowance') ||
    msg.includes('transfer from') ||
    msg.includes('spend limit')
  ) {
    return buildResult(
      'allowance_too_low',
      'Token allowance too low',
      'The contract is not authorized to transfer this token amount on your behalf.',
      'Approve a higher token allowance: call token.approve(contract_id, amount) from your wallet before subscribing.',
      false,
      rawMessage,
    );
  }

  // ── 11. Network / fetch error / unavailable RPC ───────────────────────────
  if (
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('fetch error') ||
    msg.includes('networkerror') ||
    (msg.includes('fetch') && !msg.includes('freighter')) ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('unavailable rpc') ||
    msg.includes('rpc')
  ) {
    return buildResult(
      'network_error',
      'Network error',
      'Could not reach the Soroban RPC endpoint.',
      'Check your internet connection and verify NEXT_PUBLIC_RPC_URL in .env.local. Retry in a moment.',
      true,
      rawMessage,
    );
  }

  // ── 12. Unknown / catch-all ───────────────────────────────────────────────
  return buildResult(
    'unknown',
    'Transaction failed',
    'An unexpected error occurred while submitting the transaction.',
    'Review the technical details below and retry. If the problem persists, consult the README troubleshooting section.',
    true,
    rawMessage,
  );
}

/**
 * High-level typed frontend error mapping that maps any error to a stable
 * UI recovery state while sanitizing sensitive details and provider payloads.
 */
export function mapFrontendError(err: unknown): FrontendErrorState {
  const normalized = normalizeRpcError(err);
  const failureCategory = normalized.failureCategory ?? toFrontendErrorCategory(normalized.category);
  const sanitized = sanitizeSensitiveDetails(normalized.rawMessage);

  switch (failureCategory) {
    case 'wallet_rejection':
      return {
        category: 'wallet_rejection',
        title: 'Wallet Signature Declined',
        message: 'The transaction signing request was declined or dismissed in your wallet.',
        nextSteps: 'Click Authorize Subscription again and approve the transaction in the wallet pop-up.',
        retryable: true,
        diagnosticContext: {
          category: 'wallet_rejection',
          recoveryPath: 'Re-prompt wallet signing',
          sanitizedDetail: sanitized,
        },
      };

    case 'unavailable_rpc':
      return {
        category: 'unavailable_rpc',
        title: 'RPC Service Unavailable',
        message: 'The Soroban RPC node could not be reached or the request timed out.',
        nextSteps: 'Check your internet connection, verify configured endpoint URL, or wait for RPC failover.',
        retryable: true,
        diagnosticContext: {
          category: 'unavailable_rpc',
          recoveryPath: 'Failover or retry after checking connectivity',
          sanitizedDetail: sanitized,
        },
      };

    case 'simulation_failure':
      return {
        category: 'simulation_failure',
        title: 'Transaction Simulation Failed',
        message: 'The transaction simulation failed pre-flight verification against the contract.',
        nextSteps: 'Verify subscription inputs, token contract validity, and account allowance before retrying.',
        retryable: true,
        diagnosticContext: {
          category: 'simulation_failure',
          recoveryPath: 'Adjust form inputs or approve required token allowance',
          sanitizedDetail: sanitized,
        },
      };

    case 'ledger_execution_failure':
      return {
        category: 'ledger_execution_failure',
        title: 'Ledger Execution Failed',
        message: 'The transaction reached the ledger but was rejected during execution.',
        nextSteps: 'Inspect contract error diagnostics, correct the failing condition, and resubmit.',
        retryable: false,
        diagnosticContext: {
          category: 'ledger_execution_failure',
          recoveryPath: 'Inspect ledger meta result and update contract state/inputs',
          sanitizedDetail: sanitized,
        },
      };

    case 'unknown':
    default:
      return {
        category: 'unknown',
        title: 'Transaction Encountered An Error',
        message: 'An unexpected error occurred while processing your transaction.',
        nextSteps: 'Please review your inputs and try again. If the issue persists, contact support.',
        retryable: normalized.retryable,
        diagnosticContext: {
          category: 'unknown',
          recoveryPath: 'Safe fallback retry',
          sanitizedDetail: sanitized,
        },
      };
  }
}
