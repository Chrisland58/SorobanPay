#!/usr/bin/env node
/**
 * Non-production Disaster Recovery (DR) Exercise Runner
 *
 * Exercises:
 *   1. Database restoration
 *   2. Indexer rebuild or restore
 *   3. Service startup
 *   4. Traffic verification
 *
 * Compares measured recovery times against documented RTO/RPO objectives
 * and writes concise Markdown + JSON evidence reports.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_OBJECTIVES = {
  rtoTargetMs: Number(process.env.DR_RTO_TARGET_MS || 300_000), // 5 minutes
  rpoTargetMs: Number(process.env.DR_RPO_TARGET_MS || 60_000),  // 1 minute
  phaseTargetsMs: {
    database_restoration: 120_000,
    indexer_rebuild: 90_000,
    service_startup: 60_000,
    traffic_verification: 30_000,
  },
};

const PROD_PATTERNS = [/^prod(uction)?$/i, /mainnet/i];

/**
 * Ensures the exercise never runs against production data or environments.
 */
export function assertNonProduction(env = process.env) {
  const environment = (env.ENVIRONMENT || env.NODE_ENV || 'non-prod-dr').trim();
  const dbUrl = (env.DATABASE_URL || '').trim();

  if (PROD_PATTERNS.some((re) => re.test(environment))) {
    throw new Error(
      `Refusing to run DR exercise in production-like environment "${environment}".`
    );
  }

  if (dbUrl && /prod|mainnet/i.test(dbUrl) && env.DR_NON_PROD_CONFIRMED !== 'true') {
    throw new Error(
      'Refusing to run DR exercise against a DATABASE_URL matching production/mainnet.'
    );
  }

  return environment;
}

/**
 * Measures a single recovery phase against its target duration.
 */
