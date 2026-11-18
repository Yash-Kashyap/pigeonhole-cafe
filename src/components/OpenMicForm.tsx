import { useRef, useState, type SyntheticEvent } from 'react';
import {
  OPEN_MIC_PERFORMANCE_TYPES,
  hasControlCharacters,
  mapEnquiryResponse,
  type OpenMicPerformanceType,
} from '../lib/gatherings';
import { isValidIndianPhoneInput } from '../lib/reserve';

type FieldErrors = {
  name?: string;
  phone?: string;
  performanceType?: string;
  notes?: string;
  consent?: string;
};

export default function OpenMicForm() {
  const [mountedAt] = useState(() => Date.now());
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [performanceType, setPerformanceType] =
    useState<OpenMicPerformanceType>('Music');
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const submittingRef = useRef(false);

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

    if (!OPEN_MIC_PERFORMANCE_TYPES.includes(performanceType)) {
      next.performanceType = 'Choose what you plan to perform.';
    }

    const trimmedNotes = notes.trim();
    if (trimmedNotes.length > 200) {
      next.notes = 'Notes must be 200 characters or fewer.';
    } else if (hasControlCharacters(trimmedNotes)) {
      next.notes = 'Notes contain invalid characters.';
    }

    if (!consent) {
      next.consent = 'Confirm this is a demo before signing up.';
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
      kind: 'open_mic' as const,
      name: name.trim(),
      phone: phone.trim(),
      performanceType,
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      consent: true as const,
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
        setConsent(false);
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
        data-open-mic-success
        className="border border-ink bg-card p-6 shadow-ledger sm:p-8"
      >
        <div className="flex flex-wrap items-center gap-4">
          <span
            className="ph-stamp-seal inline-flex size-14 shrink-0 items-center justify-center rounded-full border-2 border-stamp font-mono text-xs font-semibold tracking-widest text-stamp uppercase"
            aria-hidden="true"
          >
            POSTED
          </span>
          <div className="min-w-0">
            <p className="ph-label text-ok">Performer sign-up received</p>
            <h3 className="mt-1 font-display text-2xl">
              Signed up. The team will confirm.
            </h3>
            <p className="mt-1 font-mono text-sm text-ink-2">
              Reference: <strong className="text-ink">{reference}</strong>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setReference(null)}
          className="mt-5 min-h-11 border border-ink bg-transparent px-4 text-sm font-semibold text-ink hover:bg-ink hover:text-paper"
        >
          Sign up another performer
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      data-open-mic-form
      className="space-y-5 border border-ink bg-card p-6 shadow-ledger sm:p-8"
    >
      <div>
        <p className="ph-label text-stamp">Performer sign-up</p>
        <h3 className="mt-1 font-display text-2xl">Put your name down</h3>
      </div>

      {/* Honeypot field hidden from human visitors */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="open-mic-website">Website</label>
        <input
          id="open-mic-website"
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
          <label htmlFor="open-mic-name" className="ph-label block text-ink">
            Name
          </label>
          <input
            id="open-mic-name"
            name="name"
            type="text"
            required
            maxLength={60}
            autoComplete="name"
            value={name}
            disabled={submitting}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'open-mic-name-error' : undefined}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
          />
          {errors.name && (
            <p id="open-mic-name-error" className="mt-1 text-xs text-err">
              {errors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="open-mic-phone" className="ph-label block text-ink">
            Phone
          </label>
          <input
            id="open-mic-phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="+919876543210"
            value={phone}
            disabled={submitting}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={
              errors.phone ? 'open-mic-phone-error' : 'open-mic-phone-hint'
            }
            onChange={(event) => setPhone(event.target.value)}
            className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
          />
          <p id="open-mic-phone-hint" className="mt-1 text-xs text-ink-2">
            10 digits or +91 followed by 10 digits.
          </p>
          {errors.phone && (
            <p id="open-mic-phone-error" className="mt-1 text-xs text-err">
              {errors.phone}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="open-mic-type" className="ph-label block text-ink">
          What will you perform
        </label>
        <select
          id="open-mic-type"
          name="performanceType"
          value={performanceType}
          disabled={submitting}
          aria-invalid={Boolean(errors.performanceType)}
          aria-describedby={
            errors.performanceType ? 'open-mic-type-error' : undefined
          }
          onChange={(event) =>
            setPerformanceType(event.target.value as OpenMicPerformanceType)
          }
          className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
        >
          {OPEN_MIC_PERFORMANCE_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {errors.performanceType && (
          <p id="open-mic-type-error" className="mt-1 text-xs text-err">
            {errors.performanceType}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="open-mic-notes" className="ph-label block text-ink">
          Notes (optional, {notes.trim().length}/200)
        </label>
        <textarea
          id="open-mic-notes"
          name="notes"
          rows={3}
          maxLength={200}
          value={notes}
          disabled={submitting}
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={errors.notes ? 'open-mic-notes-error' : undefined}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Instrument, piece title or anything the team should know."
          className="mt-1.5 w-full border border-ink bg-paper p-3 text-base text-ink disabled:opacity-60"
        />
        {errors.notes && (
          <p id="open-mic-notes-error" className="mt-1 text-xs text-err">
            {errors.notes}
          </p>
        )}
      </div>

      <div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
          <input
            id="open-mic-consent"
            type="checkbox"
            checked={consent}
            disabled={submitting}
            aria-invalid={Boolean(errors.consent)}
            aria-describedby={
              errors.consent ? 'open-mic-consent-error' : undefined
            }
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-1 size-5 shrink-0 accent-ink"
          />
          <span>This is a demo. No real slot is reserved.</span>
        </label>
        {errors.consent && (
          <p id="open-mic-consent-error" className="mt-1 text-xs text-err">
            {errors.consent}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-6 text-sm font-semibold text-paper transition active:translate-y-px hover:bg-ink-2 disabled:opacity-60"
      >
        {submitting ? 'Sending sign-up...' : 'Sign up to perform'}
      </button>
    </form>
  );
}
