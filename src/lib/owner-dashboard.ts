import {
  isLegalBookingAction,
  isLegalOrderTransition,
  type BookingStatus,
  type OrderStatus,
} from './owner/rules';
import { CAFE_TIME_ZONE } from './rules';
import { buildWhatsAppUrl } from './whatsapp';

export type OrderCancelReason =
  | 'customer_request'
  | 'out_of_stock'
  | 'cannot_make_it'
  | 'duplicate'
  | 'other';

export type EnquiryKind = 'open_mic' | 'private_table' | 'general';
export type EnquiryStatus = 'new' | 'contacted' | 'done';

export type OwnerTodayResponse = {
  date: string;
  stats: {
    newOrders: number;
    bookingsToday: number;
    seatsBookedTonight: number;
    unansweredQuestions: number;
  };
  nextBookings: Array<{
    id: string;
    code: string;
    name: string;
    start_time: string;
    party_size: number;
    status: BookingStatus;
  }>;
  latestOrders: Array<{
    id: string;
    code: string;
    name: string;
    pickup_at: string | null;
    subtotal: number | string;
    status: OrderStatus;
    created_at: string;
  }>;
};

export type OwnerOrderItem = {
  id: string;
  menu_item_id: string;
  name_snapshot: string;
  price_snapshot: number | string;
  qty: number;
  note: string | null;
};

export type OwnerOrder = {
  id: string;
  code: string;
  name: string;
  phone: string;
  pickup_at: string | null;
  notes: string | null;
  subtotal: number | string;
  status: OrderStatus;
  source: 'site' | 'assistant';
  cancel_reason: string | null;
  created_at: string;
  order_items: OwnerOrderItem[];
};

export type OwnerOrdersResponse = {
  orders: OwnerOrder[];
  page: number;
  pageSize: number;
  total: number;
};

export type BookingPreorderLine = {
  id: string;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
};

export type BookingPreorder = {
  lines: BookingPreorderLine[];
  total: number;
};

export type OwnerBooking = {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  date: string;
  start_time: string;
  party_size: number;
  status: BookingStatus;
  occasion: string | null;
  notes: string | null;
  preorder: unknown;
  decline_reason: string | null;
  cancel_reason: string | null;
  created_at: string;
  slotIds: string[];
  slotLabels: string[];
};

export type OwnerTimelineRow = {
  id: string;
  label: string;
  seats: number;
  blocks: Array<{
    bookingId: string;
    code: string;
    startColumn: number;
    columnSpan: 3;
    partySize: number;
    status: string;
  }>;
};

export type OwnerBookingsResponse = {
  date: string;
  bookings: OwnerBooking[];
  timeline: {
    columns: string[];
    rows: OwnerTimelineRow[];
  };
};

export type OwnerEnquiry = {
  id: string;
  kind: EnquiryKind;
  name: string;
  phone: string | null;
  email: string | null;
  payload: Record<string, unknown>;
  status: EnquiryStatus;
  created_at: string;
};

export type OwnerEnquiriesResponse = {
  enquiries: OwnerEnquiry[];
  page: number;
  pageSize: number;
  total: number;
};

export type OwnerMenuItem = {
  id: string;
  category: string;
  subcategory: string | null;
  name: string;
  description: string | null;
  price_usd: number | string;
  available: boolean;
};

export type OwnerMenuResponse = {
  items: OwnerMenuItem[];
};

// Module-level formatters avoid rebuilding Intl instances on every render or row.
const kolkataDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAFE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const kolkataTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAFE_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const kolkataShortDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAFE_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export const ORDER_CANCEL_REASONS: ReadonlyArray<{
  value: OrderCancelReason;
  label: string;
}> = [
  { value: 'customer_request', label: 'Customer request' },
  { value: 'out_of_stock', label: 'Out of stock' },
  { value: 'cannot_make_it', label: 'Kitchen cannot make it' },
  { value: 'duplicate', label: 'Duplicate order' },
  { value: 'other', label: 'Other' },
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: 'Confirmed',
  requested: 'Requested',
  declined: 'Declined',
  cancelled: 'Cancelled',
  seated: 'Seated',
  no_show: 'No show',
};

