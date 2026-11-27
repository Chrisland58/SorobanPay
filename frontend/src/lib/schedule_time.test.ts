import { formatScheduleTime, getDstStatus } from './schedule_time';

describe('formatScheduleTime', () => {
  it('formats a Unix timestamp in different configured time zones with explicit zone labels', () => {
    // 2026-06-15T12:00:00Z
    const unixSeconds = Math.floor(Date.UTC(2026, 5, 15, 12, 0, 0) / 1000);

    const ny = formatScheduleTime(unixSeconds, { timeZone: 'America/New_York' });
    expect(ny).not.toBeNull();
    expect(ny!.localLabel).toContain('EDT');
    expect(ny!.localLabel).toContain('08:00 AM');
    expect(ny!.utcLabel).toBe('2026-06-15 12:00:00 UTC');
    expect(ny!.isoUtc).toBe('2026-06-15T12:00:00.000Z');
    expect(ny!.timeZone).toBe('America/New_York');

    const tokyo = formatScheduleTime(unixSeconds, { timeZone: 'Asia/Tokyo' });
    expect(tokyo).not.toBeNull();
    expect(tokyo!.localLabel).toContain('09:00 PM');
    expect(tokyo!.utcLabel).toBe('2026-06-15 12:00:00 UTC');
    expect(tokyo!.dst.observesDst).toBe(false);
  });

  it('handles US spring-forward DST boundary accurately', () => {
    // 2026-03-08 07:00:00 UTC is the exact spring-forward transition in America/New_York (02:00 -> 03:00 EDT)
    const beforeSpring = Math.floor(Date.UTC(2026, 2, 8, 6, 59, 0) / 1000);
    const afterSpring = Math.floor(Date.UTC(2026, 2, 8, 7, 0, 0) / 1000);

    const before = formatScheduleTime(beforeSpring, { timeZone: 'America/New_York' });
    const after = formatScheduleTime(afterSpring, { timeZone: 'America/New_York' });

    expect(before!.localLabel).toContain('01:59 AM');
    expect(before!.localLabel).toContain('EST');
    expect(before!.dst.observesDst).toBe(true);
    expect(before!.dst.isDstActive).toBe(false);

    expect(after!.localLabel).toContain('03:00 AM');
    expect(after!.localLabel).toContain('EDT');
    expect(after!.dst.observesDst).toBe(true);
    expect(after!.dst.isDstActive).toBe(true);
  });

  it('handles US fall-back DST boundary accurately', () => {
    // 2026-11-01 06:00:00 UTC is the fall-back transition in America/New_York (02:00 EDT -> 01:00 EST)
    const beforeFall = '2026-11-01T05:30:00.000Z';
    const afterFall = '2026-11-01T06:30:00.000Z';

    const before = formatScheduleTime(beforeFall, { timeZone: 'America/New_York' });
    const after = formatScheduleTime(afterFall, { timeZone: 'America/New_York' });

    expect(before!.localLabel).toContain('01:30 AM');
    expect(before!.localLabel).toContain('EDT');
    expect(before!.dst.isDstActive).toBe(true);

    expect(after!.localLabel).toContain('01:30 AM');
    expect(after!.localLabel).toContain('EST');
    expect(after!.dst.isDstActive).toBe(false);
  });

  it('returns null for missing, zero, negative, or invalid timestamps', () => {
    expect(formatScheduleTime(0)).toBeNull();
    expect(formatScheduleTime(-100)).toBeNull();
    expect(formatScheduleTime(Number.NaN)).toBeNull();
    expect(formatScheduleTime(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatScheduleTime('')).toBeNull();
    expect(formatScheduleTime('not-a-date')).toBeNull();
    expect(formatScheduleTime(new Date('invalid'))).toBeNull();
    expect(formatScheduleTime(null)).toBeNull();
    expect(formatScheduleTime(undefined)).toBeNull();
  });

  it('falls back gracefully when an invalid timeZone is provided', () => {
    const result = formatScheduleTime(1781524800, { timeZone: 'Invalid/Zone' });
    expect(result).not.toBeNull();
    expect(result!.utcLabel).toBe('2026-06-15 12:00:00 UTC');
  });

  it('reports DST status explanation for UTC', () => {
    const status = getDstStatus(new Date('2026-06-15T12:00:00Z'), 'UTC');
    expect(status.observesDst).toBe(false);
    expect(status.isDstActive).toBe(false);
    expect(status.explanation).toContain('does not observe daylight saving time');
  });
});
