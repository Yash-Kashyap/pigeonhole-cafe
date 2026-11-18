import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addToCart,
  computeCartDetails,
  readCart,
  removeFromCart,
  setQuantity,
  type CartItem,
} from '../lib/cart';
import {
  ALLERGENS,
  DEFAULT_FILTERS,
  MENU_CATEGORIES,
  filterMenu,
  parseFilters,
  serializeFilters,
  sortMenu,
  type MenuFilters,
  type MenuItem,
} from '../lib/menu';

type Props = { items: MenuItem[] };

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function ItemCard({
  item,
  unavailable,
  quantity,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  item: MenuItem;
  unavailable: boolean;
  quantity: number;
  onAdd: (id: string) => void;
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
}) {
  const tags = item.tags.filter((tag) =>
    ['signature', 'popular', 'seasonal', 'offer', 'kids'].includes(tag),
  );
  return (
    <article className="menu-card" id={`item-${item.id}`} tabIndex={-1}>
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-2xl">{item.name}</h3>
        <span className="shrink-0 font-mono tabular-nums">
          {item.category === 'Add-ons' ? '+ ' : ''}
          {money(item.price_usd)}
        </span>
      </div>
      <p className="mt-3 text-sm text-ink-2">{item.description}</p>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Dietary details">
        {item.vegan && (
          <span className="menu-badge text-ok">
            V<span className="sr-only">egan</span>
          </span>
        )}
        {item.jain_option && (
          <span
            className="menu-badge text-brass-dark"
            title="Can be made Jain on request"
          >
            J<span className="sr-only">ain option</span>
          </span>
        )}
        {item.gluten_free && (
          <span className="menu-badge">
            GF<span className="sr-only">, no gluten ingredient</span>
          </span>
        )}
        <span
          className="ph-label px-1"
          aria-label={`Spice level ${item.spice_level} of 3`}
        >
          Spice {item.spice_level}
        </span>
      </div>
      <p className="mt-3 text-xs text-ink-2">
        {item.allergens.length
          ? `Contains: ${item.allergens.join(', ')}`
          : 'No listed allergens'}{' '}
        · about {item.prep_minutes} min
      </p>
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="ph-label border border-ink/25 px-2 py-1">
              {tag}
            </span>
          ))}
        </div>
      )}
      {unavailable ? (
        <button
          className="mt-5 min-h-11 w-full border border-ink/40 px-4 font-semibold opacity-60 cursor-not-allowed"
          type="button"
          disabled
        >
          Sold out today
        </button>
      ) : quantity > 0 ? (
        <div className="mt-5 flex min-h-11 items-center justify-between border border-ink bg-paper-2">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center border-r border-ink text-xl font-bold transition hover:bg-ink hover:text-paper"
            onClick={() => onDecrement(item.id)}
            aria-label={`Decrease quantity of ${item.name}`}
          >
            &minus;
          </button>
          <span
            className="font-mono text-base font-semibold tabular-nums"
            aria-live="polite"
            aria-label={`${item.name} quantity: ${quantity}`}
          >
            {quantity}
          </span>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center border-l border-ink text-xl font-bold transition hover:bg-ink hover:text-paper disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => onIncrement(item.id)}
            disabled={quantity >= 20}
            aria-label={`Increase quantity of ${item.name}`}
          >
            +
          </button>
        </div>
      ) : (
        <button
          className="mt-5 min-h-11 w-full border border-ink bg-transparent px-4 font-semibold text-ink transition hover:bg-ink hover:text-paper"
          type="button"
          onClick={() => onAdd(item.id)}
          aria-label={`Add ${item.name} to cart`}
        >
          Add
        </button>
      )}
    </article>
  );
}

