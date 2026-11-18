import type { MenuItem } from './menu';
import {
  BOOKING_DURATION_MINUTES,
  BOOKING_HORIZON_DAYS,
  CAFE_TIME_ZONE,
  getBookableDates,
  getBookableTimes,
  getBookingStart,
} from './rules';
import { cleanWhatsAppMessage, whatsAppRedirectPath } from './whatsapp';

export const RESERVE_STORAGE_KEY = 'ph_reserve_draft_v1';
export const MAX_PREORDER_LINES = 12;
export const MAX_PREORDER_QTY = 20;
export const MIN_PARTY_SIZE = 1;
export const MAX_PARTY_SIZE = 12;
export const MAX_NOTES_LENGTH = 200;

export type ReserveStep = 1 | 2 | 3;

export const RESERVE_OCCASIONS = [
  'none',
  'birthday',
  'date',
  'work_meetup',
  'study_group',
  'trek_stop',
  'other',
] as const;

export type ReserveOccasion = (typeof RESERVE_OCCASIONS)[number];

export const OCCASION_OPTIONS: { value: ReserveOccasion; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'date', label: 'Date' },
  { value: 'work_meetup', label: 'Work meet-up' },
  { value: 'study_group', label: 'Study group' },
  { value: 'trek_stop', label: 'Trek stop' },
  { value: 'other', label: 'Other' },
];

export type PreorderLineInput = {
  id: string;
  qty: number;
};

export type AvailabilitySlot = {
  time: string;
  remaining: number | null;
  requestable: boolean;
};

export type ReserveDraft = {
  step: ReserveStep;
  date: string;
  time: string;
  partySize: number;
  name: string;
  phone: string;
  email: string;
  occasion: ReserveOccasion;
  notes: string;
  preorder: PreorderLineInput[];
};

export type ReserveHashState = Pick<
  ReserveDraft,
  'step' | 'date' | 'time' | 'partySize'
>;

export type CalendarDay = {
  date: string;
  dayNumber: number;
  monthShort: string;
  monthLabel: string;
  weekday: number;
  bookable: boolean;
  isToday: boolean;
  isMonday: boolean;
  isPast: boolean;
  isAfterHorizon: boolean;
  disabledReason: string | null;
};

export type BookingPreorderSnapshot = {
  lines: {
    id: string;
    name: string;
    price: number;
    qty: number;
    lineTotal: number;
  }[];
  total: number;
};

export type BookingConfirmationData = {
  code: string;
  status: string;
  slotLabels: string[];
  date: string;
  time: string;
  party: number;
  holdUntil: string;
  preorder: BookingPreorderSnapshot;
};

export type PreorderDisplayLine = {
  id: string;
  name: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  available: boolean;
};

export type PreorderSummary = {
  lines: PreorderDisplayLine[];
  itemCount: number;
  total: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const MENU_ID_RE = /^PH\d{4}$/;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0) - 330 * 60_000);
}

// One reused formatter: building an Intl.DateTimeFormat on every call is very slow
// and the calendar calls this in loops.
const istPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAFE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

function istParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const parts = istPartsFormatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour: Number(pick('hour')),
    minute: Number(pick('minute')),
    weekday: WEEKDAY_INDEX[pick('weekday')] ?? 0,
  };
}

function parseIsoDate(
  isoDate: string,
): { year: number; month: number; day: number } | null {
  if (!DATE_RE.test(isoDate)) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return null;
  const d = istMidnight(year, month, day);
  const p = istParts(d);
  if (p.year !== year || p.month !== month || p.day !== day) return null;
  return { year, month, day };
}

function formatIsoFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getIstTodayIso(now: Date): string {
  const p = istParts(now);
  return formatIsoFromParts(p.year, p.month, p.day);
}

