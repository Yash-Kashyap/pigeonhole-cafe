import { useCallback, useEffect, useRef, useState } from 'react';
import { ownerGetJson, ownerWriteJson } from '../../lib/owner-api';
import {
  formatRelativePickup,
  formatShortDate,
  formatTimeSince,
  formatTimeValue,
  formatUsd,
  getAllowedBookingActions,
  getNextOrderAction,
  type OwnerTodayResponse,
} from '../../lib/owner-dashboard';
import { BookingStatusBadge, OrderStatusBadge } from './OwnerBadges';
import { useOwnerRealtime, type RealtimeTable } from './useOwnerRealtime';

const SOUND_STORAGE_KEY = 'ph_owner_sound_v1';
const TODAY_TABLES: readonly RealtimeTable[] = [
  'orders',
  'order_items',
  'bookings',
];

function playOrderChime() {
  if (typeof window === 'undefined') return;
  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtor) return;
  try {
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.setValueAtTime(880, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.36);
    oscillator.onended = () => {
      void context.close();
    };
  } catch {
    // Ignore autoplay restrictions when the user has not interacted yet.
  }
}

type Props = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export default function OwnerToday({ supabaseUrl, supabaseAnonKey }: Props) {
  const [data, setData] = useState<OwnerTodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [newOrderBanner, setNewOrderBanner] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const seenNewOrderIds = useRef<Set<string> | null>(null);
  const soundEnabledRef = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SOUND_STORAGE_KEY);
      const enabled = saved === 'true';
      setSoundEnabled(enabled);
      soundEnabledRef.current = enabled;
    } catch {
      // Ignore storage access failures.
    }
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundEnabledRef.current = next;
    try {
      window.localStorage.setItem(SOUND_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures.
    }
  };

  const triggerNewOrderAlert = useCallback(() => {
    setNewOrderBanner(true);
    if (soundEnabledRef.current) {
      playOrderChime();
    }
  }, []);

  const fetchToday = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setLoading(true);
      }
      const result = await ownerGetJson<OwnerTodayResponse>('/api/owner/today');
      if (!result.ok) {
        if (result.status !== 0) {
          setError(result.message);
        }
        setLoading(false);
        return;
      }
      setError(null);
      setData(result.data);
      setLoading(false);

      const currentNewIds = result.data.latestOrders
        .filter((order) => order.status === 'new')
        .map((order) => order.id);

      if (seenNewOrderIds.current === null) {
        seenNewOrderIds.current = new Set(currentNewIds);
      } else {
        const hasUnseen = currentNewIds.some(
          (id) => !seenNewOrderIds.current?.has(id),
        );
        for (const id of currentNewIds) {
          seenNewOrderIds.current.add(id);
        }
        if (hasUnseen) {
          triggerNewOrderAlert();
        }
      }
    },
    [triggerNewOrderAlert],
  );

  useEffect(() => {
    void fetchToday();
  }, [fetchToday]);

  const handleRealtimeChange = useCallback(
    (table: RealtimeTable, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => {
      if (table === 'orders' && eventType === 'INSERT') {
        triggerNewOrderAlert();
      }
      void fetchToday({ silent: true });
    },
    [fetchToday, triggerNewOrderAlert],
  );

  useOwnerRealtime({
    supabaseUrl,
    supabaseAnonKey,
    tables: TODAY_TABLES,
    onTableChange: handleRealtimeChange,
    onReconnect: () => {
      void fetchToday({ silent: true });
    },
    onFallbackPoll: () => {
      void fetchToday({ silent: true });
    },
  });

  const handleAdvanceOrder = async (
    orderId: string,
    nextStatus: 'preparing' | 'ready' | 'collected',
  ) => {
    if (busyIds[orderId]) return;
    setBusyIds((prev) => ({ ...prev, [orderId]: true }));
    setActionError(null);
    const result = await ownerWriteJson<{
      order: { code: string; status: string };
    }>(`/api/owner/orders/${orderId}`, 'PATCH', { status: nextStatus });
    setBusyIds((prev) => ({ ...prev, [orderId]: false }));
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    void fetchToday({ silent: true });
  };

  const handleBookingStatus = async (
    bookingId: string,
    action: 'seated' | 'no_show',
  ) => {
    if (busyIds[bookingId]) return;
    setBusyIds((prev) => ({ ...prev, [bookingId]: true }));
    setActionError(null);
    const result = await ownerWriteJson<{
      booking: { code: string; status: string };
    }>(`/api/owner/bookings/${bookingId}`, 'PATCH', { action });
    setBusyIds((prev) => ({ ...prev, [bookingId]: false }));
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    void fetchToday({ silent: true });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/20 pb-4">
        <div>
          <p className="ph-label text-brass-text">
            {data ? formatShortDate(data.date) : 'Counter overview'}
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">Today</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={soundEnabled}
            onClick={toggleSound}
            className={`min-h-11 border px-3.5 text-sm font-medium transition-colors ${
              soundEnabled
                ? 'border-ink bg-ink text-paper'
                : 'border-ink/40 bg-card text-ink hover:bg-paper-2'
            }`}
          >
            New order sound: {soundEnabled ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            onClick={() => void fetchToday()}
            disabled={loading}
            className="min-h-11 border border-ink bg-card px-3.5 text-sm font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      {newOrderBanner && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-3 border border-stamp bg-card p-4 shadow-ledger"
        >
          <div className="min-w-0">
            <p className="ph-label text-stamp">New order arrived</p>
            <p className="mt-1 text-sm text-ink">
              A new takeaway order is waiting on the counter board.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/owner/app/orders"
              className="inline-flex min-h-11 items-center border border-ink bg-ink px-4 text-sm font-semibold text-paper no-underline"
            >
              Open orders
            </a>
            <button
              type="button"
              onClick={() => setNewOrderBanner(false)}
              className="min-h-11 border border-ink/40 bg-card px-3.5 text-sm font-medium text-ink hover:bg-paper-2"
            >
              Dismiss
            </button>
          </div>
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
            onClick={() => void fetchToday()}
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

      <section aria-label="Today summary metrics">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="border border-ink bg-card p-4 shadow-ledger">
            <p className="ph-label text-brass-text">New orders</p>
            <p className="mt-2 font-display text-3xl sm:text-4xl">
              {loading && !data ? '—' : (data?.stats.newOrders ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ink-2">Waiting for kitchen</p>
          </div>

          <div className="border border-ink bg-card p-4 shadow-ledger">
            <p className="ph-label text-brass-text">Bookings today</p>
            <p className="mt-2 font-display text-3xl sm:text-4xl">
              {loading && !data ? '—' : (data?.stats.bookingsToday ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ink-2">
              Confirmed, requested, seated
            </p>
          </div>

          <div className="border border-ink bg-card p-4 shadow-ledger">
            <p className="ph-label text-brass-text">Seats booked tonight</p>
            <p className="mt-2 font-display text-3xl sm:text-4xl">
              {loading && !data ? '—' : (data?.stats.seatsBookedTonight ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ink-2">From 5:00 PM onward</p>
          </div>

          <div className="border border-ink bg-card p-4 shadow-ledger">
            <p className="ph-label text-brass-text">Unanswered questions</p>
            <p className="mt-2 font-display text-3xl sm:text-4xl">
              {loading && !data ? '—' : (data?.stats.unansweredQuestions ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ink-2">Logged for later review</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="today-next-bookings-heading"
          className="border border-ink bg-card p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/20 pb-3">
            <div>
              <h2
                id="today-next-bookings-heading"
                className="font-display text-2xl"
              >
                Next 5 bookings
              </h2>
              <p className="text-xs text-ink-2">
                Upcoming confirmed and requested tables today
              </p>
            </div>
            <a
              href="/owner/app/bookings"
              className="inline-flex min-h-11 items-center border border-ink/35 px-3 text-xs font-semibold uppercase tracking-[0.06em] text-ink no-underline hover:bg-paper-2"
            >
              All bookings
            </a>
          </div>

          {loading && !data ? (
            <p className="py-8 text-sm text-ink-2">Loading bookings...</p>
          ) : !data || data.nextBookings.length === 0 ? (
            <p className="py-8 text-sm text-ink-2">
              No remaining bookings on the schedule for today.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-ink/15">
              {data.nextBookings.map((booking) => {
                const actions = getAllowedBookingActions(booking.status);
                const busy = Boolean(busyIds[booking.id]);
                return (
                  <li key={booking.id} className="py-3.5 first:pt-1 last:pb-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
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
                          {booking.name} · {booking.party_size}{' '}
                          {booking.party_size === 1 ? 'guest' : 'guests'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {actions.seated && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleBookingStatus(booking.id, 'seated')
                            }
                            className="min-h-11 border border-ink bg-ink px-3 text-xs font-semibold text-paper disabled:opacity-60"
                          >
                            Mark seated
                          </button>
                        )}
                        {actions.noShow && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleBookingStatus(booking.id, 'no_show')
                            }
                            className="min-h-11 border border-ink/40 bg-card px-3 text-xs font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
                          >
                            No show
                          </button>
                        )}
                        {actions.confirm && (
                          <a
                            href="/owner/app/bookings"
                            className="inline-flex min-h-11 items-center border border-warn bg-warn/10 px-3 text-xs font-semibold text-warn no-underline hover:bg-paper-2"
                          >
                            Assign slots
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="today-latest-orders-heading"
          className="border border-ink bg-card p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/20 pb-3">
            <div>
              <h2
                id="today-latest-orders-heading"
                className="font-display text-2xl"
              >
                Latest 5 orders
              </h2>
              <p className="text-xs text-ink-2">
                Most recently placed takeaway orders
              </p>
            </div>
            <a
              href="/owner/app/orders"
              className="inline-flex min-h-11 items-center border border-ink/35 px-3 text-xs font-semibold uppercase tracking-[0.06em] text-ink no-underline hover:bg-paper-2"
            >
              All orders
            </a>
          </div>

          {loading && !data ? (
            <p className="py-8 text-sm text-ink-2">Loading orders...</p>
          ) : !data || data.latestOrders.length === 0 ? (
            <p className="py-8 text-sm text-ink-2">
              No orders have been placed yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-ink/15">
              {data.latestOrders.map((order) => {
                const nextAction = getNextOrderAction(order.status);
                const busy = Boolean(busyIds[order.id]);
                return (
                  <li key={order.id} className="py-3.5 first:pt-1 last:pb-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-medium text-ink">
                            {order.code}
                          </span>
                          <OrderStatusBadge status={order.status} />
                        </div>
                        <p className="mt-1 font-semibold text-ink">
                          {order.name} · {formatUsd(order.subtotal)}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-2">
                          Pickup {formatTimeValue(order.pickup_at)} (
                          {formatRelativePickup(order.pickup_at, now)}) · Placed{' '}
                          {formatTimeSince(order.created_at, now)}
                        </p>
                      </div>

                      {nextAction && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void handleAdvanceOrder(
                              order.id,
                              nextAction.nextStatus,
                            )
                          }
                          className="min-h-11 border border-ink bg-ink px-3 text-xs font-semibold text-paper disabled:opacity-60"
                        >
                          {busy ? 'Saving...' : nextAction.label}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
