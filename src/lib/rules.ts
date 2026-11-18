export const CAFE_TIME_ZONE = 'Asia/Kolkata';
export const BOOKING_DURATION_MINUTES = 90;
export const BOOKING_STEP_MINUTES = 30;
export const BOOKING_HORIZON_DAYS = 30;
export const BOOKING_SAME_DAY_CUTOFF_MINUTES = 120;
export const BOOKING_LARGE_PARTY_NOTICE_MINUTES = 24 * 60;
export const BOOKING_CANCEL_CUTOFF_MINUTES = 120;
export const BOOKING_HOLD_MINUTES = 15;
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

// Building an Intl.DateTimeFormat is expensive. The pickup and booking logic calls
// localParts thousands of times in loops, so one formatter is created and reused.
const localPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAFE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

function localParts(date: Date): LocalParts {
  const parts = localPartsFormatter.formatToParts(date);
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
  const minimum = now.getTime() + BOOKING_SAME_DAY_CUTOFF_MINUTES * 60_000;
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

/** Converts a local cafe date and time to its absolute booking start. */
export function getBookingStart(date: string, time: string): Date | null {
  const parsedDate = parseDate(date);
  const parsedTime = parseTime(time);
  if (!parsedDate || !parsedTime) return null;
  return istDate(
    parsedDate.year,
    parsedDate.month,
    parsedDate.day,
    parsedTime.hour,
    parsedTime.minute,
  );
}

/** The time until which a confirmed slot is held. */
export function getBookingHoldUntil(date: string, time: string): Date | null {
  const start = getBookingStart(date, time);
  return start
    ? new Date(start.getTime() + BOOKING_HOLD_MINUTES * 60_000)
    : null;
}

/** Groups of eight to twelve must book at least 24 hours ahead. */
export function hasLargePartyNotice(
  date: string,
  time: string,
  now: Date,
): boolean {
  const start = getBookingStart(date, time);
  return (
    start !== null &&
    start.getTime() - now.getTime() >=
      BOOKING_LARGE_PARTY_NOTICE_MINUTES * 60_000
  );
}

/** Cancellations are accepted until exactly two hours before the start. */
export function canCancelBooking(
  date: string,
  time: string,
  now: Date,
): boolean {
  const start = getBookingStart(date, time);
  return (
    start !== null &&
    start.getTime() - now.getTime() >= BOOKING_CANCEL_CUTOFF_MINUTES * 60_000
  );
}

/** Half-open booking ranges overlap when each begins before the other ends. */
export function bookingRangesOverlap(
  firstStart: Date,
  secondStart: Date,
  durationMinutes = BOOKING_DURATION_MINUTES,
): boolean {
  if (
    Number.isNaN(firstStart.getTime()) ||
    Number.isNaN(secondStart.getTime()) ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  )
    return false;
  const duration = durationMinutes * 60_000;
  return (
    firstStart.getTime() < secondStart.getTime() + duration &&
    secondStart.getTime() < firstStart.getTime() + duration
  );
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
    const start = getBookingStart(booking.date, booking.time);
    if (!getBookableDates(now).includes(booking.date))
      errors.push('Date is outside the booking window or the café is closed.');
    if (!getBookableTimes(booking.date, now).includes(booking.time))
      errors.push('Time is not available under the booking rules.');
    if (
      booking.partySize >= 8 &&
      start !== null &&
      !hasLargePartyNotice(booking.date, booking.time, now)
    ) {
      errors.push('Groups of 8 or more need 24 hours notice.');
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true };
}

export const PICKUP_STEP_MINUTES = 15;
export const MIN_PREP_MINUTES = 10;
export const MAX_QUANTITY_PER_ITEM = 20;
export const MAX_ITEMS_PER_ORDER = 40;
const LAST_ORDER_BUFFER_MINUTES = 30;

export type PickupOption = {
  time: string;
  label: string;
  available: boolean;
  reason?: string;
};

export type PickupDate = {
  date: string;
  available: boolean;
  reason?: string;
};

export type OrderLine = {
  id: string;
  quantity: number;
  /** Preparation minutes for the item. The server fills this from the menu table, never from the browser. */
  prepMinutes?: number;
};

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Longest prep time in the cart plus five minutes, never below ten. */
export function estimatedPrepMinutes(prepMinutes: number[]): number {
  const longest = prepMinutes.reduce(
    (max, value) => (Number.isFinite(value) && value > max ? value : max),
    0,
  );
  return Math.max(MIN_PREP_MINUTES, longest + 5);
}

function roundUpToFive(date: Date): Date {
  const step = 5 * 60_000;
  return new Date(Math.ceil(date.getTime() / step) * step);
}

/** "As soon as possible": now plus prep time, rounded up to the next five minutes. */
export function getAsapPickup(now: Date, estimatedPrep: number): Date {
  return roundUpToFive(new Date(now.getTime() + estimatedPrep * 60_000));
}

/** Why a pickup moment can never work, ignoring the current time. Null means it falls inside opening hours. */
function pickupHoursProblem(pickupAt: Date): string | null {
  const hours = hoursFor(pickupAt);
  if (!hours) return 'The café is closed on Mondays.';
  const p = localParts(pickupAt);
  const minutes = p.hour * 60 + p.minute;
  if (minutes < hours.open)
    return `The café opens at ${formatClock(hours.open)}.`;
  if (minutes >= hours.close - LAST_ORDER_BUFFER_MINUTES)
    return `Pickup must be before last orders at ${formatClock(hours.close - LAST_ORDER_BUFFER_MINUTES)}.`;
  return null;
}

function pickupTimeProblem(
  pickupAt: Date,
  now: Date,
  estimatedPrep: number,
): string | null {
  const hoursProblem = pickupHoursProblem(pickupAt);
  if (hoursProblem) return hoursProblem;
  const day = istDate(
    localParts(pickupAt).year,
    localParts(pickupAt).month,
    localParts(pickupAt).day,
  );
  if (!pickupDateStrings(now).includes(isoLocal(day)))
    return `Pickup can be up to ${PICKUP_HORIZON_DAYS} days ahead.`;
  if (pickupAt.getTime() < now.getTime() + estimatedPrep * 60_000)
    return `Too soon: the kitchen needs about ${estimatedPrep} minutes.`;
  return null;
}

function pickupDateStrings(now: Date): string[] {
  const p = localParts(now);
  const start = istDate(p.year, p.month, p.day);
  return Array.from({ length: PICKUP_HORIZON_DAYS + 1 }, (_, offset) =>
    isoLocal(new Date(start.getTime() + offset * 86_400_000)),
  );
}

/** Today plus the next seven days, with a reason when a day cannot take orders. */
export function getPickupDates(
  now: Date,
  estimatedPrep: number = MIN_PREP_MINUTES,
): PickupDate[] {
  return pickupDateStrings(now).map((date) => {
    const parsed = parseDate(date);
    if (!parsed) return { date, available: false, reason: 'Invalid date.' };
    if (!hoursFor(istDate(parsed.year, parsed.month, parsed.day)))
      return {
        date,
        available: false,
        reason: 'The café is closed on Mondays. Pick Tuesday.',
      };
    const anyTime = getPickupWindow(date, now, estimatedPrep).some(
      (option) => option.available,
    );
    return anyTime
      ? { date, available: true }
      : {
          date,
          available: false,
          reason: 'Last orders have passed. Pick another day.',
        };
  });
}

/** Pickup times for one date in 15-minute steps inside opening hours and before last orders. */
export function getPickupWindow(
  date: string,
  now: Date,
  estimatedPrep: number = MIN_PREP_MINUTES,
): PickupOption[] {
  const parsed = parseDate(date);
  if (!parsed || !pickupDateStrings(now).includes(date)) return [];
  const day = istDate(parsed.year, parsed.month, parsed.day);
  const hours = hoursFor(day);
  if (!hours) return [];
  const options: PickupOption[] = [];
  for (
    let minutes = hours.open;
    minutes < hours.close - LAST_ORDER_BUFFER_MINUTES;
    minutes += PICKUP_STEP_MINUTES
  ) {
    const candidate = istDate(
      parsed.year,
      parsed.month,
      parsed.day,
      Math.floor(minutes / 60),
      minutes % 60,
    );
    const problem = pickupTimeProblem(candidate, now, estimatedPrep);
    options.push({
      time: hhmm(minutes),
      label: formatClock(minutes),
      available: problem === null,
      ...(problem ? { reason: problem } : {}),
    });
  }
  return options;
}

/** The first valid pickup at or after the "as soon as possible" time. Used to correct a stale choice. */
export function nearestValidPickup(now: Date, estimatedPrep: number): Date {
  const start = getAsapPickup(now, estimatedPrep).getTime();
  const step = 5 * 60_000;
  for (
    let t = start;
    t <= start + (PICKUP_HORIZON_DAYS + 2) * 86_400_000;
    t += step
  ) {
    if (pickupTimeProblem(new Date(t), now, estimatedPrep) === null)
      return new Date(t);
  }
  throw new Error('No valid pickup time found.');
}

export function validateOrder(
  order: { items: OrderLine[]; pickupAt: Date },
  now: Date,
): RuleResult {
  const errors: string[] = [];
  if (!order.items.length) errors.push('Add at least one item.');

  const totals = new Map<string, number>();
  let validLines = true;
  for (const item of order.items) {
    if (
      !/^PH\d{4}$/.test(item.id) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) {
      validLines = false;
      continue;
    }
    totals.set(item.id, (totals.get(item.id) ?? 0) + item.quantity);
  }
  if (!validLines)
    errors.push('Each order item needs a valid menu ID and a whole quantity.');
  if ([...totals.values()].some((quantity) => quantity > MAX_QUANTITY_PER_ITEM))
    errors.push(`Order at most ${MAX_QUANTITY_PER_ITEM} of any one item.`);
  const itemCount = [...totals.values()].reduce((sum, value) => sum + value, 0);
  if (itemCount > MAX_ITEMS_PER_ORDER)
    errors.push(`Order at most ${MAX_ITEMS_PER_ORDER} items in total.`);

  if (
    !(order.pickupAt instanceof Date) ||
    Number.isNaN(order.pickupAt.getTime())
  ) {
    errors.push('Choose a valid pickup time.');
  } else {
    const prep = estimatedPrepMinutes(
      order.items.map((item) => item.prepMinutes ?? 0),
    );
    const problem = pickupTimeProblem(order.pickupAt, now, prep);
    if (problem) errors.push(problem);
  }
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