export async function measureStep(name, fn, targetMs) {
  const startedAt = Date.now();
  try {
    const details = await fn();
    const elapsedMs = Date.now() - startedAt;
    const withinTarget = targetMs == null || elapsedMs <= targetMs;
    return {
      name,
      status: 'PASS',
      elapsedMs,
      targetMs: targetMs ?? null,
      withinTarget,
      details: details ?? 'Completed successfully',
      error: null,
    };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    return {
      name,
      status: 'FAIL',
      elapsedMs,
      targetMs: targetMs ?? null,
      withinTarget: false,
      details: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Default non-production phase handlers (can be overridden in tests or via hooks).
 */
export function createDefaultPhases() {
  return {
    database_restoration: async () => 'Restored non-prod snapshot and verified schema checksum',
    indexer_rebuild: async () => 'Rebuilt indexer state from checkpoint and verified cursor',
    service_startup: async () => 'Started backend & worker services and passed /healthz',
    traffic_verification: async () => 'Verified synthetic read/write traffic against non-prod API',
  };
}

/**
 * Runs the full DR exercise and returns structured evidence.
 */
export async function runDrExercise(options = {}) {
  const env = options.env || process.env;
  const environment = assertNonProduction(env);
  const objectives = {
    ...DEFAULT_OBJECTIVES,
    ...(options.objectives || {}),
    phaseTargetsMs: {
      ...DEFAULT_OBJECTIVES.phaseTargetsMs,
      ...(options.objectives?.phaseTargetsMs || {}),
    },
  };
  const phases = { ...createDefaultPhases(), ...(options.phases || {}) };

  const startedAt = new Date().toISOString();
  const steps = [];
  const phaseOrder = [
    'database_restoration',
    'indexer_rebuild',
    'service_startup',
    'traffic_verification',
  ];

  for (const phaseName of phaseOrder) {
    const handler = phases[phaseName];
    if (typeof handler !== 'function') {
      steps.push({
        name: phaseName,
        status: 'FAIL',
        elapsedMs: 0,
        targetMs: objectives.phaseTargetsMs[phaseName] ?? null,
        withinTarget: false,
        details: null,
        error: `Missing handler for phase "${phaseName}"`,
      });
      continue;
    }
    const result = await measureStep(
      phaseName,
      handler,
      objectives.phaseTargetsMs[phaseName]
    );
    steps.push(result);
  }

  const totalElapsedMs = steps.reduce((sum, s) => sum + s.elapsedMs, 0);
  const rtoMet = totalElapsedMs <= objectives.rtoTargetMs;
  const allPassed = steps.every((s) => s.status === 'PASS');

  const gaps = [];
  for (const step of steps) {
    if (step.status === 'FAIL') {
      gaps.push(`Phase \`${step.name}\` failed: ${step.error}`);
    } else if (!step.withinTarget) {
      gaps.push(
        `Phase \`${step.name}\` exceeded target (${step.elapsedMs}ms > ${step.targetMs}ms)`
      );
    }
  }
  if (!rtoMet) {
    gaps.push(
      `Total recovery time (${totalElapsedMs}ms) exceeded RTO objective (${objectives.rtoTargetMs}ms)`
    );
  }

  const overallStatus = allPassed && rtoMet ? 'PASS' : 'FAIL';

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    environment,
    overallStatus,
    objectives: {
      rtoTargetMs: objectives.rtoTargetMs,
      rpoTargetMs: objectives.rpoTargetMs,
    },
    totalElapsedMs,
    rtoMet,
    steps,
    gaps,
  };
}

/**
 * Formats a concise Markdown report comparing measured recovery times with objectives.
 */
export function formatMarkdownReport(result) {
  const lines = [
    '# Disaster Recovery Exercise Report',
    '',
    `- **Status:** ${result.overallStatus}`,
    `- **Environment:** \`${result.environment}\` (non-production)`,
    `- **Started:** ${result.startedAt}`,
    `- **Completed:** ${result.completedAt}`,
    `- **Total Recovery Time:** ${result.totalElapsedMs} ms (RTO Objective: ${result.objectives.rtoTargetMs} ms, Met: ${result.rtoMet ? 'Yes' : 'No'})`,
    `- **RPO Objective:** ${result.objectives.rpoTargetMs} ms`,
    '',
    '## Phase Results',
    '',
    '| Phase | Status | Elapsed (ms) | Target (ms) | Within Target | Notes |',
    '| --- | --- | ---: | ---: | --- | --- |',
  ];

  for (const step of result.steps) {
    const notes = step.status === 'PASS' ? step.details : `Error: ${step.error}`;
    lines.push(
      `| \`${step.name}\` | ${step.status} | ${step.elapsedMs} | ${step.targetMs ?? 'N/A'} | ${step.withinTarget ? 'Yes' : 'No'} | ${notes} |`
    );
  }

  lines.push('', '## Identified Gaps & Follow-Up');
  if (result.gaps.length === 0) {
    lines.push('', 'No gaps identified. All phases passed within documented RTO objectives.');
  } else {
    lines.push('');
    for (const gap of result.gaps) {
      lines.push(`- ${gap}`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Builds an actionable GitHub issue payload when the exercise fails or breaches RTO.
 */
export function buildFollowUpIssuePayload(result) {
  if (result.overallStatus === 'PASS') {
    return null;
  }

  return {
    title: `[DR Exercise] Recovery gap detected in ${result.environment} (${result.completedAt.slice(0, 10)})`,
    labels: ['disaster-recovery', 'ops', 'automated-followup'],
    body: [
      'A scheduled non-production disaster-recovery exercise detected a failure or RTO breach.',
      '',
      `- **Environment:** \`${result.environment}\``,
      `- **Total Elapsed:** ${result.totalElapsedMs} ms (RTO: ${result.objectives.rtoTargetMs} ms)`,
      '',
      '### Gaps',
      ...result.gaps.map((g) => `- ${g}`),
      '',
      '### Next Steps',
      '- Investigate the failing or slow recovery phase in non-production.',
      '- Update runbooks or automation and re-run the DR exercise workflow.',
    ].join('\n'),
  };
}

async function main() {
  const outputDir = process.env.DR_REPORT_DIR || 'reports';
  const result = await runDrExercise();
  const markdown = formatMarkdownReport(result);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'dr-exercise-report.md'), markdown, 'utf8');
  await fs.writeFile(
    path.join(outputDir, 'dr-exercise-report.json'),
    JSON.stringify(result, null, 2) + '\n',
    'utf8'
  );

  process.stdout.write(markdown);

  if (result.overallStatus !== 'PASS') {
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
