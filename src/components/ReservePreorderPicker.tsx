import { useMemo, useState } from 'react';
import { MENU_CATEGORIES, type MenuItem } from '../lib/menu';
import {
  MAX_PREORDER_LINES,
  MAX_PREORDER_QTY,
  addPreorderItem,
  computePreorderSummary,
  updatePreorderQty,
  type PreorderLineInput,
} from '../lib/reserve';

type Props = {
  items: MenuItem[];
  preorder: PreorderLineInput[];
  onChange: (next: PreorderLineInput[]) => void;
};

const INITIAL_VISIBLE = 12;

function CompactMenuCard({
  item,
  qty,
  limitReached,
  onAdd,
  onSetQty,
}: {
  item: MenuItem;
  qty: number;
  limitReached: boolean;
  onAdd: () => void;
  onSetQty: (qty: number) => void;
}) {
  const unavailable = !item.available;
  const blockedByLimit = limitReached && qty === 0;

  return (
    <article className="flex flex-col justify-between gap-3 border border-ink/30 bg-card p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2 sm:justify-start">
          <h4 className="font-display text-base leading-snug text-ink">
            {item.name}
          </h4>
          <span className="font-mono text-xs font-medium tabular-nums text-ink-2">
            {item.category === 'Add-ons' ? '+ ' : ''}$
            {item.price_usd.toFixed(2)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">
          {item.vegan && (
            <span className="border border-ok px-1.5 py-0.5 font-mono text-[10px] text-ok">
              V<span className="sr-only">egan</span>
            </span>
          )}
          {item.jain_option && (
            <span
              className="border border-brass-text px-1.5 py-0.5 font-mono text-[10px] text-brass-text"
              title="Can be made Jain on request"
            >
              J<span className="sr-only">ain option</span>
            </span>
          )}
          {item.gluten_free && (
            <span className="border border-ink/50 px-1.5 py-0.5 font-mono text-[10px] text-ink">
              GF<span className="sr-only"> gluten-free</span>
            </span>
          )}
          <span className="truncate">
            {item.allergens.length > 0
              ? `Contains: ${item.allergens.join(', ')}`
              : 'No listed allergens'}
          </span>
        </div>
      </div>

      <div className="shrink-0">
        {unavailable ? (
          <button
            type="button"
            disabled
            className="min-h-11 w-full cursor-not-allowed border border-ink/35 px-3 text-xs font-semibold text-ink-2 opacity-60 sm:w-auto"
            aria-label={`${item.name} is sold out today`}
          >
            Sold out today
          </button>
        ) : qty > 0 ? (
          <div className="inline-flex h-11 items-center border border-ink bg-paper">
            <button
              type="button"
              onClick={() => onSetQty(qty - 1)}
              className="flex h-11 w-11 items-center justify-center border-r border-ink text-base font-bold transition hover:bg-ink hover:text-paper"
              aria-label={`Decrease pre-order quantity of ${item.name}`}
            >
              &minus;
            </button>
            <span
              className="min-w-9 text-center font-mono text-sm font-semibold tabular-nums"
              aria-live="polite"
            >
              {qty}
            </span>
            <button
              type="button"
              onClick={() => onSetQty(qty + 1)}
              disabled={qty >= MAX_PREORDER_QTY}
              className="flex h-11 w-11 items-center justify-center border-l border-ink text-base font-bold transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`Increase pre-order quantity of ${item.name}`}
            >
              +
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            disabled={blockedByLimit}
            className="min-h-11 w-full border border-ink bg-transparent px-4 text-xs font-semibold text-ink transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
            aria-label={`Add ${item.name} to pre-order`}
          >
            Add
          </button>
        )}
      </div>
    </article>
  );
}

export default function ReservePreorderPicker({
  items,
  preorder,
  onChange,
}: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [showAll, setShowAll] = useState(false);

  const qtyById = useMemo(
    () => new Map(preorder.map((line) => [line.id, line.qty])),
    [preorder],
  );

  const summary = useMemo(
    () => computePreorderSummary(preorder, items),
    [preorder, items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category && item.category !== category) return false;
      if (!q) return true;
      const haystack =
        `${item.name} ${item.description} ${item.subcategory} ${item.tags.join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query, category]);

  const visibleItems = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE);
  const limitReached = preorder.length >= MAX_PREORDER_LINES;

  return (
    <details className="group border border-ink bg-paper-2/50">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 font-display text-lg text-ink">
        <span className="min-w-0">
          Order ahead so it is ready when you arrive
          {summary.itemCount > 0 && (
            <span className="ml-2 inline-block border border-ink bg-card px-2 py-0.5 font-mono text-xs align-middle">
              {summary.itemCount} {summary.itemCount === 1 ? 'item' : 'items'}
            </span>
          )}
        </span>
        <span
          className="shrink-0 font-mono text-lg transition group-open:rotate-45"
          aria-hidden="true"
        >
          +
        </span>
      </summary>

      <div className="space-y-5 border-t border-ink/25 bg-paper p-4">
        <p className="text-xs text-ink-2">
          Optional. Sent to the kitchen on arrival. Up to {MAX_PREORDER_LINES}{' '}
          dishes, {MAX_PREORDER_QTY} of each.
        </p>

        {/* Selected items summary */}
        {summary.lines.length > 0 && (
          <div className="space-y-3 border border-ink bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/20 pb-2">
              <h3 className="ph-label text-ink">Selected pre-order</h3>
              <span className="font-mono text-xs text-ink-2">
                {summary.lines.length}/{MAX_PREORDER_LINES} lines
              </span>
            </div>

            <ul className="divide-y divide-ink/15">
              {summary.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">
                      {line.name}
                    </p>
                    <p className="font-mono text-xs text-ink-2">
                      ${line.unitPrice.toFixed(2)} each · line $
                      {line.lineTotal.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex h-11 items-center border border-ink bg-paper">
                      <button
                        type="button"
                        onClick={() =>
                          onChange(
                            updatePreorderQty(preorder, line.id, line.qty - 1),
                          )
                        }
                        className="flex h-11 w-11 items-center justify-center border-r border-ink text-base font-bold hover:bg-ink hover:text-paper"
                        aria-label={`Decrease selected ${line.name}`}
                      >
                        &minus;
                      </button>
                      <span className="min-w-9 text-center font-mono text-sm font-semibold tabular-nums">
                        {line.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onChange(
                            updatePreorderQty(preorder, line.id, line.qty + 1),
                          )
                        }
                        disabled={line.qty >= MAX_PREORDER_QTY}
                        className="flex h-11 w-11 items-center justify-center border-l border-ink text-base font-bold hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Increase selected ${line.name}`}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onChange(updatePreorderQty(preorder, line.id, 0))
                      }
                      className="min-h-11 px-2 text-xs text-err underline underline-offset-4 hover:text-ink"
                      aria-label={`Remove ${line.name} from pre-order`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="border-t border-ink/25 pt-3">
              <p className="font-mono text-sm font-semibold text-ink">
                Pre-order total ${summary.total.toFixed(2)}, pay at the café
              </p>
              <p className="mt-1 text-xs text-ink-2">
                Display estimate only. The café confirms final prices when your
                booking is saved.
              </p>
            </div>
          </div>
        )}

        {limitReached && (
          <p
            role="status"
            aria-live="polite"
            className="border border-warn bg-paper-2 px-3 py-2 text-xs text-ink"
          >
            Maximum {MAX_PREORDER_LINES} pre-order lines reached. Remove a line
            to add another dish.
          </p>
        )}

        {/* Search & category filter */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="preorder-search"
              className="ph-label block text-ink-2"
            >
              Search menu
            </label>
            <input
              id="preorder-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowAll(false);
              }}
              placeholder="e.g. Post Chai, Maska Pav"
              className="mt-1 min-h-11 w-full border border-ink bg-card px-3 text-sm text-ink"
            />
          </div>
          <div>
            <label
              htmlFor="preorder-category"
              className="ph-label block text-ink-2"
            >
              Category
            </label>
            <select
              id="preorder-category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setShowAll(false);
              }}
              className="mt-1 min-h-11 w-full border border-ink bg-card px-3 text-sm text-ink"
            >
              <option value="">All categories</option>
              {MENU_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Matching compact cards */}
        {visibleItems.length === 0 ? (
          <p className="py-4 text-sm text-ink-2">
            No dishes match your filter. Try another search or category.
          </p>
        ) : (
          <div className="space-y-2">
            {visibleItems.map((item) => (
              <CompactMenuCard
                key={item.id}
                item={item}
                qty={qtyById.get(item.id) ?? 0}
                limitReached={limitReached}
                onAdd={() => onChange(addPreorderItem(preorder, item))}
                onSetQty={(nextQty) =>
                  onChange(updatePreorderQty(preorder, item.id, nextQty))
                }
              />
            ))}
          </div>
        )}

        {filtered.length > INITIAL_VISIBLE && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="min-h-11 w-full border border-ink bg-card px-4 text-xs font-semibold text-ink transition hover:bg-ink hover:text-paper"
          >
            Show all {filtered.length} matching dishes
          </button>
        )}
      </div>
    </details>
  );
}
