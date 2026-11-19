/**
 * Pre-deploy backward-compatible database migration analyzer.
 *
 * Classifies SQL migration diffs against expand-and-contract rules so rolling
 * deployments do not break existing application instances.
 */

export type CompatibilityClassification = 'compatible' | 'warning' | 'incompatible';

export interface MigrationFinding {
  file: string;
  line: number;
  classification: CompatibilityClassification;
  ruleId: string;
  operation: string;
  statement: string;
  remediation: string;
}

export interface MigrationOverride {
  approver?: string;
  rationale?: string;
}

export interface MigrationGateResult {
  passed: boolean;
  overridden: boolean;
  overrideError?: string;
  findings: MigrationFinding[];
  incompatibleCount: number;
  warningCount: number;
  compatibleCount: number;
}

interface RuleDefinition {
  ruleId: string;
  classification: CompatibilityClassification;
  operation: string;
  pattern: RegExp;
  remediation: string;
}

const RULES: RuleDefinition[] = [
  {
    ruleId: 'DESTRUCTIVE_DROP_TABLE',
    classification: 'incompatible',
    operation: 'DROP TABLE',
    pattern: /\bDROP\s+TABLE\b/i,
    remediation:
      'Stop reading/writing the table in application code first, deploy, then drop in a later contract release.',
  },
  {
    ruleId: 'DESTRUCTIVE_DROP_COLUMN',
    classification: 'incompatible',
    operation: 'DROP COLUMN',
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+COLUMN\b/i,
    remediation:
      'Remove all application references to the column in an earlier release before dropping it.',
  },
  {
    ruleId: 'BREAKING_RENAME_COLUMN',
    classification: 'incompatible',
    operation: 'RENAME COLUMN',
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+COLUMN\b/i,
    remediation:
      'Use expand-and-contract: add the new column, dual-write, backfill, switch reads, then drop the old column.',
  },
  {
    ruleId: 'BREAKING_RENAME_TABLE',
    classification: 'incompatible',
    operation: 'RENAME TABLE',
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+TO\b/i,
    remediation:
      'Create the new table or view, dual-write/migrate traffic, then drop the old table in a subsequent release.',
  },
  {
    ruleId: 'BREAKING_ALTER_COLUMN_TYPE',
    classification: 'incompatible',
    operation: 'ALTER COLUMN TYPE',
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\b(?:SET\s+DATA\s+)?TYPE\b/i,
    remediation:
      'Add a new column with the target type, backfill, dual-write, switch reads, then drop the old column.',
  },
  {
    ruleId: 'BREAKING_SET_NOT_NULL',
    classification: 'incompatible',
    operation: 'SET NOT NULL',
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bSET\s+NOT\s+NULL\b/i,
    remediation:
      'Add a CHECK constraint with NOT VALID, backfill nulls, then VALIDATE CONSTRAINT before enforcing NOT NULL.',
  },
  {
    ruleId: 'BREAKING_ADD_NOT_NULL_NO_DEFAULT',
    classification: 'incompatible',
    operation: 'ADD COLUMN NOT NULL without DEFAULT',
    pattern:
      /\bALTER\s+TABLE\b[\s\S]*?\bADD\s+(?:COLUMN\s+)?(?![\s\S]*\bDEFAULT\b)[\s\S]*?\bNOT\s+NULL\b/i,
    remediation:
      'Add the column as nullable (or with a safe DEFAULT), backfill existing rows, then enforce NOT NULL.',
  },
  {
    ruleId: 'DESTRUCTIVE_TRUNCATE',
    classification: 'incompatible',
    operation: 'TRUNCATE TABLE',
    pattern: /\bTRUNCATE\s+(?:TABLE\s+)?/i,
    remediation: 'Avoid TRUNCATE in rolling migrations; use a controlled background job if data cleanup is needed.',
  },
  {
    ruleId: 'LOCK_RISK_CREATE_INDEX_BLOCKING',
    classification: 'warning',
    operation: 'CREATE INDEX without CONCURRENTLY',
    pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)/i,
    remediation: 'Use CREATE INDEX CONCURRENTLY to avoid blocking writes during rolling deployments.',
  },
  {
    ruleId: 'COMPATIBLE_CREATE_INDEX_CONCURRENTLY',
    classification: 'compatible',
    operation: 'CREATE INDEX CONCURRENTLY',
    pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i,
    remediation: 'No action required.',
  },
  {
    ruleId: 'COMPATIBLE_CREATE_TABLE',
    classification: 'compatible',
    operation: 'CREATE TABLE',
    pattern: /\bCREATE\s+TABLE\b/i,
    remediation: 'No action required.',
  },
  {
    ruleId: 'COMPATIBLE_ADD_COLUMN',
    classification: 'compatible',
    operation: 'ADD COLUMN (nullable or with DEFAULT)',
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bADD\s+(?:COLUMN\s+)?/i,
    remediation: 'No action required.',
  },
];

/**
 * Strips SQL single-line (`-- ...`) and block (`/* ... *\/`) comments while
 * preserving newlines so line numbers remain accurate.
 */
