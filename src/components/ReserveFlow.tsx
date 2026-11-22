import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import type { MenuItem } from '../lib/menu';
import {
  MAX_NOTES_LENGTH,
  MAX_PARTY_SIZE,
  MIN_PARTY_SIZE,
  OCCASION_OPTIONS,
  RESERVE_STORAGE_KEY,
  buildReserveCalendar,
  computePreorderSummary,
  formatClockTime24,
  formatLiveSummary,
  formatReserveDate,
  formatReserveDateLong,
  getPartyHelperLines,
  isValidIndianPhoneInput,
  parseReserveDateParam,
  parseReserveHash,
  sanitizeReserveDraft,
  serializeReserveHash,
  toApiPreorder,
  type AvailabilitySlot,
  type PreorderLineInput,
  type ReserveOccasion,
  type ReserveStep,
} from '../lib/reserve';
import { whatsAppRedirectPath } from '../lib/whatsapp';
import ReservePreorderPicker from './ReservePreorderPicker';

type Props = {
  items: MenuItem[];
};

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const hasControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });

const detailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter a name with at least 2 characters.')
    .max(60, 'Name must be at most 60 characters.')
    .refine(
      (value) => !hasControlCharacter(value),
      'Name contains invalid characters.',
    ),
  phone: z
    .string()
    .trim()
    .refine(
      isValidIndianPhoneInput,
      'Enter 10 digits or +91 followed by 10 digits without spaces.',
    ),
  email: z.union([
    z.literal(''),
    z
      .email('Enter a valid email address or leave it blank.')
      .trim()
      .max(254, 'Email is too long.'),
  ]),
  notes: z
    .string()
    .max(MAX_NOTES_LENGTH, 'Notes must be at most 200 characters.')
    .refine(
      (value) => !hasControlCharacter(value),
      'Notes contain invalid characters.',
    ),
});

function PostmarkSpinner() {
  return (
    <svg
      className="size-5 shrink-0 animate-spin"
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <circle
        cx="24"
        cy="24"
        r="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <circle
        cx="24"
        cy="24"
        r="13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <text
        x="24"
        y="27"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="DM Mono, monospace"
        fontSize="10"
      >
        PH
      </text>
    </svg>
  );
}

