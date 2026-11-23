import {
  SENSITIVE_FIELD_PATTERN,
  SENSITIVE_VALUE_PATTERNS,
} from './logPolicy';

export interface SensitiveFieldViolation {
  path: string;
  rule: string;
}

/**
 * Scan an object, array, or primitive for sensitive keys or value formats.
 *
 * CRITICAL REQUIREMENT: To ensure checks do NOT leak secrets into logs or console
 * outputs during automated failure reporting, violations record the field path
 * and matching rule name only — NEVER the sensitive fixture or payload value.
 */
export function scanForSensitiveData(
  data: unknown,
  currentPath: string = '',
): SensitiveFieldViolation[] {
  const violations: SensitiveFieldViolation[] = [];

  if (data === null || data === undefined) {
    return violations;
  }

  if (typeof data === 'string') {
    for (const rule of SENSITIVE_VALUE_PATTERNS) {
      if (rule.pattern.test(data)) {
        violations.push({
          path: currentPath || 'root',
          rule: rule.name,
        });
      }
    }
    return violations;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return violations;
  }

  if (Array.isArray(data)) {
    data.forEach((item, index) => {
      const itemPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`;
      violations.push(...scanForSensitiveData(item, itemPath));
    });
    return violations;
  }

  if (typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const fieldPath = currentPath ? `${currentPath}.${key}` : key;

      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        // Only if the value is not already safely redacted
        if (typeof value === 'string' && isRedactedValue(value)) {
          // Allowed: already redacted placeholder
        } else {
          violations.push({
            path: fieldPath,
            rule: `Forbidden sensitive field name: "${key}"`,
          });
        }
      }

      violations.push(...scanForSensitiveData(value, fieldPath));
    }
    return violations;
  }

  return violations;
}

/**
 * Determine if a string value is a safe redacted placeholder.
 */
function isRedactedValue(val: string): boolean {
  return (
    val === '[REDACTED]' ||
    val === '[REDACTED_SEED]' ||
    val === '***REDACTED***' ||
    val.includes('[REDACTED]') ||
    val.includes('[REDACTED_SEED]')
  );
}

/**
 * Assert that an operational log record or telemetry payload is compliant.
 * Throws an Error on violation WITHOUT logging or revealing sensitive contents.
 */
export function assertSafeLogEntry(entry: unknown): void {
  const violations = scanForSensitiveData(entry);
  if (violations.length > 0) {
    const summary = violations
      .map((v) => `field="${v.path}" (rule="${v.rule}")`)
      .join('; ');
    throw new Error(
      `Sensitive log policy violation detected at ${summary}. Log payload contents suppressed for security.`,
    );
  }
}
