import type { BookingStatus, OrderStatus } from '../../lib/owner/rules';
import {
  BOOKING_STATUS_LABELS,
  ENQUIRY_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  type EnquiryStatus,
} from '../../lib/owner-dashboard';

const ORDER_BADGE_CLASSES: Record<OrderStatus, string> = {
  new: 'border-stamp bg-stamp/10 text-stamp',
  preparing: 'border-warn bg-warn/10 text-warn',
  ready: 'border-ok bg-ok/10 text-ok',
  collected: 'border-ink/35 bg-paper-2 text-ink-2',
  cancelled: 'border-err bg-err/10 text-err',
};

const BOOKING_BADGE_CLASSES: Record<BookingStatus, string> = {
  requested: 'border-warn bg-warn/10 text-warn',
  confirmed: 'border-ok bg-ok/10 text-ok',
  seated: 'border-ink bg-ink text-paper',
  no_show: 'border-err bg-err/10 text-err',
  declined: 'border-err bg-err/10 text-err',
  cancelled: 'border-ink/35 bg-paper-2 text-ink-2',
};

const ENQUIRY_BADGE_CLASSES: Record<EnquiryStatus, string> = {
  new: 'border-stamp bg-stamp/10 text-stamp',
  contacted: 'border-warn bg-warn/10 text-warn',
  done: 'border-ok bg-ok/10 text-ok',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.06em] uppercase ${ORDER_BADGE_CLASSES[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.06em] uppercase ${BOOKING_BADGE_CLASSES[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {BOOKING_STATUS_LABELS[status]}
    </span>
  );
}

export function EnquiryStatusBadge({ status }: { status: EnquiryStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.06em] uppercase ${ENQUIRY_BADGE_CLASSES[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {ENQUIRY_STATUS_LABELS[status]}
    </span>
  );
}