function FilterControls({
  state,
  setState,
}: {
  state: MenuFilters;
  setState: React.Dispatch<React.SetStateAction<MenuFilters>>;
}) {
  const toggle = (key: 'vegan' | 'jain' | 'glutenFree') =>
    setState((old) => ({ ...old, [key]: !old[key] }));
  return (
    <div className="grid gap-5 md:grid-cols-2 md:items-start xl:grid-cols-5">
      <fieldset>
        <legend className="ph-label mb-2">Diet</legend>
        <div className="flex flex-wrap gap-2">
          {[
            ['vegan', 'Vegan'],
            ['jain', 'Jain option'],
            ['glutenFree', 'Gluten-free'],
          ].map(([key, label]) => (
            <button
              key={key}
              className="filter-chip"
              type="button"
              aria-pressed={state[key as 'vegan' | 'jain' | 'glutenFree']}
              onClick={() => toggle(key as 'vegan' | 'jain' | 'glutenFree')}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="ph-label mb-2">Spice</legend>
        <div className="flex flex-wrap gap-2">
          {[
            ['any', 'Any'],
            ['mild', 'Mild (0)'],
            ['medium', 'Medium (1–2)'],
            ['hot', 'Hot (3)'],
          ].map(([value, label]) => (
            <button
              key={value}
              className="filter-chip"
              type="button"
              aria-pressed={state.spice === value}
              onClick={() =>
                setState((old) => ({
                  ...old,
                  spice: value as MenuFilters['spice'],
                }))
              }
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="ph-label mb-2">Avoid allergen</legend>
        <div className="flex flex-wrap gap-2">
          {ALLERGENS.map((allergen) => (
            <button
              key={allergen}
              className="filter-chip capitalize"
              type="button"
              aria-pressed={state.avoid.includes(allergen)}
              onClick={() =>
                setState((old) => ({
                  ...old,
                  avoid: old.avoid.includes(allergen)
                    ? old.avoid.filter((item) => item !== allergen)
                    : [...old.avoid, allergen],
                }))
              }
            >
              {allergen}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="ph-label mb-2">Max price</legend>
        <div className="flex flex-wrap gap-2">
          {[
            [null, 'Any'],
            [2, 'Under $2'],
            [4, 'Under $4'],
            [6, 'Under $6'],
          ].map(([value, label]) => (
            <button
              key={String(value)}
              className="filter-chip"
              type="button"
              aria-pressed={state.maxPrice === value}
              onClick={() =>
                setState((old) => ({
                  ...old,
                  maxPrice: value as number | null,
                }))
              }
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-2">
        <span className="ph-label">Sort</span>
        <select
          className="min-h-11 border border-ink bg-paper px-3"
          value={state.sort}
          onChange={(event) =>
            setState((old) => ({
              ...old,
              sort: event.target.value as MenuFilters['sort'],
            }))
          }
        >
          <option value="recommended">Recommended</option>
          <option value="price-asc">Price low to high</option>
          <option value="price-desc">Price high to low</option>
          <option value="name">A to Z</option>
          <option value="quickest">Quickest</option>
        </select>
      </label>
    </div>
  );
}

function active(state: MenuFilters) {
  return serializeFilters(state) !== '';
}

export default function MenuExplorer({ items }: Props) {
  const [state, setState] = useState<MenuFilters>(DEFAULT_FILTERS);
  const [queryInput, setQueryInput] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<CartItem[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setCart(readCart());
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('ph-cart-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('ph-cart-change', sync);
    };
  }, []);

  const cartQuantities = useMemo(
    () => new Map(cart.map((c) => [c.id, c.quantity])),
    [cart],
  );

  const cartDetails = useMemo(
    () => computeCartDetails(cart, items),
    [cart, items],
  );

  useEffect(() => {
    if (cartDetails.itemCount > 0) {
      document.body.setAttribute('data-cart-peek', 'true');
    } else {
      document.body.removeAttribute('data-cart-peek');
    }
    return () => {
      document.body.removeAttribute('data-cart-peek');
    };
  }, [cartDetails.itemCount]);

  const handleAdd = (id: string) => addToCart(id, 1);
  const handleIncrement = (id: string) => {
    const q = cartQuantities.get(id) ?? 0;
    setQuantity(id, q + 1);
  };
  const handleDecrement = (id: string) => {
    const q = cartQuantities.get(id) ?? 0;
    if (q <= 1) removeFromCart(id);
    else setQuantity(id, q - 1);
  };

  useEffect(() => {
    const read = () => {
      const parsed = parseFilters(window.location.href);
      setState(parsed);
      setQueryInput(parsed.query);
    };
    read();
    setHydrated(true);
    window.addEventListener('popstate', read);
    fetch('/api/menu/availability')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: unknown) => {
        if (
          data &&
          typeof data === 'object' &&
          Array.isArray((data as { unavailableIds?: unknown }).unavailableIds)
        )
          setUnavailable(
            new Set((data as { unavailableIds: string[] }).unavailableIds),
          );
      })
      .catch(() => setUnavailable(new Set()));
    return () => window.removeEventListener('popstate', read);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(
      () => setState((old) => ({ ...old, query: queryInput })),
      150,
    );
    return () => clearTimeout(timer);
  }, [queryInput, hydrated]);
  const lastQueryRef = useRef(state.query);
  useEffect(() => {
    if (!hydrated) return;
    const next = `${window.location.pathname}${serializeFilters(state)}`;
    if (window.location.search !== serializeFilters(state)) {
      if (lastQueryRef.current !== state.query) {
        window.history.replaceState({}, '', next);
      } else {
        window.history.pushState({}, '', next);
      }
    }
    lastQueryRef.current = state.query;
  }, [state, hydrated]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const categoryCounts = useMemo(
    () =>
      new Map(
        MENU_CATEGORIES.map((category) => [
          category,
          items.filter((item) => item.category === category).length,
        ]),
      ),
    [items],
  );
  const visible = useMemo(() => {
    if (!hydrated)
      return items.filter((item) => item.category === MENU_CATEGORIES[0]);
    return sortMenu(filterMenu(items, state), state.sort);
  }, [items, state, hydrated]);
  const grouped = !state.category && !state.query;
  const clear = () => {
    setState(DEFAULT_FILTERS);
    setQueryInput('');
  };
  const shortcut = (value: Partial<MenuFilters>) => {
    setState({ ...DEFAULT_FILTERS, ...value });
    setQueryInput(value.query ?? '');
  };
  const onCategoryKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        'button',
      );
    buttons?.[(index + direction + buttons.length) % buttons.length]?.focus();
  };

  const results = grouped
    ? MENU_CATEGORIES.map((category) => ({
        category,
        items: visible.filter((item) => item.category === category),
      })).filter((group) => group.items.length)
    : [{ category: state.category || 'Matches', items: visible }];
  return (
    <div>
      <form
        className="menu-toolbar"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="grid min-w-0 flex-1 gap-2">
          <span className="ph-label">Search the menu</span>
          <input
            ref={searchRef}
            className="min-h-12 w-full border border-ink bg-paper px-4"
            type="search"
            placeholder={'Search dishes, e.g. "paneer" or "no onion"'}
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
          />
        </label>
        <button
          className="min-h-12 border border-ink px-5 md:hidden"
          type="button"
          onClick={() => setFiltersOpen(true)}
        >
          Filters
        </button>
      </form>
      <div className="hidden border-b border-ink/30 py-6 md:block">
        <FilterControls state={state} setState={setState} />
      </div>
      <div
        className="category-tabs"
        role="tablist"
        aria-label="Menu categories"
      >
        {[
          ['', 'All', items.length] as const,
          ...MENU_CATEGORIES.map(
            (category) =>
              [
                category,
                category.replaceAll(',', ''),
                categoryCounts.get(category) ?? 0,
              ] as const,
          ),
        ].map(([value, label, count], index) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={state.category === value}
            onKeyDown={(event) => onCategoryKey(event, index)}
            onClick={() =>
              setState((old) => ({ ...old, category: value, kids: false }))
            }
          >
            {label} <span>({count})</span>
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="ph-label mr-2">Quick picks</span>
        <button
          className="filter-chip"
          type="button"
          onClick={() => shortcut({ vegan: true, maxPrice: 3 })}
        >
          Vegan under $3
        </button>
        <button
          className="filter-chip"
          type="button"
          onClick={() => shortcut({ jain: true, category: 'Indian Mains' })}
        >
          Jain mains
        </button>
        <button
          className="filter-chip"
          type="button"
          onClick={() => shortcut({ kids: true })}
        >
          Kids
        </button>
        <button
          className="filter-chip"
          type="button"
          onClick={() => shortcut({ quick: true })}
        >
          Quick (under 6 min)
        </button>
        {active(state) && (
          <button
            className="min-h-11 px-3 underline"
            type="button"
            onClick={clear}
          >
            Clear all filters
          </button>
        )}
      </div>
      {state.avoid.length > 0 && (
        <p className="mt-6 border-l-4 border-warn bg-card p-4">
          Filtering is a convenience, not a guarantee. Tell the team about any
          allergy.
        </p>
      )}
      <p className="ph-label mt-8" aria-live="polite">
        {visible.length} {visible.length === 1 ? 'item' : 'items'}
      </p>
      {visible.length === 0 ? (
        <section className="mt-6 border border-ink bg-card p-6 shadow-ledger">
          <h2 className="text-3xl">Nothing matches those filters.</h2>
          <p className="mt-2 text-sm text-ink-2">
            Remove a filter below or clear all filters to see more dishes.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {state.query && (
              <button
                type="button"
                className="filter-chip inline-flex items-center gap-2"
                onClick={() => {
                  setState((old) => ({ ...old, query: '' }));
                  setQueryInput('');
                }}
                aria-label={`Remove search filter "${state.query}"`}
              >
                <span>Search: {state.query}</span>
                <span aria-hidden="true">&times;</span>
              </button>
            )}
            {state.category && (
              <button
                type="button"
                className="filter-chip inline-flex items-center gap-2"
                onClick={() => setState((old) => ({ ...old, category: '' }))}
                aria-label={`Remove category filter "${state.category}"`}
              >
                <span>{state.category}</span>
                <span aria-hidden="true">&times;</span>
              </button>
            )}
            {state.avoid.map((allergen) => (
              <button
                key={allergen}
                type="button"
                className="filter-chip inline-flex items-center gap-2 capitalize"
                onClick={() =>
                  setState((old) => ({
                    ...old,
                    avoid: old.avoid.filter((a) => a !== allergen),
                  }))
                }
                aria-label={`Remove avoid ${allergen} filter`}
              >
                <span>Avoid {allergen}</span>
                <span aria-hidden="true">&times;</span>
              </button>
            ))}
            {state.vegan && (
              <button
                type="button"
                className="filter-chip inline-flex items-center gap-2"
                onClick={() => setState((old) => ({ ...old, vegan: false }))}
                aria-label="Remove vegan filter"
              >
                <span>Vegan</span>
                <span aria-hidden="true">&times;</span>
              </button>
            )}
            {state.jain && (
              <button
                type="button"
                className="filter-chip inline-flex items-center gap-2"
                onClick={() => setState((old) => ({ ...old, jain: false }))}
                aria-label="Remove Jain filter"
              >
                <span>Jain option</span>
                <span aria-hidden="true">&times;</span>
              </button>
            )}
            {state.glutenFree && (
              <button
                type="button"
                className="filter-chip inline-flex items-center gap-2"
                onClick={() =>
                  setState((old) => ({ ...old, glutenFree: false }))
                }
                aria-label="Remove gluten-free filter"
              >
                <span>Gluten-free</span>
                <span aria-hidden="true">&times;</span>
              </button>
            )}
            {state.maxPrice !== null && (
              <button
                type="button"
                className="filter-chip inline-flex items-center gap-2"
                onClick={() => setState((old) => ({ ...old, maxPrice: null }))}
                aria-label={`Remove max price filter $${state.maxPrice}`}
              >
                <span>Under ${state.maxPrice}</span>
                <span aria-hidden="true">&times;</span>
              </button>
            )}
          </div>
          <button
            className="mt-5 min-h-11 border border-ink px-4 font-semibold transition hover:bg-ink hover:text-paper"
            type="button"
            onClick={clear}
          >
            Clear filters
          </button>
        </section>
      ) : (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-12">
          {results.map((group) => (
            <section className="menu-group" key={group.category}>
              <h2 className="sticky top-[106px] z-10 border-y border-ink bg-paper py-3 text-3xl">
                {group.category}
              </h2>
              {grouped ? (
                [...new Set(group.items.map((item) => item.subcategory))].map(
                  (subcategory) => (
                    <div key={subcategory}>
                      <h3 className="ph-label mt-7 text-ink-2">
                        {subcategory}
                      </h3>
                      <div className="menu-grid">
                        {group.items
                          .filter((item) => item.subcategory === subcategory)
                          .map((item) => (
                            <ItemCard
                              key={item.id}
                              item={item}
                              unavailable={unavailable.has(item.id)}
                              quantity={cartQuantities.get(item.id) ?? 0}
                              onAdd={handleAdd}
                              onIncrement={handleIncrement}
                              onDecrement={handleDecrement}
                            />
                          ))}
                      </div>
                    </div>
                  ),
                )
              ) : (
                <div className="menu-grid">
                  {group.items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      unavailable={unavailable.has(item.id)}
                      quantity={cartQuantities.get(item.id) ?? 0}
                      onAdd={handleAdd}
                      onIncrement={handleIncrement}
                      onDecrement={handleDecrement}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {cartDetails.itemCount > 0 && (
        <>
          {/* Mobile bottom bar */}
          <div
            data-cart-peek="mobile"
            className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between border-t border-ink bg-ink px-4 py-3 text-paper shadow-ledger sm:hidden"
            role="region"
            aria-label="Cart summary"
          >
            <div className="flex flex-col">
              <span className="font-mono text-[11px] uppercase tracking-wider text-brass-text">
                Your slip
              </span>
              <span
                className="font-mono text-sm font-semibold tabular-nums"
                aria-live="polite"
              >
                {cartDetails.itemCount}{' '}
                {cartDetails.itemCount === 1 ? 'item' : 'items'}, $
                {cartDetails.subtotal.toFixed(2)}
              </span>
            </div>
            <a
              href="/order"
              className="inline-flex min-h-11 items-center border border-paper bg-paper px-4 text-sm font-semibold text-ink no-underline transition hover:bg-brass hover:text-paper"
            >
              Go to order &rarr;
            </a>
          </div>

          {/* Desktop fixed card */}
          <div
            data-cart-peek="desktop"
            className="hidden sm:fixed sm:bottom-6 sm:left-6 sm:z-30 sm:flex sm:items-center sm:gap-6 sm:border sm:border-ink sm:bg-ink sm:px-6 sm:py-4 sm:text-paper sm:shadow-ledger"
            role="region"
            aria-label="Cart summary"
          >
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-brass-text">
                Your slip
              </p>
              <p
                className="mt-1 font-mono text-base font-semibold tabular-nums"
                aria-live="polite"
              >
                {cartDetails.itemCount}{' '}
                {cartDetails.itemCount === 1 ? 'item' : 'items'}, $
                {cartDetails.subtotal.toFixed(2)}
              </p>
            </div>
            <a
              href="/order"
              className="inline-flex min-h-11 items-center border border-paper bg-paper px-5 text-sm font-semibold text-ink no-underline transition hover:bg-brass hover:text-paper"
            >
              Go to order &rarr;
            </a>
          </div>
        </>
      )}
      {filtersOpen && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-paper p-5 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu filters"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-3xl">Filters</h2>
            <button
              className="min-h-11 border border-ink px-4"
              type="button"
              onClick={() => setFiltersOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="mt-8">
            <FilterControls state={state} setState={setState} />
          </div>
          <button
            className="mt-8 min-h-12 w-full bg-ink px-5 font-semibold text-paper"
            type="button"
            onClick={() => setFiltersOpen(false)}
          >
            Apply filters
          </button>
        </div>
      )}
    </div>
  );
}