export function stripSqlComments(sql: string): string {
  const withoutBlockComments = sql.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
  return withoutBlockComments.replace(/--[^\n]*/g, '');
}

/**
 * Splits SQL text into individual statements with their starting 1-based line numbers.
 */
export function extractSqlStatements(sql: string): Array<{ statement: string; line: number }> {
  const cleaned = stripSqlComments(sql);
  const statements: Array<{ statement: string; line: number }> = [];
  let current = '';
  let startLine = 1;
  let currentLine = 1;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (current.trim().length === 0 && ch !== '\n' && ch.trim().length > 0) {
      startLine = currentLine;
    }
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push({ statement: trimmed, line: startLine });
      }
      current = '';
    } else {
      current += ch;
    }
    if (ch === '\n') {
      currentLine++;
    }
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push({ statement: trailing, line: startLine });
  }

  return statements;
}

/**
 * Analyzes a single migration file's SQL content and returns all classified findings.
 */
export function analyzeMigrationSql(file: string, sql: string): MigrationFinding[] {
  if (!sql || sql.trim().length === 0) {
    return [];
  }

  const statements = extractSqlStatements(sql);
  const findings: MigrationFinding[] = [];

  for (const { statement, line } of statements) {
    for (const rule of RULES) {
      if (rule.pattern.test(statement)) {
        findings.push({
          file,
          line,
          classification: rule.classification,
          ruleId: rule.ruleId,
          operation: rule.operation,
          statement: statement.replace(/\s+/g, ' ').slice(0, 200),
          remediation: rule.remediation,
        });
        break;
      }
    }
  }

  return findings;
}

/**
 * Validates an override request. Both an explicit approver and a meaningful
 * rationale (>= 10 characters) are required.
 */
export function validateOverride(override?: MigrationOverride): {
  valid: boolean;
  requested: boolean;
  error?: string;
} {
  if (!override) {
    return { valid: false, requested: false };
  }

  const approver = override.approver?.trim() ?? '';
  const rationale = override.rationale?.trim() ?? '';
  const requested = approver.length > 0 || rationale.length > 0;

  if (!requested) {
    return { valid: false, requested: false };
  }

  if (approver.length === 0) {
    return {
      valid: false,
      requested: true,
      error: 'Migration override requires an explicit approver (e.g. @handle or email).',
    };
  }

  if (rationale.length < 10) {
    return {
      valid: false,
      requested: true,
      error: 'Migration override requires an explicit rationale of at least 10 characters.',
    };
  }

  return { valid: true, requested: true };
}

/**
 * Evaluates a set of migration files (diffs or full SQL) against the pre-deploy gate.
 */
export function evaluateMigrationGate(
  files: Array<{ file: string; sql: string }>,
  override?: MigrationOverride,
): MigrationGateResult {
  const findings = files.flatMap(({ file, sql }) => analyzeMigrationSql(file, sql));

  const incompatibleCount = findings.filter((f) => f.classification === 'incompatible').length;
  const warningCount = findings.filter((f) => f.classification === 'warning').length;
  const compatibleCount = findings.filter((f) => f.classification === 'compatible').length;

  const overrideCheck = validateOverride(override);

  if (incompatibleCount === 0) {
    return {
      passed: true,
      overridden: false,
      findings,
      incompatibleCount,
      warningCount,
      compatibleCount,
    };
  }

  if (overrideCheck.valid) {
    return {
      passed: true,
      overridden: true,
      findings,
      incompatibleCount,
      warningCount,
      compatibleCount,
    };
  }

  return {
    passed: false,
    overridden: false,
    overrideError: overrideCheck.requested ? overrideCheck.error : undefined,
    findings,
    incompatibleCount,
    warningCount,
    compatibleCount,
  };
}

/**
 * Formats gate results into a human-readable report for CI logs.
 */
export function formatGateReport(result: MigrationGateResult, override?: MigrationOverride): string {
  const lines: string[] = [
    `Migration Compatibility Gate: ${result.passed ? 'PASSED' : 'FAILED'}` +
      (result.overridden ? ' (OVERRIDDEN)' : ''),
    `Summary: ${result.compatibleCount} compatible, ${result.warningCount} warning(s), ${result.incompatibleCount} incompatible`,
  ];

  if (result.overridden && override) {
    lines.push(
      `Override approved by: ${override.approver?.trim()} | Rationale: ${override.rationale?.trim()}`,
    );
  }

  if (result.overrideError) {
    lines.push(`Override rejected: ${result.overrideError}`);
  }

  for (const finding of result.findings) {
    if (finding.classification === 'compatible') {
      continue;
    }
    lines.push(
      `[${finding.classification.toUpperCase()}] ${finding.file}:${finding.line} (${finding.ruleId}) — ${finding.operation}`,
    );
    lines.push(`  Statement: ${finding.statement}`);
    lines.push(`  Remediation: ${finding.remediation}`);
  }

  return lines.join('\n');
}
