import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  PRIVATE_PARTY_SIZES,
  PRIVATE_TABLE_OCCASIONS,
  buildPrivateTableDateOptions,
  getPrivateTableTimeOptions,
  hasControlCharacters,
  mapEnquiryResponse,
  type PrivateTableOccasion,
} from '../lib/gatherings';
import { isValidIndianPhoneInput } from '../lib/reserve';

type FieldErrors = {
  name?: string;
  phone?: string;
  date?: string;
  time?: string;
  partySize?: string;
  occasion?: string;
  notes?: string;
};

export default function PrivateTableForm() {
  const [now] = useState(() => new Date());
  const [mountedAt] = useState(() => Date.now());

  const dateOptions = useMemo(() => buildPrivateTableDateOptions(now), [now]);
  const firstEnabledDate = useMemo(
    () => dateOptions.find((option) => !option.disabled)?.date ?? '',
    [dateOptions],
  );

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [partySize, setPartySize] = useState<number>(8);
  const [date, setDate] = useState<string>(firstEnabledDate);
  const [time, setTime] = useState<string>('');
  const [occasion, setOccasion] = useState<PrivateTableOccasion>('Birthday');
  const [notes, setNotes] = useState('');
  const [honeypot, setHoneypot] = useState('');

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const availableTimes = useMemo(
    () => (date ? getPrivateTableTimeOptions(date, partySize, now) : []),
    [date, partySize, now],
  );

  useEffect(() => {
    if (!date) {
      if (firstEnabledDate) setDate(firstEnabledDate);
      return;
    }
    const currentDateHasTimes =
      getPrivateTableTimeOptions(date, partySize, now).length > 0;
    if (!currentDateHasTimes) {
      const nextDateWithTimes = dateOptions.find(
        (opt) =>
          !opt.disabled &&
          getPrivateTableTimeOptions(opt.date, partySize, now).length > 0,
      );
      if (nextDateWithTimes && nextDateWithTimes.date !== date) {
        setDate(nextDateWithTimes.date);
      }
    }
  }, [date, dateOptions, firstEnabledDate, now, partySize]);

  useEffect(() => {
    if (!time || !availableTimes.some((option) => option.time === time)) {
      setTime(availableTimes[0]?.time ?? '');
    }
  }, [availableTimes, time]);

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 60) {
      next.name = 'Enter a name between 2 and 60 characters.';
    } else if (hasControlCharacters(trimmedName)) {
      next.name = 'Name contains invalid characters.';
    }

    if (!isValidIndianPhoneInput(phone)) {
      next.phone =
        'Enter 10 digits or +91 followed by 10 digits without spaces.';
    }

    if (!date || dateOptions.find((o) => o.date === date)?.disabled) {
      next.date = 'Choose an open date within the next 30 days.';
    }

    if (!time || !availableTimes.some((o) => o.time === time)) {
      next.time =
        partySize >= 8
          ? 'Choose a time at least 24 hours from now.'
          : 'Choose an available booking time.';
    }

    if (partySize < 7 || partySize > 12) {
      next.partySize = 'Private table enquiries are for 7 to 12 people.';
    }

    if (!PRIVATE_TABLE_OCCASIONS.includes(occasion)) {
      next.occasion = 'Choose an occasion.';
    }

    const trimmedNotes = notes.trim();
    if (trimmedNotes.length > 200) {
      next.notes = 'Notes must be 200 characters or fewer.';
    } else if (hasControlCharacters(trimmedNotes)) {
      next.notes = 'Notes contain invalid characters.';
    }

    return next;
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setSubmitError(null);

    const fieldErrors = validate();
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    submittingRef.current = true;
    setSubmitting(true);

    const trimmedNotes = notes.trim();
    const payload = {
      kind: 'private_table' as const,
      name: name.trim(),
      phone: phone.trim(),
      date,
      time,
      partySize,
      occasion,
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      honeypot,
      mountedAt,
    };

    try {
      const response = await fetch('/api/enquiries', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      const outcome = mapEnquiryResponse(response.status, body);
      if (outcome.ok) {
        setReference(outcome.reference);
        setName('');
        setPhone('');
        setNotes('');
      } else {
        setSubmitError(outcome.message);
      }
    } catch {
      setSubmitError(
        'Enquiry service is unavailable right now. Please try again later.',
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (reference) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-private-table-success
        className="border border-ink bg-card p-6 shadow-ledger sm:p-8"
      >
        <p className="ph-label text-ok">Private table enquiry sent</p>
        <h3 className="mt-1 font-display text-2xl">
          The team will confirm within the day.
        </h3>
        <p className="mt-2 font-mono text-sm text-ink-2">
          Reference: <strong className="text-ink">{reference}</strong>
        </p>
        <button
          type="button"
          onClick={() => setReference(null)}
          className="mt-5 min-h-11 border border-ink bg-transparent px-4 text-sm font-semibold text-ink hover:bg-ink hover:text-paper"
        >
          Send another enquiry
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      data-private-table-form
      className="space-y-5 border border-ink bg-card p-6 shadow-ledger sm:p-8"
    >
      <div>
        <p className="ph-label text-brass-text">Group enquiry (7 to 12)</p>
        <h3 className="mt-1 font-display text-2xl">Ask for a private table</h3>
      </div>

      {/* Honeypot field hidden from human visitors */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="private-table-website">Website</label>
        <input
          id="private-table-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>

      {submitError && (
        <div
          role="alert"
          className="border border-err bg-paper p-3.5 text-sm text-err"
        >
          {submitError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="private-name" className="ph-label block text-ink">
            Name
          </label>
          <input
            id="private-name"
            name="name"
            type="text"
            required
            maxLength={60}
            autoComplete="name"
            value={name}
            disabled={submitting}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'private-name-error' : undefined}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
          />
          {errors.name && (
            <p id="private-name-error" className="mt-1 text-xs text-err">
              {errors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="private-phone" className="ph-label block text-ink">
            Phone
          </label>
          <input
            id="private-phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="+919876543210"
            value={phone}
            disabled={submitting}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={
              errors.phone ? 'private-phone-error' : 'private-phone-hint'
            }
            onChange={(event) => setPhone(event.target.value)}
            className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
          />
          <p id="private-phone-hint" className="mt-1 text-xs text-ink-2">
            10 digits or +91 followed by 10 digits.
          </p>
          {errors.phone && (
            <p id="private-phone-error" className="mt-1 text-xs text-err">
              {errors.phone}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="private-party" className="ph-label block text-ink">
            Party size (7 to 12)
          </label>
          <select
            id="private-party"
            name="partySize"
            value={partySize}
            disabled={submitting}
            aria-invalid={Boolean(errors.partySize)}
            aria-describedby={
              errors.partySize ? 'private-party-error' : 'private-party-hint'
            }
            onChange={(event) => setPartySize(Number(event.target.value))}
            className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
          >
            {PRIVATE_PARTY_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} people
              </option>
            ))}
          </select>
          <p id="private-party-hint" className="mt-1 text-xs text-ink-2">
            {partySize >= 8
              ? "Groups of 8 or more need 24 hours' notice."
              : 'Confirmed by the team across one or two slots.'}
          </p>
          {errors.partySize && (
            <p id="private-party-error" className="mt-1 text-xs text-err">
              {errors.partySize}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="private-date" className="ph-label block text-ink">
            Date
          </label>
          <select
            id="private-date"
            name="date"
            value={date}
            disabled={submitting}
            aria-invalid={Boolean(errors.date)}
            aria-describedby={
              errors.date ? 'private-date-error' : 'private-date-hint'
            }
            onChange={(event) => setDate(event.target.value)}
            className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
          >
            {dateOptions.map((option) => (
              <option
                key={option.date}
                value={option.date}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
          </select>
          <p id="private-date-hint" className="mt-1 text-xs text-ink-2">
            Mondays are closed. Up to 30 days ahead.
          </p>
          {errors.date && (
            <p id="private-date-error" className="mt-1 text-xs text-err">
              {errors.date}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="private-time" className="ph-label block text-ink">
            Time
          </label>
          <select
            id="private-time"
            name="time"
            value={time}
            disabled={submitting || availableTimes.length === 0}
            aria-invalid={Boolean(errors.time)}
            aria-describedby={errors.time ? 'private-time-error' : undefined}
            onChange={(event) => setTime(event.target.value)}
            className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
          >
            {availableTimes.length === 0 ? (
              <option value="">No valid times on this date</option>
            ) : (
              availableTimes.map((slot) => (
                <option key={slot.time} value={slot.time}>
                  {slot.label}
                </option>
              ))
            )}
          </select>
          {errors.time && (
            <p id="private-time-error" className="mt-1 text-xs text-err">
              {errors.time}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="private-occasion" className="ph-label block text-ink">
          Occasion
        </label>
        <select
          id="private-occasion"
          name="occasion"
          value={occasion}
          disabled={submitting}
          aria-invalid={Boolean(errors.occasion)}
          aria-describedby={
            errors.occasion ? 'private-occasion-error' : undefined
          }
          onChange={(event) =>
            setOccasion(event.target.value as PrivateTableOccasion)
          }
          className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
        >
          {PRIVATE_TABLE_OCCASIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {errors.occasion && (
          <p id="private-occasion-error" className="mt-1 text-xs text-err">
            {errors.occasion}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="private-notes" className="ph-label block text-ink">
          Notes (optional, {notes.trim().length}/200)
        </label>
        <textarea
          id="private-notes"
          name="notes"
          rows={3}
          maxLength={200}
          value={notes}
          disabled={submitting}
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={errors.notes ? 'private-notes-error' : undefined}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Seating preferences or menu items you plan to pre-order."
          className="mt-1.5 w-full border border-ink bg-paper p-3 text-base text-ink disabled:opacity-60"
        />
        {errors.notes && (
          <p id="private-notes-error" className="mt-1 text-xs text-err">
            {errors.notes}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={submitting || availableTimes.length === 0}
          className="inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-6 text-sm font-semibold text-paper transition active:translate-y-px hover:bg-ink-2 disabled:opacity-60"
        >
          {submitting ? 'Sending enquiry...' : 'Send table enquiry'}
        </button>
        <a
          href="/reserve"
          className="text-sm font-semibold text-brass-text underline underline-offset-4 hover:text-ink"
        >
          Prefer to pick a time yourself? Use Reserve
        </a>
      </div>
    </form>
  );
}
