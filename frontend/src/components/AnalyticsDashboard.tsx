/**
 * #735 — Analytics Dashboard component.
 *
 * Displays real analytics data from the /api/v1/analytics/dashboard endpoint.
 * Shows total events, unique users, page views, top pages, top events,
 * and a daily trend summary.
 *
 * Usage:
 *   <AnalyticsDashboard />
 */

'use client';

import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types (matching the backend DashboardStats shape)
// ---------------------------------------------------------------------------

interface DashboardStats {
  totalEvents: number;
  uniqueUsers: number;
  pageViews: number;
  topPages: Array<{ page: string; views: number }>;
  topEvents: Array<{ eventName: string; count: number }>;
  dailyTrend: Array<{ date: string; count: number }>;
  consentRate: number;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
      <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value.toLocaleString()}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function TopList({ title, items, valueKey, labelKey }: {
  title: string;
  items: Array<Record<string, unknown>>;
  labelKey: string;
  valueKey: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">{title}</p>
        <p className="text-gray-500 text-sm">No data available</p>
      </div>
    );
  }

  const max = Math.max(...items.map(i => Number(i[valueKey]) || 0));

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
      <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">{title}</p>
      <ul className="space-y-2">
        {items.map((item, idx) => {
          const label = String(item[labelKey] ?? '—');
          const val   = Number(item[valueKey] ?? 0);
          const pct   = max > 0 ? (val / max) * 100 : 0;
          return (
            <li key={idx} className="flex items-center gap-3">
              <span className="text-xs text-gray-300 w-36 truncate shrink-0" title={label}>{label}</span>
              <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-gray-400 w-10 text-right">{val.toLocaleString()}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DailyTrend({ data }: { data: Array<{ date: string; count: number }> }) {
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
        <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">Daily trend (last 30 days)</p>
        <p className="text-gray-500 text-sm">No data available</p>
      </div>
    );
  }

  const max = Math.max(...data.map(d => d.count), 1);

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
      <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-4">Daily trend</p>
      <div className="flex items-end gap-1 h-20">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 bg-blue-600/70 rounded-t hover:bg-blue-500 transition-colors"
            style={{ height: `${(d.count / max) * 100}%` }}
            title={`${d.date}: ${d.count} events`}
            aria-label={`${d.date}: ${d.count} events`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1 text-xs text-gray-500">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

interface AnalyticsDashboardProps {
  apiBase?: string;
  days?: number;
}

export default function AnalyticsDashboard({
  apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
  days = 30,
}: AnalyticsDashboardProps) {
  const [stats, setStats]     = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    const endDate   = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 3600_000);

    const params = new URLSearchParams({
      startDate: startDate.toISOString(),
      endDate:   endDate.toISOString(),
    });

    fetch(`${apiBase}/api/v1/analytics/dashboard?${params}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DashboardStats>;
      })
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [apiBase, days]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-gray-800/60" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-gray-800/60" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-800 bg-red-900/20 p-6 text-red-300 text-sm">
        <p className="font-semibold mb-1">Failed to load analytics</p>
        <p className="text-red-400 text-xs">{error}</p>
        <p className="text-red-500 text-xs mt-2">Ensure the backend is running and the API_BASE_URL is configured.</p>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <section aria-label="Analytics dashboard" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-white font-bold text-lg">Analytics</h2>
        <span className="text-xs text-gray-500 bg-gray-800 rounded-full px-3 py-1">
          Last {days} days
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total events"  value={stats.totalEvents}  sub="all tracked interactions" />
        <StatCard label="Unique users"  value={stats.uniqueUsers}  sub="identified user accounts" />
        <StatCard label="Page views"    value={stats.pageViews}    sub="navigation events" />
        <StatCard label="Consent rate"  value={`${stats.consentRate}%`} sub="users with analytics enabled" />
      </div>

      {/* Lists + trend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TopList
          title="Top pages"
          items={stats.topPages as unknown as Array<Record<string, unknown>>}
          labelKey="page"
          valueKey="views"
        />
        <TopList
          title="Top events"
          items={stats.topEvents as unknown as Array<Record<string, unknown>>}
          labelKey="eventName"
          valueKey="count"
        />
      </div>

      <DailyTrend data={stats.dailyTrend} />
    </section>
  );
}
