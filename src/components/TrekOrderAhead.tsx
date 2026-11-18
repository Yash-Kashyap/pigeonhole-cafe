import { useEffect, useMemo, useState } from 'react';
import {
  CART_STORAGE_KEY,
  computeCartDetails,
  readCart,
  type CartItem,
} from '../lib/cart';
import type { MenuItem } from '../lib/menu';
import { buildPickupSlotIso } from '../lib/order-pickup';
import { formatReserveDate } from '../lib/reserve';
import {
  estimatedPrepMinutes,
  getPickupDates,
  getPickupWindow,
} from '../lib/rules';

type Props = {
  items: MenuItem[];
};

export default function TrekOrderAhead({ items }: Props) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const sync = () => setCart(readCart());
    const onStorage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) sync();
    };
    sync();
    window.addEventListener('storage', onStorage);
    window.addEventListener('ph-cart-change', sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('ph-cart-change', sync);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const cartDetails = useMemo(
    () => computeCartDetails(cart, items),
    [cart, items],
  );

  const prepMinutes = useMemo(
    () =>
      estimatedPrepMinutes(cartDetails.lines.map((line) => line.prepMinutes)),
    [cartDetails.lines],
  );

  const pickupDates = useMemo(
    () => getPickupDates(now, prepMinutes),
    [now, prepMinutes],
  );

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');

  useEffect(() => {
    if (
      !selectedDate ||
      !pickupDates.some(
        (entry) => entry.date === selectedDate && entry.available,
      )
    ) {
      const firstOpen = pickupDates.find((entry) => entry.available);
      setSelectedDate(firstOpen?.date ?? '');
    }
  }, [pickupDates, selectedDate]);

  const pickupWindow = useMemo(
    () => (selectedDate ? getPickupWindow(selectedDate, now, prepMinutes) : []),
    [selectedDate, now, prepMinutes],
  );

  useEffect(() => {
    if (
      !selectedTime ||
      !pickupWindow.some((opt) => opt.time === selectedTime && opt.available)
    ) {
      const firstTime = pickupWindow.find((opt) => opt.available);
      setSelectedTime(firstTime?.time ?? '');
    }
  }, [pickupWindow, selectedTime]);

  const chosenIso = useMemo(
    () =>
      selectedDate && selectedTime
        ? buildPickupSlotIso(selectedDate, selectedTime)
        : null,
    [selectedDate, selectedTime],
  );

  const orderHref = chosenIso
    ? `/order?pickup=${encodeURIComponent(chosenIso)}`
    : '/order';

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="border border-ink bg-card p-6 shadow-ledger lg:col-span-5">
        <div className="flex items-baseline justify-between gap-2 border-b border-ink/20 pb-3">
          <p className="ph-label text-brass-text">Your takeaway bag</p>
          <span
            data-trek-cart-count
            className="font-mono text-xs font-medium text-ink"
          >
            {cartDetails.itemCount}{' '}
            {cartDetails.itemCount === 1 ? 'item' : 'items'}
          </span>
        </div>

        {cartDetails.lines.length === 0 ? (
          <p className="mt-4 text-sm text-ink-2">
            Your bag is empty. Use Add on any dish above to pack your order
            ahead.
          </p>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-ink/15 text-sm">
              {cartDetails.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <span className="min-w-0 text-ink">
                    <span className="font-mono text-xs font-medium">
                      {line.quantity}×
                    </span>{' '}
                    {line.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink-2">
                    ${line.lineTotal.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-baseline justify-between border-t border-ink/20 pt-3">
              <span className="ph-label text-ink-2">Estimated subtotal</span>
              <span className="font-mono text-base font-semibold text-ink">
                ${cartDetails.subtotal.toFixed(2)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="border border-ink bg-card p-6 shadow-ledger lg:col-span-7">
        <p className="ph-label text-stamp">Ready when I reach</p>
        <h3 className="mt-1 font-display text-2xl">Choose a pickup time</h3>
        <p className="mt-2 text-sm text-ink-2">
          Takeaway only. Orders take 15 to 20 minutes. Pay at pickup.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="trek-pickup-date"
              className="ph-label block text-ink"
            >
              Pickup date
            </label>
            <select
              id="trek-pickup-date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink"
            >
              {pickupDates.map((entry) => (
                <option
                  key={entry.date}
                  value={entry.date}
                  disabled={!entry.available}
                >
                  {formatReserveDate(entry.date)}
                  {entry.available ? '' : ` — ${entry.reason ?? 'Unavailable'}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="trek-pickup-time"
              className="ph-label block text-ink"
            >
              Ready when I reach (15-min steps)
            </label>
            <select
              id="trek-pickup-time"
              value={selectedTime}
              disabled={pickupWindow.every((opt) => !opt.available)}
              onChange={(event) => setSelectedTime(event.target.value)}
              className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
            >
              {pickupWindow.length === 0 ? (
                <option value="">No pickup times on this date</option>
              ) : (
                pickupWindow.map((option) => (
                  <option
                    key={option.time}
                    value={option.time}
                    disabled={!option.available}
                  >
                    {option.label}
                    {option.available ? '' : ' (unavailable)'}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <a
            href={orderHref}
            data-trek-go-order
            className="inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-6 text-sm font-semibold text-paper no-underline transition active:translate-y-px hover:bg-ink-2"
          >
            Go to order
          </a>
          <a
            href="/reserve"
            className="text-sm font-semibold text-brass-text underline underline-offset-4 hover:text-ink"
          >
            Coming as a group? Reserve a slot and add a pre-order
          </a>
        </div>
      </div>
    </div>
  );
}
