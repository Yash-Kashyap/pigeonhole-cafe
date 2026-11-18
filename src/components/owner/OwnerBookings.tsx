import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  buildBookingTimeline,
  type TimelineBooking,
  type TimelineSlot,
} from '../../lib/owner/timeline';
import { ownerGetJson, ownerWriteJson } from '../../lib/owner-api';
import {
  BOOKING_OCCASION_OPTIONS,
  BOOKING_STATUS_LABELS,
  formatShortDate,
  formatTimeValue,
  formatUsd,
  getAllowedBookingActions,
  groupBookingsByTime,
  isSlotOccupiedForBooking,
  parseBookingPreorder,
  todayInKolkata,
  type OwnerBooking,
  type OwnerBookingsResponse,
} from '../../lib/owner-dashboard';
import { BookingStatusBadge } from './OwnerBadges';
import { useOwnerRealtime, type RealtimeTable } from './useOwnerRealtime';

const BOOKINGS_TABLES: readonly RealtimeTable[] = ['bookings'];

const WALKIN_TIME_OPTIONS: readonly string[] = Array.from(
  { length: 31 },
  (_, index) => {
    const minutes = 7 * 60 + index * 30;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  },
);

function shiftDate(dateIso: string, deltaDays: number): string {
  const parsed = new Date(`${dateIso}T12:00:00+05:30`);
  if (Number.isNaN(parsed.getTime())) return todayInKolkata();
  return todayInKolkata(new Date(parsed.getTime() + deltaDays * 86_400_000));
}

function timelineBlockClass(status: string, selected: boolean): string {
  const ring = selected ? 'ring-2 ring-brass ring-offset-1' : '';
  if (status === 'seated') {
    return `border-ink bg-ink text-paper ${ring}`;
  }
  if (status === 'confirmed') {
    return `border-ok bg-ok/15 text-ink hover:bg-ok/25 ${ring}`;
  }
  if (status === 'requested') {
    return `border-warn bg-warn/15 text-ink hover:bg-warn/25 ${ring}`;
  }
  if (status === 'no_show' || status === 'declined') {
    return `border-err/60 bg-err/10 text-err ${ring}`;
  }
  return `border-ink/30 bg-paper-2 text-ink-2 ${ring}`;
}

