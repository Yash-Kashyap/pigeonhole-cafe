import { useCallback, useEffect, useState } from 'react';
import { ownerGetJson, ownerWriteJson } from '../../lib/owner-api';
import {
  formatKolkataTime,
  formatNullableCount,
  formatPercent,
  formatUsd,
  parseSummaryContent,
  type DailySummaryParsed,
  type InsightsRange,
  type OwnerInsightsData,
  type OwnerInsightsResponse,
  type OwnerSummaryResponse,
  type OwnerSummaryRow,
} from '../../lib/owner-ai-helpers';
import {
  BookingsByPartySizeChart,
  OrdersByHourChart,
  OrdersPerDayChart,
  TopItemsChart,
} from './OwnerCharts';
import { useOwnerRealtime, type RealtimeTable } from './useOwnerRealtime';

const INSIGHTS_TABLES: readonly RealtimeTable[] = [
  'orders',
  'bookings',
  'assistant_logs' as RealtimeTable,
];

const RANGES: readonly { key: InsightsRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];

type Props = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export default function OwnerInsights({ supabaseUrl, supabaseAnonKey }: Props) {
  const [range, setRange] = useState<InsightsRange>('7d');
  const [insights, setInsights] = useState<OwnerInsightsData | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // Daily summary state
  const [summaryRow, setSummaryRow] = useState<OwnerSummaryRow | null>(null);
  const [parsedSummary, setParsedSummary] = useState<DailySummaryParsed | null>(
    null,
  );
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Fetch Insights
  const fetchInsights = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoadingInsights(true);
      const res = await ownerGetJson<OwnerInsightsResponse>(
        `/api/owner/insights?range=${range}`,
      );
      if (!res.ok) {
        if (res.status !== 0) setInsightsError(res.message);
        setLoadingInsights(false);
        return;
      }
      setInsightsError(null);
      setInsights(res.data.insights);
      setLoadingInsights(false);
    },
    [range],
  );

  // Fetch Summary
  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    setSummaryError(null);
    const res = await ownerGetJson<OwnerSummaryResponse>('/api/owner/summary');
    if (!res.ok) {
      if (res.status !== 0) setSummaryError(res.message);
      setLoadingSummary(false);
      return;
    }
    setSummaryRow(res.data.summary);
    if (res.data.summary) {
      setParsedSummary(parseSummaryContent(res.data.summary.content));
    } else {
      setParsedSummary(null);
    }
    setLoadingSummary(false);
  }, []);

  useEffect(() => {
    void fetchInsights();
  }, [fetchInsights]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  // Realtime updates
  useOwnerRealtime({
    supabaseUrl,
    supabaseAnonKey,
    tables: INSIGHTS_TABLES,
    onTableChange: () => {
      void fetchInsights({ silent: true });
    },
    onReconnect: () => {
      void fetchInsights({ silent: true });
    },
    onFallbackPoll: () => {
      void fetchInsights({ silent: true });
    },
  });

  // Generate / Regenerate Summary
  const handleGenerateSummary = async (regenerate = false) => {
    if (summaryGenerating) return;
    setSummaryGenerating(true);
    setSummaryError(null);

    const body = regenerate ? { regenerate: true } : {};
    const res = await ownerWriteJson<OwnerSummaryRow>(
      '/api/owner/summary',
      'POST',
      body,
    );
    setSummaryGenerating(false);

    if (!res.ok) {
      setSummaryError(res.message);
      return;
    }

    setSummaryRow(res.data);
    setParsedSummary(parseSummaryContent(res.data.content));
  };

  return (
    <div className="space-y-8">
      {/* Header & Range Selector */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/20 pb-4">
        <div>
          <p className="ph-label text-brass-text">Metrics & AI Summary</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">Insights</h1>
        </div>

        {/* Range Segmented Control */}
        <div
          role="radiogroup"
          aria-label="Insights time range"
          className="inline-flex border border-ink bg-card"
        >
          {RANGES.map((r) => {
            const isSelected = range === r.key;
            return (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setRange(r.key)}
                className={`min-h-11 px-4 text-xs font-semibold uppercase tracking-wider transition-colors first:border-0 border-l border-ink ${
                  isSelected ? 'bg-ink text-paper' : 'text-ink hover:bg-paper-2'
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 1: Stat Tiles */}
      <section aria-label="Core metrics summary">
        {insightsError && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-err bg-card p-4 text-sm text-err"
          >
            <p>{insightsError}</p>
            <button
              type="button"
              onClick={() => void fetchInsights()}
              className="min-h-11 border border-err bg-card px-3.5 font-semibold text-err hover:bg-paper-2"
            >
              Try again
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="border border-ink bg-card p-4 shadow-ledger">
            <p className="ph-label text-brass-text">Orders</p>
            <p className="mt-2 font-display text-3xl sm:text-4xl">
              {loadingInsights && !insights ? '—' : (insights?.orderCount ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ink-2">
              Cancelled orders not counted
            </p>
          </div>

          <div className="border border-ink bg-card p-4 shadow-ledger">
            <p className="ph-label text-brass-text">Revenue</p>
            <p className="mt-2 font-display text-3xl sm:text-4xl">
              {loadingInsights && !insights
                ? '—'
                : formatUsd(insights?.orderTotal ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ink-2">Total gross order value</p>
          </div>

          <div className="border border-ink bg-card p-4 shadow-ledger">
            <p className="ph-label text-brass-text">Bookings</p>
            <p className="mt-2 font-display text-3xl sm:text-4xl">
              {loadingInsights && !insights
                ? '—'
                : (insights?.bookingCount ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ink-2">
              Declined and cancelled not counted
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 2: AI Daily Summary Card */}
      <section
        aria-labelledby="daily-summary-heading"
        className="border border-ink bg-card p-5 shadow-ledger sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink/20 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="daily-summary-heading" className="font-display text-2xl">
                Daily summary
              </h2>
              <span className="border border-ink/30 bg-paper px-2 py-0.5 font-mono text-[11px] text-brass-text">
                Written by AI from today's numbers
              </span>
            </div>
            {summaryRow && (
              <p className="mt-1 font-mono text-xs text-ink-2">
                Written {formatKolkataTime(summaryRow.created_at)}
              </p>
            )}
          </div>

          {/* Action button: Generate or Regenerate */}
          {!loadingSummary && summaryRow && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-2">Up to 3 a day</span>
              <button
                type="button"
                disabled={summaryGenerating}
                onClick={() => void handleGenerateSummary(true)}
                className="min-h-11 border border-ink bg-ink px-4 py-1.5 text-xs font-semibold text-paper hover:bg-ink-2 disabled:opacity-50"
              >
                {summaryGenerating ? 'Generating...' : 'Regenerate'}
              </button>
            </div>
          )}
        </div>

        {summaryError && (
          <div
            role="alert"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-err bg-err/10 p-3 text-xs text-err"
          >
            <p>{summaryError}</p>
            <button
              type="button"
              onClick={() => void handleGenerateSummary(Boolean(summaryRow))}
              className="min-h-11 border border-err bg-card px-3 font-semibold text-err hover:bg-paper-2"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Summary state */}
        {loadingSummary && (
          <div className="p-6 text-center text-sm text-ink-2">
            Loading summary...
          </div>
        )}

        {/* In-flight Generating state */}
        {summaryGenerating && (
          <div className="mt-4 border border-ink/20 bg-paper p-6 text-center text-xs text-ink">
            <span
              className="inline-block size-2 animate-ping rounded-full bg-brass mr-2"
              aria-hidden="true"
            />
            <span className="font-mono">
              Consulting today's ledger... takes about 4 seconds
            </span>
          </div>
        )}

        {/* No Summary State -> Generate Button */}
        {!loadingSummary && !summaryGenerating && !summaryRow && (
          <div className="mt-4 space-y-3 py-4 text-center">
            <p className="text-xs text-ink-2">
              No AI summary generated for today yet.
            </p>
            <button
              type="button"
              onClick={() => void handleGenerateSummary(false)}
              className="min-h-11 border border-ink bg-ink px-5 py-2 text-xs font-semibold text-paper transition hover:bg-ink-2"
            >
              Generate daily summary
            </button>
          </div>
        )}

        {/* Render Summary Content strictly as Plain Text */}
        {!loadingSummary && !summaryGenerating && parsedSummary && (
          <div className="mt-4 space-y-4" data-testid="daily-summary-content">
            <div>
              <p className="ph-label text-brass-text">Key Observations</p>
              <ul className="mt-2 space-y-1.5 pl-4 text-xs leading-relaxed text-ink">
                {parsedSummary.bullets.map((bullet, idx) => (
                  <li key={idx} className="list-disc">
                    {bullet}
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-ink/10 pt-3">
              <p className="ph-label text-brass-text">Team Suggestion</p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-ink">
                {parsedSummary.suggestion}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* SECTION 3: Charts Grid */}
      <section
        aria-label="Visual trend charts"
        className="grid gap-6 lg:grid-cols-2"
      >
        {/* Chart 1: Orders per day */}
        <div className="min-w-0 border border-ink bg-card p-4 shadow-ledger sm:p-5">
          <h2 className="font-display text-xl">Orders per day</h2>
          <p className="mt-1 text-xs text-ink-2">
            Daily order volume across the selected period.
          </p>
          <div className="mt-4">
            <OrdersPerDayChart
              data={insights?.ordersPerDay ?? []}
              range={range}
            />
          </div>
        </div>

        {/* Chart 2: Top 10 items */}
        <div className="min-w-0 border border-ink bg-card p-4 shadow-ledger sm:p-5">
          <h2 className="font-display text-xl">Top 10 items</h2>
          <p className="mt-1 text-xs text-ink-2">
            Most frequently ordered items by quantity.
          </p>
          <div className="mt-4">
            <TopItemsChart data={insights?.topItems ?? []} />
          </div>
        </div>

        {/* Chart 3: Orders by hour */}
        <div className="min-w-0 border border-ink bg-card p-4 shadow-ledger sm:p-5">
          <h2 className="font-display text-xl">Orders by hour</h2>
          <p className="mt-1 text-xs text-ink-2">
            Order placement distribution across 24 hours (Asia/Kolkata).
          </p>
          <div className="mt-4">
            <OrdersByHourChart data={insights?.ordersPerHour ?? []} />
          </div>
        </div>

        {/* Chart 4: Bookings by party size */}
        <div className="min-w-0 border border-ink bg-card p-4 shadow-ledger sm:p-5">
          <h2 className="font-display text-xl">Bookings by party size</h2>
          <p className="mt-1 text-xs text-ink-2">
            Number of table bookings by guest count.
          </p>
          <div className="mt-4">
            <BookingsByPartySizeChart
              data={insights?.bookingsByPartySize ?? []}
            />
          </div>
        </div>
      </section>

      {/* SECTION 4: Assistant Performance Card */}
      <section
        aria-labelledby="assistant-metrics-heading"
        className="border border-ink bg-card p-5 shadow-ledger sm:p-6"
      >
        <h2 id="assistant-metrics-heading" className="font-display text-2xl">
          Assistant performance
        </h2>
        <p className="mt-1 text-xs text-ink-2">
          Activity and conversion rates from the public AI assistant widget.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="min-w-0 border border-ink/20 bg-paper p-3 text-xs">
            <p className="ph-label text-ink-2 truncate">Conversations</p>
            <p className="mt-1 font-mono text-sm sm:text-xl font-semibold text-ink">
              {loadingInsights && !insights
                ? '—'
                : formatNullableCount(
                    insights?.assistant.conversations ?? null,
                  )}
            </p>
          </div>

          <div className="min-w-0 border border-ink/20 bg-paper p-3 text-xs">
            <p className="ph-label text-ink-2 truncate">Answered rate</p>
            <p className="mt-1 font-mono text-sm sm:text-xl font-semibold text-ink">
              {loadingInsights && !insights
                ? '—'
                : formatPercent(insights?.assistant.answeredRate ?? null)}
            </p>
          </div>

          <div className="min-w-0 border border-ink/20 bg-paper p-3 text-xs">
            <p className="ph-label text-ink-2 truncate">Cart additions</p>
            <p className="mt-1 font-mono text-sm sm:text-xl font-semibold text-ink">
              {loadingInsights && !insights
                ? '—'
                : formatNullableCount(insights?.assistant.cartActions ?? null)}
            </p>
          </div>

          <div className="min-w-0 border border-ink/20 bg-paper p-3 text-xs">
            <p className="ph-label text-ink-2 truncate">Booking proposals</p>
            <p className="mt-1 font-mono text-sm sm:text-xl font-semibold text-ink">
              {loadingInsights && !insights
                ? '—'
                : formatNullableCount(
                    insights?.assistant.bookingActions ?? null,
                  )}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
