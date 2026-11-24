#!/usr/bin/env node
/**
 * load-test-batch-execute.mjs — Issue #1426
 *
 * Load test: batch_execute_payment with 50 subscribers.
 *
 * Purpose
 * -------
 * Verify that a full batch of 50 subscribers stays within Soroban CPU
 * instruction limits and document the performance baseline for CI regression
 * tracking (docs/performance-baseline.json).
 *
 * What this script does
 * ---------------------
 * 1. Generates 50 ephemeral test-subscriber keypairs (no on-chain setup required
 *    for the simulation path; the script targets `--simulate-only`).
 * 2. Constructs a `batch_execute_payment` call with all 50 subscriber addresses.
 * 3. Simulates the transaction via the Soroban RPC `simulateTransaction` endpoint.
 * 4. Records: CPU instructions, read bytes, write bytes, min resource fee, and
 *    estimated fee per subscriber.
 * 5. Checks the result against the Soroban hard limits (100M instructions,
 *    512KB read bytes, 65KB write bytes).
 * 6. Writes the results to docs/performance-baseline.json.
 *
 * Usage
 * -----
 *   # Run the simulation-only load test (no actual on-chain txs, no XLM needed)
 *   node scripts/load-test-batch-execute.mjs
 *
 *   # Run against a different network / contract
 *   CONTRACT_ID=C... RPC_URL=https://... node scripts/load-test-batch-execute.mjs
 *
 *   # Run against testnet with real transactions (requires funded merchant key)
 *   SIMULATE_ONLY=false MERCHANT_SECRET=S... node scripts/load-test-batch-execute.mjs
 *
 * Environment variables
 * ---------------------
 *   CONTRACT_ID      Deployed contract address (C…). Required for live run;
 *                    defaults to the placeholder below for simulation.
 *   RPC_URL          Soroban RPC endpoint. Default: Stellar testnet.
 *   NETWORK_PASSPHRASE  Stellar network passphrase. Default: testnet.
 *   SIMULATE_ONLY    'true' (default) — use simulateTransaction only.
 *                    'false' — sign and submit (requires MERCHANT_SECRET).
 *   MERCHANT_SECRET  Stellar secret key (S…) for the merchant account.
 *                    Only needed when SIMULATE_ONLY=false.
 *   BATCH_SIZE       Number of subscribers to include (1-50). Default: 50.
 *   BASELINE_FILE    Path to the baseline JSON to update. Default: docs/performance-baseline.json.
 *
 * Dependencies
 * ------------
 * Uses only @stellar/stellar-sdk (already in the project's package.json).
 * Run from the repository root:
 *
 *   cd /path/to/SorobanPay
 *   node scripts/load-test-batch-execute.mjs
 *
 * Soroban hard limits (as of Stellar Protocol 21)
 * ------------------------------------------------
 *   CPU instructions : 100,000,000 (100M)
 *   Read bytes       : 524,288     (512 KB)
 *   Write bytes      : 65,536      (64 KB)
 *   Transaction size : 71,680 bytes
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// ─── Config ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const CONTRACT_ID =
  process.env.CONTRACT_ID ??
  'CPLACEHOLDERCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const RPC_URL =
  process.env.RPC_URL ?? 'https://soroban-testnet.stellar.org';

const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

const SIMULATE_ONLY = (process.env.SIMULATE_ONLY ?? 'true') === 'true';

const BATCH_SIZE = Math.min(
  50,
  Math.max(1, parseInt(process.env.BATCH_SIZE ?? '50', 10))
);

const BASELINE_FILE = resolve(
  REPO_ROOT,
  process.env.BASELINE_FILE ?? 'docs/performance-baseline.json'
);

// Soroban Protocol-21 hard limits
const SOROBAN_LIMITS = {
  instructions: 100_000_000,
  readBytes: 524_288,
  writeBytes: 65_536,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(...args) {
  console.log('[load-test]', ...args);
}

function logError(...args) {
  console.error('[load-test][error]', ...args);
}

/**
 * Format a number with thousands separators.
 */
function fmt(n) {
  return Number(n).toLocaleString('en-US');
}

/**
 * Compute utilisation percentage against a hard limit.
 */
function utilPct(used, limit) {
  return ((used / limit) * 100).toFixed(2);
}

// ─── SDK import ───────────────────────────────────────────────────────────────

