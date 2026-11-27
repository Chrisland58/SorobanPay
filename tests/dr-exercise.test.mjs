import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNonProduction,
  buildFollowUpIssuePayload,
  formatMarkdownReport,
  runDrExercise,
} from '../scripts/dr-exercise.mjs';

test('assertNonProduction allows non-prod environments and rejects production', () => {
  assert.equal(assertNonProduction({ ENVIRONMENT: 'non-prod-dr' }), 'non-prod-dr');

  assert.throws(
    () => assertNonProduction({ ENVIRONMENT: 'production' }),
    /Refusing to run DR exercise/
  );
  assert.throws(
    () => assertNonProduction({ NODE_ENV: 'prod' }),
    /Refusing to run DR exercise/
  );
  assert.throws(
    () =>
      assertNonProduction({
        ENVIRONMENT: 'staging',
        DATABASE_URL: 'postgres://user:pass@prod-db.internal:5432/sorobanpay',
      }),
    /DATABASE_URL matching production/
  );
});

test('runDrExercise passes when all four phases succeed within RTO', async () => {
  const result = await runDrExercise({
    env: { ENVIRONMENT: 'non-prod-dr' },
    objectives: { rtoTargetMs: 10_000 },
  });

  assert.equal(result.overallStatus, 'PASS');
  assert.equal(result.rtoMet, true);
  assert.equal(result.steps.length, 4);
  assert.deepEqual(
    result.steps.map((s) => s.name),
    ['database_restoration', 'indexer_rebuild', 'service_startup', 'traffic_verification']
  );
  assert.equal(result.gaps.length, 0);
  assert.equal(buildFollowUpIssuePayload(result), null);

  const md = formatMarkdownReport(result);
  assert.match(md, /Disaster Recovery Exercise Report/);
  assert.match(md, /\*\*Status:\*\* PASS/);
  assert.match(md, /RTO Objective: 10000 ms, Met: Yes/);
});

test('runDrExercise flags RTO breach when total elapsed exceeds objective', async () => {
  const result = await runDrExercise({
    env: { ENVIRONMENT: 'non-prod-dr' },
    objectives: {
      rtoTargetMs: -1,
      phaseTargetsMs: {
        database_restoration: 1000,
        indexer_rebuild: 1000,
        service_startup: 1000,
        traffic_verification: 1000,
      },
    },
  });

  assert.equal(result.rtoMet, false);
  assert.equal(result.overallStatus, 'FAIL');
  assert.ok(result.gaps.some((g) => g.includes('exceeded RTO objective')));

  const issue = buildFollowUpIssuePayload(result);
  assert.ok(issue);
  assert.match(issue.title, /\[DR Exercise\] Recovery gap detected/);
  assert.ok(issue.labels.includes('disaster-recovery'));
});

test('runDrExercise records phase failure and generates actionable follow-up', async () => {
  const result = await runDrExercise({
    env: { ENVIRONMENT: 'non-prod-dr' },
    phases: {
      indexer_rebuild: async () => {
        throw new Error('Checkpoint checksum mismatch');
      },
    },
  });

  assert.equal(result.overallStatus, 'FAIL');
  const indexerStep = result.steps.find((s) => s.name === 'indexer_rebuild');
  assert.equal(indexerStep.status, 'FAIL');
  assert.equal(indexerStep.error, 'Checkpoint checksum mismatch');
  assert.ok(result.gaps.some((g) => g.includes('indexer_rebuild') && g.includes('Checkpoint checksum mismatch')));

  const issue = buildFollowUpIssuePayload(result);
  assert.ok(issue);
  assert.match(issue.body, /Checkpoint checksum mismatch/);
});
