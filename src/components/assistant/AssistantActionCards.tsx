import React, { useState } from 'react';
import type {
  BookingProposalAction,
  CartAddAction,
} from '../../lib/assistant/types';
import {
  addToCart,
  readCart,
  restoreOrderCart,
  type CartItem,
} from '../../lib/cart';
import { whatsAppRedirectPath } from '../../lib/whatsapp';

export function CartAddCard({ action }: { action: CartAddAction }) {
  const [added, setAdded] = useState(false);
  const [savedCart, setSavedCart] = useState<CartItem[] | null>(null);

  const handleAdd = () => {
    const current = readCart();
    setSavedCart(current);
    for (const item of action.items) {
      if (/^PH\d{4}$/.test(item.id)) {
        addToCart(item.id, item.qty);
      }
    }
    setAdded(true);
  };

  const handleUndo = () => {
    if (savedCart !== null) {
      restoreOrderCart(savedCart);
      setAdded(false);
      setSavedCart(null);
    }
  };

  const total = action.items.reduce(
    (sum, item) => sum + item.qty * item.price,
    0,
  );

  return (
    <div
      className="mt-3 border border-ink/30 bg-paper p-3 text-xs text-ink"
      data-testid="cart-add-card"
    >
      <p className="ph-label text-brass-text">Proposed order items</p>
      <ul className="mt-2 space-y-1.5 divide-y divide-ink/10">
        {action.items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between pt-1.5 first:pt-0"
          >
            <div>
              <span className="font-semibold">{item.name}</span>
              <span className="ml-1 text-ink-2">× {item.qty}</span>
            </div>
            <div className="font-mono text-ink">
              ${(item.qty * item.price).toFixed(2)}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex items-center justify-between border-t border-ink/20 pt-2 font-mono font-semibold">
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!added ? (
          <button
            type="button"
            onClick={handleAdd}
            className="inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-4 py-2 text-xs font-semibold text-paper transition hover:bg-ink-2"
          >
            Add to cart
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-flex min-h-11 items-center px-2 font-mono text-xs text-ok">
              ✓ Added to cart
            </span>
            <button
              type="button"
              onClick={handleUndo}
              className="inline-flex min-h-11 items-center justify-center border border-ink bg-paper px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-paper-2"
            >
              Undo
            </button>
          </div>
        )}
        <a
          href="/order"
          className="inline-flex min-h-11 items-center justify-center border border-ink/40 bg-paper px-3 py-1.5 text-xs font-semibold text-ink no-underline transition hover:bg-paper-2"
        >
          Go to order →
        </a>
      </div>
    </div>
  );
}

