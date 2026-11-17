export const CAFE_TIME_ZONE = 'Asia/Kolkata';
export const BOOKING_DURATION_MINUTES = 90;
export const BOOKING_STEP_MINUTES = 30;
export const BOOKING_HORIZON_DAYS = 30;
export const PICKUP_HORIZON_DAYS = 7;

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

export type OpenState = {
  state: 'open' | 'last-orders-passed' | 'closed';
  label: string;
  closesAt?: string;
  nextOpensAt?: string;
};

export type PartyClass = 'confirmed' | 'requested' | 'handoff';

export type RuleResult = { valid: true } | { valid: false; errors: string[] };

const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function localParts(date: Date): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAFE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    weekday: weekdayIndex[value('weekday')] ?? 0,
  };
}

function istDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 330 * 60_000);
}

function isoLocal(date: Date): string {
  const p = localParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function parseDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = istDate(year, month, day);
  const parts = localParts(date);
  return parts.year === year && parts.month === month && parts.day === day
    ? { year, month, day }
    : null;
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function hoursFor(date: Date): { open: number; close: number } | null {
  const p = localParts(date);
  if (p.weekday === 1) return null;
  if (p.weekday === 0 && (p.month === 10 || p.month === 11))
    return { open: 7 * 60, close: 23 * 60 };
  if (p.weekday === 0 || p.weekday === 6)
    return { open: 8 * 60, close: 23 * 60 };
  return { open: 8 * 60, close: 21 * 60 + 30 };
}

function formatClock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function nextOpen(now: Date): Date {
  const p = localParts(now);
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(
      istDate(p.year, p.month, p.day).getTime() + offset * 86_400_000,
    );
    const hours = hoursFor(candidate);
    if (!hours) continue;
    const cp = localParts(candidate);
    const opening = istDate(
      cp.year,
      cp.month,
      cp.day,
      Math.floor(hours.open / 60),
      hours.open % 60,
    );
    if (opening > now) return opening;
  }
  throw new Error('Unable to find the next opening time.');
}

function formatOpening(date: Date): string {
  const p = localParts(date);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: CAFE_TIME_ZONE,
    weekday: 'long',
  }).format(date);
  return `${weekday} ${formatClock(p.hour * 60 + p.minute)}`;
}

export function getOpenState(now: Date): OpenState {
  const p = localParts(now);
  const hours = hoursFor(now);
  const minutes = p.hour * 60 + p.minute;
  if (hours && minutes >= hours.open && minutes < hours.close - 30) {
    const closesAt = formatClock(hours.close);
    return { state: 'open', label: `Open now, until ${closesAt}`, closesAt };
  }
  if (hours && minutes >= hours.close - 30 && minutes < hours.close) {
    return {
      state: 'last-orders-passed',
      label: 'Last orders passed',
      closesAt: formatClock(hours.close),
      nextOpensAt: formatOpening(nextOpen(now)),
    };
  }
  const nextOpensAt = formatOpening(nextOpen(now));
  return {
    state: 'closed',
    label: `Closed, opens ${nextOpensAt}`,
    nextOpensAt,
  };
}

export function getBookableDates(now: Date): string[] {
  const p = localParts(now);
  const start = istDate(p.year, p.month, p.day);
  const dates: string[] = [];
  for (let offset = 0; offset <= BOOKING_HORIZON_DAYS; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 86_400_000);
    if (hoursFor(candidate)) dates.push(isoLocal(candidate));
  }
  return dates;
}

export function getBookableTimes(date: string, now: Date): string[] {
  const parsed = parseDate(date);
  if (!parsed) return [];
  const day = istDate(parsed.year, parsed.month, parsed.day);
  if (!getBookableDates(now).includes(date)) return [];
  const hours = hoursFor(day);
  if (!hours) return [];
  const minimum = now.getTime() + 2 * 60 * 60_000;
  const times: string[] = [];
  for (
    let minutes = hours.open;
    minutes <= hours.close - 60;
    minutes += BOOKING_STEP_MINUTES
  ) {
    const candidate = istDate(
      parsed.year,
      parsed.month,
      parsed.day,
      Math.floor(minutes / 60),
      minutes % 60,
    );
    if (candidate.getTime() >= minimum)
      times.push(
        `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      );
  }
  return times;
}

export function classifyParty(partySize: number): PartyClass {
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 12)
    return 'handoff';
  return partySize <= 6 ? 'confirmed' : 'requested';
}

export function validateBooking(
  booking: { date: string; time: string; partySize: number },
  now: Date,
): RuleResult {
  const errors: string[] = [];
  const date = parseDate(booking.date);
  const time = parseTime(booking.time);
  if (classifyParty(booking.partySize) === 'handoff')
    errors.push('Party size must be between 1 and 12.');
  if (!date) errors.push('Choose a valid booking date.');
  if (!time) errors.push('Choose a valid booking time.');
  if (date && time) {
    const start = istDate(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
    );
    if (!getBookableDates(now).includes(booking.date))
      errors.push('Date is outside the booking window or the cafe is closed.');
    if (!getBookableTimes(booking.date, now).includes(booking.time))
      errors.push('Time is not available under the booking rules.');
    if (
      booking.partySize >= 8 &&
      start.getTime() - now.getTime() < 24 * 60 * 60_000
    ) {
      errors.push('Groups of 8 or more need 24 hours notice.');
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true };
}

export function getPickupWindow(now: Date): { earliest: Date; latest: Date } {
  const earliest = new Date(
    Math.ceil((now.getTime() + 20 * 60_000) / (5 * 60_000)) * 5 * 60_000,
  );
  const latest = new Date(now.getTime() + PICKUP_HORIZON_DAYS * 86_400_000);
  return { earliest, latest };
}

export function validateOrder(
  order: { items: Array<{ id: string; quantity: number }>; pickupAt: Date },
  now: Date,
): RuleResult {
  const errors: string[] = [];
  if (!order.items.length) errors.push('Add at least one item.');
  if (
    order.items.some(
      (item) =>
        !/^PH\d{4}$/.test(item.id) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 20,
    )
  ) {
    errors.push(
      'Each order item needs a valid menu ID and quantity from 1 to 20.',
    );
  }
  const window = getPickupWindow(now);
  if (
    !(order.pickupAt instanceof Date) ||
    Number.isNaN(order.pickupAt.getTime())
  )
    errors.push('Choose a valid pickup time.');
  else if (order.pickupAt < window.earliest || order.pickupAt > window.latest)
    errors.push('Pickup must be within the available window.');
  return errors.length ? { valid: false, errors } : { valid: true };
}

export function nextFirstSaturday(now: Date): Date {
  const p = localParts(now);
  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const total = p.month - 1 + monthOffset;
    const year = p.year + Math.floor(total / 12);
    const month = (total % 12) + 1;
    const first = istDate(year, month, 1);
    const fp = localParts(first);
    const saturday = istDate(year, month, 1 + ((6 - fp.weekday + 7) % 7));
    if (saturday >= now) return saturday;
  }
  throw new Error('Unable to find the next first Saturday.');
}

export function isTrekSunday(date: Date): boolean {
  const p = localParts(date);
  return p.weekday === 0 && (p.month === 10 || p.month === 11);
}

export function isStudentHourNow(date: Date): boolean {
  const p = localParts(date);
  const minutes = p.hour * 60 + p.minute;
  return (
    p.weekday >= 2 && p.weekday <= 4 && minutes >= 15 * 60 && minutes < 18 * 60
  );
}