export const ENQUIRY_KIND_LABELS: Record<EnquiryKind, string> = {
  open_mic: 'Open-mic',
  private_table: 'Private tables',
  general: 'General',
};

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  done: 'Done',
};

export const BOOKING_OCCASION_OPTIONS: ReadonlyArray<{
  value:
    | 'none'
    | 'birthday'
    | 'date'
    | 'work_meetup'
    | 'study_group'
    | 'trek_stop'
    | 'other';
  label: string;
}> = [
  { value: 'none', label: 'No occasion' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'date', label: 'Date' },
  { value: 'work_meetup', label: 'Work meetup' },
  { value: 'study_group', label: 'Study group' },
  { value: 'trek_stop', label: 'Trek stop' },
  { value: 'other', label: 'Other' },
];

export function todayInKolkata(now: Date = new Date()): string {
  return kolkataDateFormatter.format(now);
}

export function formatShortDate(dateIso: string): string {
  const parsed = new Date(`${dateIso}T12:00:00+05:30`);
  if (Number.isNaN(parsed.getTime())) return dateIso;
  return kolkataShortDateFormatter.format(parsed);
}

export function formatTimeValue(value: string | null | undefined): string {
  if (!value) return 'ASAP';
  const timeMatch = /^(\d{2}):(\d{2})/.exec(value);
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const suffix = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return kolkataTimeFormatter.format(parsed);
}

export function formatUsd(value: number | string): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '$0.00';
  return `$${numeric.toFixed(2)}`;
}

export function formatRelativePickup(
  pickupIso: string | null,
  now: Date = new Date(),
): string {
  if (!pickupIso) return 'ASAP';
  const target = new Date(pickupIso);
  if (Number.isNaN(target.getTime())) return '';
  const diffMinutes = Math.round((target.getTime() - now.getTime()) / 60_000);
  if (diffMinutes === 0) return 'now';
  const abs = Math.abs(diffMinutes);
  let duration: string;
  if (abs < 60) {
    duration = `${abs} min`;
  } else if (abs < 24 * 60) {
    const hours = Math.floor(abs / 60);
    const rem = abs % 60;
    duration = rem === 0 ? `${hours} h` : `${hours} h ${rem} min`;
  } else {
    const days = Math.round(abs / (24 * 60));
    duration = days === 1 ? '1 day' : `${days} days`;
  }
  return diffMinutes > 0 ? `in ${duration}` : `${duration} ago`;
}

export function formatTimeSince(
  createdIso: string,
  now: Date = new Date(),
): string {
  const created = new Date(createdIso);
  if (Number.isNaN(created.getTime())) return '';
  const diffMinutes = Math.floor((now.getTime() - created.getTime()) / 60_000);
  if (diffMinutes <= 0) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffMinutes < 24 * 60) {
    const hours = Math.floor(diffMinutes / 60);
    const rem = diffMinutes % 60;
    return rem === 0 ? `${hours} h ago` : `${hours} h ${rem} min ago`;
  }
  const days = Math.floor(diffMinutes / (24 * 60));
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export function getNextOrderAction(
  status: OrderStatus,
): { nextStatus: 'preparing' | 'ready' | 'collected'; label: string } | null {
  if (status === 'new' && isLegalOrderTransition(status, 'preparing')) {
    return { nextStatus: 'preparing', label: 'Start preparing' };
  }
  if (status === 'preparing' && isLegalOrderTransition(status, 'ready')) {
    return { nextStatus: 'ready', label: 'Mark ready' };
  }
  if (status === 'ready' && isLegalOrderTransition(status, 'collected')) {
    return { nextStatus: 'collected', label: 'Mark collected' };
  }
  return null;
}

export function canCancelOrder(status: OrderStatus): boolean {
  return isLegalOrderTransition(status, 'cancelled');
}