export function BookingProposalCard({
  action,
}: {
  action: BookingProposalAction;
}) {
  const [name, setName] = useState(action.name ?? '');
  const [phone, setPhone] = useState(action.phone ?? '');
  const [time, setTime] = useState(action.time);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [alternatives, setAlternatives] = useState<string[]>([]);
  // Real mount time: the server rejects bookings sent under 3 seconds after
  // this, so the timestamp must not be faked (see handleConfirm for the wait).
  const [mountedAt] = useState(() => Date.now());

  const handleConfirm = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!name.trim() || name.trim().length < 2) {
      errors.name = 'Enter a name with at least 2 characters.';
    }
    const cleanPhone = phone.trim().replace(/\s+/g, '');
    if (!/^(?:\+91|91)?[6-9]\d{9}$/.test(cleanPhone)) {
      errors.phone = 'Enter 10 digits or +91 followed by 10 digits.';
    }
    if (!consent) {
      errors.consent =
        'Confirm you understand this is a demo and no table is held.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setAlternatives([]);
    setSubmitting(true);

    try {
      // A guest with prefilled details can tap Confirm within the 3 second
      // minimum; wait out the remainder instead of showing a server error.
      const wait = 3100 - (Date.now() - mountedAt);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      const payload = {
        name: name.trim(),
        phone: cleanPhone,
        email: '',
        date: action.date,
        time,
        partySize: action.partySize,
        occasion: action.occasion || 'none',
        notes: action.notes || '',
        honeypot: '',
        mountedAt,
      };

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data: unknown = await res.json().catch(() => ({}));

      if (
        res.status === 201 &&
        data &&
        typeof data === 'object' &&
        typeof (data as { code?: unknown }).code === 'string'
      ) {
        window.location.assign(
          `/reserve/confirmed?code=${encodeURIComponent((data as { code: string }).code)}`,
        );
        return;
      }

      if (res.status === 409 && data && typeof data === 'object') {
        const alts = Array.isArray(
          (data as { alternatives?: unknown }).alternatives,
        )
          ? (data as { alternatives: unknown[] }).alternatives.filter(
              (v): v is string => typeof v === 'string',
            )
          : [];
        setAlternatives(alts);
        setFieldErrors({
          time:
            alts.length > 0
              ? 'That time was just taken. Choose an alternative below:'
              : 'That time was just taken. Please choose another time.',
        });
      } else if (res.status === 422 || res.status === 400) {
        const msg =
          typeof (data as { message?: unknown }).message === 'string'
            ? (data as { message: string }).message
            : 'Check the booking details.';
        setFieldErrors({ general: msg });
      } else {
        setFieldErrors({
          general: 'Could not complete booking right now. Please try again.',
        });
      }
    } catch {
      setFieldErrors({
        general: 'Network error. Could not connect to booking service.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="mt-3 border border-ink/30 bg-paper p-3 text-xs text-ink"
      data-testid="booking-proposal-card"
    >
      <p className="ph-label text-brass-text">Proposed Table Reservation</p>
      <div className="mt-2 space-y-1 font-mono text-xs">
        <p>
          <span className="font-semibold text-ink-2">Date:</span> {action.date}
        </p>
        <p>
          <span className="font-semibold text-ink-2">Time:</span> {time}
        </p>
        <p>
          <span className="font-semibold text-ink-2">Party:</span>{' '}
          {action.partySize} {action.partySize === 1 ? 'guest' : 'guests'}
        </p>
        {action.occasion && action.occasion !== 'none' && (
          <p>
            <span className="font-semibold text-ink-2">Occasion:</span>{' '}
            {action.occasion}
          </p>
        )}
        {action.notes && (
          <p>
            <span className="font-semibold text-ink-2">Notes:</span>{' '}
            {action.notes}
          </p>
        )}
      </div>

      {alternatives.length > 0 && (
        <div className="mt-2 border-t border-ink/10 pt-2">
          <p className="ph-label text-warn">Available alternatives:</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {alternatives.map((alt) => (
              <button
                key={alt}
                type="button"
                onClick={() => {
                  setTime(alt);
                  setAlternatives([]);
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.time;
                    return next;
                  });
                }}
                className="min-h-11 border border-ink bg-paper-2 px-3 py-1 font-mono text-xs font-semibold text-ink hover:bg-ink hover:text-paper"
              >
                {alt}
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleConfirm} className="mt-3 space-y-2.5">
        <div>
          <label
            htmlFor="assistant-booking-name"
            className="block font-mono text-[11px] uppercase tracking-wider text-ink-2"
          >
            Name *
          </label>
          <input
            id="assistant-booking-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 block min-h-11 w-full border border-ink bg-card px-3 py-1.5 text-xs text-ink"
            placeholder="Your name"
          />
          {fieldErrors.name && (
            <p className="mt-1 text-[11px] text-err">{fieldErrors.name}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="assistant-booking-phone"
            className="block font-mono text-[11px] uppercase tracking-wider text-ink-2"
          >
            Phone *
          </label>
          <input
            id="assistant-booking-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className="mt-1 block min-h-11 w-full border border-ink bg-card px-3 py-1.5 font-mono text-xs text-ink"
            placeholder="10 digits or +91..."
          />
          {fieldErrors.phone && (
            <p className="mt-1 text-[11px] text-err">{fieldErrors.phone}</p>
          )}
        </div>

        <div className="pt-1">
          <label className="flex items-start gap-2 text-[11px] leading-tight text-ink-2">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 size-4 rounded-none border border-ink"
            />
            <span>
              I understand this is a fictional demo and no real table is held.
            </span>
          </label>
          {fieldErrors.consent && (
            <p className="mt-1 text-[11px] text-err">{fieldErrors.consent}</p>
          )}
        </div>

        {fieldErrors.general && (
          <p className="text-[11px] text-err">{fieldErrors.general}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-11 w-full items-center justify-center border border-ink bg-ink px-4 py-2 text-xs font-semibold text-paper transition hover:bg-ink-2 disabled:opacity-50"
        >
          {submitting ? 'Confirming...' : 'Confirm booking'}
        </button>
      </form>
    </div>
  );
}

export function HandoffCard() {
  const whatsAppUrl = whatsAppRedirectPath(
    'Hello, I would like to speak to the café team.',
  );

  return (
    <div
      className="mt-3 border border-ink/30 bg-paper p-3 text-xs text-ink"
      data-testid="handoff-card"
    >
      <p className="ph-label text-brass-text">Connect with the Team</p>
      <p className="mt-1 text-xs text-ink-2">
        For special requests, allergies, or immediate questions, reach our team
        directly.
      </p>

      <div className="mt-2 space-y-1 font-mono text-xs">
        <p>
          <span className="text-ink-2">Phone:</span> +91 00000 00000
        </p>
        <p>
          <span className="text-ink-2">Email:</span>{' '}
          hello@pigeonhole-demo.example
        </p>
      </div>

      <div className="mt-3">
        <a
          href={whatsAppUrl}
          className="inline-flex min-h-11 w-full items-center justify-center border border-ink bg-ink px-4 py-2 font-mono text-xs font-semibold text-paper no-underline transition hover:bg-ink-2"
        >
          Message on WhatsApp →
        </a>
      </div>
    </div>
  );
}
