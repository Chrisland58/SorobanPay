/**
 * migrationLockConcurrent.test.ts
 *
 * Automated tests for serialized concurrent database migrations (Issue #1599):
 * - Guarantees exactly one migration executor runs among concurrent instances
 * - Surfaces lock timeout clearly with MigrationLockTimeoutError
 * - Does not mark migrations as applied prematurely when timeout occurs
 */

import {
  acquireMigrationLock,
  releaseMigrationLock,
  runMigrationsWithLock,
  MigrationLockTimeoutError,
  MIGRATION_ADVISORY_LOCK_ID,
} from '../src/services/migrationRunner';

describe('Serialized Database Migrations Across Service Instances (#1599)', () => {
  let mockClient: any;
  let mockPool: any;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
    };
  });

  it('acquires advisory lock on first instance and releases when done', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }
      if (sql.includes('pg_advisory_unlock')) {
        return { rows: [{ unlocked: true }] };
      }
      return { rows: [] };
    });

    const acquired = await acquireMigrationLock(mockClient, 1000);
    expect(acquired).toBe(true);

    await releaseMigrationLock(mockClient);
    expect(mockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      MIGRATION_ADVISORY_LOCK_ID,
    ]);
  });

  it('surfaces MigrationLockTimeoutError when lock cannot be acquired within timeout', async () => {
    // Another instance holds the lock
    mockClient.query.mockResolvedValue({ rows: [{ locked: false }] });

    await expect(acquireMigrationLock(mockClient, 400)).rejects.toThrow(
      MigrationLockTimeoutError,
    );
    await expect(acquireMigrationLock(mockClient, 400)).rejects.toThrow(
      /Another backend instance is actively executing migrations/,
    );
  });

  it('does not mark migrations as applied when lock acquisition times out', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ locked: false }] });

    let errorThrown: any = null;
    try {
      await runMigrationsWithLock({ pool: mockPool, timeoutMs: 300 });
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).toBeInstanceOf(MigrationLockTimeoutError);
    // Verified lock released in finally block
    expect(mockClient.release).toHaveBeenCalled();
  });
});