export function getAllowedBookingActions(status: BookingStatus): {
  confirm: boolean;
  decline: boolean;
  seated: boolean;
  noShow: boolean;
  cancel: boolean;
} {
  return {
    confirm: isLegalBookingAction(status, 'confirm'),
    decline: isLegalBookingAction(status, 'decline'),
    seated: isLegalBookingAction(status, 'seated'),
    noShow: isLegalBookingAction(status, 'no_show'),
    cancel: isLegalBookingAction(status, 'cancel'),
  };
}

export function normaliseCustomerWhatsAppPhone(
  phone: string | null | undefined,
): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function buildOrderReadyWhatsAppUrl(
  phone: string | null | undefined,
  orderCode: string,
): string | null {
  const normalised = normaliseCustomerWhatsAppPhone(phone);
  if (!normalised) return null;
  return buildWhatsAppUrl(normalised, `Your order ${orderCode} is ready`);
}

export function buildEnquiryReplyWhatsAppUrl(
  phone: string | null | undefined,
  guestName: string,
  kind: EnquiryKind,
): string | null {
  const normalised = normaliseCustomerWhatsAppPhone(phone);
  if (!normalised) return null;
  const topic =
    kind === 'open_mic'
      ? 'open-mic'
      : kind === 'private_table'
        ? 'private table'
        : 'cafe';
  const greeting = guestName.trim() ? `Hello ${guestName.trim()},` : 'Hello,';
  return buildWhatsAppUrl(
    normalised,
    `${greeting} following up on your ${topic} enquiry at The Pigeonhole Café.`,
  );
}

const STABLE_ERROR_MESSAGES: Record<string, string> = {
  not_found: 'That record could not be found. Refresh and try again.',
  bad_transition:
    'That status change is no longer allowed. Refresh to see the latest state.',
  reason_required: 'Enter a short reason before continuing.',
  slot_taken:
    'One or more chosen slots were just taken. Pick another open slot.',
  too_few_seats: 'The chosen slots do not have enough seats for this party.',
  bad_slots: 'Select at least one valid slot from S1 to S16.',
};

export function mapOwnerApiError(
  status: number,
  serverMessage?: string | null,
): string {
  if (status === 401) return 'Your session ended. Sign in again to continue.';
  if (status === 403) return 'Owner access is required for this action.';
  if (status === 429)
    return 'Too many changes in a short period. Wait a moment and try again.';

  const trimmed = typeof serverMessage === 'string' ? serverMessage.trim() : '';
  if (trimmed) {
    for (const [code, friendly] of Object.entries(STABLE_ERROR_MESSAGES)) {
      if (trimmed.includes(code)) return friendly;
    }
    if (status === 400 || status === 404 || status === 409 || status === 422) {
      return trimmed;
    }
  }
  if (status === 409) {
    return 'That record changed before your update finished. Refresh and try again.';
  }
  return 'Could not complete that request right now. Try again.';
}

export function parseBookingPreorder(raw: unknown): BookingPreorder | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { lines?: unknown; total?: unknown };
  if (!Array.isArray(candidate.lines) || candidate.lines.length === 0) {
    return null;
  }
  const lines: BookingPreorderLine[] = [];
  for (const entry of candidate.lines) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name : '';
    const qty = Number(item.qty);
    const price = Number(item.price ?? 0);
    const lineTotal = Number(item.lineTotal ?? price * qty);
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    lines.push({
      id: typeof item.id === 'string' ? item.id : name,
      name,
      price: Number.isFinite(price) ? price : 0,
      qty,
      lineTotal: Number.isFinite(lineTotal) ? lineTotal : 0,
    });
  }
  if (lines.length === 0) return null;
  const total = Number(candidate.total);
  const computed = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return {
    lines,
    total: Number.isFinite(total) ? total : Number(computed.toFixed(2)),
  };
}