type Props = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export default function OwnerBookings({ supabaseUrl, supabaseAnonKey }: Props) {
  const [selectedDate, setSelectedDate] = useState(() => todayInKolkata());
  const [bookings, setBookings] = useState<OwnerBooking[]>([]);
  const [slots, setSlots] = useState<TimelineSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(
    null,
  );

  // Inline action states (confirm slots, decline reason, cancel reason)
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [chosenSlotIds, setChosenSlotIds] = useState<string[]>([]);
  const [reasonMode, setReasonMode] = useState<{
    bookingId: string;
    action: 'decline' | 'cancel';
  } | null>(null);
  const [reasonText, setReasonText] = useState('');

  // Walk-in / phone booking form state
  const [showWalkInForm, setShowWalkInForm] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInEmail, setWalkInEmail] = useState('');
  const [walkInDate, setWalkInDate] = useState(() => todayInKolkata());
  const [walkInTime, setWalkInTime] = useState('18:00');
  const [walkInParty, setWalkInParty] = useState(2);
  const [walkInOccasion, setWalkInOccasion] = useState<
    | 'none'
    | 'birthday'
    | 'date'
    | 'work_meetup'
    | 'study_group'
    | 'trek_stop'
    | 'other'
  >('none');
  const [walkInNotes, setWalkInNotes] = useState('');
  const [walkInBusy, setWalkInBusy] = useState(false);
  const [walkInError, setWalkInError] = useState<string | null>(null);
  const [walkInRuleErrors, setWalkInRuleErrors] = useState<string[]>([]);

  const fetchBookings = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const result = await ownerGetJson<OwnerBookingsResponse>(
        `/api/owner/bookings?date=${encodeURIComponent(selectedDate)}`,
      );
      if (!result.ok) {
        if (result.status !== 0) setError(result.message);
        setLoading(false);
        return;
      }
      setError(null);
      setBookings(result.data.bookings);
      setSlots(
        result.data.timeline.rows.map((row) => ({
          id: row.id,
          label: row.label,
          seats: row.seats,
        })),
      );
      setLoading(false);
    },
    [selectedDate],
  );

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  useEffect(() => {
    setWalkInDate(selectedDate);
  }, [selectedDate]);

  useOwnerRealtime({
    supabaseUrl,
    supabaseAnonKey,
    tables: BOOKINGS_TABLES,
    onTableChange: () => {
      void fetchBookings({ silent: true });
    },
    onReconnect: () => {
      void fetchBookings({ silent: true });
    },
    onFallbackPoll: () => {
      void fetchBookings({ silent: true });
    },
  });

  const timeline = useMemo(() => {
    const timelineBookings: TimelineBooking[] = bookings
      .filter(
        (booking) =>
          booking.status !== 'cancelled' && booking.status !== 'declined',
      )
      .map((booking) => ({
        id: booking.id,
        code: booking.code,
        start_time: booking.start_time,
        party_size: booking.party_size,
        status: booking.status,
        slot_ids: booking.slotIds,
      }));
    return buildBookingTimeline(slots, timelineBookings);
  }, [bookings, slots]);

  const requestedBookings = useMemo(
    () => bookings.filter((booking) => booking.status === 'requested'),
    [bookings],
  );

  const groupedByTime = useMemo(
    () => groupBookingsByTime(bookings),
    [bookings],
  );

  const selectedBooking = useMemo(
    () => bookings.find((booking) => booking.id === selectedBookingId) ?? null,
    [bookings, selectedBookingId],
  );

  const runBookingPatch = async (
    bookingId: string,
    payload:
      | { action: 'confirm'; slotIds: string[] }
      | { action: 'decline'; reason: string }
      | { action: 'cancel'; reason: string }
      | { action: 'seated' }
      | { action: 'no_show' },
    successText: string,
  ) => {
    if (busyIds[bookingId]) return;
    setBusyIds((prev) => ({ ...prev, [bookingId]: true }));
    setActionError(null);
    setActionSuccess(null);

    const result = await ownerWriteJson<{
      booking: { code: string; status: string; slot_labels?: string[] };
    }>(`/api/owner/bookings/${bookingId}`, 'PATCH', payload);

    setBusyIds((prev) => ({ ...prev, [bookingId]: false }));
    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    setConfirmingId(null);
    setChosenSlotIds([]);
    setReasonMode(null);
    setReasonText('');
    setActionSuccess(successText);
    void fetchBookings({ silent: true });
  };

  const toggleSlotSelection = (slotId: string) => {
    setChosenSlotIds((prev) =>
      prev.includes(slotId)
        ? prev.filter((id) => id !== slotId)
        : [...prev, slotId],
    );
  };

  const handleWalkInSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (walkInBusy) return;
    setWalkInError(null);
    setWalkInRuleErrors([]);
    setActionSuccess(null);

    if (!walkInName.trim()) {
      setWalkInError('Enter the guest name.');
      return;
    }
    if (!walkInPhone.trim()) {
      setWalkInError('Enter a phone number.');
      return;
    }

    setWalkInBusy(true);
    const body: Record<string, unknown> = {
      name: walkInName.trim(),
      phone: walkInPhone.trim(),
      date: walkInDate,
      time: walkInTime,
      partySize: walkInParty,
    };
    if (walkInEmail.trim()) body.email = walkInEmail.trim();
    if (walkInOccasion !== 'none') body.occasion = walkInOccasion;
    if (walkInNotes.trim()) body.notes = walkInNotes.trim();

    const result = await ownerWriteJson<{
      booking: { code: string; status: string; slot_labels?: string[] };
    }>('/api/owner/bookings', 'POST', body);
    setWalkInBusy(false);

    if (!result.ok) {
      setWalkInError(result.message);
      if (result.errors && result.errors.length > 0) {
        setWalkInRuleErrors(result.errors);
      }
      return;
    }

    const created = result.data.booking;
    const assigned =
      created.slot_labels && created.slot_labels.length > 0
        ? ` (${created.slot_labels.join(', ')})`
        : '';
    setActionSuccess(
      `Booking ${created.code} created as ${created.status}${assigned}.`,
    );
    setWalkInName('');
    setWalkInPhone('');
    setWalkInEmail('');
    setWalkInNotes('');
    setWalkInOccasion('none');
    setShowWalkInForm(false);

    if (walkInDate !== selectedDate) {
      setSelectedDate(walkInDate);
    } else {
      void fetchBookings({ silent: true });
    }
  };

  const renderPreorder = (booking: OwnerBooking) => {
    const preorder = parseBookingPreorder(booking.preorder);
    if (!preorder) return null;
    return (
      <div className="mt-3 border border-ink/20 bg-paper p-3">
        <p className="ph-label text-brass-text">Pre-order</p>
        <ul className="mt-1.5 space-y-1 text-xs">
          {preorder.lines.map((line) => (
            <li
              key={line.id}
              className="flex items-baseline justify-between gap-2"
            >
              <span>
                <span className="font-mono font-medium">{line.qty}×</span>{' '}
                {line.name}
              </span>
              <span className="font-mono text-ink-2">
                {formatUsd(line.lineTotal)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 border-t border-ink/15 pt-1.5 font-mono text-xs font-medium">
          Pre-order total: {formatUsd(preorder.total)}
        </p>
      </div>
    );
  };

  const renderReasonForm = (booking: OwnerBooking) => {
    if (!reasonMode || reasonMode.bookingId !== booking.id) return null;
    const busy = Boolean(busyIds[booking.id]);
    const isDecline = reasonMode.action === 'decline';
    return (
      <div className="mt-3 space-y-2 border border-err/50 bg-paper p-3">
        <label className="block text-xs font-semibold text-ink">
          {isDecline ? 'Reason for declining' : 'Reason for cancelling'}
          <input
            type="text"
            maxLength={200}
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
            placeholder={
              isDecline
                ? 'For example: No adjacent slots free at that hour'
                : 'For example: Guest called to cancel'
            }
            disabled={busy}
            className="mt-1 min-h-11 w-full border border-ink bg-card px-3 text-sm text-ink"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !reasonText.trim()}
            onClick={() =>
              void runBookingPatch(
                booking.id,
                { action: reasonMode.action, reason: reasonText.trim() },
                `Booking ${booking.code} marked ${isDecline ? 'declined' : 'cancelled'}.`,
              )
            }
            className="min-h-11 border border-err bg-err px-3.5 text-xs font-semibold text-paper disabled:opacity-50"
          >
            {busy
              ? 'Saving...'
              : isDecline
                ? 'Confirm decline'
                : 'Confirm cancel'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setReasonMode(null);
              setReasonText('');
            }}
            className="min-h-11 border border-ink/40 bg-card px-3.5 text-xs font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
          >
            Back
          </button>
        </div>
      </div>
    );
  };

  const renderBookingActions = (booking: OwnerBooking) => {
    const allowed = getAllowedBookingActions(booking.status);
    const busy = Boolean(busyIds[booking.id]);
    const isConfirming = confirmingId === booking.id;
    const selectedSeats = slots
      .filter((slot) => chosenSlotIds.includes(slot.id))
      .reduce((sum, slot) => sum + slot.seats, 0);

    return (
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          {allowed.confirm && !isConfirming && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmingId(booking.id);
                setChosenSlotIds([]);
                setReasonMode(null);
                setActionError(null);
              }}
              className="min-h-11 border border-ink bg-ink px-3.5 text-xs font-semibold text-paper disabled:opacity-60"
            >
              Confirm and assign slots
            </button>
          )}
          {allowed.seated && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runBookingPatch(
                  booking.id,
                  { action: 'seated' },
                  `Booking ${booking.code} marked seated.`,
                )
              }
              className="min-h-11 border border-ink bg-ink px-3.5 text-xs font-semibold text-paper disabled:opacity-60"
            >
              {busy ? 'Saving...' : 'Mark seated'}
            </button>
          )}
          {allowed.noShow && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runBookingPatch(
                  booking.id,
                  { action: 'no_show' },
                  `Booking ${booking.code} marked no show.`,
                )
              }
              className="min-h-11 border border-ink/40 bg-card px-3.5 text-xs font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
            >
              No show
            </button>
          )}
          {allowed.decline && booking.status === 'requested' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setReasonMode({ bookingId: booking.id, action: 'decline' });
                setReasonText('');
                setConfirmingId(null);
              }}
              className="min-h-11 border border-err/70 bg-card px-3.5 text-xs font-semibold text-err hover:bg-paper-2 disabled:opacity-60"
            >
              Decline
            </button>
          )}
          {allowed.cancel && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setReasonMode({ bookingId: booking.id, action: 'cancel' });
                setReasonText('');
                setConfirmingId(null);
              }}
              className="min-h-11 border border-err/70 bg-card px-3.5 text-xs font-semibold text-err hover:bg-paper-2 disabled:opacity-60"
            >
              Cancel booking
            </button>
          )}
        </div>

        {isConfirming && (
          <div className="border border-ink bg-paper p-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-ink">
                Choose slots for {booking.party_size} guests at{' '}
                {formatTimeValue(booking.start_time)}
              </p>
              <p
                className={`font-mono text-xs ${
                  selectedSeats >= booking.party_size
                    ? 'text-ok'
                    : 'text-brass-text'
                }`}
              >
                Selected seats: {selectedSeats} / {booking.party_size}
              </p>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {slots.map((slot) => {
                const occupied = isSlotOccupiedForBooking(
                  slot.id,
                  booking.start_time,
                  bookings,
                  booking.id,
                );
                const checked = chosenSlotIds.includes(slot.id);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleSlotSelection(slot.id)}
                    className={`min-h-11 border px-2.5 py-1.5 text-left font-mono text-xs transition-colors ${
                      checked
                        ? 'border-ink bg-ink text-paper'
                        : occupied
                          ? 'border-err/40 bg-paper-2 text-ink-2'
                          : 'border-ink/40 bg-card text-ink hover:bg-paper-2'
                    }`}
                  >
                    <span className="block font-medium">{slot.label}</span>
                    <span className="block text-[10px] opacity-85">
                      {slot.seats} seats{occupied ? ' · busy' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || chosenSlotIds.length === 0}
                onClick={() =>
                  void runBookingPatch(
                    booking.id,
                    { action: 'confirm', slotIds: chosenSlotIds },
                    `Booking ${booking.code} confirmed.`,
                  )
                }
                className="min-h-11 border border-ok bg-ok px-4 text-xs font-semibold text-paper disabled:opacity-50"
              >
                {busy ? 'Confirming...' : 'Confirm booking'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmingId(null);
                  setChosenSlotIds([]);
                }}
                className="min-h-11 border border-ink/40 bg-card px-3.5 text-xs font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
              >
                Cancel selection
              </button>
            </div>
          </div>
        )}

        {renderReasonForm(booking)}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/20 pb-4">
        <div>
          <p className="ph-label text-brass-text">
            {formatShortDate(selectedDate)} · 16 slots
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">Bookings</h1>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={() => setSelectedDate((date) => shiftDate(date, -1))}
            className="min-h-11 border border-ink/40 bg-card px-3 text-xs font-semibold text-ink hover:bg-paper-2"
            aria-label="Previous day"
          >
            Prev
          </button>
          <label className="text-xs font-semibold text-ink-2">
            Date
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                if (event.target.value) setSelectedDate(event.target.value);
              }}
              className="mt-1 block min-h-11 border border-ink bg-card px-3 text-sm text-ink"
            />
          </label>
          <button
            type="button"
            onClick={() => setSelectedDate((date) => shiftDate(date, 1))}
            className="min-h-11 border border-ink/40 bg-card px-3 text-xs font-semibold text-ink hover:bg-paper-2"
            aria-label="Next day"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(todayInKolkata())}
            className="min-h-11 border border-ink/40 bg-card px-3 text-xs font-semibold text-ink hover:bg-paper-2"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setShowWalkInForm((open) => !open)}
            className="min-h-11 border border-ink bg-ink px-4 text-xs font-semibold text-paper"
          >
            {showWalkInForm ? 'Close form' : 'New walk-in / phone booking'}
          </button>
        </div>
      </div>

      {actionSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="border border-ok bg-card p-3.5 text-sm text-ok"
        >
          {actionSuccess}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border border-err bg-card p-4 text-sm text-err"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void fetchBookings()}
            className="min-h-11 border border-err bg-card px-3.5 font-semibold text-err hover:bg-paper-2"
          >
            Try again
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="border border-err bg-card p-3.5 text-sm text-err"
        >
          {actionError}
        </div>
      )}

      {showWalkInForm && (
        <section
          aria-labelledby="walkin-booking-heading"
          className="border border-ink bg-card p-4 sm:p-5 shadow-ledger"
        >
          <h2 id="walkin-booking-heading" className="font-display text-2xl">
            Walk-in or phone booking
          </h2>
          <p className="mt-1 text-xs text-ink-2">
            Uses café booking hours and availability rules. Parties of 7 to 12
            are saved as requested for slot assignment.
          </p>

          <form
            onSubmit={(event) => void handleWalkInSubmit(event)}
            className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <label className="text-xs font-semibold text-ink">
              Guest name
              <input
                type="text"
                required
                maxLength={60}
                value={walkInName}
                onChange={(event) => setWalkInName(event.target.value)}
                className="mt-1 min-h-11 w-full border border-ink bg-paper px-3 text-sm text-ink"
              />
            </label>

            <label className="text-xs font-semibold text-ink">
              Phone (10 digits or +91)
              <input
                type="tel"
                required
                value={walkInPhone}
                onChange={(event) => setWalkInPhone(event.target.value)}
                placeholder="+919876543210"
                className="mt-1 min-h-11 w-full border border-ink bg-paper px-3 text-sm text-ink"
              />
            </label>

            <label className="text-xs font-semibold text-ink">
              Email (optional)
              <input
                type="email"
                value={walkInEmail}
                onChange={(event) => setWalkInEmail(event.target.value)}
                className="mt-1 min-h-11 w-full border border-ink bg-paper px-3 text-sm text-ink"
              />
            </label>

            <label className="text-xs font-semibold text-ink">
              Date
              <input
                type="date"
                required
                value={walkInDate}
                onChange={(event) => setWalkInDate(event.target.value)}
                className="mt-1 min-h-11 w-full border border-ink bg-paper px-3 text-sm text-ink"
              />
            </label>

            <label className="text-xs font-semibold text-ink">
              Start time
              <select
                value={walkInTime}
                onChange={(event) => setWalkInTime(event.target.value)}
                className="mt-1 min-h-11 w-full border border-ink bg-paper px-3 text-sm text-ink"
              >
                {WALKIN_TIME_OPTIONS.map((timeOption) => (
                  <option key={timeOption} value={timeOption}>
                    {formatTimeValue(timeOption)} ({timeOption})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold text-ink">
              Party size (1 to 12)
              <input
                type="number"
                min={1}
                max={12}
                required
                value={walkInParty}
                onChange={(event) =>
                  setWalkInParty(
                    Math.min(12, Math.max(1, Number(event.target.value) || 1)),
                  )
                }
                className="mt-1 min-h-11 w-full border border-ink bg-paper px-3 text-sm text-ink"
              />
            </label>

            <label className="text-xs font-semibold text-ink">
              Occasion
              <select
                value={walkInOccasion}
                onChange={(event) =>
                  setWalkInOccasion(event.target.value as typeof walkInOccasion)
                }
                className="mt-1 min-h-11 w-full border border-ink bg-paper px-3 text-sm text-ink"
              >
                {BOOKING_OCCASION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold text-ink sm:col-span-2">
              Notes (optional, max 200 characters)
              <input
                type="text"
                maxLength={200}
                value={walkInNotes}
                onChange={(event) => setWalkInNotes(event.target.value)}
                className="mt-1 min-h-11 w-full border border-ink bg-paper px-3 text-sm text-ink"
              />
            </label>

            {(walkInError || walkInRuleErrors.length > 0) && (
              <div
                role="alert"
                className="border border-err bg-paper p-3 text-xs text-err sm:col-span-2 lg:col-span-3"
              >
                {walkInError && <p className="font-semibold">{walkInError}</p>}
                {walkInRuleErrors.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {walkInRuleErrors.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
              <button
                type="submit"
                disabled={walkInBusy}
                className="min-h-11 border border-ink bg-ink px-5 text-sm font-semibold text-paper disabled:opacity-60"
              >
                {walkInBusy ? 'Creating booking...' : 'Create booking'}
              </button>
              <button
                type="button"
                disabled={walkInBusy}
                onClick={() => setShowWalkInForm(false)}
                className="min-h-11 border border-ink/40 bg-card px-4 text-sm font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Tablet and desktop 16-slot timeline */}
      <section
        aria-labelledby="slot-timeline-heading"
        className="hidden border border-ink bg-card p-4 md:block"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/20 pb-3">
          <div>
            <h2 id="slot-timeline-heading" className="font-display text-2xl">
              Slot timeline
            </h2>
            <p className="text-xs text-ink-2">
              Slots S1 to S16 in 30-minute steps. Each block covers 90 minutes.
              Click a block to inspect details.
            </p>
          </div>
          <p className="font-mono text-xs text-ink-2">
            {bookings.length} {bookings.length === 1 ? 'booking' : 'bookings'}{' '}
            on {selectedDate}
          </p>
        </div>

        {loading && slots.length === 0 ? (
          <p className="py-8 text-sm text-ink-2">Loading slot timeline...</p>
        ) : slots.length === 0 ? (
          <p className="py-8 text-sm text-ink-2">
            Slot schedule is unavailable for this date.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto pb-2">
            <div className="min-w-[1180px]">
              <div
                className="grid border-b border-ink/25 pb-1.5"
                style={{
                  gridTemplateColumns: `124px repeat(${timeline.columns.length}, minmax(34px, 1fr))`,
                }}
              >
                <div className="ph-label px-2 text-ink-2">Slot</div>
                {timeline.columns.map((column, index) => (
                  <div
                    key={column}
                    className="border-l border-ink/10 px-1 font-mono text-[10px] text-ink-2"
                  >
                    {index % 2 === 0 ? column : ''}
                  </div>
                ))}
              </div>

              <div className="divide-y divide-ink/15">
                {timeline.rows.map((row) => (
                  <div
                    key={row.id}
                    className="grid items-stretch"
                    style={{
                      gridTemplateColumns: `124px repeat(${timeline.columns.length}, minmax(34px, 1fr))`,
                    }}
                  >
                    <div className="flex min-h-11 flex-col justify-center bg-paper-2/40 px-2 py-1">
                      <span className="font-mono text-xs font-medium text-ink">
                        {row.label}
                      </span>
                      <span className="font-mono text-[10px] text-ink-2">
                        {row.seats} seats
                      </span>
                    </div>

                    <div
                      className="relative col-span-full col-start-2 grid min-h-11 items-center"
                      style={{
                        gridTemplateColumns: `repeat(${timeline.columns.length}, minmax(34px, 1fr))`,
                      }}
                    >
                      {timeline.columns.map((column) => (
                        <div
                          key={column}
                          className="h-full border-l border-ink/10"
                          aria-hidden="true"
                        />
                      ))}

                      {row.blocks.map((block) => {
                        const isSelected =
                          selectedBookingId === block.bookingId;
                        return (
                          <button
                            key={`${row.id}-${block.bookingId}`}
                            type="button"
                            onClick={() =>
                              setSelectedBookingId(block.bookingId)
                            }
                            style={{
                              gridColumn: `${block.startColumn + 1} / span ${block.columnSpan}`,
                              gridRow: 1,
                            }}
                            className={`z-10 mx-0.5 my-1 flex min-h-9 items-center justify-between gap-1 overflow-hidden border px-1.5 text-left font-mono text-[10px] font-medium transition-colors ${timelineBlockClass(block.status, isSelected)}`}
                            title={`${block.code} (${block.partySize} guests, ${block.status})`}
                          >
                            <span className="truncate">{block.code}</span>
                            <span className="shrink-0">{block.partySize}p</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Selected booking details drawer/card (tablet and desktop) */}
      {selectedBooking && (
        <section
          aria-labelledby="selected-booking-heading"
          className="border border-ink bg-card p-4 sm:p-5 shadow-ledger"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink/20 pb-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-medium text-ink">
                  {selectedBooking.code}
                </span>
                <BookingStatusBadge status={selectedBooking.status} />
              </div>
              <h2
                id="selected-booking-heading"
                className="mt-1 font-display text-2xl"
              >
                {selectedBooking.name} · {selectedBooking.party_size}{' '}
                {selectedBooking.party_size === 1 ? 'guest' : 'guests'}
              </h2>
              <p className="mt-0.5 font-mono text-xs text-ink-2">
                {formatTimeValue(selectedBooking.start_time)} (90 min) ·{' '}
                {selectedBooking.phone}
                {selectedBooking.email ? ` · ${selectedBooking.email}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedBookingId(null)}
              className="min-h-11 border border-ink/40 bg-card px-3 text-xs font-semibold text-ink hover:bg-paper-2"
            >
              Close details
            </button>
          </div>

          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <p>
              <span className="ph-label text-ink-2">Slots:</span>{' '}
              <span className="font-mono text-xs">
                {selectedBooking.slotLabels.length > 0
                  ? selectedBooking.slotLabels.join(', ')
                  : 'Unassigned'}
              </span>
            </p>
            {selectedBooking.occasion && (
              <p>
                <span className="ph-label text-ink-2">Occasion:</span>{' '}
                {selectedBooking.occasion.replaceAll('_', ' ')}
              </p>
            )}
            {selectedBooking.notes && (
              <p className="sm:col-span-2">
                <span className="ph-label text-ink-2">Notes:</span>{' '}
                {selectedBooking.notes}
              </p>
            )}
            {selectedBooking.decline_reason && (
              <p className="text-err sm:col-span-2">
                Decline reason: {selectedBooking.decline_reason}
              </p>
            )}
            {selectedBooking.cancel_reason && (
              <p className="text-err sm:col-span-2">
                Cancel reason: {selectedBooking.cancel_reason}
              </p>
            )}
          </div>

          {renderPreorder(selectedBooking)}
          {renderBookingActions(selectedBooking)}
        </section>
      )}

      {/* Requested bookings needing slot assignment */}
      <section
        aria-labelledby="requested-bookings-heading"
        className="border border-ink bg-card p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/20 pb-3">
          <div>
            <h2
              id="requested-bookings-heading"
              className="font-display text-2xl"
            >
              Requested bookings ({requestedBookings.length})
            </h2>
            <p className="text-xs text-ink-2">
              Larger groups waiting for slot confirmation or a decline reason.
            </p>
          </div>
        </div>

        {loading && bookings.length === 0 ? (
          <p className="py-6 text-sm text-ink-2">Loading requests...</p>
        ) : requestedBookings.length === 0 ? (
          <p className="py-6 text-sm text-ink-2">
            No pending requested bookings for {formatShortDate(selectedDate)}.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {requestedBookings.map((booking) => (
              <article
                key={booking.id}
                className="border border-warn/60 bg-paper/60 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-medium text-ink">
                        {formatTimeValue(booking.start_time)}
                      </span>
                      <span className="font-mono text-xs text-ink-2">
                        {booking.code}
                      </span>
                      <BookingStatusBadge status={booking.status} />
                    </div>
                    <p className="mt-1 font-semibold text-ink">
                      {booking.name} · {booking.party_size} guests
                    </p>
                    <p className="font-mono text-xs text-ink-2">
                      {booking.phone}
                      {booking.email ? ` · ${booking.email}` : ''}
                    </p>
                  </div>
                </div>
                {booking.notes && (
                  <p className="mt-2 text-xs text-ink">Note: {booking.notes}</p>
                )}
                {renderPreorder(booking)}
                {renderBookingActions(booking)}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Phone vertical list grouped by time (and full day list below timeline) */}
      <section
        aria-labelledby="bookings-by-time-heading"
        className="border border-ink bg-card p-4 sm:p-5 md:hidden"
      >
        <h2 id="bookings-by-time-heading" className="font-display text-2xl">
          Schedule by time
        </h2>
        {loading && bookings.length === 0 ? (
          <p className="py-6 text-sm text-ink-2">Loading schedule...</p>
        ) : groupedByTime.length === 0 ? (
          <p className="py-6 text-sm text-ink-2">
            No bookings scheduled for {formatShortDate(selectedDate)}.
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {groupedByTime.map((group) => (
              <div key={group.time}>
                <h3 className="ph-label border-b border-ink/20 pb-1.5 text-brass-text">
                  {group.label}
                </h3>
                <div className="mt-2.5 space-y-3">
                  {group.bookings.map((booking) => (
                    <article
                      key={booking.id}
                      className="border border-ink/30 bg-paper p-3.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-ink-2">
                            {booking.code}
                          </p>
                          <p className="font-semibold text-ink">
                            {booking.name} · {booking.party_size}{' '}
                            {booking.party_size === 1 ? 'guest' : 'guests'}
                          </p>
                          <p className="font-mono text-xs text-ink-2">
                            {booking.phone}
                          </p>
                          {booking.slotLabels.length > 0 && (
                            <p className="mt-1 font-mono text-xs text-ink">
                              {booking.slotLabels.join(', ')}
                            </p>
                          )}
                        </div>
                        <BookingStatusBadge status={booking.status} />
                      </div>
                      {booking.notes && (
                        <p className="mt-2 text-xs text-ink">
                          Note: {booking.notes}
                        </p>
                      )}
                      {renderPreorder(booking)}
                      {renderBookingActions(booking)}
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Compact all-bookings summary for desktop/tablet so cancelled/declined are also inspectable */}
      <section
        aria-labelledby="all-day-bookings-heading"
        className="hidden border border-ink/25 bg-card p-4 md:block"
      >
        <h2 id="all-day-bookings-heading" className="font-display text-xl">
          All bookings on {formatShortDate(selectedDate)}
        </h2>
        {loading && bookings.length === 0 ? (
          <p className="py-4 text-sm text-ink-2">Loading bookings...</p>
        ) : bookings.length === 0 ? (
          <p className="py-4 text-sm text-ink-2">
            No bookings on record for this date.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-ink/25 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Guest</th>
                  <th className="py-2 pr-3">Party</th>
                  <th className="py-2 pr-3">Slots</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/15">
                {bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td className="py-2.5 pr-3 font-mono text-xs">
                      {formatTimeValue(booking.start_time)}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">
                      {booking.code}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold">
                      {booking.name}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">
                      {booking.party_size}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">
                      {booking.slotLabels.length > 0
                        ? booking.slotLabels.join(', ')
                        : '—'}
                    </td>
                    <td className="py-2.5 pr-3">
                      <BookingStatusBadge status={booking.status} />
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedBookingId(booking.id)}
                        className="min-h-11 border border-ink/35 bg-paper px-3 text-xs font-semibold text-ink hover:bg-paper-2"
                        aria-label={`Inspect booking ${booking.code} (${BOOKING_STATUS_LABELS[booking.status]})`}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
