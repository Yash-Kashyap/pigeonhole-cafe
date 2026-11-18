import { useRef, useState, type SyntheticEvent } from 'react';
import {
  hasControlCharacters,
  mapEnquiryResponse,
  parseGeneralContactChannel,
} from '../lib/gatherings';

type FieldErrors = {
  name?: string;
  contact?: string;
  message?: string;
};

export default function GeneralContactForm() {
  const [mountedAt] = useState(() => Date.now());
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [honeypot, setHoneypot] = useState('');

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setSubmitError(null);

    const fieldErrors: FieldErrors = {};
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 60) {
      fieldErrors.name = 'Enter a name between 2 and 60 characters.';
    } else if (hasControlCharacters(trimmedName)) {
      fieldErrors.name = 'Name contains invalid characters.';
    }

    const parsedContact = parseGeneralContactChannel(contact);
    if (!parsedContact.ok) {
      fieldErrors.contact = parsedContact.error;
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 5 || trimmedMessage.length > 1000) {
      fieldErrors.message = 'Enter a message between 5 and 1000 characters.';
    } else if (hasControlCharacters(trimmedMessage)) {
      fieldErrors.message = 'Message contains invalid characters.';
    }

    if (Object.keys(fieldErrors).length > 0 || !parsedContact.ok) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    submittingRef.current = true;
    setSubmitting(true);

    const payload = {
      kind: 'general' as const,
      name: trimmedName,
      ...(parsedContact.phone ? { phone: parsedContact.phone } : {}),
      ...(parsedContact.email ? { email: parsedContact.email } : {}),
      message: trimmedMessage,
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
        setContact('');
        setMessage('');
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
        data-general-contact-success
        className="border border-ink bg-paper p-6"
      >
        <p className="ph-label text-ok">Message received</p>
        <h3 className="mt-1 font-display text-2xl">
          The team will reply as soon as they can.
        </h3>
        <p className="mt-2 font-mono text-sm text-ink-2">
          Reference: <strong className="text-ink">{reference}</strong>
        </p>
        <button
          type="button"
          onClick={() => setReference(null)}
          className="mt-4 min-h-11 border border-ink bg-card px-4 text-sm font-semibold text-ink hover:bg-ink hover:text-paper"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      data-general-contact-form
      className="space-y-4 border-t border-ink/20 pt-6"
    >
      <div>
        <p className="ph-label text-brass-text">Write to the counter</p>
        <h3 className="mt-1 font-display text-2xl">Send a note</h3>
      </div>

      {/* Honeypot field hidden from human visitors */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="visit-contact-website">Website</label>
        <input
          id="visit-contact-website"
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
          <label htmlFor="visit-name" className="ph-label block text-ink">
            Name
          </label>
          <input
            id="visit-name"
            name="name"
            type="text"
            required
            maxLength={60}
            autoComplete="name"
            value={name}
            disabled={submitting}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'visit-name-error' : undefined}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
          />
          {errors.name && (
            <p id="visit-name-error" className="mt-1 text-xs text-err">
              {errors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="visit-contact" className="ph-label block text-ink">
            Phone or email
          </label>
          <input
            id="visit-contact"
            name="contact"
            type="text"
            required
            value={contact}
            disabled={submitting}
            placeholder="+919876543210 or name@example.com"
            aria-invalid={Boolean(errors.contact)}
            aria-describedby={
              errors.contact ? 'visit-contact-error' : 'visit-contact-hint'
            }
            onChange={(event) => setContact(event.target.value)}
            className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink disabled:opacity-60"
          />
          <p id="visit-contact-hint" className="mt-1 text-xs text-ink-2">
            10-digit phone, +91 phone, or email address.
          </p>
          {errors.contact && (
            <p id="visit-contact-error" className="mt-1 text-xs text-err">
              {errors.contact}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="visit-message" className="ph-label block text-ink">
          Message ({message.trim().length}/1000)
        </label>
        <textarea
          id="visit-message"
          name="message"
          rows={4}
          required
          maxLength={1000}
          value={message}
          disabled={submitting}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? 'visit-message-error' : undefined}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Tell us how we can help."
          className="mt-1.5 w-full border border-ink bg-paper p-3 text-base text-ink disabled:opacity-60"
        />
        {errors.message && (
          <p id="visit-message-error" className="mt-1 text-xs text-err">
            {errors.message}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-6 text-sm font-semibold text-paper transition active:translate-y-px hover:bg-ink-2 disabled:opacity-60"
      >
        {submitting ? 'Sending message...' : 'Send message'}
      </button>
    </form>
  );
}
