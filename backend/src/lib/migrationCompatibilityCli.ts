import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateMigrationGate,
  formatGateReport,
  type MigrationOverride,
} from './migrationCompatibility';

const MIGRATION_PATH_PATTERNS = [
  /^backend\/migrations\/.*\.sql$/i,
  /^backend\/src\/db\/schema\.sql$/i,
  /^backend\/audit-trail\/schema\.sql$/i,
];

function isMigrationFile(filePath: string): boolean {
  return MIGRATION_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function getChangedMigrationFiles(baseRef: string, headRef: string): string[] {
  const output = execSync(`git diff --name-only --diff-filter=AM ${baseRef}...${headRef}`, {
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && isMigrationFile(line));
}

function main(): void {
  const args = process.argv.slice(2);
  let baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'HEAD~1';
  let headRef = 'HEAD';
  const explicitFiles: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) {
      baseRef = args[++i];
    } else if (args[i] === '--head' && args[i + 1]) {
      headRef = args[++i];
    } else if (args[i] === '--file' && args[i + 1]) {
      explicitFiles.push(args[++i]);
    }
  }

  const filesToCheck =
    explicitFiles.length > 0 ? explicitFiles : getChangedMigrationFiles(baseRef, headRef);

  if (filesToCheck.length === 0) {
    console.log('Migration Compatibility Gate: PASSED (no migration files changed)');
    process.exit(0);
  }

  const inputs = filesToCheck
    .filter((filePath) => fs.existsSync(path.resolve(filePath)))
    .map((filePath) => ({
      file: filePath,
      sql: fs.readFileSync(path.resolve(filePath), 'utf8'),
    }));

  const override: MigrationOverride = {
    approver: process.env.MIGRATION_OVERRIDE_APPROVER,
    rationale: process.env.MIGRATION_OVERRIDE_RATIONALE,
  };

  const result = evaluateMigrationGate(inputs, override);
  console.log(formatGateReport(result, override));

  process.exit(result.passed ? 0 : 1);
}

main();
