import {
  BOOKING_HORIZON_DAYS,
  CAFE_TIME_ZONE,
  getBookableDates,
  getBookableTimes,
  getSundayPlan,
  hasLargePartyNotice,
} from './rules';
import {
  formatClockTime24,
  formatReserveDate,
  isValidIndianPhoneInput,
} from './reserve';

export const OPEN_MIC_PERFORMANCE_TYPES = [
  'Music',
  'Poetry',
  'Story',
  'Comedy',
  'Other',
] as const;

export type OpenMicPerformanceType =
  (typeof OPEN_MIC_PERFORMANCE_TYPES)[number];

export const PRIVATE_TABLE_OCCASIONS = [
  'Birthday',
  'Small party',
  'Study group',
  'Work meet-up',
  'Other',
] as const;

export type PrivateTableOccasion = (typeof PRIVATE_TABLE_OCCASIONS)[number];

export const PRIVATE_PARTY_SIZES = [7, 8, 9, 10, 11, 12] as const;

export type EnquirySubmitOutcome =
  { ok: true; reference: string } | { ok: false; message: string };

export type PrivateDateOption = {
  date: string;
  label: string;
  disabled: boolean;
  reason?: string;
};

const istIsoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAFE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

const istMonthLongFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAFE_TIME_ZONE,
  month: 'long',
});

const istShortDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAFE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const istWeekdayDayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAFE_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

export function formatDateIsoKolkata(date: Date): string {
  const parts = istIsoFormatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function formatOpenMicBlock(date: Date): {
  iso: string;
  dayNumber: string;
  monthYear: string;
  shortLabel: string;
} {
  const iso = formatDateIsoKolkata(date);
  const [year = '', , day = ''] = iso.split('-');
  const dayNumber = String(Number(day));
  const monthName = istMonthLongFormatter.format(date);
  return {
    iso,
    dayNumber,
    monthYear: `${monthName} ${year}`,
    shortLabel: istShortDateFormatter.format(date),
  };
}

export function formatSundayOptionLabel(dateIso: string): string {
  const parsed = new Date(`${dateIso}T12:00:00+05:30`);
  if (Number.isNaN(parsed.getTime())) return dateIso;
  return istWeekdayDayFormatter.format(parsed);
}

export function describeSundayPlan(dateIso: string): {
  opensLabel: string;
  closesLabel: string;
  lastOrdersLabel: string;
  summary: string;
  trekSeason: boolean;
} | null {
  const plan = getSundayPlan(dateIso);
  if (!plan) return null;
  const opensLabel =
    plan.opensAt === '07:00' ? 'Opens 7:00 AM' : 'Opens 8:00 AM';
  const closesLabel = 'Closes 11:00 PM';
  const lastOrdersLabel = 'Last orders 10:30 PM';
  return {
    opensLabel,
    closesLabel,
    lastOrdersLabel,
    trekSeason: plan.trekSeason,
    summary: `${opensLabel}. ${closesLabel}. ${lastOrdersLabel}.`,
  };
}

/**
 * Builds the 31-day date list for the private-table enquiry form using rules.getBookableDates
 * and rules.getBookableTimes. Mondays and days with no remaining bookable times are disabled.
 */
export function buildPrivateTableDateOptions(now: Date): PrivateDateOption[] {
  const bookable = new Set(getBookableDates(now));
  const todayIso = formatDateIsoKolkata(now);
  const [year = 2026, month = 1, day = 1] = todayIso.split('-').map(Number);
  const startMs = Date.UTC(year, month - 1, day, 0, 0) - 330 * 60_000;

  const options: PrivateDateOption[] = [];
  for (let offset = 0; offset <= BOOKING_HORIZON_DAYS; offset += 1) {
    const current = new Date(startMs + offset * 86_400_000);
    const iso = formatDateIsoKolkata(current);
    const weekday = istIsoFormatter
      .formatToParts(current)
      .find((part) => part.type === 'weekday')?.value;
    const isMonday = weekday === 'Mon';
    const baseLabel = formatReserveDate(iso);

    if (isMonday) {
      options.push({
        date: iso,
        label: `${baseLabel} — Closed (Monday)`,
        disabled: true,
        reason: 'The café is closed on Mondays.',
      });
      continue;
    }

    const times = bookable.has(iso) ? getBookableTimes(iso, now) : [];
    if (times.length === 0) {
      options.push({
        date: iso,
        label: `${baseLabel} — No slots left`,
        disabled: true,
        reason: 'Same-day bookings close 2 hours before the last slot.',
      });
      continue;
    }

    options.push({
      date: iso,
      label: baseLabel,
      disabled: false,
    });
  }
  return options;
}

/** Returns valid HH:MM times for a private-table party size (enforcing 24h notice for 8+). */
export function getPrivateTableTimeOptions(
  date: string,
  partySize: number,
  now: Date,
): { time: string; label: string }[] {
  const times = getBookableTimes(date, now);
  const filtered =
    partySize >= 8
      ? times.filter((time) => hasLargePartyNotice(date, time, now))
      : times;
  return filtered.map((time) => ({
    time,
    label: formatClockTime24(time),
  }));
}

/**
 * Classifies the single "Phone or email" input on the Visit general contact form.
 * Returns either a valid phone or a valid email, never storing either in browser storage.
 */
export function parseGeneralContactChannel(
  input: string,
): { ok: true; phone?: string; email?: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Enter a phone number or an email address.',
    };
  }
  if (hasControlCharacters(trimmed)) {
    return {
      ok: false,
      error: 'Contact details contain invalid characters.',
    };
  }
  if (trimmed.includes('@')) {
    if (trimmed.length > 254 || !EMAIL_RE.test(trimmed)) {
      return { ok: false, error: 'Enter a valid email address.' };
    }
    return { ok: true, email: trimmed.toLowerCase() };
  }
  if (!isValidIndianPhoneInput(trimmed)) {
    return {
      ok: false,
      error:
        'Enter 10 digits, +91 followed by 10 digits, or a valid email address.',
    };
  }
  return { ok: true, phone: trimmed };
}

/** Maps POST /api/enquiries HTTP statuses to safe, fixed customer-facing copy. */
export function mapEnquiryResponse(
  status: number,
  body: unknown,
): EnquirySubmitOutcome {
  if (
    status === 201 &&
    body &&
    typeof body === 'object' &&
    typeof (body as { reference?: unknown }).reference === 'string' &&
    /^ENQ-[A-Z0-9]{8}$/.test((body as { reference: string }).reference)
  ) {
    return { ok: true, reference: (body as { reference: string }).reference };
  }

  if (status === 429) {
    return {
      ok: false,
      message: 'Too many enquiries. Please try again later.',
    };
  }

  if (status === 422) {
    return {
      ok: false,
      message: 'Choose another date or time that follows the booking rules.',
    };
  }

  if (status === 400) {
    const serverMessage =
      body &&
      typeof body === 'object' &&
      typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : '';
    if (serverMessage === 'Please wait a moment, then try again.') {
      return { ok: false, message: serverMessage };
    }
    return {
      ok: false,
      message: 'Check the details highlighted below and try again.',
    };
  }

  return {
    ok: false,
    message:
      'Enquiry service is unavailable right now. Please try again later.',
  };
}