/** Formats 24-hour HH:MM into 12-hour display without timezone conversion. */
export function formatClockTime24(hhmm: string): string {
  if (!TIME_RE.test(hhmm)) return hhmm;
  const [hour = 0, minute = 0] = hhmm.split(':').map(Number);
  if (hour > 23 || minute > 59) return hhmm;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** Formats an ISO timestamp in Asia/Kolkata clock time (e.g. "7:45 PM"). */
export function formatIsoClockTimeIst(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const p = istParts(date);
  return formatClockTime24(
    `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
  );
}

/** Formats YYYY-MM-DD as "Saturday 14 Nov" in Asia/Kolkata. */
export function formatReserveDate(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate;
  const d = istMidnight(parsed.year, parsed.month, parsed.day);
  const p = istParts(d);
  const weekday = WEEKDAY_NAMES[p.weekday] ?? '';
  const month = MONTH_SHORT[parsed.month - 1] ?? '';
  return `${weekday} ${parsed.day} ${month}`;
}

/** Formats YYYY-MM-DD as "Saturday, 14 Nov 2026" in Asia/Kolkata. */
export function formatReserveDateLong(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate;
  const d = istMidnight(parsed.year, parsed.month, parsed.day);
  const p = istParts(d);
  const weekday = WEEKDAY_NAMES[p.weekday] ?? '';
  const month = MONTH_SHORT[parsed.month - 1] ?? '';
  return `${weekday}, ${parsed.day} ${month} ${parsed.year}`;
}

/** Formats the Step 1 live summary line, e.g. "Saturday 14 Nov, 7:30 PM, 4 people". */
export function formatLiveSummary(
  date: string,
  time: string,
  partySize: number,
): string {
  const people = partySize === 1 ? '1 person' : `${partySize} people`;
  if (date && time) {
    return `${formatReserveDate(date)}, ${formatClockTime24(time)}, ${people}`;
  }
  if (date) {
    return `${formatReserveDate(date)}, choose a time, ${people}`;
  }
  return `Choose a date and time, ${people}`;
}

export function getPartyHelperLines(partySize: number): string[] {
  if (partySize <= 6) return ['Slots seat 2, 4 or 6.'];
  if (partySize === 7)
    return ['Groups of 7 or more are confirmed by the team.'];
  return [
    'Groups of 7 or more are confirmed by the team.',
    "Groups of 8 or more need 24 hours' notice.",
  ];
}

/**
 * Builds the 7-column Monday-first calendar grid spanning today through +30 days in Asia/Kolkata.
 * Bookable status comes strictly from rules.getBookableDates plus same-day cut-off checks.
 */
export function buildReserveCalendar(now: Date): {
  weeks: CalendarDay[][];
  bookableDates: string[];
  firstSelectableDate: string;
} {
  const todayParts = istParts(now);
  const todayStart = istMidnight(
    todayParts.year,
    todayParts.month,
    todayParts.day,
  );
  const todayIso = formatIsoFromParts(
    todayParts.year,
    todayParts.month,
    todayParts.day,
  );
  const horizonEnd = new Date(
    todayStart.getTime() + BOOKING_HORIZON_DAYS * 86_400_000,
  );

  // Align grid start to Monday of today's week and end to Sunday of horizon's week.
  const startOffset = (todayParts.weekday + 6) % 7;
  const gridStart = new Date(todayStart.getTime() - startOffset * 86_400_000);
  const horizonParts = istParts(horizonEnd);
  const endOffset = (7 - horizonParts.weekday) % 7;
  const gridEnd = new Date(horizonEnd.getTime() + endOffset * 86_400_000);

  const ruleBookable = new Set(getBookableDates(now));
  const todayHasTimes = getBookableTimes(todayIso, now).length > 0;
  const selectableDates: string[] = [];
  const days: CalendarDay[] = [];

  for (
    let cursor = gridStart.getTime();
    cursor <= gridEnd.getTime();
    cursor += 86_400_000
  ) {
    const d = new Date(cursor);
    const p = istParts(d);
    const iso = formatIsoFromParts(p.year, p.month, p.day);
    const isToday = iso === todayIso;
    const isPast = cursor < todayStart.getTime();
    const isAfterHorizon = cursor > horizonEnd.getTime();
    const isMonday = p.weekday === 1;
    const inRuleDates = ruleBookable.has(iso);
    const cutoffPassedToday = isToday && inRuleDates && !todayHasTimes;
    const bookable = inRuleDates && !cutoffPassedToday;

    let disabledReason: string | null = null;
    if (isPast) disabledReason = 'Past date.';
    else if (isAfterHorizon)
      disabledReason = 'Outside the 30-day booking window.';
    else if (isMonday) disabledReason = 'Closed on Mondays.';
    else if (cutoffPassedToday)
      disabledReason = 'Same-day bookings close 2 hours before the last slot.';
    else if (!bookable) disabledReason = 'Not available for booking.';

    if (bookable) selectableDates.push(iso);

    days.push({
      date: iso,
      dayNumber: p.day,
      monthShort: MONTH_SHORT[p.month - 1] ?? '',
      monthLabel: `${MONTH_LONG[p.month - 1] ?? ''} ${p.year}`,
      weekday: p.weekday,
      bookable,
      isToday,
      isMonday,
      isPast,
      isAfterHorizon,
      disabledReason,
    });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return {
    weeks,
    bookableDates: selectableDates,
    firstSelectableDate: selectableDates[0] ?? '',
  };
}

/**
 * Reads an optional ?date=YYYY-MM-DD query parameter and accepts it only when it
 * is a real date present in the bookable dates list from rules.
 */
export function parseReserveDateParam(
  search: string,
  bookableDates: readonly string[],
): string | null {
  const raw = new URLSearchParams(search).get('date')?.trim() ?? '';
  if (!parseIsoDate(raw)) return null;
  return bookableDates.includes(raw) ? raw : null;
}

export function parseReserveHash(hash: string): Partial<ReserveHashState> {
  const cleaned = hash.replace(/^#/, '').trim();
  if (!cleaned) return {};
  const params = new URLSearchParams(cleaned);
  const out: Partial<ReserveHashState> = {};

  const stepRaw = Number(params.get('step'));
  if (stepRaw === 1 || stepRaw === 2 || stepRaw === 3) {
    out.step = stepRaw;
  }

  const dateRaw = params.get('date') ?? '';
  if (parseIsoDate(dateRaw)) {
    out.date = dateRaw;
  }

  const timeRaw = params.get('time') ?? '';
  if (TIME_RE.test(timeRaw)) {
    const [h = 0, m = 0] = timeRaw.split(':').map(Number);
    if (h <= 23 && m <= 59) out.time = timeRaw;
  }

  const partyRaw = Number(params.get('party'));
  if (
    Number.isInteger(partyRaw) &&
    partyRaw >= MIN_PARTY_SIZE &&
    partyRaw <= MAX_PARTY_SIZE
  ) {
    out.partySize = partyRaw;
  }

  return out;
}

export function serializeReserveHash(state: ReserveHashState): string {
  const params = new URLSearchParams();
  params.set('step', String(state.step));
  if (parseIsoDate(state.date)) params.set('date', state.date);
  if (TIME_RE.test(state.time)) params.set('time', state.time);
  const party = Math.min(
    MAX_PARTY_SIZE,
    Math.max(MIN_PARTY_SIZE, Math.trunc(state.partySize)),
  );
  params.set('party', String(party));
  return `#${params.toString()}`;
}

export function sanitizePreorderLines(raw: unknown): PreorderLineInput[] {
  if (!Array.isArray(raw)) return [];
  const merged = new Map<string, number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    const qty = (entry as { qty?: unknown }).qty;
    if (
      typeof id !== 'string' ||
      !MENU_ID_RE.test(id) ||
      typeof qty !== 'number' ||
      !Number.isInteger(qty) ||
      qty < 1
    )
      continue;
    if (!merged.has(id) && merged.size >= MAX_PREORDER_LINES) continue;
    const nextQty = Math.min(MAX_PREORDER_QTY, (merged.get(id) ?? 0) + qty);
    merged.set(id, nextQty);
  }
  return [...merged.entries()].map(([id, qty]) => ({ id, qty }));
}

export function sanitizeReserveDraft(raw: unknown): Partial<ReserveDraft> {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const out: Partial<ReserveDraft> = {};

  if (input.step === 1 || input.step === 2 || input.step === 3) {
    out.step = input.step;
  }
  if (typeof input.date === 'string' && parseIsoDate(input.date)) {
    out.date = input.date;
  }
  if (typeof input.time === 'string' && TIME_RE.test(input.time)) {
    out.time = input.time;
  }
  if (
    typeof input.partySize === 'number' &&
    Number.isInteger(input.partySize) &&
    input.partySize >= MIN_PARTY_SIZE &&
    input.partySize <= MAX_PARTY_SIZE
  ) {
    out.partySize = input.partySize;
  }
  if (typeof input.name === 'string') out.name = input.name.slice(0, 60);
  if (typeof input.phone === 'string') out.phone = input.phone.slice(0, 20);
  if (typeof input.email === 'string') out.email = input.email.slice(0, 254);
  if (
    typeof input.occasion === 'string' &&
    (RESERVE_OCCASIONS as readonly string[]).includes(input.occasion)
  ) {
    out.occasion = input.occasion as ReserveOccasion;
  }
  if (typeof input.notes === 'string')
    out.notes = input.notes.slice(0, MAX_NOTES_LENGTH);
  if (Array.isArray(input.preorder)) {
    out.preorder = sanitizePreorderLines(input.preorder);
  }

  return out;
}

export function addPreorderItem(
  lines: PreorderLineInput[],
  item: Pick<MenuItem, 'id' | 'available'>,
): PreorderLineInput[] {
  if (!item.available || !MENU_ID_RE.test(item.id)) return lines;
  const existing = lines.find((line) => line.id === item.id);
  if (existing) {
    if (existing.qty >= MAX_PREORDER_QTY) return lines;
    return lines.map((line) =>
      line.id === item.id
        ? { id: line.id, qty: Math.min(MAX_PREORDER_QTY, line.qty + 1) }
        : line,
    );
  }
  if (lines.length >= MAX_PREORDER_LINES) return lines;
  return [...lines, { id: item.id, qty: 1 }];
}

export function updatePreorderQty(
  lines: PreorderLineInput[],
  id: string,
  qty: number,
): PreorderLineInput[] {
  const nextQty = Math.floor(qty);
  if (!Number.isFinite(nextQty) || nextQty <= 0) {
    return lines.filter((line) => line.id !== id);
  }
  const clamped = Math.min(MAX_PREORDER_QTY, nextQty);
  return lines.map((line) =>
    line.id === id ? { id: line.id, qty: clamped } : line,
  );
}

/** Display estimate only; the server snapshots authoritative prices and names. */
export function computePreorderSummary(
  lines: PreorderLineInput[],
  items: MenuItem[],
): PreorderSummary {
  const map = new Map(items.map((item) => [item.id, item]));
  const resolved: PreorderDisplayLine[] = [];
  let itemCount = 0;
  let total = 0;

  for (const line of lines) {
    const item = map.get(line.id);
    if (!item) continue;
    const qty = Math.min(MAX_PREORDER_QTY, Math.max(1, Math.floor(line.qty)));
    const lineTotal = roundMoney(item.price_usd * qty);
    resolved.push({
      id: item.id,
      name: item.name,
      unitPrice: item.price_usd,
      qty,
      lineTotal,
      available: item.available,
    });
    itemCount += qty;
    total = roundMoney(total + lineTotal);
  }

  return { lines: resolved, itemCount, total };
}

/** Strips pre-order lines to the exact { id, qty } API contract. */
export function toApiPreorder(
  lines: PreorderLineInput[],
): { id: string; qty: number }[] {
  return sanitizePreorderLines(lines).map(({ id, qty }) => ({ id, qty }));
}

export function isValidIndianPhoneInput(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\+?\d+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/^\+/, '');
  return /^\d{10}$/.test(digits) || /^91\d{10}$/.test(digits);
}

