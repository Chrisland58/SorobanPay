import {
  analyzeMigrationSql,
  evaluateMigrationGate,
  extractSqlStatements,
  formatGateReport,
  stripSqlComments,
  validateOverride,
} from '../src/lib/migrationCompatibility';

describe('migrationCompatibility', () => {
  describe('stripSqlComments & extractSqlStatements', () => {
    it('ignores single-line and block SQL comments', () => {
      const sql = `
        -- DROP TABLE users;
        /* ALTER TABLE payments DROP COLUMN amount; */
        CREATE TABLE audit_events (id SERIAL PRIMARY KEY);
      `;
      const stripped = stripSqlComments(sql);
      expect(stripped).not.toContain('DROP TABLE');
      expect(stripped).not.toContain('DROP COLUMN');

      const statements = extractSqlStatements(sql);
      expect(statements).toHaveLength(1);
      expect(statements[0].statement).toContain('CREATE TABLE audit_events');
    });

    it('handles empty or whitespace-only SQL', () => {
      expect(extractSqlStatements('')).toEqual([]);
      expect(extractSqlStatements('   \n\t  ')).toEqual([]);
      expect(analyzeMigrationSql('empty.sql', '')).toEqual([]);
    });
  });

  describe('compatible expand-and-contract patterns', () => {
    it('passes CREATE TABLE, nullable ADD COLUMN, ADD COLUMN with DEFAULT, and CREATE INDEX CONCURRENTLY', () => {
      const sql = `
        CREATE TABLE subscription_snapshots (
          id UUID PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE payments ADD COLUMN memo TEXT;
        ALTER TABLE payments ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX CONCURRENTLY idx_payments_memo ON payments (memo);
      `;
      const result = evaluateMigrationGate([{ file: '001_expand.sql', sql }]);

      expect(result.passed).toBe(true);
      expect(result.incompatibleCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.compatibleCount).toBe(4);
    });
  });

  describe('incompatible and destructive operations', () => {
    it.each([
      ['DROP TABLE users;', 'DESTRUCTIVE_DROP_TABLE', 'DROP TABLE'],
      ['ALTER TABLE users DROP COLUMN legacy_id;', 'DESTRUCTIVE_DROP_COLUMN', 'DROP COLUMN'],
      [
        'ALTER TABLE users RENAME COLUMN email TO primary_email;',
        'BREAKING_RENAME_COLUMN',
        'RENAME COLUMN',
      ],
      ['ALTER TABLE users RENAME TO accounts;', 'BREAKING_RENAME_TABLE', 'RENAME TABLE'],
      [
        'ALTER TABLE payments ALTER COLUMN amount TYPE BIGINT;',
        'BREAKING_ALTER_COLUMN_TYPE',
        'ALTER COLUMN TYPE',
      ],
      [
        'ALTER TABLE payments ALTER COLUMN currency SET NOT NULL;',
        'BREAKING_SET_NOT_NULL',
        'SET NOT NULL',
      ],
      [
        'ALTER TABLE payments ADD COLUMN external_ref TEXT NOT NULL;',
        'BREAKING_ADD_NOT_NULL_NO_DEFAULT',
        'ADD COLUMN NOT NULL without DEFAULT',
      ],
      ['TRUNCATE TABLE temp_events;', 'DESTRUCTIVE_TRUNCATE', 'TRUNCATE TABLE'],
    ])('detects %s as incompatible (%s)', (sql, expectedRuleId, expectedOperation) => {
      const result = evaluateMigrationGate([{ file: '002_breaking.sql', sql }]);

      expect(result.passed).toBe(false);
      expect(result.incompatibleCount).toBe(1);
      expect(result.findings[0].ruleId).toBe(expectedRuleId);
      expect(result.findings[0].operation).toBe(expectedOperation);
      expect(result.findings[0].file).toBe('002_breaking.sql');
      expect(result.findings[0].line).toBe(1);
    });

    it('reports multiple incompatible operations in a single migration', () => {
      const sql = `
        ALTER TABLE a DROP COLUMN x;
        DROP TABLE b;
      `;
      const result = evaluateMigrationGate([{ file: '003_multi.sql', sql }]);
      expect(result.passed).toBe(false);
      expect(result.incompatibleCount).toBe(2);
    });

    it('flags non-concurrent CREATE INDEX as a warning without failing the gate', () => {
      const sql = 'CREATE INDEX idx_payments_status ON payments (status);';
      const result = evaluateMigrationGate([{ file: '004_index.sql', sql }]);

      expect(result.passed).toBe(true);
      expect(result.warningCount).toBe(1);
      expect(result.findings[0].ruleId).toBe('LOCK_RISK_CREATE_INDEX_BLOCKING');
    });
  });

  describe('override validation and failure handling', () => {
    const breakingFiles = [
      { file: '005_drop.sql', sql: 'ALTER TABLE users DROP COLUMN old_col;' },
    ];

    it('allows incompatible migration when explicit approver and rationale are provided', () => {
      const override = {
        approver: '@platform-lead',
        rationale: 'Column old_col has zero readers since v2.4.0 deployed 14 days ago.',
      };
      const result = evaluateMigrationGate(breakingFiles, override);

      expect(result.passed).toBe(true);
      expect(result.overridden).toBe(true);
      expect(result.overrideError).toBeUndefined();

      const report = formatGateReport(result, override);
      expect(report).toContain('PASSED (OVERRIDDEN)');
      expect(report).toContain('@platform-lead');
    });

    it('rejects override when approver is missing', () => {
      const result = evaluateMigrationGate(breakingFiles, {
        approver: '   ',
        rationale: 'Valid rationale with sufficient length.',
      });

      expect(result.passed).toBe(false);
      expect(result.overridden).toBe(false);
      expect(result.overrideError).toContain('explicit approver');
    });

    it('rejects override when rationale is missing or too short', () => {
      const check = validateOverride({ approver: '@alice', rationale: 'urgent' });
      expect(check.valid).toBe(false);
      expect(check.requested).toBe(true);
      expect(check.error).toContain('at least 10 characters');

      const result = evaluateMigrationGate(breakingFiles, {
        approver: '@alice',
        rationale: 'short',
      });
      expect(result.passed).toBe(false);
      expect(result.overridden).toBe(false);
    });
  });
});
