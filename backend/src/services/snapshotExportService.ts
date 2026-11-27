/**
 * backend/src/services/snapshotExportService.ts
 *
 * Asynchronous, tenant-scoped export flow from a consistent database snapshot (Issue #1600).
 *
 * Captures a stable query timestamp boundary, executes background streaming,
 * exposes job status/progress, and enforces token/expiry authorization with cleanup.
 */

import { randomUUID } from 'crypto';
import { sanitizeCsvCell, toCsvRow } from '../utils/csv';

export interface ExportJob {
  jobId: string;
  merchant: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired';
  snapshotAt: Date;
  expiresAt: Date;
  progress: number; // 0 - 100
  rowCount: number;
  downloadToken: string;
  dataCsv?: string;
  error?: string;
}

const jobStore = new Map<string, ExportJob>();

// Default expiry: 24 hours
const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

export class ExportError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

/**
 * Initiate a background export job bound to a consistent database snapshot.
 */
export async function createSnapshotExportJob(
  merchant: string,
  fetchRowsFn: (snapshotAt: Date) => Promise<Array<Record<string, any>>>,
): Promise<ExportJob> {
  const jobId = randomUUID();
  const downloadToken = randomUUID();
  const snapshotAt = new Date();
  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);

  const job: ExportJob = {
    jobId,
    merchant,
    status: 'processing',
    snapshotAt,
    expiresAt,
    progress: 0,
    rowCount: 0,
    downloadToken,
  };

  jobStore.set(jobId, job);

  // Background snapshot collection
  setImmediate(async () => {
    try {
      job.progress = 25;
      const rows = await fetchRowsFn(snapshotAt);
      job.progress = 75;

      const headers = ['Date', 'Subscriber', 'Token', 'Amount', 'TxHash', 'Status'];
      const csvLines = [headers.join(',')];

      for (const r of rows) {
        csvLines.push(
          toCsvRow([
            r.date || r.createdAt?.toISOString() || snapshotAt.toISOString(),
            r.subscriber || '',
            r.token || '',
            r.amount || '',
            r.txHash || '',
            r.status || 'executed',
          ]).trim(),
        );
      }

      job.dataCsv = csvLines.join('\r\n') + '\r\n';
      job.rowCount = rows.length;
      job.progress = 100;
      job.status = 'completed';
    } catch (err: any) {
      job.status = 'failed';
      job.error = err.message || 'Snapshot export failed';
    }
  });

  return job;
}

/**
 * Get export status; ensures tenant isolation.
 */
export function getExportStatus(jobId: string, requestingMerchant: string): ExportJob {
  cleanExpiredJobs();
  const job = jobStore.get(jobId);
  if (!job) {
    throw new ExportError(404, 'Export job not found');
  }
  if (job.merchant !== requestingMerchant) {
    throw new ExportError(403, 'Unauthorized access to export job');
  }
  if (job.expiresAt.getTime() <= Date.now()) {
    job.status = 'expired';
    jobStore.delete(jobId);
    throw new ExportError(410, 'Export has expired');
  }

  return { ...job };
}

/**
 * Download completed export snapshot.
 */
export function downloadExportSnapshot(
  jobId: string,
  requestingMerchant: string,
  token: string,
): { filename: string; csv: string } {
  cleanExpiredJobs();
  const job = jobStore.get(jobId);
  if (!job) {
    throw new ExportError(404, 'Export job not found or expired');
  }
  if (job.merchant !== requestingMerchant) {
    throw new ExportError(403, 'Unauthorized access to export download');
  }
  if (job.downloadToken !== token) {
    throw new ExportError(401, 'Invalid download token');
  }
  if (job.expiresAt.getTime() <= Date.now()) {
    jobStore.delete(jobId);
    throw new ExportError(410, 'Export has expired');
  }
  if (job.status !== 'completed' || !job.dataCsv) {
    throw new ExportError(409, 'Export is not ready for download');
  }

  const dateStr = job.snapshotAt.toISOString().slice(0, 10);
  const filename = `snapshot-${requestingMerchant.slice(0, 8)}-${dateStr}.csv`;

  return {
    filename,
    csv: job.dataCsv,
  };
}

/**
 * Clean up expired exports.
 */
function cleanExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of jobStore.entries()) {
    if (job.expiresAt.getTime() <= now) {
      jobStore.delete(id);
    }
  }
}

export function _clearJobsForTesting() {
  jobStore.clear();
}