export function timeToMinutes(timeText: string): number {
  const [hourText = '0', minuteText = '0'] = timeText.slice(0, 5).split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;
  return hour * 60 + minute;
}

export function isSlotOccupiedForBooking(
  slotId: string,
  startTime: string,
  bookings: ReadonlyArray<
    Pick<OwnerBooking, 'id' | 'start_time' | 'status' | 'slotIds'>
  >,
  excludeBookingId?: string,
): boolean {
  const targetStart = timeToMinutes(startTime);
  if (targetStart < 0) return false;
  const targetEnd = targetStart + 90;
  return bookings.some((booking) => {
    if (booking.id === excludeBookingId) return false;
    if (booking.status === 'cancelled' || booking.status === 'declined') {
      return false;
    }
    if (!booking.slotIds.includes(slotId)) return false;
    const otherStart = timeToMinutes(booking.start_time);
    if (otherStart < 0) return false;
    const otherEnd = otherStart + 90;
    return targetStart < otherEnd && otherStart < targetEnd;
  });
}

export function groupBookingsByTime<T extends { start_time: string }>(
  bookings: ReadonlyArray<T>,
): Array<{ time: string; label: string; bookings: T[] }> {
  const map = new Map<string, T[]>();
  for (const booking of bookings) {
    const key = booking.start_time.slice(0, 5);
    const list = map.get(key) ?? [];
    list.push(booking);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([time, list]) => ({
      time,
      label: formatTimeValue(time),
      bookings: list,
    }));
}

export function validateMenuEdit(input: {
  priceText: string;
  description: string;
}):
  | { ok: true; price_usd: number; description: string }
  | { ok: false; error: string } {
  const trimmedPrice = input.priceText.trim();
  if (!trimmedPrice) {
    return { ok: false, error: 'Enter a price between $0.50 and $50.00.' };
  }
  const price = Number(trimmedPrice);
  if (!Number.isFinite(price) || price < 0.5 || price > 50) {
    return { ok: false, error: 'Price must be between $0.50 and $50.00.' };
  }
  const roundedPrice = Number(price.toFixed(2));
  const description = input.description.trim();
  if (description.length > 300) {
    return { ok: false, error: 'Description must be 300 characters or fewer.' };
  }
  return { ok: true, price_usd: roundedPrice, description };
}

export function buildMenuPatch(
  original: Pick<OwnerMenuItem, 'available' | 'price_usd' | 'description'>,
  draft: {
    available?: boolean;
    price_usd?: number;
    description?: string;
  },
): {
  available?: boolean;
  price_usd?: number;
  description?: string;
} | null {
  const patch: {
    available?: boolean;
    price_usd?: number;
    description?: string;
  } = {};
  if (draft.available !== undefined && draft.available !== original.available) {
    patch.available = draft.available;
  }
  const originalPrice = Number(Number(original.price_usd).toFixed(2));
  if (
    draft.price_usd !== undefined &&
    Number(draft.price_usd.toFixed(2)) !== originalPrice
  ) {
    patch.price_usd = Number(draft.price_usd.toFixed(2));
  }
  const originalDescription = (original.description ?? '').trim();
  if (
    draft.description !== undefined &&
    draft.description.trim() !== originalDescription
  ) {
    patch.description = draft.description.trim();
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export function formatEnquiryPayloadEntries(
  payload: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const entries: Array<{ label: string; value: string }> = [];
  for (const [key, rawValue] of Object.entries(payload)) {
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      continue;
    }
    const label = key
      .replaceAll('_', ' ')
      .replace(/^\w/, (char) => char.toUpperCase());
    if (
      typeof rawValue === 'string' ||
      typeof rawValue === 'number' ||
      typeof rawValue === 'boolean'
    ) {
      entries.push({ label, value: String(rawValue) });
    } else if (Array.isArray(rawValue)) {
      const joined = rawValue
        .filter((item) => typeof item === 'string' || typeof item === 'number')
        .join(', ');
      if (joined) entries.push({ label, value: joined });
    }
  }
  return entries;
}
