import {
  CAFE_TIME_ZONE,
  MIN_PREP_MINUTES,
  getPickupDates,
  getPickupWindow,
} from './rules';

export type ResolvedPickupSlot = {
  date: string;
  time: string;
  iso: string;
};

const istSlotFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAFE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Builds an explicit Asia/Kolkata ISO string for a YYYY-MM-DD date and HH:MM time. */
export function buildPickupSlotIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const parsed = new Date(`${date}T${time}:00+05:30`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Parses an optional ?pickup= ISO timestamp and returns the matching date and time
 * only when it matches an available slot from the order rules. Invalid or stale values
 * are ignored and return null.
 */
export function resolveOrderPickupParam(
  search: string,
  now: Date,
  estimatedPrep: number = MIN_PREP_MINUTES,
): ResolvedPickupSlot | null {
  const raw = new URLSearchParams(search).get('pickup')?.trim() ?? '';
  if (!raw || raw.length > 64) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      raw,
    )
  ) {
    return null;
  }

  const target = new Date(raw);
  if (Number.isNaN(target.getTime())) return null;

  const parts = istSlotFormatter.formatToParts(target);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const date = `${pick('year')}-${pick('month')}-${pick('day')}`;
  const time = `${pick('hour')}:${pick('minute')}`;
  const second = Number(pick('second'));

  if (second !== 0 || target.getMilliseconds() !== 0) return null;

  const availableDates = getPickupDates(now, estimatedPrep);
  if (!availableDates.some((entry) => entry.date === date && entry.available)) {
    return null;
  }

  const windowOptions = getPickupWindow(date, now, estimatedPrep);
  const matched = windowOptions.find(
    (option) => option.time === time && option.available,
  );
  if (!matched) return null;

  const canonical = new Date(`${date}T${time}:00+05:30`);
  if (canonical.getTime() !== target.getTime()) return null;

  return { date, time, iso: canonical.toISOString() };
}
