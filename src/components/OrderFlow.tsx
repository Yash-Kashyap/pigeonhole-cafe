import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  addToCart,
  clearCart,
  computeCartDetails,
  getOftenAddedSuggestions,
  readCart,
  removeFromCart,
  setNote,
  setQuantity,
  type CartItem,
} from '../lib/cart';
import type { MenuItem } from '../lib/menu';
import { resolveOrderPickupParam } from '../lib/order-pickup';
import {
  estimatedPrepMinutes,
  getAsapPickup,
  getOpenState,
  getPickupDates,
  getPickupWindow,
  nearestValidPickup,
  validateOrder,
  type OrderLine,
} from '../lib/rules';

type Props = {
  items: MenuItem[];
};

const orderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(60, 'Name must be at most 60 characters.'),
  phone: z
    .string()
    .trim()
    .refine((val) => {
      const digits = val.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 13;
    }, 'Phone number must be between 10 and 13 digits.'),
  notes: z
    .string()
    .max(200, 'Kitchen notes cannot exceed 200 characters.')
    .optional(),
  consent: z.literal(true, {
    message:
      'Please confirm you understand this is a demo and no real order is placed.',
  }),
  honeypot: z.string().max(0, 'Bot submission rejected.').optional(),
});

// Intl formatters are expensive to build, and these two run once per pickup option.
const clockTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const dateLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

function formatClockTime(date: Date): string {
  return clockTimeFormatter.format(date);
}

function formatDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  const d = new Date(Date.UTC(year, month - 1, day, 0, 0) - 330 * 60_000);
  return dateLabelFormatter.format(d);
}

