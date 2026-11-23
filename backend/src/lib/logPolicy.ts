/**
 * Log Retention & Sensitive Data Redaction Policies
 * Issue #1682 — DevOps log retention and sensitive field policy checks.
 */

export const LOG_RETENTION_POLICY = {
  /** Operational logs (stdout / JSON streams from pods and containers) */
  OPERATIONAL_LOGS_DAYS: 30,
  /** Audit & security logs (cancellations, payment reconciliations, security events) */
  AUDIT_LOGS_YEARS: 7,
  /** Debug / trace logs in staging / dev environments */
  DEBUG_LOGS_DAYS: 7,
  /** Metrics retention period in Prometheus */
  METRICS_RETENTION_DAYS: 15,
} as const;

/**
 * Known sensitive field names (case-insensitive regex pattern).
 * Catches credentials, keys, tokens, secrets, PII, auth headers, and session identifiers.
 */
export const SENSITIVE_FIELD_NAMES: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'secretkey',
  'secret_key',
  'privatekey',
  'private_key',
  'seed',
  'secretseed',
  'secret_seed',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'authorization',
  'auth',
  'apikey',
  'api_key',
  'webhooksecret',
  'webhook_secret',
  'jwt',
  'admin_jwt_secret',
  'cookie',
  'session',
  'sessionid',
  'session_id',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'ssn',
  'email',
];

export const SENSITIVE_FIELD_PATTERN = new RegExp(
  `^(${SENSITIVE_FIELD_NAMES.join('|')})$`,
  'i',
);

/**
 * Regex patterns for forbidden secret and sensitive values in logs.
 * Used for static analysis of log streams and pre-release verification.
 */
export const SENSITIVE_VALUE_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  {
    name: 'Stellar Secret Seed',
    // Stellar secret seeds always start with 'S' and have 55 uppercase base32 characters following (56 total)
    pattern: /\bS[A-Z2-7]{55}\b/,
  },
  {
    name: 'Generic API Key / Secret Token (prefixed)',
    // e.g. sk_live_..., key_..., secret_...
    pattern: /\b(?:sk_live|sk_test|api_key|secret_key)_[a-zA-Z0-9]{20,}\b/,
  },
  {
    name: 'JSON Web Token (JWT)',
    // Header.Payload.Signature (base64url)
    pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
  },
  {
    name: 'Database URL with Password',
    // postgresql://user:password@host
    pattern: /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@[^\s]+/,
  },
  {
    name: 'Bearer Authorization Header Value',
    pattern: /\bBearer\s+[a-zA-Z0-9_.\-~+/]+=*\b/i,
  },
  {
    name: 'Email Address',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  },
  {
    name: 'Credit Card / PAN',
    // 13-19 digit card numbers with optional delimiters
    pattern: /\b(?:\d{4}[ -]?){3}\d{4}\b/,
  },
];