async function importSDK() {
  try {
    const sdk = await import('@stellar/stellar-sdk');
    return sdk;
  } catch {
    logError(
      'Could not import @stellar/stellar-sdk. ' +
      'Run `npm install` in the frontend/ directory first, or from the project root.'
    );
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`=== batch_execute_payment load test ===`);
  log(`Batch size      : ${BATCH_SIZE}`);
  log(`Contract ID     : ${CONTRACT_ID}`);
  log(`RPC URL         : ${RPC_URL}`);
  log(`Network         : ${NETWORK_PASSPHRASE}`);
  log(`Simulate only   : ${SIMULATE_ONLY}`);
  log('');

  const sdk = await importSDK();
  const {
    Keypair,
    Networks,
    TransactionBuilder,
    BASE_FEE,
    SorobanRpc,
    xdr,
    Contract,
    nativeToScVal,
    Address,
    Operation,
  } = sdk;

  // ── Generate 50 ephemeral subscriber keypairs ──────────────────────────────
  log(`Generating ${BATCH_SIZE} ephemeral subscriber keypairs…`);
  const subscribers = Array.from({ length: BATCH_SIZE }, (_, i) => {
    const kp = Keypair.random();
    return kp;
  });
  const subscriberAddresses = subscribers.map((kp) => kp.publicKey());
  log(`Generated ${subscriberAddresses.length} addresses.`);

  // ── Use a random merchant keypair (simulation only) ────────────────────────
  const merchantKp = SIMULATE_ONLY
    ? Keypair.random()
    : Keypair.fromSecret(process.env.MERCHANT_SECRET ?? '');

  const merchantAddress = merchantKp.publicKey();
  log(`Merchant address: ${merchantAddress}`);

  // ── Build the transaction ──────────────────────────────────────────────────
  const server = new SorobanRpc.Server(RPC_URL);
  const contract = new Contract(CONTRACT_ID);

  // Build the `batch_execute_payment` invocation arguments:
  // batch_execute_payment(merchant: Address, subscribers: Vec<Address>)
  const subscribersScVal = xdr.ScVal.scvVec(
    subscriberAddresses.map((addr) => new Address(addr).toScVal())
  );

  const operation = contract.call(
    'batch_execute_payment',
    new Address(merchantAddress).toScVal(),
    subscribersScVal
  );

  // We need a source account for the transaction builder.
  // For simulation, use the merchant keypair (account doesn't need to be funded).
  let account;
  try {
    account = await server.getAccount(merchantAddress);
    log(`Fetched merchant account (sequence: ${account.sequence}).`);
  } catch {
    // If the account doesn't exist on testnet, create a minimal AccountResponse
    // stub sufficient for simulation.
    log(`Merchant account not found on-chain — using stub for simulation.`);
    account = {
      accountId: () => merchantAddress,
      sequence: () => '0',
      incrementSequenceNumber: () => {},
    };
  }

  const fee = '10000000'; // 1 XLM max — simulation ignores the fee
  const tx = new TransactionBuilder(account, {
    fee,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  log('Transaction built. Running simulation…');

  // ── Simulate ───────────────────────────────────────────────────────────────
  const simStart = Date.now();
  let simResult;

  try {
    simResult = await server.simulateTransaction(tx);
  } catch (err) {
    logError('simulateTransaction call failed:', err.message ?? err);
    logError(
      'This may be expected if CONTRACT_ID is a placeholder ' +
      '(the contract does not exist on testnet).'
    );
    logError('Falling back to estimated projections from single-payment baseline.');

    // ── Fallback: project from single execute_payment baseline ──────────────
    const baseline = readBaseline();
    const singlePayment = baseline.entryPoints?.execute_payment;

    if (!singlePayment) {
      logError('No execute_payment baseline found. Cannot project batch cost.');
      process.exit(1);
    }

    // Linear projection (conservative upper bound — actual batch is more
    // efficient due to shared auth and ledger reads being amortised).
    const projectedInstructions =
      singlePayment.instructions * BATCH_SIZE;
    const projectedReadBytes =
      singlePayment.readBytes * BATCH_SIZE;
    const projectedWriteBytes =
      singlePayment.writeBytes * BATCH_SIZE;
    const projectedFee = singlePayment.minResourceFee * BATCH_SIZE;

    log('');
    log('=== Projected results (linear extrapolation from single-payment baseline) ===');
    log(`  Batch size                : ${BATCH_SIZE}`);
    log(`  Instructions (projected)  : ${fmt(projectedInstructions)} / ${fmt(SOROBAN_LIMITS.instructions)} (${utilPct(projectedInstructions, SOROBAN_LIMITS.instructions)}%)`);
    log(`  Read bytes   (projected)  : ${fmt(projectedReadBytes)} / ${fmt(SOROBAN_LIMITS.readBytes)} (${utilPct(projectedReadBytes, SOROBAN_LIMITS.readBytes)}%)`);
    log(`  Write bytes  (projected)  : ${fmt(projectedWriteBytes)} / ${fmt(SOROBAN_LIMITS.writeBytes)} (${utilPct(projectedWriteBytes, SOROBAN_LIMITS.writeBytes)}%)`);
    log(`  Min resource fee (proj.)  : ${fmt(projectedFee)} stroops`);
    log(`  Cost per subscriber (proj): ${fmt(Math.ceil(projectedFee / BATCH_SIZE))} stroops`);
    log('');

    const withinLimits =
      projectedInstructions <= SOROBAN_LIMITS.instructions &&
      projectedReadBytes    <= SOROBAN_LIMITS.readBytes &&
      projectedWriteBytes   <= SOROBAN_LIMITS.writeBytes;

    log(withinLimits
      ? '✅ Projected batch stays within Soroban limits (conservative linear estimate).'
      : '⚠️  Projected batch MAY exceed Soroban limits. Verify with a live simulation.'
    );

    updateBaseline({
      instructions: projectedInstructions,
      readBytes:    projectedReadBytes,
      writeBytes:   projectedWriteBytes,
      minResourceFee: projectedFee,
      batchSize:    BATCH_SIZE,
      costPerSubscriber: Math.ceil(projectedFee / BATCH_SIZE),
      method:       'linear-projection',
      withinLimits,
    });

    process.exit(withinLimits ? 0 : 1);
  }

  const elapsed = Date.now() - simStart;
  log(`Simulation completed in ${elapsed}ms.`);

  // ── Parse results ──────────────────────────────────────────────────────────
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    logError('Simulation returned an error:');
    logError(simResult.error);
    process.exit(1);
  }

  if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
    logError('Unexpected simulation result:', JSON.stringify(simResult, null, 2));
    process.exit(1);
  }

  const resources = simResult.transactionData?.resources();
  if (!resources) {
    logError('No resource data in simulation result.');
    process.exit(1);
  }

  const instructions    = resources.instructions();
  const readBytes       = resources.readBytes();
  const writeBytes      = resources.writeBytes();
  const minResourceFee  = BigInt(simResult.minResourceFee ?? 0);
  const feePerSub       = minResourceFee / BigInt(BATCH_SIZE);

  // ── Print report ──────────────────────────────────────────────────────────
  log('');
  log('=== Simulation results ===');
  log(`  Batch size          : ${BATCH_SIZE}`);
  log(`  CPU instructions    : ${fmt(instructions)} / ${fmt(SOROBAN_LIMITS.instructions)} (${utilPct(instructions, SOROBAN_LIMITS.instructions)}%)`);
  log(`  Read bytes          : ${fmt(readBytes)} / ${fmt(SOROBAN_LIMITS.readBytes)} (${utilPct(readBytes, SOROBAN_LIMITS.readBytes)}%)`);
  log(`  Write bytes         : ${fmt(writeBytes)} / ${fmt(SOROBAN_LIMITS.writeBytes)} (${utilPct(writeBytes, SOROBAN_LIMITS.writeBytes)}%)`);
  log(`  Min resource fee    : ${fmt(minResourceFee)} stroops (${(Number(minResourceFee) / 1e7).toFixed(4)} XLM)`);
  log(`  Cost per subscriber : ${fmt(feePerSub)} stroops`);
  log(`  Simulation duration : ${elapsed}ms`);

  // ── Limit checks ──────────────────────────────────────────────────────────
  const checks = [
    { name: 'CPU instructions', used: instructions, limit: SOROBAN_LIMITS.instructions },
    { name: 'Read bytes',       used: readBytes,    limit: SOROBAN_LIMITS.readBytes    },
    { name: 'Write bytes',      used: writeBytes,   limit: SOROBAN_LIMITS.writeBytes   },
  ];

  log('');
  log('=== Limit checks ===');
  let allPassed = true;
  for (const { name, used, limit } of checks) {
    const pct = utilPct(used, limit);
    const pass = used <= limit;
    if (!pass) allPassed = false;
    log(`  ${pass ? '✅' : '❌'} ${name.padEnd(20)} : ${fmt(used).padStart(12)} / ${fmt(limit).padStart(12)} (${pct}%)`);
  }

  log('');
  log(allPassed
    ? `✅ Batch of ${BATCH_SIZE} subscribers stays within all Soroban limits.`
    : `❌ One or more Soroban limits exceeded for batch of ${BATCH_SIZE}.`
  );

  // ── Update baseline ───────────────────────────────────────────────────────
  updateBaseline({
    instructions:     Number(instructions),
    readBytes:        Number(readBytes),
    writeBytes:       Number(writeBytes),
    minResourceFee:   Number(minResourceFee),
    batchSize:        BATCH_SIZE,
    costPerSubscriber: Number(feePerSub),
    simulationDurationMs: elapsed,
    method:           'simulateTransaction',
    withinLimits:     allPassed,
  });

  process.exit(allPassed ? 0 : 1);
}

// ─── Baseline helpers ─────────────────────────────────────────────────────────

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function updateBaseline(data) {
  const baseline = readBaseline();

  if (!baseline.entryPoints) baseline.entryPoints = {};

  baseline.entryPoints.batch_execute_payment = {
    _comment:
      `Load test: batch of ${data.batchSize} subscribers — Issue #1426.`,
    _comment2:
      `Method: ${data.method}. Within Soroban limits: ${data.withinLimits}.`,
    batchSize:        data.batchSize,
    instructions:     data.instructions,
    readBytes:        data.readBytes,
    writeBytes:       data.writeBytes,
    minResourceFee:   data.minResourceFee,
    costPerSubscriber: data.costPerSubscriber,
    ...(data.simulationDurationMs !== undefined
      ? { simulationDurationMs: data.simulationDurationMs }
      : {}),
    withinLimits:     data.withinLimits,
    capturedAt:       new Date().toISOString(),
  };

  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  log(`\nBaseline updated → ${BASELINE_FILE}`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  logError('Unhandled error:', err);
  process.exit(1);
});
