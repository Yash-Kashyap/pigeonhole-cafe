import { useCallback, useEffect, useState } from 'react';
import type { OrderStatus } from '../../lib/owner/rules';
import { ownerGetJson, ownerWriteJson } from '../../lib/owner-api';
import {
  ORDER_CANCEL_REASONS,
  ORDER_STATUS_LABELS,
  buildOrderReadyWhatsAppUrl,
  canCancelOrder,
  formatRelativePickup,
  formatTimeSince,
  formatTimeValue,
  formatUsd,
  getNextOrderAction,
  todayInKolkata,
  type OrderCancelReason,
  type OwnerOrder,
  type OwnerOrdersResponse,
} from '../../lib/owner-dashboard';
import { OrderStatusBadge } from './OwnerBadges';
import { useOwnerRealtime, type RealtimeTable } from './useOwnerRealtime';

const ORDERS_TABLES: readonly RealtimeTable[] = ['orders', 'order_items'];
const KANBAN_COLUMNS: ReadonlyArray<{ status: OrderStatus; title: string }> = [
  { status: 'new', title: 'New' },
  { status: 'preparing', title: 'Preparing' },
  { status: 'ready', title: 'Ready' },
  { status: 'collected', title: 'Collected' },
];
const PHONE_STATUS_TABS: ReadonlyArray<{
  value: '' | OrderStatus;
  label: string;
}> = [
  { value: '', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready' },
  { value: 'collected', label: 'Collected' },
  { value: 'cancelled', label: 'Cancelled' },
];

type Props = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

type OrderCardProps = {
  order: OwnerOrder;
  now: Date;
  busy: boolean;
  cancelling: boolean;
  cancelReason: OrderCancelReason;
  onStartCancel: () => void;
  onAbortCancel: () => void;
  onChangeCancelReason: (reason: OrderCancelReason) => void;
  onConfirmCancel: () => void;
  onAdvance: (nextStatus: 'preparing' | 'ready' | 'collected') => void;
};

function OrderCard({
  order,
  now,
  busy,
  cancelling,
  cancelReason,
  onStartCancel,
  onAbortCancel,
  onChangeCancelReason,
  onConfirmCancel,
  onAdvance,
}: OrderCardProps) {
  const nextAction = getNextOrderAction(order.status);
  const cancellable = canCancelOrder(order.status);
  const whatsAppUrl = buildOrderReadyWhatsAppUrl(order.phone, order.code);

  return (
    <article
      data-order-card={order.code}
      data-order-status={order.status}
      className="min-w-0 border border-ink bg-card p-3.5 shadow-ledger"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium text-ink break-all">
            {order.code}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{order.name}</p>
          <p className="font-mono text-xs text-ink-2">{order.phone}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-y border-ink/15 py-2 text-xs">
        <p className="font-medium text-ink">
          Pickup {formatTimeValue(order.pickup_at)}{' '}
          <span className="font-mono text-brass-text">
            ({formatRelativePickup(order.pickup_at, now)})
          </span>
        </p>
        <p className="font-mono text-ink-2">
          Placed {formatTimeSince(order.created_at, now)}
        </p>
      </div>

      <ul className="mt-2.5 space-y-1.5 text-sm">
        {order.order_items.length === 0 ? (
          <li className="text-xs text-ink-2">No line items recorded.</li>
        ) : (
          order.order_items.map((item) => (
            <li key={item.id} className="leading-snug">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 text-ink">
                  <span className="font-mono text-xs font-medium">
                    {item.qty}×
                  </span>{' '}
                  {item.name_snapshot}
                </span>
                <span className="shrink-0 font-mono text-xs text-ink-2">
                  {formatUsd(Number(item.price_snapshot) * item.qty)}
                </span>
              </div>
              {item.note && (
                <p className="mt-0.5 pl-4 text-xs text-brass-text">
                  Note: {item.note}
                </p>
              )}
            </li>
          ))
        )}
      </ul>

      {order.notes && (
        <p className="mt-2.5 border-l-2 border-brass-dark bg-paper-2/60 px-2.5 py-1.5 text-xs text-ink">
          Order note: {order.notes}
        </p>
      )}

      {order.status === 'cancelled' && order.cancel_reason && (
        <p className="mt-2 text-xs text-err">
          Cancel reason: {order.cancel_reason.replaceAll('_', ' ')}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-ink/15 pt-2.5 text-sm">
        <span className="ph-label text-ink-2">Subtotal</span>
        <span className="font-mono font-medium text-ink">
          {formatUsd(order.subtotal)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {nextAction && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdvance(nextAction.nextStatus)}
            className="min-h-11 flex-1 border border-ink bg-ink px-3 text-xs font-semibold text-paper transition-transform active:translate-y-px disabled:opacity-60"
          >
            {busy ? 'Saving...' : nextAction.label}
          </button>
        )}

        {cancellable && !cancelling && (
          <button
            type="button"
            disabled={busy}
            onClick={onStartCancel}
            className="min-h-11 border border-err/70 bg-card px-3 text-xs font-semibold text-err hover:bg-paper-2 disabled:opacity-60"
          >
            Cancel
          </button>
        )}

        {whatsAppUrl && (
          <a
            href={whatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center border border-ok/70 bg-card px-3 text-xs font-semibold text-ok no-underline hover:bg-paper-2"
          >
            Message on WhatsApp
          </a>
        )}
      </div>

      {cancelling && (
        <div className="mt-3 space-y-2 border border-err/50 bg-paper p-3">
          <label className="block text-xs font-semibold text-ink">
            Cancellation reason
            <select
              value={cancelReason}
              onChange={(event) =>
                onChangeCancelReason(event.target.value as OrderCancelReason)
              }
              disabled={busy}
              className="mt-1 min-h-11 w-full border border-ink bg-card px-2.5 text-sm text-ink"
            >
              {ORDER_CANCEL_REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirmCancel}
              className="min-h-11 border border-err bg-err px-3 text-xs font-semibold text-paper disabled:opacity-60"
            >
              {busy ? 'Cancelling...' : 'Confirm cancel'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onAbortCancel}
              className="min-h-11 border border-ink/40 bg-card px-3 text-xs font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
            >
              Keep order
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export default function OwnerOrders({ supabaseUrl, supabaseAnonKey }: Props) {
  const [orders, setOrders] = useState<OwnerOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] =
    useState<OrderCancelReason>('customer_request');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  const fetchOrders = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const params = new URLSearchParams();
      params.set('page', String(page));
      if (dateFilter) params.set('date', dateFilter);
      if (statusFilter) params.set('status', statusFilter);

      const result = await ownerGetJson<OwnerOrdersResponse>(
        `/api/owner/orders?${params.toString()}`,
      );
      if (!result.ok) {
        if (result.status !== 0) setError(result.message);
        setLoading(false);
        return;
      }
      setError(null);
      setOrders(result.data.orders);
      setTotal(result.data.total);
      setPageSize(result.data.pageSize);
      setLoading(false);
    },
    [dateFilter, page, statusFilter],
  );

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  useOwnerRealtime({
    supabaseUrl,
    supabaseAnonKey,
    tables: ORDERS_TABLES,
    onTableChange: () => {
      void fetchOrders({ silent: true });
    },
    onReconnect: () => {
      void fetchOrders({ silent: true });
    },
    onFallbackPoll: () => {
      void fetchOrders({ silent: true });
    },
  });

  const handleAdvance = async (
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
    void fetchOrders({ silent: true });
  };

  const handleConfirmCancel = async (orderId: string) => {
    if (busyIds[orderId]) return;
    setBusyIds((prev) => ({ ...prev, [orderId]: true }));
    setActionError(null);
    const result = await ownerWriteJson<{
      order: { code: string; status: string };
    }>(`/api/owner/orders/${orderId}`, 'PATCH', {
      status: 'cancelled',
      cancel_reason: cancelReason,
    });
    setBusyIds((prev) => ({ ...prev, [orderId]: false }));
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    setCancelTargetId(null);
    void fetchOrders({ silent: true });
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cancelledOrders = orders.filter(
    (order) => order.status === 'cancelled',
  );

  const renderCard = (order: OwnerOrder) => (
    <OrderCard
      key={order.id}
      order={order}
      now={now}
      busy={Boolean(busyIds[order.id])}
      cancelling={cancelTargetId === order.id}
      cancelReason={cancelReason}
      onStartCancel={() => {
        setCancelTargetId(order.id);
        setCancelReason('customer_request');
      }}
      onAbortCancel={() => setCancelTargetId(null)}
      onChangeCancelReason={setCancelReason}
      onConfirmCancel={() => void handleConfirmCancel(order.id)}
      onAdvance={(nextStatus) => void handleAdvance(order.id, nextStatus)}
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/20 pb-4">
        <div>
          <p className="ph-label text-brass-text">Takeaway queue</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">Orders</h1>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-ink-2">
            Pickup date
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => {
                setDateFilter(event.target.value);
                setPage(1);
              }}
              className="mt-1 block min-h-11 border border-ink bg-card px-3 text-sm text-ink"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setDateFilter(todayInKolkata());
              setPage(1);
            }}
            className="min-h-11 border border-ink/40 bg-card px-3 text-xs font-semibold text-ink hover:bg-paper-2"
          >
            Today
          </button>
          {dateFilter && (
            <button
              type="button"
              onClick={() => {
                setDateFilter('');
                setPage(1);
              }}
              className="min-h-11 border border-ink/40 bg-card px-3 text-xs font-semibold text-ink hover:bg-paper-2"
            >
              All dates
            </button>
          )}
          <label className="hidden text-xs font-semibold text-ink-2 md:block">
            Status filter
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as '' | OrderStatus);
                setPage(1);
              }}
              className="mt-1 block min-h-11 border border-ink bg-card px-3 text-sm text-ink"
            >
              {PHONE_STATUS_TABS.map((tab) => (
                <option key={tab.label} value={tab.value}>
                  {tab.value ? tab.label : 'All statuses'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void fetchOrders()}
            disabled={loading}
            className="min-h-11 border border-ink bg-card px-3.5 text-sm font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Status filter tabs for phones */}
      <div
        role="tablist"
        aria-label="Filter orders by status"
        className="flex gap-1.5 overflow-x-auto pb-1 md:hidden"
      >
        {PHONE_STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.value;
          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setStatusFilter(tab.value);
                setPage(1);
              }}
              className={`min-h-11 shrink-0 border px-3 text-xs font-semibold uppercase tracking-[0.05em] ${
                active
                  ? 'border-ink bg-ink text-paper'
                  : 'border-ink/35 bg-card text-ink hover:bg-paper-2'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border border-err bg-card p-4 text-sm text-err"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void fetchOrders()}
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

      {loading && orders.length === 0 ? (
        <div className="border border-ink/20 bg-card p-8 text-sm text-ink-2">
          Loading orders...
        </div>
      ) : orders.length === 0 ? (
        <div className="border border-ink/20 bg-card p-8 text-sm text-ink-2">
          No orders match these filters.
        </div>
      ) : (
        <>
          {/* Phone single-column list */}
          <div className="space-y-3 md:hidden">{orders.map(renderCard)}</div>

          {/* Tablet and desktop Kanban columns (or filtered grid when viewing Cancelled) */}
          <div className="hidden md:block">
            {statusFilter === 'cancelled' ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {orders.map(renderCard)}
              </div>
            ) : (
              <div className="space-y-5">
                <div
                  data-orders-kanban
                  className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
                >
                  {KANBAN_COLUMNS.map((column) => {
                    const columnOrders = orders.filter(
                      (order) => order.status === column.status,
                    );
                    return (
                      <section
                        key={column.status}
                        aria-label={`${column.title} orders`}
                        className="min-w-0 border border-ink/25 bg-paper-2/50 p-3"
                      >
                        <header className="mb-3 flex items-center justify-between border-b border-ink/20 pb-2">
                          <h2 className="font-display text-xl">
                            {column.title}
                          </h2>
                          <span className="border border-ink/30 bg-card px-2 py-0.5 font-mono text-xs text-ink">
                            {columnOrders.length}
                          </span>
                        </header>
                        {columnOrders.length === 0 ? (
                          <p className="py-6 text-center text-xs text-ink-2">
                            No{' '}
                            {ORDER_STATUS_LABELS[column.status].toLowerCase()}{' '}
                            orders on this page.
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {columnOrders.map(renderCard)}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>

                {cancelledOrders.length > 0 && (
                  <details className="border border-ink/25 bg-paper-2/40 p-3">
                    <summary className="cursor-pointer font-mono text-xs font-medium uppercase tracking-[0.06em] text-ink-2">
                      Cancelled on this page ({cancelledOrders.length})
                    </summary>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {cancelledOrders.map(renderCard)}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <nav
        aria-label="Orders pagination"
        className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/20 pt-4 text-sm"
      >
        <p className="font-mono text-xs text-ink-2">
          Showing page {page} of {totalPages} ({total} total{' '}
          {total === 1 ? 'order' : 'orders'})
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="min-h-11 border border-ink bg-card px-4 text-xs font-semibold text-ink hover:bg-paper-2 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
            className="min-h-11 border border-ink bg-card px-4 text-xs font-semibold text-ink hover:bg-paper-2 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </nav>
    </div>
  );
}