export default function OrderFlow({ items }: Props) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [mountedAt] = useState(() => Date.now());

  // Form inputs
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kitchenNotes, setKitchenNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  // Pickup selection state
  const [pickupMode, setPickupMode] = useState<'asap' | 'scheduled'>('asap');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [pickupReady, setPickupReady] = useState<boolean>(false);

  // Note editing state for cart items
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [itemNoteInput, setItemNoteInput] = useState<string>('');

  // Validation & submission feedback
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorSummary, setErrorSummary] = useState<string[]>([]);
  const [suggestedPickup, setSuggestedPickup] = useState<Date | null>(null);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Two very fast clicks can both arrive before the button is disabled, so the handler guards itself too.
  const submittingRef = useRef(false);
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);

  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const menuMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Sync cart from storage and apply any valid ?pickup= query parameter on mount
  useEffect(() => {
    const sync = () => setCart(readCart());
    const initialCart = readCart();
    setCart(initialCart);

    const initialDetails = computeCartDetails(initialCart, items);
    const initialPrep = estimatedPrepMinutes(
      initialDetails.lines.map((line) => line.prepMinutes),
    );
    const preselected = resolveOrderPickupParam(
      window.location.search,
      new Date(),
      initialPrep,
    );
    if (preselected) {
      setPickupMode('scheduled');
      setSelectedDate(preselected.date);
      setSelectedTime(preselected.time);
    }
    setPickupReady(true);

    window.addEventListener('storage', sync);
    window.addEventListener('ph-cart-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('ph-cart-change', sync);
    };
  }, [items]);

  // Update clock every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const cartDetails = useMemo(
    () => computeCartDetails(cart, items),
    [cart, items],
  );

  const prepMinutes = useMemo(() => {
    const list = cartDetails.lines.map((l) => l.prepMinutes);
    return estimatedPrepMinutes(list);
  }, [cartDetails.lines]);

  const openState = useMemo(() => getOpenState(now), [now]);
  const isClosed =
    openState.state === 'closed' || openState.state === 'last-orders-passed';

  const asapPickupDate = useMemo(
    () => getAsapPickup(now, prepMinutes),
    [now, prepMinutes],
  );

  const pickupDates = useMemo(
    () => getPickupDates(now, prepMinutes),
    [now, prepMinutes],
  );

  // Set default date when dates load
  useEffect(() => {
    if (!pickupReady) return;
    if (!selectedDate || !pickupDates.some((d) => d.date === selectedDate)) {
      const firstAvailable = pickupDates.find((d) => d.available);
      if (firstAvailable) {
        setSelectedDate(firstAvailable.date);
      } else if (pickupDates[0]) {
        setSelectedDate(pickupDates[0].date);
      }
    }
  }, [pickupDates, pickupReady, selectedDate]);

  const pickupWindow = useMemo(() => {
    if (!selectedDate) return [];
    return getPickupWindow(selectedDate, now, prepMinutes);
  }, [selectedDate, now, prepMinutes]);

  // Set default time when window loads
  useEffect(() => {
    if (!pickupReady) return;
    if (
      !selectedTime ||
      !pickupWindow.some((opt) => opt.time === selectedTime)
    ) {
      const firstAvailable = pickupWindow.find((opt) => opt.available);
      if (firstAvailable) {
        setSelectedTime(firstAvailable.time);
      } else if (pickupWindow[0]) {
        setSelectedTime(pickupWindow[0].time);
      }
    }
  }, [pickupReady, pickupWindow, selectedTime]);

  // Switch to scheduled mode if café is closed or last orders passed
  useEffect(() => {
    if (isClosed && pickupMode === 'asap') {
      setPickupMode('scheduled');
    }
  }, [isClosed, pickupMode]);

  const suggestions = useMemo(
    () => getOftenAddedSuggestions(cart, items, 4),
    [cart, items],
  );

  const handleStartEditNote = (id: string, currentNote?: string) => {
    setEditingNoteId(id);
    setItemNoteInput(currentNote ?? '');
  };

  const handleSaveNote = (id: string) => {
    setNote(id, itemNoteInput);
    setEditingNoteId(null);
    setItemNoteInput('');
  };

  useEffect(() => {
    if (errorSummary.length > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [errorSummary]);

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setDemoNotice(null);
    setSuggestedPickup(null);
    setUnavailableIds([]);
    const newErrors: Record<string, string> = {};
    const summaryList: string[] = [];

    // Check cart items
    if (cart.length === 0) {
      newErrors.cart = 'Your cart is empty. Add items before ordering.';
      summaryList.push('Your cart is empty.');
    }

    // Zod validation
    const parsed = orderSchema.safeParse({
      name,
      phone,
      notes: kitchenNotes || undefined,
      consent,
      honeypot: honeypot || undefined,
    });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as string;
        if (field && !newErrors[field]) {
          newErrors[field] = issue.message;
          summaryList.push(issue.message);
        }
      }
    }

    // Pickup time determination and validation
    const submitNow = new Date();
    let pickupAt: Date;

    if (pickupMode === 'asap') {
      pickupAt = getAsapPickup(submitNow, prepMinutes);
    } else {
      pickupAt = new Date(`${selectedDate}T${selectedTime}:00+05:30`);
    }

    const orderLines: OrderLine[] = cart.map((c) => ({
      id: c.id,
      quantity: c.quantity,
      prepMinutes: menuMap.get(c.id)?.prep_minutes ?? 10,
    }));

    const ruleValidation = validateOrder(
      { items: orderLines, pickupAt },
      submitNow,
    );
    if (!ruleValidation.valid) {
      newErrors.pickup = ruleValidation.errors.join(' ');
      summaryList.push(...ruleValidation.errors);
      try {
        const nearest = nearestValidPickup(submitNow, prepMinutes);
        setSuggestedPickup(nearest);
      } catch {
        // No nearest available
      }
    }

    if (summaryList.length > 0) {
      setErrors(newErrors);
      setErrorSummary(summaryList);
      errorSummaryRef.current?.focus();
      return;
    }

    // Client checks are for feedback. The server repeats every decision.
    setErrors({});
    setErrorSummary([]);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((item) => ({
            id: item.id,
            qty: item.quantity,
            ...(item.note ? { note: item.note } : {}),
          })),
          name,
          phone,
          ...(pickupMode === 'asap'
            ? { asap: true }
            : { pickupAt: pickupAt.toISOString() }),
          notes: kitchenNotes,
          honeypot,
          mountedAt,
        }),
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (
        response.status === 201 &&
        data &&
        typeof data === 'object' &&
        typeof (data as { code?: unknown }).code === 'string'
      ) {
        clearCart();
        window.location.assign(
          `/order/confirmed?code=${encodeURIComponent((data as { code: string }).code)}`,
        );
        return;
      }
      if (response.status === 409 && data && typeof data === 'object') {
        const ids = Array.isArray(
          (data as { unavailableIds?: unknown }).unavailableIds,
        )
          ? (data as { unavailableIds: unknown[] }).unavailableIds.filter(
              (id): id is string => typeof id === 'string',
            )
          : [];
        setUnavailableIds(ids);
        setErrorSummary([
          'One or more items sold out while you were ordering.',
        ]);
      } else if (response.status === 422 && data && typeof data === 'object') {
        const messages = Array.isArray((data as { errors?: unknown }).errors)
          ? (data as { errors: unknown[] }).errors.filter(
              (message): message is string => typeof message === 'string',
            )
          : ['Choose another pickup time.'];
        setErrors({ pickup: messages.join(' ') });
        setErrorSummary(messages);
        try {
          setSuggestedPickup(nearestValidPickup(new Date(), prepMinutes));
        } catch {
          /* no pickup remains */
        }
      } else if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        setErrorSummary([
          `Please wait ${retryAfter ? `${Math.ceil(Number(retryAfter) / 60)} minutes` : 'before trying again'}.`,
        ]);
      } else {
        setErrorSummary([
          data &&
          typeof data === 'object' &&
          typeof (data as { message?: unknown }).message === 'string'
            ? (data as { message: string }).message
            : 'We could not place the order. Please try again.',
        ]);
      }
    } catch {
      setDemoNotice(
        'The connection failed. Your cart and details are still here. Please retry.',
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const applySuggestedPickup = () => {
    if (!suggestedPickup) return;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(suggestedPickup);
    const val = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? '';
    const dateStr = `${val('year')}-${val('month')}-${val('day')}`;
    const timeStr = `${val('hour')}:${val('minute')}`;

    setPickupMode('scheduled');
    setSelectedDate(dateStr);
    setSelectedTime(timeStr);
    setSuggestedPickup(null);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.pickup;
      return next;
    });
    setErrorSummary((prev) =>
      prev.filter(
        (err) =>
          !err.includes('closed') &&
          !err.includes('Too soon') &&
          !err.includes('last orders') &&
          !err.includes('pickup'),
      ),
    );
  };

  return (
    <div className="py-10 md:py-16">
      <div className="border-b border-ink/20 pb-8">
        <p className="ph-label text-stamp">Order takeaway · Demo</p>
        <h1 className="mt-3 text-5xl sm:text-6xl">Your slip</h1>
        <p className="mt-3 text-lg text-ink-2">
          Takeaway from 240 items. Ready in 15 to 20 minutes, pay at pickup.
        </p>
      </div>

      {isClosed && (
        <div
          className="mt-6 border border-warn bg-paper-2 p-4 text-ink"
          role="status"
        >
          <strong className="block font-semibold">We are closed now.</strong>
          <p className="text-sm">
            {openState.label}. You can still order ahead for the next open time.
          </p>
        </div>
      )}

      {errorSummary.length > 0 && (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          aria-labelledby="error-summary-title"
          className="mt-6 border-2 border-err bg-paper-2 p-5 text-ink focus:outline-2 focus:outline-err"
        >
          <h2 id="error-summary-title" className="text-xl font-bold text-err">
            There was a problem with your order
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {errorSummary.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {demoNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mt-6 border-2 border-brass bg-paper-2 p-6 text-ink shadow-ledger"
        >
          <h2 className="text-2xl font-normal">Order ready for Phase 2b</h2>
          <p className="mt-2 text-sm text-ink-2">{demoNotice}</p>
          <p className="mt-3 text-xs text-stamp">
            No real order was sent. Order submission will be connected in Phase
            2b.
          </p>
        </div>
      )}

      <div className="mt-10 grid gap-12 lg:grid-cols-12 lg:items-start">
        {/* Left Column: Editable Cart */}
        <section className="lg:col-span-7" aria-labelledby="cart-heading">
          <div className="flex items-baseline justify-between border-b border-ink pb-3">
            <h2 id="cart-heading" className="text-3xl">
              Your items
            </h2>
            <span
              className="font-mono text-sm font-semibold tabular-nums text-ink-2"
              aria-live="polite"
            >
              {cartDetails.itemCount}{' '}
              {cartDetails.itemCount === 1 ? 'item' : 'items'}
            </span>
          </div>

          {cartDetails.lines.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-2xl font-serif">Your order is empty.</p>
              <p className="mt-2 text-sm text-ink-2">
                Browse our menu to pick your favourite dishes.
              </p>
              <div className="mt-6">
                <a
                  href="/menu"
                  className="inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-6 font-semibold text-paper no-underline transition hover:bg-brass hover:text-ink"
                >
                  Browse the menu &rarr;
                </a>
              </div>

              {/* Quick Adds for 6 Signatures */}
              <div className="mt-12 text-left">
                <h3 className="ph-label text-stamp">Or add a signature dish</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {items
                    .filter((item) => item.tags.includes('signature'))
                    .slice(0, 6)
                    .map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between border border-ink/30 bg-card p-3"
                      >
                        <div>
                          <p className="font-semibold">{item.name}</p>
                          <p className="font-mono text-xs text-ink-2">
                            ${item.price_usd.toFixed(2)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addToCart(item.id, 1)}
                          className="min-h-11 border border-ink px-4 text-xs font-semibold text-ink transition hover:bg-ink hover:text-paper"
                          aria-label={`Add ${item.name} to order`}
                        >
                          + Add
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-ink/20">
              {cartDetails.lines.map((line) => (
                <article
                  key={line.id}
                  className={`py-5 ${unavailableIds.includes(line.id) ? 'border-l-4 border-err pl-3' : ''}`}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3 className="text-xl font-medium">{line.name}</h3>
                        <span className="font-mono text-sm text-ink-2">
                          ${line.unitPrice.toFixed(2)} each
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink-2">
                        {line.allergens.length
                          ? `Contains: ${line.allergens.join(', ')}`
                          : 'No listed allergens'}{' '}
                        · {line.prepMinutes} min
                      </p>
                      {unavailableIds.includes(line.id) && (
                        <div className="mt-2 flex items-center gap-3 text-sm text-err">
                          <span>Sold out today.</span>
                          <button
                            type="button"
                            className="underline"
                            onClick={() => removeFromCart(line.id)}
                          >
                            Remove it
                          </button>
                        </div>
                      )}

                      {/* Line Note */}
                      <div className="mt-2 text-sm">
                        {editingNoteId === line.id ? (
                          <div className="mt-2 flex max-w-md items-center gap-2">
                            <input
                              type="text"
                              value={itemNoteInput}
                              onChange={(e) =>
                                setItemNoteInput(e.target.value.slice(0, 80))
                              }
                              placeholder="e.g. less sugar, extra hot"
                              className="min-h-11 flex-1 border border-ink bg-paper px-3 text-sm"
                              aria-label={`Special request for ${line.name}`}
                              maxLength={80}
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveNote(line.id)}
                              className="min-h-11 border border-ink bg-ink px-3 text-xs font-semibold text-paper"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingNoteId(null)}
                              className="min-h-11 border border-ink/40 px-2 text-xs"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            {line.note ? (
                              <span className="inline-block border-l-2 border-brass pl-2 text-xs italic text-ink-2">
                                &ldquo;{line.note}&rdquo;
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                handleStartEditNote(line.id, line.note)
                              }
                              className="text-xs text-brass-text underline underline-offset-4 hover:text-ink"
                            >
                              {line.note ? 'Edit note' : '+ Add note'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
                      <span className="font-mono text-lg font-bold tabular-nums">
                        ${line.lineTotal.toFixed(2)}
                      </span>

                      {/* Stepper & Remove */}
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 items-center border border-ink bg-paper">
                          <button
                            type="button"
                            className="flex h-11 w-11 items-center justify-center border-r border-ink text-lg font-bold transition hover:bg-ink hover:text-paper"
                            onClick={() => {
                              if (line.quantity <= 1) removeFromCart(line.id);
                              else setQuantity(line.id, line.quantity - 1);
                            }}
                            aria-label={`Decrease quantity of ${line.name}`}
                          >
                            &minus;
                          </button>
                          <span
                            className="min-w-10 text-center font-mono text-sm font-semibold tabular-nums"
                            aria-live="polite"
                          >
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            className="flex h-11 w-11 items-center justify-center border-l border-ink text-lg font-bold transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() =>
                              setQuantity(line.id, line.quantity + 1)
                            }
                            disabled={line.quantity >= 20}
                            aria-label={`Increase quantity of ${line.name}`}
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFromCart(line.id)}
                          className="min-h-11 px-2 text-xs text-err underline underline-offset-4 hover:text-ink"
                          aria-label={`Remove ${line.name} from order`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}

              {/* Suggestions Row ("Often added") */}
              {suggestions.length > 0 && (
                <div className="pt-6">
                  <h3 className="ph-label text-ink-2">Often added</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {suggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addToCart(item.id, 1)}
                        className="inline-flex min-h-11 items-center gap-2 border border-ink bg-card px-3 text-xs font-semibold text-ink transition hover:bg-ink hover:text-paper"
                        aria-label={`Add ${item.name} for $${item.price_usd.toFixed(2)}`}
                      >
                        <span>+ {item.name}</span>
                        <span className="font-mono text-ink-2">
                          ${item.price_usd.toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Allergen & Pricing Totals */}
              <div className="pt-6 space-y-4">
                <div className="border border-ink/20 bg-card p-4 text-xs text-ink-2">
                  <p className="font-semibold text-ink">Allergen summary</p>
                  <p className="mt-1">
                    {cartDetails.allergens.length
                      ? `This order contains: ${cartDetails.allergens.join(', ')}.`
                      : 'This order contains no listed allergens.'}
                  </p>
                  <p className="mt-1 text-[11px]">
                    The kitchen handles dairy, gluten, nuts, soy and honey;
                    cross-contact is possible.
                  </p>
                </div>

                <div className="flex items-baseline justify-between border-t border-ink pt-4">
                  <div>
                    <span className="text-2xl font-serif">Subtotal</span>
                    <p className="text-xs text-ink-2">
                      Pay at pickup. No tax, no delivery fee.
                    </p>
                  </div>
                  <span className="font-mono text-3xl font-bold tabular-nums">
                    ${cartDetails.subtotal.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right Column: Pickup Details */}
        <section
          className="border border-ink bg-card p-6 shadow-ledger lg:col-span-5"
          aria-labelledby="pickup-heading"
        >
          <h2 id="pickup-heading" className="text-2xl">
            Pickup details
          </h2>
          <p className="mt-1 text-xs text-ink-2">
            No payment taken online. Orders are paid at the counter.
          </p>

          <form className="mt-6 space-y-6" onSubmit={handleSubmit} noValidate>
            {/* Honeypot field (hidden from screen readers and sighted users) */}
            <div className="hidden" aria-hidden="true">
              <label htmlFor="order-fax">Leave this empty</label>
              <input
                id="order-fax"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
              <input type="hidden" name="mounted_at" value={mountedAt} />
            </div>

            {/* Name */}
            <div>
              <label htmlFor="order-name" className="ph-label block text-ink">
                Your name
              </label>
              <input
                id="order-name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`mt-2 min-h-12 w-full border bg-paper px-4 text-base ${
                  errors.name ? 'border-err' : 'border-ink'
                }`}
                aria-describedby={errors.name ? 'order-name-error' : undefined}
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name && (
                <p id="order-name-error" className="mt-1 text-xs text-err">
                  {errors.name}
                </p>
              )}
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="order-phone" className="ph-label block text-ink">
                Phone number
              </label>
              <input
                id="order-phone"
                type="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10 to 13 digits (optional +91)"
                className={`mt-2 min-h-12 w-full border bg-paper px-4 text-base ${
                  errors.phone ? 'border-err' : 'border-ink'
                }`}
                aria-describedby="order-phone-help order-phone-error"
                aria-invalid={Boolean(errors.phone)}
              />
              <p id="order-phone-help" className="mt-1 text-[11px] text-ink-2">
                Used strictly for order pickup identification at the counter.
              </p>
              {errors.phone && (
                <p id="order-phone-error" className="mt-1 text-xs text-err">
                  {errors.phone}
                </p>
              )}
            </div>

            {/* Pickup time options */}
            <fieldset>
              <legend className="ph-label mb-2 block text-ink">
                Pickup time
              </legend>
              <div className="space-y-3">
                {/* ASAP Option */}
                {!isClosed && (
                  <label className="flex items-start gap-3 border border-ink/30 bg-paper p-3 cursor-pointer">
                    <input
                      type="radio"
                      name="pickup_mode"
                      value="asap"
                      checked={pickupMode === 'asap'}
                      onChange={() => setPickupMode('asap')}
                      className="mt-1 size-4 accent-ink"
                    />
                    <div>
                      <span className="font-semibold">As soon as possible</span>
                      <p className="text-xs text-ink-2">
                        Ready in {prepMinutes} to {prepMinutes + 5} minutes
                        (about {formatClockTime(asapPickupDate)})
                      </p>
                    </div>
                  </label>
                )}

                {/* Scheduled Option */}
                <label className="flex items-start gap-3 border border-ink/30 bg-paper p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="pickup_mode"
                    value="scheduled"
                    checked={pickupMode === 'scheduled'}
                    onChange={() => setPickupMode('scheduled')}
                    className="mt-1 size-4 accent-ink"
                  />
                  <div className="flex-1">
                    <span className="font-semibold">Choose a time</span>
                    <p className="text-xs text-ink-2">
                      Schedule pickup today or up to 7 days ahead
                    </p>

                    {pickupMode === 'scheduled' && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {/* Date Select */}
                        <div>
                          <label
                            htmlFor="pickup-date-select"
                            className="ph-label block text-xs"
                          >
                            Date
                          </label>
                          <select
                            id="pickup-date-select"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="mt-1 min-h-11 w-full border border-ink bg-paper px-2 text-sm"
                          >
                            {pickupDates.map((d) => (
                              <option
                                key={d.date}
                                value={d.date}
                                disabled={!d.available}
                              >
                                {formatDateLabel(d.date)}{' '}
                                {!d.available && d.reason
                                  ? `(${d.reason})`
                                  : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Time Select */}
                        <div>
                          <label
                            htmlFor="pickup-time-select"
                            className="ph-label block text-xs"
                          >
                            Time
                          </label>
                          <select
                            id="pickup-time-select"
                            value={selectedTime}
                            onChange={(e) => setSelectedTime(e.target.value)}
                            className="mt-1 min-h-11 w-full border border-ink bg-paper px-2 text-sm"
                          >
                            {pickupWindow.map((t) => (
                              <option
                                key={t.time}
                                value={t.time}
                                disabled={!t.available}
                              >
                                {t.label}{' '}
                                {!t.available && t.reason
                                  ? `(${t.reason})`
                                  : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </label>
              </div>

              {errors.pickup && (
                <div className="mt-2 text-xs text-err">
                  <p>{errors.pickup}</p>
                  {suggestedPickup && (
                    <button
                      type="button"
                      onClick={applySuggestedPickup}
                      className="mt-2 inline-flex items-center gap-1 border border-ink bg-paper px-3 py-1 font-semibold text-ink underline"
                    >
                      Pick next valid time ({formatClockTime(suggestedPickup)})
                    </button>
                  )}
                </div>
              )}
            </fieldset>

            {/* Kitchen Notes */}
            <div>
              <div className="flex items-baseline justify-between">
                <label
                  htmlFor="kitchen-notes"
                  className="ph-label block text-ink"
                >
                  Notes for the kitchen
                </label>
                <span className="font-mono text-[11px] text-ink-2">
                  {kitchenNotes.length}/200
                </span>
              </div>
              <textarea
                id="kitchen-notes"
                value={kitchenNotes}
                onChange={(e) => setKitchenNotes(e.target.value.slice(0, 200))}
                rows={3}
                placeholder="Any special handling, e.g. cutlery or spice preferences"
                className="mt-2 w-full border border-ink bg-paper p-3 text-sm"
                maxLength={200}
              />
            </div>

            {/* Demo Consent Checkbox */}
            <div>
              <label className="flex items-start gap-3 cursor-pointer text-sm">
                <input
                  id="order-consent"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 size-5 accent-ink"
                  aria-describedby={
                    errors.consent ? 'order-consent-error' : undefined
                  }
                  aria-invalid={Boolean(errors.consent)}
                />
                <span className="text-xs text-ink-2">
                  I understand this is a demo. No real order will be prepared.
                </span>
              </label>
              {errors.consent && (
                <p id="order-consent-error" className="mt-1 text-xs text-err">
                  {errors.consent}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={
                cartDetails.itemCount === 0 ||
                submitting ||
                unavailableIds.some((id) =>
                  cartDetails.lines.some((line) => line.id === id),
                )
              }
              className="min-h-12 w-full border border-ink bg-ink px-6 text-base font-semibold text-paper shadow-ledger transition hover:bg-brass hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    className="size-4 animate-spin rounded-full border-2 border-paper border-t-transparent"
                    aria-hidden="true"
                  />
                  Sending order…
                </span>
              ) : (
                'Place order'
              )}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
