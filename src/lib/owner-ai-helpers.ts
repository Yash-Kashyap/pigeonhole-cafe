export type QuestionExcerptMessage = {
  role: string;
  content: string;
  time: string;
};

export type OwnerQuestionItem = {
  id: string;
  time: string;
  unanswered_topic: string | null;
  question: string;
  excerpt: QuestionExcerptMessage[];
  handled: boolean;
};

export type OwnerQuestionsResponse = {
  questions: OwnerQuestionItem[];
  page: number;
  pageSize: number;
  total: number;
};

export type OwnerOverrideItem = {
  id: string;
  question: string;
  answer: string;
  created_at: string;
};

export type OwnerOverridesResponse = {
  overrides: OwnerOverrideItem[];
  limit: number;
};

export type InsightsRange = 'today' | '7d' | '30d';

export type HourCount = { hour: number; count: number };
export type DayCount = { day: string; count: number };
export type TopItemCount = { id: string; name: string; quantity: number };
export type PartySizeCount = { partySize: number; count: number };

export type OwnerInsightsData = {
  range: InsightsRange;
  start: string;
  end: string;
  orderCount: number;
  orderTotal: number;
  bookingCount: number;
  ordersPerDay: DayCount[];
  topItems: TopItemCount[];
  ordersPerHour: HourCount[];
  bookingsByPartySize: PartySizeCount[];
  assistant: {
    conversations: number | null;
    answeredRate: number | null;
    cartActions: number | null;
    bookingActions: number | null;
  };
};

export type OwnerInsightsResponse = {
  insights: OwnerInsightsData;
};

export type DailySummaryParsed = {
  bullets: string[];
  suggestion: string;
};

export type OwnerSummaryRow = {
  day: string;
  content: string;
  created_at: string;
};

export type OwnerSummaryResponse = {
  summary: OwnerSummaryRow | null;
};

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(rate: number | null): string {
  if (rate === null || typeof rate !== 'number' || Number.isNaN(rate)) {
    return 'Not tracked yet';
  }
  const pct = Math.round(rate * 100);
  return `${pct}%`;
}

export function formatNullableCount(count: number | null): string {
  if (count === null || typeof count !== 'number' || Number.isNaN(count)) {
    return 'Not tracked yet';
  }
  return String(count);
}

export function zeroFill24Hours(sparseHours: HourCount[]): HourCount[] {
  const map = new Map<number, number>();
  for (const item of sparseHours) {
    map.set(item.hour, item.count);
  }
  const filled: HourCount[] = [];
  for (let h = 0; h < 24; h += 1) {
    filled.push({ hour: h, count: map.get(h) ?? 0 });
  }
  return filled;
}

export function formatHourLabel(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}

export function thinDayLabels(
  days: { day: string; count: number }[],
  range: InsightsRange,
): { day: string; count: number; showLabel: boolean }[] {
  if (range !== '30d') {
    return days.map((d) => ({ ...d, showLabel: true }));
  }
  const total = days.length;
  return days.map((d, index) => {
    // Show first, last, and every 5th label
    const show = index === 0 || index === total - 1 || index % 5 === 0;
    return { ...d, showLabel: show };
  });
}

export function parseSummaryContent(
  rawContent: string,
): DailySummaryParsed | null {
  try {
    const parsed: unknown = JSON.parse(rawContent);
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as Record<string, unknown>;
    if (!Array.isArray(rec.bullets) || typeof rec.suggestion !== 'string') {
      return null;
    }
    const bullets = rec.bullets.filter(
      (b): b is string => typeof b === 'string',
    );
    if (bullets.length !== 5) return null;
    return {
      bullets,
      suggestion: rec.suggestion.trim(),
    };
  } catch {
    return null;
  }
}

export function formatKolkataTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatRelativeTime(
  isoString: string,
  now = new Date(),
): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
