import React, { useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  Activity,
  MessageSquare,
  Phone,
  Video,
  Home,
  Flag,
  RefreshCw,
  TrendingUp,
  Clock,
  Scale,
  LifeBuoy,
} from 'lucide-react';
import { adminApi } from '@/src/lib/admin/adminApi';
import { cn } from '@/src/lib/utils';

interface AdminDashboardViewProps {
  onNavigate?: (section: string) => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({ onNavigate }) => {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof adminApi.getDashboard>> | null>(null);
  const [range, setRange] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof adminApi.getAnalytics>> | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoadingStats(true);
    setError(null);
    try {
      const data = await adminApi.getDashboard();
      setStats(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load dashboard metrics.');
    } finally {
      setLoadingStats(false);
    }
  };

  const loadAnalytics = async (targetRange: 'daily' | 'weekly' | 'monthly') => {
    setLoadingAnalytics(true);
    try {
      const data = await adminApi.getAnalytics(targetRange);
      setAnalytics(data);
    } catch (err: any) {
      setError((prev) => prev || err?.message || 'Failed to load analytics.');
    } finally {
      setLoadingAnalytics(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    void loadAnalytics(range);
  }, [range]);

  const kpiCards = [
    {
      label: 'Total Users',
      value: stats?.totalUsers ?? 0,
      icon: Users,
      accent: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
    },
    {
      label: 'New Users Today',
      value: stats?.newUsersToday ?? 0,
      icon: UserPlus,
      accent: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
    },
    {
      label: 'Online Now',
      value: stats?.onlineNow ?? 0,
      icon: Activity,
      accent: 'text-sky-600 dark:text-sky-400 bg-sky-500/10',
    },
    {
      label: 'Messages Today',
      value: stats?.messagesToday ?? 0,
      icon: MessageSquare,
      accent: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10',
    },
    {
      label: 'Audio Calls Today',
      value: stats?.audioCallsToday ?? 0,
      icon: Phone,
      accent: 'text-teal-600 dark:text-teal-400 bg-teal-500/10',
    },
    {
      label: 'Video Calls Today',
      value: stats?.videoCallsToday ?? 0,
      icon: Video,
      accent: 'text-violet-600 dark:text-violet-400 bg-violet-500/10',
    },
    {
      label: 'Total Families',
      value: stats?.totalFamilies ?? 0,
      icon: Home,
      accent: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
    },
    {
      label: 'Pending Reports',
      value: stats?.pendingReportsCount ?? 0,
      icon: Flag,
      accent: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
      section: 'reports',
    },
  ];

  const growthPoints = analytics?.userGrowth || [];
  const maxGrowth = Math.max(1, ...growthPoints.map((p) => p.count));

  const peakHours = analytics?.peakOnlineHours || [];
  const maxPeak = Math.max(1, ...peakHours.map((h) => h.count));

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Platform Overview
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live metrics, user growth, and activity queues across LiveConnect
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void loadDashboard();
            void loadAnalytics(range);
          }}
          disabled={loadingStats}
          className="self-start sm:self-auto px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loadingStats && 'animate-spin')} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* 8 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          const clickable = Boolean(card.section && onNavigate);
          return (
            <div
              key={card.label}
              onClick={() => card.section && onNavigate?.(card.section)}
              className={cn(
                'p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3',
                clickable && 'cursor-pointer hover:border-blue-400 dark:hover:border-blue-700 transition-colors'
              )}
            >
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                  {card.label}
                </p>
                <p className="text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                  {loadingStats && !stats ? '—' : card.value.toLocaleString()}
                </p>
              </div>
              <div className={cn('p-2 rounded-lg shrink-0', card.accent)}>
                <Icon className="w-4 h-4" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Queue Quick Links */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <button
            type="button"
            onClick={() => onNavigate?.('reports')}
            className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-700 flex items-center justify-between text-start cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Flag className="w-4 h-4 text-rose-500" />
              <span>Pending Reports Queue</span>
            </span>
            <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {stats.pendingReportsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate?.('appeals')}
            className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-700 flex items-center justify-between text-start cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Scale className="w-4 h-4 text-amber-500" />
              <span>Pending Ban Appeals</span>
            </span>
            <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {stats.pendingAppealsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate?.('tickets')}
            className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-700 flex items-center justify-between text-start cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <LifeBuoy className="w-4 h-4 text-blue-500" />
              <span>Open Support Tickets</span>
            </span>
            <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {stats.openTicketsCount}
            </span>
          </button>
        </div>
      )}

      {/* Analytics Graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* User Growth Chart */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">User Growth</h3>
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-50 dark:bg-slate-950">
              {(['daily', 'weekly', 'monthly'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize cursor-pointer transition-colors',
                    range === r
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {loadingAnalytics && growthPoints.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-xs text-slate-400">
              Loading chart...
            </div>
          ) : (
            <div className="h-44 flex items-end gap-1.5 pt-4">
              {growthPoints.map((pt, idx) => {
                const heightPct = Math.max(4, Math.round((pt.count / maxGrowth) * 100));
                return (
                  <div
                    key={`${pt.label}-${idx}`}
                    className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full min-w-0 group"
                    title={`${pt.label}: ${pt.count} new users`}
                  >
                    <span className="text-[10px] font-semibold tabular-nums text-slate-500 dark:text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      {pt.count}
                    </span>
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className="w-full rounded-t-md bg-blue-600/85 dark:bg-blue-500/85 group-hover:bg-blue-600 transition-all"
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="text-[9.5px] text-slate-400 truncate max-w-full tabular-nums">
                      {pt.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Peak Online Hours (24h) */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Peak Online Hours (24h)
              </h3>
            </div>
            <span className="text-[11px] text-slate-400">Hourly active distribution</span>
          </div>

          {loadingAnalytics && peakHours.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-xs text-slate-400">
              Loading chart...
            </div>
          ) : (
            <div className="h-44 flex items-end gap-1 pt-4">
              {peakHours.map((hr) => {
                const heightPct = Math.max(4, Math.round((hr.count / maxPeak) * 100));
                return (
                  <div
                    key={hr.hour}
                    className="flex-1 flex flex-col items-center justify-end gap-1 h-full min-w-0 group"
                    title={`${hr.label}: ${hr.count} events`}
                  >
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className="w-full rounded-t-sm bg-emerald-500/80 dark:bg-emerald-400/80 group-hover:bg-emerald-500 transition-all"
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-slate-400 tabular-nums">
                      {hr.hour % 4 === 0 ? hr.hour : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top Active Users & Top Active Families */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Most Active Users (Last 30 Days)
          </h3>
          {!analytics?.topActiveUsers?.length ? (
            <p className="text-xs text-slate-400 py-6 text-center">No recent activity recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 text-[11px]">
                    <th className="py-2 text-start font-semibold">User</th>
                    <th className="py-2 text-end font-semibold">Messages</th>
                    <th className="py-2 text-end font-semibold">Calls</th>
                    <th className="py-2 text-end font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {analytics.topActiveUsers.map((u) => (
                    <tr key={u.userId}>
                      <td className="py-2.5 pe-2">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[180px]">
                          {u.displayName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 truncate max-w-[180px]">
                          @{u.username}
                        </div>
                      </td>
                      <td className="py-2.5 text-end tabular-nums text-slate-600 dark:text-slate-300">
                        {u.messageCount}
                      </td>
                      <td className="py-2.5 text-end tabular-nums text-slate-600 dark:text-slate-300">
                        {u.callCount}
                      </td>
                      <td className="py-2.5 text-end tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {u.totalActivity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Most Active Families
          </h3>
          {!analytics?.topActiveFamilies?.length ? (
            <p className="text-xs text-slate-400 py-6 text-center">No Family activity recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 text-[11px]">
                    <th className="py-2 text-start font-semibold">Family</th>
                    <th className="py-2 text-end font-semibold">Members</th>
                    <th className="py-2 text-end font-semibold">Messages</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {analytics.topActiveFamilies.map((f) => (
                    <tr key={f.familyId}>
                      <td className="py-2.5 pe-2 font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
                        {f.name}
                      </td>
                      <td className="py-2.5 text-end tabular-nums text-slate-600 dark:text-slate-300">
                        {f.memberCount.toLocaleString()}
                      </td>
                      <td className="py-2.5 text-end tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {f.messageCount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