export default function ReserveFlow({ items }: Props) {
  const [now] = useState(() => new Date());
  const [mountedAt] = useState(() => Date.now());
  const calendar = useMemo(() => buildReserveCalendar(now), [now]);

  // Core booking form state
  const [step, setStep] = useState<ReserveStep>(1);
  const [date, setDate] = useState<string>(() => calendar.firstSelectableDate);
  const [time, setTime] = useState<string>('');
  const [partySize, setPartySize] = useState<number>(2);
  const [showLargeGroupHandoff, setShowLargeGroupHandoff] = useState(false);

  // Step 2 guest details
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [occasion, setOccasion] = useState<ReserveOccasion>('none');
  const [notes, setNotes] = useState<string>('');
  const [preorder, setPreorder] = useState<PreorderLineInput[]>([]);

  // Step 3 consent + anti-bot
  const [consent, setConsent] = useState<boolean>(false);
  const [honeypot, setHoneypot] = useState<string>('');

  // Server availability state
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [loadingAvailability, setLoadingAvailability] =
    useState<boolean>(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  );
  const [availabilityRetry, setAvailabilityRetry] = useState<number>(0);
  const [clearedTimeNotice, setClearedTimeNotice] = useState<string | null>(
    null,
  );

  // Validation, submission and 409 alternatives state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorSummary, setErrorSummary] = useState<string[]>([]);
  const [errorTrigger, setErrorTrigger] = useState<number>(0);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const submittingRef = useRef<boolean>(false);

  const [restored, setRestored] = useState<boolean>(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const dayButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const timeButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const selectedTimeRef = useRef<string>(time);
  selectedTimeRef.current = time;

  const bookableSet = useMemo(
    () => new Set(calendar.bookableDates),
    [calendar.bookableDates],
  );
  const preorderSummary = useMemo(
    () => computePreorderSummary(preorder, items),
    [preorder, items],
  );
  const partyHelpers = useMemo(
    () => getPartyHelperLines(partySize),
    [partySize],
  );
  const isRequestParty = partySize >= 7;

  // Restore saved draft from sessionStorage and URL hash on mount.
  useEffect(() => {
    let saved: ReturnType<typeof sanitizeReserveDraft> = {};
    try {
      const raw = window.sessionStorage.getItem(RESERVE_STORAGE_KEY);
      if (raw) saved = sanitizeReserveDraft(JSON.parse(raw));
    } catch {
      saved = {};
    }
    const fromHash = parseReserveHash(window.location.hash);
    const fromQueryDate = parseReserveDateParam(
      window.location.search,
      calendar.bookableDates,
    );

    const nextDateCandidate =
      fromQueryDate ?? fromHash.date ?? saved.date ?? '';
    const nextDate = bookableSet.has(nextDateCandidate)
      ? nextDateCandidate
      : calendar.firstSelectableDate;
    const preservedTime = fromQueryDate
      ? ''
      : nextDate === (fromHash.date ?? saved.date ?? '')
        ? (fromHash.time ?? saved.time ?? '')
        : '';
    const nextTime = preservedTime;
    const nextParty = fromHash.partySize ?? saved.partySize ?? 2;
    const nextStepCandidate = fromQueryDate
      ? 1
      : (fromHash.step ?? saved.step ?? 1);

    setDate(nextDate);
    setTime(nextTime);
    setPartySize(nextParty);
    if (saved.name !== undefined) setName(saved.name);
    if (saved.phone !== undefined) setPhone(saved.phone);
    if (saved.email !== undefined) setEmail(saved.email);
    if (saved.occasion !== undefined) setOccasion(saved.occasion);
    if (saved.notes !== undefined) setNotes(saved.notes);
    if (saved.preorder !== undefined) setPreorder(saved.preorder);

    // Only land on step 2/3 if step 1 essentials exist.
    if (nextStepCandidate > 1 && nextDate && nextTime) {
      setStep(nextStepCandidate);
    } else {
      setStep(1);
    }
    setRestored(true);
  }, [bookableSet, calendar.firstSelectableDate]);

  // Listen for browser Back/Forward hash navigation.
  useEffect(() => {
    const syncFromHash = () => {
      const parsed = parseReserveHash(window.location.hash);
      if (parsed.date && bookableSet.has(parsed.date)) setDate(parsed.date);
      if (parsed.time !== undefined) setTime(parsed.time);
      if (parsed.partySize !== undefined) setPartySize(parsed.partySize);
      if (parsed.step !== undefined) setStep(parsed.step);
    };
    window.addEventListener('hashchange', syncFromHash);
    window.addEventListener('popstate', syncFromHash);
    return () => {
      window.removeEventListener('hashchange', syncFromHash);
      window.removeEventListener('popstate', syncFromHash);
    };
  }, [bookableSet]);

  // Persist draft to sessionStorage and keep URL hash in sync.
  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(
        RESERVE_STORAGE_KEY,
        JSON.stringify({
          step,
          date,
          time,
          partySize,
          name,
          phone,
          email,
          occasion,
          notes,
          preorder,
        }),
      );
    } catch {
      /* ignore storage quota errors */
    }
    const nextHash = serializeReserveHash({ step, date, time, partySize });
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }, [
    restored,
    step,
    date,
    time,
    partySize,
    name,
    phone,
    email,
    occasion,
    notes,
    preorder,
  ]);

  // Fetch availability from the server whenever date or partySize changes.
  useEffect(() => {
    if (!restored || !date) return;
    const controller = new AbortController();
    setLoadingAvailability(true);
    setAvailabilityError(null);

    fetch(
      `/api/availability?date=${encodeURIComponent(date)}&party=${partySize}`,
      {
        signal: controller.signal,
        cache: 'no-store',
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`status ${response.status}`);
        }
        const data: unknown = await response.json();
        const rawTimes =
          data &&
          typeof data === 'object' &&
          Array.isArray((data as { times?: unknown }).times)
            ? (data as { times: unknown[] }).times
            : [];
        const slots: AvailabilitySlot[] = rawTimes
          .filter(
            (entry): entry is AvailabilitySlot =>
              Boolean(entry) &&
              typeof entry === 'object' &&
              typeof (entry as { time?: unknown }).time === 'string' &&
              typeof (entry as { requestable?: unknown }).requestable ===
                'boolean',
          )
          .map((entry) => ({
            time: entry.time,
            remaining:
              typeof entry.remaining === 'number' ? entry.remaining : null,
            requestable: entry.requestable,
          }));

        setAvailability(slots);

        const currentTime = selectedTimeRef.current;
        if (currentTime) {
          const matching = slots.find((slot) => slot.time === currentTime);
          const stillValid =
            matching !== undefined &&
            (matching.requestable || (matching.remaining ?? 0) > 0);
          if (!stillValid) {
            setTime('');
            setClearedTimeNotice(
              'Your previous time is not available for this selection. Choose another time.',
            );
          }
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setAvailability([]);
        setAvailabilityError(
          'We could not load available times. Please try again.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingAvailability(false);
        }
      });

    return () => controller.abort();
  }, [restored, date, partySize, availabilityRetry]);

  // Focus error summary whenever a failed submit or step check records errors.
  useEffect(() => {
    if (errorSummary.length > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [errorSummary, errorTrigger]);

  const calendarMonthHeading = useMemo(() => {
    const first = calendar.weeks[0]?.[0];
    const lastWeek = calendar.weeks[calendar.weeks.length - 1];
    const last = lastWeek?.[lastWeek.length - 1];
    if (!first || !last) return 'Next 30 days';
    if (first.monthLabel === last.monthLabel) return first.monthLabel;
    return `${first.monthLabel} – ${last.monthLabel}`;
  }, [calendar.weeks]);

  const showErrors = (
    nextFieldErrors: Record<string, string>,
    nextSummary: string[],
  ) => {
    setErrors(nextFieldErrors);
    setErrorSummary(nextSummary);
    setErrorTrigger((n) => n + 1);
  };

  const clearErrors = () => {
    setErrors({});
    setErrorSummary([]);
    setAlternatives([]);
  };

  const pushStep = (target: ReserveStep) => {
    setStep(target);
    const nextHash = serializeReserveHash({
      step: target,
      date,
      time,
      partySize,
    });
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash);
    }
  };

  const validateStep1 = (): {
    fieldErrors: Record<string, string>;
    summary: string[];
  } => {
    const fieldErrors: Record<string, string> = {};
    const summary: string[] = [];
    if (!date || !bookableSet.has(date)) {
      fieldErrors.date = 'Choose a valid booking date.';
      summary.push(fieldErrors.date);
    }
    const chosen = availability.find((slot) => slot.time === time);
    const timeAvailable =
      chosen !== undefined &&
      (chosen.requestable || (chosen.remaining ?? 0) > 0);
    if (!time) {
      fieldErrors.time = 'Choose a booking time.';
      summary.push(fieldErrors.time);
    } else if (!loadingAvailability && !availabilityError && !timeAvailable) {
      fieldErrors.time = 'That time is not available. Choose another time.';
      summary.push(fieldErrors.time);
    }
    return { fieldErrors, summary };
  };

  const validateStep2 = (): {
    fieldErrors: Record<string, string>;
    summary: string[];
  } => {
    const fieldErrors: Record<string, string> = {};
    const summary: string[] = [];
    const parsed = detailsSchema.safeParse({
      name,
      phone,
      email: email.trim(),
      notes,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'details');
        if (!fieldErrors[key]) {
          fieldErrors[key] = issue.message;
          summary.push(issue.message);
        }
      }
    }
    return { fieldErrors, summary };
  };

  const goToStep = (target: ReserveStep) => {
    if (target <= step) {
      clearErrors();
      pushStep(target);
      return;
    }
    if (step === 1 || target >= 2) {
      const s1 = validateStep1();
      if (s1.summary.length > 0) {
        showErrors(s1.fieldErrors, s1.summary);
        return;
      }
    }
    if (target === 3) {
      const s2 = validateStep2();
      if (s2.summary.length > 0) {
        showErrors(s2.fieldErrors, s2.summary);
        return;
      }
    }
    clearErrors();
    pushStep(target);
  };

  const handlePartyDecrease = () => {
    setShowLargeGroupHandoff(false);
    setClearedTimeNotice(null);
    setPartySize((prev) => Math.max(MIN_PARTY_SIZE, prev - 1));
  };

  const handlePartyIncrease = () => {
    if (partySize >= MAX_PARTY_SIZE) {
      setShowLargeGroupHandoff(true);
      return;
    }
    setClearedTimeNotice(null);
    setPartySize((prev) => Math.min(MAX_PARTY_SIZE, prev + 1));
  };

  const handleCalendarKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentDate: string,
  ) => {
    const flatBookable = calendar.bookableDates;
    const idx = flatBookable.indexOf(currentDate);
    if (idx === -1) return;

    const flatAll = calendar.weeks.flat();
    const allIdx = flatAll.findIndex((d) => d.date === currentDate);
    let targetDate: string | undefined;

    if (event.key === 'ArrowRight') {
      targetDate = flatBookable[Math.min(flatBookable.length - 1, idx + 1)];
    } else if (event.key === 'ArrowLeft') {
      targetDate = flatBookable[Math.max(0, idx - 1)];
    } else if (event.key === 'ArrowDown' && allIdx !== -1) {
      for (let i = allIdx + 7; i < flatAll.length; i += 1) {
        if (flatAll[i]?.bookable) {
          targetDate = flatAll[i]?.date;
          break;
        }
      }
    } else if (event.key === 'ArrowUp' && allIdx !== -1) {
      for (let i = allIdx - 7; i >= 0; i -= 1) {
        if (flatAll[i]?.bookable) {
          targetDate = flatAll[i]?.date;
          break;
        }
      }
    } else if (event.key === 'Home') {
      targetDate = flatBookable[0];
    } else if (event.key === 'End') {
      targetDate = flatBookable[flatBookable.length - 1];
    } else {
      return;
    }

    if (targetDate) {
      event.preventDefault();
      setDate(targetDate);
      setClearedTimeNotice(null);
      dayButtonRefs.current.get(targetDate)?.focus();
    }
  };

  const enabledTimes = useMemo(
    () =>
      availability
        .filter((slot) => slot.requestable || (slot.remaining ?? 0) > 0)
        .map((slot) => slot.time),
    [availability],
  );

  const handleTimeKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentTime: string,
  ) => {
    const idx = enabledTimes.indexOf(currentTime);
    if (idx === -1) return;
    let nextIdx: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIdx = (idx + 1) % enabledTimes.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIdx = (idx - 1 + enabledTimes.length) % enabledTimes.length;
    } else {
      return;
    }
    const target = enabledTimes[nextIdx];
    if (target) {
      event.preventDefault();
      setTime(target);
      setClearedTimeNotice(null);
      timeButtonRefs.current.get(target)?.focus();
    }
  };

  const handlePickAlternative = (altTime: string) => {
    setTime(altTime);
    setAlternatives([]);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.time;
      return next;
    });
    setErrorSummary([]);
  };

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    // Pressing Enter in step 1 or 2 advances instead of prematurely submitting.
    if (step === 1) {
      goToStep(2);
      return;
    }
    if (step === 2) {
      goToStep(3);
      return;
    }

    const s1 = validateStep1();
    const s2 = validateStep2();
    const combinedErrors: Record<string, string> = {
      ...s1.fieldErrors,
      ...s2.fieldErrors,
    };
    const combinedSummary: string[] = [...s1.summary, ...s2.summary];

    if (!consent) {
      combinedErrors.consent =
        'Confirm you understand this is a demo and no real table is held.';
      combinedSummary.push(combinedErrors.consent);
    }

    if (combinedSummary.length > 0) {
      setAlternatives([]);
      showErrors(combinedErrors, combinedSummary);
      return;
    }

    clearErrors();
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const apiPreorder = toApiPreorder(preorder);
      const bodyPayload: {
        name: string;
        phone: string;
        email: string;
        date: string;
        time: string;
        partySize: number;
        occasion: ReserveOccasion;
        notes: string;
        preorder?: { id: string; qty: number }[];
        honeypot: string;
        mountedAt: number;
      } = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        date,
        time,
        partySize,
        occasion,
        notes: notes.trim(),
        ...(apiPreorder.length > 0 ? { preorder: apiPreorder } : {}),
        honeypot,
        mountedAt,
      };

      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      const data: unknown = await response.json().catch(() => ({}));

      if (
        response.status === 201 &&
        data &&
        typeof data === 'object' &&
        typeof (data as { code?: unknown }).code === 'string'
      ) {
        try {
          window.sessionStorage.removeItem(RESERVE_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        window.location.assign(
          `/reserve/confirmed?code=${encodeURIComponent((data as { code: string }).code)}`,
        );
        return;
      }

      if (response.status === 409 && data && typeof data === 'object') {
        const alts = Array.isArray(
          (data as { alternatives?: unknown }).alternatives,
        )
          ? (data as { alternatives: unknown[] }).alternatives
              .filter((value): value is string => typeof value === 'string')
              .slice(0, 3)
          : [];
        setAlternatives(alts);
        showErrors({ time: 'That time was just taken.' }, [
          alts.length > 0
            ? 'That time was just taken. Here are the nearest options.'
            : 'That time was just taken. Choose another time.',
        ]);
      } else if (response.status === 422 && data && typeof data === 'object') {
        const ruleMessages = Array.isArray(
          (data as { errors?: unknown }).errors,
        )
          ? (data as { errors: unknown[] }).errors.filter(
              (msg): msg is string => typeof msg === 'string',
            )
          : [];
        const fallback =
          typeof (data as { message?: unknown }).message === 'string'
            ? (data as { message: string }).message
            : 'This booking breaks the booking rules. Choose another date or time.';
        showErrors({}, ruleMessages.length > 0 ? ruleMessages : [fallback]);
      } else if (response.status === 429) {
        showErrors({}, ['Too many attempts, try again later.']);
      } else if (response.status === 400 && data && typeof data === 'object') {
        const msg =
          typeof (data as { message?: unknown }).message === 'string'
            ? (data as { message: string }).message
            : 'Check your booking details and try again.';
        showErrors({}, [msg]);
      } else {
        // Never show raw server text for 500 or unexpected responses.
        showErrors({}, [
          'We could not complete your booking right now. Please try again.',
        ]);
      }
    } catch {
      showErrors({}, [
        'The connection failed. Your details are still here. Please try again.',
      ]);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const selectedOccasionLabel =
    OCCASION_OPTIONS.find((opt) => opt.value === occasion)?.label ?? 'None';

  return (
    <div className="py-10 md:py-16">
      <div className="border-b border-ink/20 pb-8">
        <p className="ph-label text-stamp">Reserve a slot · Demo</p>
        <h1 className="mt-3 text-5xl sm:text-6xl">Book a slot</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-2">
          Slots seat two, four or six. Larger groups up to twelve are arranged
          by the team.
        </p>
      </div>

      {/* Progress strip */}
      <nav aria-label="Booking progress" className="mt-8">
        <ol className="grid grid-cols-3 gap-2">
          {(
            [
              [1, 'When'],
              [2, 'Who'],
              [3, 'Confirm'],
            ] as const
          ).map(([num, label]) => {
            const active = step === num;
            const complete = step > num;
            return (
              <li key={num}>
                <button
                  type="button"
                  onClick={() => goToStep(num)}
                  aria-current={active ? 'step' : undefined}
                  className={`flex min-h-12 w-full items-center justify-center gap-2 border px-2 py-2 text-center font-mono text-xs uppercase tracking-wider transition sm:px-4 ${
                    active
                      ? 'border-ink bg-ink font-semibold text-paper'
                      : complete
                        ? 'border-ink bg-paper-2 text-ink hover:bg-ink hover:text-paper'
                        : 'border-ink/35 bg-card text-ink-2 hover:border-ink hover:text-ink'
                  }`}
                >
                  <span className="shrink-0">{num}</span>
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Error summary + 409 alternative time choices */}
      {errorSummary.length > 0 && (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          aria-live="assertive"
          aria-labelledby="reserve-error-summary-title"
          className="mt-6 border-2 border-err bg-paper-2 p-5 text-ink focus:outline-2 focus:outline-err"
        >
          <h2
            id="reserve-error-summary-title"
            className="text-xl font-semibold text-err"
          >
            There was a problem with your booking
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {errorSummary.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>

          {alternatives.length > 0 && (
            <div className="mt-4 border-t border-ink/20 pt-4">
              <p className="ph-label text-ink">Nearest available times</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {alternatives.map((alt) => (
                  <button
                    key={alt}
                    type="button"
                    onClick={() => handlePickAlternative(alt)}
                    className="min-h-11 border border-ink bg-card px-4 font-mono text-sm font-semibold text-ink transition hover:bg-ink hover:text-paper"
                  >
                    {formatClockTime24(alt)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <form className="mt-8" onSubmit={handleSubmit} noValidate>
        {/* Honeypot field hidden from sighted users and assistive technology */}
        <div className="hidden" aria-hidden="true">
          <label htmlFor="reserve-website">Leave this empty</label>
          <input
            id="reserve-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
          <input type="hidden" name="mounted_at" value={mountedAt} />
        </div>

        {/* STEP 1: WHEN */}
        <section
          aria-labelledby="step-1-heading"
          hidden={step !== 1}
          className="space-y-8"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-3">
            <h2 id="step-1-heading" className="text-3xl">
              1. When
            </h2>
            <span className="ph-label text-ink-2">Asia/Kolkata (IST)</span>
          </div>

          <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
            {/* Calendar Grid */}
            <div className="border border-ink bg-card px-1.5 py-4 shadow-ledger sm:p-6 lg:col-span-7">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-1.5 pb-4 sm:px-0">
                <h3 className="text-2xl font-normal">Choose a date</h3>
                <span className="ph-label text-ink-2">
                  {calendarMonthHeading}
                </span>
              </div>

              <div
                role="grid"
                aria-label="Choose a booking date"
                className="w-full"
              >
                <div
                  role="row"
                  className="grid grid-cols-7 border-b border-ink/25 pb-2 text-center"
                >
                  {WEEKDAY_HEADERS.map((label) => (
                    <div
                      key={label}
                      role="columnheader"
                      className="ph-label text-[10px] text-ink-2 sm:text-xs"
                    >
                      {label}
                    </div>
                  ))}
                </div>

                <div className="mt-1 space-y-1">
                  {calendar.weeks.map((week, weekIndex) => (
                    <div
                      key={weekIndex}
                      role="row"
                      className="grid grid-cols-7"
                    >
                      {week.map((day) => {
                        const isSelected = day.bookable && day.date === date;
                        const baseLabel = formatReserveDateLong(day.date);
                        const label = day.bookable
                          ? day.isToday
                            ? `${day.dayNumber} Now - ${baseLabel}`
                            : baseLabel
                          : `${baseLabel} — ${day.disabledReason ?? 'Unavailable'}`;

                        return (
                          <button
                            key={day.date}
                            ref={(el) => {
                              if (el) dayButtonRefs.current.set(day.date, el);
                              else dayButtonRefs.current.delete(day.date);
                            }}
                            type="button"
                            role="gridcell"
                            aria-selected={isSelected}
                            aria-disabled={!day.bookable}
                            disabled={!day.bookable}
                            tabIndex={
                              isSelected ||
                              (!date &&
                                day.date === calendar.firstSelectableDate)
                                ? 0
                                : -1
                            }
                            title={day.disabledReason ?? undefined}
                            aria-label={label}
                            onClick={() => {
                              if (!day.bookable) return;
                              setDate(day.date);
                              setClearedTimeNotice(null);
                              setErrors((prev) => {
                                const next = { ...prev };
                                delete next.date;
                                return next;
                              });
                            }}
                            onKeyDown={(e) =>
                              handleCalendarKeyDown(e, day.date)
                            }
                            className={`flex min-h-11 w-full flex-col items-center justify-center border text-xs transition sm:min-h-12 sm:text-sm ${
                              isSelected
                                ? 'border-ink bg-ink font-semibold text-paper'
                                : day.bookable
                                  ? 'border-ink/20 bg-paper text-ink hover:border-ink hover:bg-paper-2'
                                  : 'cursor-not-allowed border-transparent bg-paper-2 text-ink-2'
                            }`}
                          >
                            <span
                              className={`font-mono leading-none ${
                                !day.bookable ? 'line-through' : ''
                              }`}
                            >
                              {day.dayNumber}
                            </span>{' '}
                            {day.dayNumber === 1 && (
                              <span className="mt-0.5 font-mono text-[9px] uppercase leading-none">
                                {day.monthShort}
                              </span>
                            )}
                            {day.isToday && day.dayNumber !== 1 && (
                              <span className="mt-0.5 font-mono text-[9px] uppercase leading-none">
                                Now
                              </span>
                            )}
                            {day.isMonday &&
                              !day.isPast &&
                              !day.isAfterHorizon && (
                                <span className="sr-only">
                                  Closed on Mondays
                                </span>
                              )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <p className="mt-4 px-1.5 text-xs text-ink-2 sm:px-0">
                Mondays are closed. Past dates and days beyond 30 days are
                unavailable.
              </p>
              {errors.date && (
                <p
                  className="mt-2 px-1.5 text-xs text-err sm:px-0"
                  aria-live="polite"
                >
                  {errors.date}
                </p>
              )}
            </div>

            {/* Party size & Times */}
            <div className="space-y-6 lg:col-span-5">
              {/* Party size stepper */}
              <div className="border border-ink bg-card p-5 shadow-ledger">
                <h3 id="reserve-party-heading" className="text-2xl font-normal">
                  Party size
                </h3>

                <div className="mt-4 flex items-center justify-between gap-4 border border-ink bg-paper p-2">
                  <button
                    type="button"
                    onClick={handlePartyDecrease}
                    disabled={partySize <= MIN_PARTY_SIZE}
                    className="flex h-11 w-11 items-center justify-center border border-ink bg-card text-xl font-bold text-ink transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Decrease party size"
                  >
                    &minus;
                  </button>
                  <div className="text-center" aria-live="polite">
                    <span className="block font-mono text-2xl font-semibold tabular-nums text-ink">
                      {partySize}
                    </span>
                    <span className="ph-label text-ink-2">
                      {partySize === 1 ? 'person' : 'people'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handlePartyIncrease}
                    className="flex h-11 w-11 items-center justify-center border border-ink bg-card text-xl font-bold text-ink transition hover:bg-ink hover:text-paper"
                    aria-label="Increase party size"
                  >
                    +
                  </button>
                </div>

                <div
                  className="mt-3 space-y-1 text-xs text-ink-2"
                  aria-live="polite"
                >
                  {partyHelpers.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setShowLargeGroupHandoff((prev) => !prev)}
                  className="mt-3 min-h-11 text-left text-xs font-semibold text-brass-text underline underline-offset-4 hover:text-ink"
                >
                  Planning for more than 12?
                </button>

                {showLargeGroupHandoff && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="mt-3 space-y-3 border-l-4 border-brass bg-paper-2 p-4 text-xs text-ink"
                  >
                    <p className="font-semibold">
                      Groups above 12 cannot be booked online.
                    </p>
                    <p className="text-ink-2">
                      I&apos;ll check with the team so we can arrange space for
                      your group.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <a
                        href={whatsAppRedirectPath(
                          'Hello, I would like to arrange a booking for more than 12 guests at The Pigeonhole Café.',
                        )}
                        target="_blank"
                        rel="nofollow noopener noreferrer"
                        className="inline-flex min-h-11 items-center border border-ink bg-ink px-4 font-semibold text-paper no-underline transition hover:bg-ink-2"
                      >
                        Message on WhatsApp
                      </a>
                      <a
                        href="/gatherings#private-tables"
                        className="inline-flex min-h-11 items-center border border-ink bg-card px-4 font-semibold text-ink no-underline transition hover:bg-ink hover:text-paper"
                      >
                        Private tables
                      </a>
                    </div>
                    <p className="font-mono text-[11px] text-ink-2">
                      Email: hello@pigeonhole-demo.example · Phone: +91 00000
                      00000 (placeholder)
                    </p>
                  </div>
                )}
              </div>

              {/* Time grid (radiogroup) */}
              <div className="border border-ink bg-card p-5 shadow-ledger">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3
                    id="reserve-time-heading"
                    className="text-2xl font-normal"
                  >
                    Choose a time
                  </h3>
                  <span className="ph-label text-ink-2">
                    {date ? formatReserveDate(date) : ''}
                  </span>
                </div>

                {clearedTimeNotice && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="mt-3 border border-warn bg-paper-2 px-3 py-2 text-xs text-ink"
                  >
                    {clearedTimeNotice}
                  </p>
                )}

                {loadingAvailability ? (
                  <div
                    className="mt-4 flex items-center gap-3 py-4 text-sm text-ink-2"
                    role="status"
                    aria-live="polite"
                  >
                    <PostmarkSpinner />
                    <span>Checking available slots…</span>
                  </div>
                ) : availabilityError ? (
                  <div className="mt-4 space-y-3 border border-err bg-paper-2 p-4 text-sm text-ink">
                    <p>{availabilityError}</p>
                    <button
                      type="button"
                      onClick={() => setAvailabilityRetry((n) => n + 1)}
                      className="min-h-11 border border-ink bg-card px-4 text-xs font-semibold text-ink hover:bg-ink hover:text-paper"
                    >
                      Try again
                    </button>
                  </div>
                ) : availability.length === 0 ? (
                  <p className="mt-4 py-3 text-sm text-ink-2">
                    No times are available on this date for this party size.
                    Choose another date.
                  </p>
                ) : (
                  <div
                    role="radiogroup"
                    aria-labelledby="reserve-time-heading"
                    className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"
                  >
                    {availability.map((slot) => {
                      const isRequest =
                        slot.requestable && slot.remaining === null;
                      const isFull =
                        !slot.requestable && (slot.remaining ?? 0) <= 0;
                      const isFewLeft =
                        !slot.requestable && slot.remaining === 1;
                      const isChecked = !isFull && time === slot.time;
                      const isFirstEnabled = enabledTimes[0] === slot.time;

                      const statusLabel = isRequest
                        ? 'Request'
                        : isFull
                          ? 'Full'
                          : isFewLeft
                            ? 'Few left'
                            : '';

                      return (
                        <button
                          key={slot.time}
                          ref={(el) => {
                            if (el) timeButtonRefs.current.set(slot.time, el);
                            else timeButtonRefs.current.delete(slot.time);
                          }}
                          type="button"
                          role="radio"
                          aria-checked={isChecked}
                          aria-disabled={isFull}
                          disabled={isFull}
                          tabIndex={
                            isChecked || (!time && isFirstEnabled) ? 0 : -1
                          }
                          onClick={() => {
                            if (isFull) return;
                            setTime(slot.time);
                            setClearedTimeNotice(null);
                            setErrors((prev) => {
                              const next = { ...prev };
                              delete next.time;
                              return next;
                            });
                          }}
                          onKeyDown={(e) => handleTimeKeyDown(e, slot.time)}
                          className={`flex min-h-12 flex-col items-center justify-center border px-2 py-2 text-center transition ${
                            isChecked
                              ? 'border-ink bg-ink text-paper'
                              : isFull
                                ? 'cursor-not-allowed border-ink/20 bg-paper-2 text-ink-2'
                                : 'border-ink/40 bg-paper text-ink hover:border-ink hover:bg-paper-2'
                          }`}
                        >
                          <span className="font-mono text-sm font-medium tabular-nums">
                            {formatClockTime24(slot.time)}
                          </span>
                          {statusLabel && (
                            <span
                              className={`mt-0.5 font-mono text-[10px] uppercase tracking-wider ${
                                isChecked
                                  ? 'text-brass'
                                  : isFewLeft
                                    ? 'text-stamp'
                                    : isRequest
                                      ? 'text-brass-text'
                                      : 'text-ink-2'
                              }`}
                            >
                              {statusLabel}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {errors.time && (
                  <p className="mt-3 text-xs text-err" aria-live="polite">
                    {errors.time}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Live summary strip & Continue */}
          <div className="flex flex-col gap-4 border border-ink bg-paper-2 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="ph-label text-ink-2">Selected slot</p>
              <p
                id="reserve-live-summary"
                className="mt-1 font-display text-2xl text-ink"
                aria-live="polite"
              >
                {formatLiveSummary(date, time, partySize)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => goToStep(2)}
              className="min-h-12 shrink-0 border border-ink bg-ink px-6 text-base font-semibold text-paper transition hover:bg-ink-2"
            >
              Continue to details &rarr;
            </button>
          </div>
        </section>

        {/* STEP 2: WHO */}
        <section
          aria-labelledby="step-2-heading"
          hidden={step !== 2}
          className="mx-auto max-w-3xl space-y-8"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-3">
            <h2 id="step-2-heading" className="text-3xl">
              2. Who
            </h2>
            <span className="font-mono text-xs text-ink-2">
              {formatLiveSummary(date, time, partySize)}
            </span>
          </div>

          <div className="space-y-6 border border-ink bg-card p-5 shadow-ledger sm:p-6">
            {/* Name */}
            <div>
              <label htmlFor="reserve-name" className="ph-label block text-ink">
                Your name
              </label>
              <input
                id="reserve-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`mt-2 min-h-12 w-full border bg-paper px-4 text-base ${
                  errors.name ? 'border-err' : 'border-ink'
                }`}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={
                  errors.name ? 'reserve-name-error' : undefined
                }
              />
              {errors.name && (
                <p
                  id="reserve-name-error"
                  className="mt-1 text-xs text-err"
                  aria-live="polite"
                >
                  {errors.name}
                </p>
              )}
            </div>

            {/* Phone */}
            <div>
              <label
                htmlFor="reserve-phone"
                className="ph-label block text-ink"
              >
                Phone number
              </label>
              <input
                id="reserve-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210 or +919876543210"
                className={`mt-2 min-h-12 w-full border bg-paper px-4 text-base ${
                  errors.phone ? 'border-err' : 'border-ink'
                }`}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby="reserve-phone-help reserve-phone-error"
              />
              <p id="reserve-phone-help" className="mt-1 text-xs text-ink-2">
                Indian 10-digit number or +91 followed by 10 digits, without
                spaces.
              </p>
              {errors.phone && (
                <p
                  id="reserve-phone-error"
                  className="mt-1 text-xs text-err"
                  aria-live="polite"
                >
                  {errors.phone}
                </p>
              )}
            </div>

            {/* Email (optional) */}
            <div>
              <label
                htmlFor="reserve-email"
                className="ph-label block text-ink"
              >
                Email (optional)
              </label>
              <input
                id="reserve-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={`mt-2 min-h-12 w-full border bg-paper px-4 text-base ${
                  errors.email ? 'border-err' : 'border-ink'
                }`}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={
                  errors.email ? 'reserve-email-error' : undefined
                }
              />
              {errors.email && (
                <p
                  id="reserve-email-error"
                  className="mt-1 text-xs text-err"
                  aria-live="polite"
                >
                  {errors.email}
                </p>
              )}
            </div>

            {/* Occasion */}
            <div>
              <label
                htmlFor="reserve-occasion"
                className="ph-label block text-ink"
              >
                Occasion
              </label>
              <select
                id="reserve-occasion"
                name="occasion"
                value={occasion}
                onChange={(e) => setOccasion(e.target.value as ReserveOccasion)}
                className="mt-2 min-h-12 w-full border border-ink bg-paper px-3 text-base text-ink"
              >
                {OCCASION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {occasion === 'birthday' && partySize >= 7 && (
                <div className="mt-3 border-l-4 border-brass bg-paper-2 p-3 text-sm text-ink">
                  <p>Hosting a birthday table for seven or more?</p>
                  <a
                    href="/gatherings#private-tables"
                    className="mt-1 inline-flex min-h-11 items-center font-semibold text-brass-text underline underline-offset-4 hover:text-ink"
                  >
                    Plan a bigger gathering &rarr;
                  </a>
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label
                  htmlFor="reserve-notes"
                  className="ph-label block text-ink"
                >
                  Notes (optional)
                </label>
                <span className="font-mono text-xs text-ink-2">
                  {notes.length}/{MAX_NOTES_LENGTH}
                </span>
              </div>
              <textarea
                id="reserve-notes"
                name="notes"
                rows={3}
                maxLength={MAX_NOTES_LENGTH}
                value={notes}
                onChange={(e) =>
                  setNotes(e.target.value.slice(0, MAX_NOTES_LENGTH))
                }
                placeholder="Near a plug point please"
                className={`mt-2 w-full border bg-paper p-3 text-sm ${
                  errors.notes ? 'border-err' : 'border-ink'
                }`}
                aria-invalid={Boolean(errors.notes)}
                aria-describedby={
                  errors.notes ? 'reserve-notes-error' : undefined
                }
              />
              {errors.notes && (
                <p
                  id="reserve-notes-error"
                  className="mt-1 text-xs text-err"
                  aria-live="polite"
                >
                  {errors.notes}
                </p>
              )}
            </div>

            {/* Optional Pre-order Accordion */}
            <ReservePreorderPicker
              items={items}
              preorder={preorder}
              onChange={setPreorder}
            />
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => goToStep(1)}
              className="min-h-12 border border-ink bg-transparent px-5 text-sm font-semibold text-ink transition hover:bg-ink hover:text-paper"
            >
              &larr; Back to when
            </button>
            <button
              type="button"
              onClick={() => goToStep(3)}
              className="min-h-12 border border-ink bg-ink px-6 text-base font-semibold text-paper transition hover:bg-ink-2"
            >
              Review and confirm &rarr;
            </button>
          </div>
        </section>

        {/* STEP 3: CONFIRM */}
        <section
          aria-labelledby="step-3-heading"
          hidden={step !== 3}
          className="mx-auto max-w-3xl space-y-8"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-3">
            <h2 id="step-3-heading" className="text-3xl">
              3. Confirm
            </h2>
            <span className="ph-label text-ink-2">
              {isRequestParty ? 'Team confirmation' : 'Instant slot'}
            </span>
          </div>

          {/* Summary Card */}
          <div className="space-y-6 border border-ink bg-card p-5 shadow-ledger sm:p-6">
            <div>
              <p className="ph-label text-stamp">Booking summary</p>
              <p className="mt-2 font-display text-2xl text-ink">
                {formatLiveSummary(date, time, partySize)}
              </p>
              <p className="mt-1 text-xs text-ink-2">
                {isRequestParty
                  ? 'Groups of 7 to 12 are sent as a request and confirmed by the team.'
                  : 'Your slot is confirmed right away.'}
              </p>
            </div>

            <dl className="grid gap-4 border-y border-ink/20 py-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="ph-label text-ink-2">Name</dt>
                <dd className="mt-1 text-ink">{name.trim() || '—'}</dd>
              </div>
              <div>
                <dt className="ph-label text-ink-2">Phone</dt>
                <dd className="mt-1 font-mono text-ink">
                  {phone.trim() || '—'}
                </dd>
              </div>
              {email.trim() && (
                <div>
                  <dt className="ph-label text-ink-2">Email</dt>
                  <dd className="mt-1 break-all text-ink">{email.trim()}</dd>
                </div>
              )}
              {occasion !== 'none' && (
                <div>
                  <dt className="ph-label text-ink-2">Occasion</dt>
                  <dd className="mt-1 text-ink">{selectedOccasionLabel}</dd>
                </div>
              )}
              {notes.trim() && (
                <div className="sm:col-span-2">
                  <dt className="ph-label text-ink-2">Notes</dt>
                  <dd className="mt-1 text-ink">{notes.trim()}</dd>
                </div>
              )}
            </dl>

            {preorderSummary.lines.length > 0 && (
              <div className="space-y-2 border-b border-ink/20 pb-4 text-sm">
                <p className="ph-label text-ink-2">Optional pre-order</p>
                <ul className="space-y-1">
                  {preorderSummary.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-baseline justify-between gap-4"
                    >
                      <span>
                        {line.name}{' '}
                        <span className="font-mono text-xs text-ink-2">
                          × {line.qty}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums">
                        ${line.lineTotal.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="pt-2 font-mono text-sm font-semibold text-ink">
                  Pre-order total ${preorderSummary.total.toFixed(2)}, pay at
                  the café
                </p>
              </div>
            )}

            {/* Plain-word rules */}
            <div className="space-y-1.5 bg-paper-2 p-4 text-xs text-ink-2">
              <p className="ph-label text-ink">How slots work</p>
              <p>Your slot is held for 15 minutes after the booking time.</p>
              <p>Each booking gives you a 90-minute slot.</p>
              <p>No deposit is taken online. Pay at the café.</p>
            </div>

            {/* Demo consent checkbox */}
            <div>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                <input
                  id="reserve-consent"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    if (e.target.checked) {
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.consent;
                        return next;
                      });
                    }
                  }}
                  className="mt-1 size-5 shrink-0 accent-ink"
                  aria-invalid={Boolean(errors.consent)}
                  aria-describedby={
                    errors.consent ? 'reserve-consent-error' : undefined
                  }
                />
                <span className="text-ink">
                  I understand this is a demo. No real table is held.
                </span>
              </label>
              {errors.consent && (
                <p
                  id="reserve-consent-error"
                  className="mt-1 text-xs text-err"
                  aria-live="polite"
                >
                  {errors.consent}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => goToStep(2)}
              disabled={submitting}
              className="min-h-12 border border-ink bg-transparent px-5 text-sm font-semibold text-ink transition hover:bg-ink hover:text-paper disabled:opacity-50"
            >
              &larr; Back to details
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-12 items-center justify-center gap-2 border border-ink bg-ink px-7 text-base font-semibold text-paper shadow-ledger transition hover:bg-brass hover:text-ink disabled:cursor-not-allowed disabled:opacity-55"
            >
              {submitting ? (
                <>
                  <PostmarkSpinner />
                  <span>
                    {isRequestParty ? 'Sending request…' : 'Reserving slot…'}
                  </span>
                </>
              ) : isRequestParty ? (
                'Send request'
              ) : (
                'Reserve slot'
              )}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}