export function formatSlotLabel(slotLabels: string[], status?: string): string {
  const cleaned = slotLabels.map((label) => label.trim()).filter(Boolean);
  if (cleaned.length > 0) return cleaned.join(' + ');
  if (status === 'requested') return 'PENDING';
  if (status === 'cancelled') return 'RELEASED';
  if (status === 'declined') return 'DECLINED';
  return 'PENDING';
}

/** RFC 5545 text escaping for .ics SUMMARY, DESCRIPTION and LOCATION fields. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function formatIcsLocalIst(date: Date): string {
  const p = istParts(date);
  return (
    `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}` +
    `T${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}00`
  );
}

function formatIcsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Generates a 90-minute Asia/Kolkata .ics calendar event for a booking. */
export function buildBookingCalendarIcs(
  booking: {
    code: string;
    date: string;
    time: string;
    party: number;
    slotLabels: string[];
    status: string;
  },
  now: Date = new Date(),
): string {
  const start = getBookingStart(booking.date, booking.time);
  if (!start) throw new Error('Invalid booking date or time.');
  const end = new Date(start.getTime() + BOOKING_DURATION_MINUTES * 60_000);
  const slotText = formatSlotLabel(booking.slotLabels, booking.status);
  const summary = escapeIcsText(
    `The Pigeonhole Café — Slot booking (${slotText})`,
  );
  const location = escapeIcsText(
    'Old Sorting Room, Post Office Lane, Kothi Bagh, Himachal Pradesh',
  );
  const description = escapeIcsText(
    [
      `Booking code: ${booking.code}`,
      `Party size: ${booking.party}`,
      `Status: ${booking.status}`,
      `Slot: ${slotText}`,
      'Held for 15 minutes after the booking time. Demo booking.',
    ].join('\n'),
  );

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Pigeonhole Café//Reserve//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Kolkata',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0530',
    'TZOFFSETTO:+0530',
    'TZNAME:IST',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${booking.code}@pigeonhole-cafe.demo`,
    `DTSTAMP:${formatIcsUtc(now)}`,
    `DTSTART;TZID=Asia/Kolkata:${formatIcsLocalIst(start)}`,
    `DTEND;TZID=Asia/Kolkata:${formatIcsLocalIst(end)}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function buildBookingWhatsAppText(booking: {
  code: string;
  date: string;
  time: string;
  party: number;
  slotLabels: string[];
  status: string;
}): string {
  const slotText = formatSlotLabel(booking.slotLabels, booking.status);
  return cleanWhatsAppMessage(
    [
      `Booking ${booking.code} (${booking.status})`,
      `Date: ${formatReserveDate(booking.date)}, ${formatClockTime24(booking.time)} (IST)`,
      `Party: ${booking.party}`,
      `Slot: ${slotText}`,
    ].join('\n'),
  );
}

export function buildBookingWhatsAppPath(booking: {
  code: string;
  date: string;
  time: string;
  party: number;
  slotLabels: string[];
  status: string;
}): string {
  return whatsAppRedirectPath(buildBookingWhatsAppText(booking));
}
