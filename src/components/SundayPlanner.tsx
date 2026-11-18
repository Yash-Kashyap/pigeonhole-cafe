import { useMemo, useState } from 'react';
import { describeSundayPlan, formatSundayOptionLabel } from '../lib/gatherings';
import { getSundayPlannerDates } from '../lib/rules';

export default function SundayPlanner() {
  const [now] = useState(() => new Date());
  const sundays = useMemo(() => getSundayPlannerDates(now, 8), [now]);
  const [selectedSunday, setSelectedSunday] = useState<string>(
    () => sundays[0] ?? '',
  );

  const plan = useMemo(
    () => (selectedSunday ? describeSundayPlan(selectedSunday) : null),
    [selectedSunday],
  );

  const reserveHref = selectedSunday
    ? `/reserve?date=${encodeURIComponent(selectedSunday)}`
    : '/reserve';

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      data-sunday-planner
      className="border border-ink bg-card p-6 shadow-ledger sm:p-8"
    >
      <p className="ph-label text-brass-text">Sunday hours</p>
      <h2
        id="sunday-planner-heading"
        className="mt-2 font-display text-3xl sm:text-4xl"
      >
        Plan your Sunday
      </h2>
      <p className="mt-2 max-w-[58ch] text-sm text-ink-2">
        Check opening hours for any Sunday in the next eight weeks.
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label
            htmlFor="sunday-planner-select"
            className="ph-label block text-ink"
          >
            Choose a Sunday
          </label>
          <select
            id="sunday-planner-select"
            value={selectedSunday}
            onChange={(event) => setSelectedSunday(event.target.value)}
            className="mt-1.5 min-h-11 w-full border border-ink bg-paper px-3 text-base text-ink"
          >
            {sundays.map((sunday) => (
              <option key={sunday} value={sunday}>
                {formatSundayOptionLabel(sunday)}
              </option>
            ))}
          </select>
        </div>

        <a
          href={reserveHref}
          data-reserve-sunday
          className="inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-5 text-sm font-semibold text-paper no-underline transition active:translate-y-px hover:bg-ink-2"
        >
          Reserve this Sunday
        </a>
      </div>

      <div
        role="status"
        aria-live="polite"
        data-sunday-plan-result
        className="mt-5 border-t border-ink/20 pt-4"
      >
        {plan ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink">
            <span className="font-mono font-semibold text-ink">
              {plan.opensLabel}
            </span>
            <span className="text-ink-2">{plan.closesLabel}</span>
            <span className="text-ink-2">{plan.lastOrdersLabel}</span>
            {plan.trekSeason && (
              <span className="ph-label border border-stamp px-2 py-0.5 text-stamp">
                Trek season Sunday
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-2">
            Select a Sunday to view opening hours.
          </p>
        )}
      </div>
    </form>
  );
}
