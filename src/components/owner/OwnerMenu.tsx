import { useCallback, useEffect, useState } from 'react';
import { ownerGetJson, ownerWriteJson } from '../../lib/owner-api';
import {
  buildMenuPatch,
  formatUsd,
  validateMenuEdit,
  type OwnerMenuItem,
  type OwnerMenuResponse,
} from '../../lib/owner-dashboard';
import { useOwnerRealtime, type RealtimeTable } from './useOwnerRealtime';

const MENU_TABLES: readonly RealtimeTable[] = ['orders'];

type RowDraft = {
  priceText: string;
  description: string;
};

type RowStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; message: string }
  | { kind: 'error'; message: string };

type Props = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export default function OwnerMenu({ supabaseUrl, supabaseAnonKey }: Props) {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [items, setItems] = useState<OwnerMenuItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSearch(searchInput.trim().slice(0, 80));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchMenu = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const query = appliedSearch
        ? `?search=${encodeURIComponent(appliedSearch)}`
        : '';
      const result = await ownerGetJson<OwnerMenuResponse>(
        `/api/owner/menu${query}`,
      );
      if (!result.ok) {
        if (result.status !== 0) setError(result.message);
        setLoading(false);
        return;
      }
      setError(null);
      setItems(result.data.items);
      setDrafts((prev) => {
        const next: Record<string, RowDraft> = {};
        for (const item of result.data.items) {
          next[item.id] = prev[item.id] ?? {
            priceText: Number(item.price_usd).toFixed(2),
            description: item.description ?? '',
          };
        }
        return next;
      });
      setLoading(false);
    },
    [appliedSearch],
  );

  useEffect(() => {
    void fetchMenu();
  }, [fetchMenu]);

  useOwnerRealtime({
    supabaseUrl,
    supabaseAnonKey,
    tables: MENU_TABLES,
    onTableChange: () => {
      // Keep the Live status pill connected without disrupting inline edits.
    },
    onReconnect: () => {
      void fetchMenu({ silent: true });
    },
    onFallbackPoll: () => {
      // Avoid overwriting unsaved inline edits during background polling.
    },
  });

  const getDraft = (item: OwnerMenuItem): RowDraft =>
    drafts[item.id] ?? {
      priceText: Number(item.price_usd).toFixed(2),
      description: item.description ?? '',
    };

  const setItemDraft = (itemId: string, next: RowDraft) => {
    setDrafts((prev) => ({ ...prev, [itemId]: next }));
    setRowStatus((prev) =>
      prev[itemId]?.kind === 'error' || prev[itemId]?.kind === 'saved'
        ? { ...prev, [itemId]: { kind: 'idle' } }
        : prev,
    );
  };

  const handleToggleAvailable = async (item: OwnerMenuItem) => {
    if (rowStatus[item.id]?.kind === 'saving') return;
    const patch = buildMenuPatch(item, { available: !item.available });
    if (!patch) return;

    setRowStatus((prev) => ({ ...prev, [item.id]: { kind: 'saving' } }));
    const result = await ownerWriteJson<{ item: OwnerMenuItem }>(
      `/api/owner/menu/${item.id}`,
      'PATCH',
      patch,
    );

    if (!result.ok) {
      setRowStatus((prev) => ({
        ...prev,
        [item.id]: { kind: 'error', message: result.message },
      }));
      return;
    }

    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, ...result.data.item } : entry,
      ),
    );
    setRowStatus((prev) => ({
      ...prev,
      [item.id]: {
        kind: 'saved',
        message: result.data.item.available
          ? 'Marked available.'
          : 'Marked unavailable.',
      },
    }));
  };

  const handleSaveDetails = async (item: OwnerMenuItem) => {
    if (rowStatus[item.id]?.kind === 'saving') return;
    const draft = getDraft(item);
    const validated = validateMenuEdit(draft);
    if (!validated.ok) {
      setRowStatus((prev) => ({
        ...prev,
        [item.id]: { kind: 'error', message: validated.error },
      }));
      return;
    }

    const patch = buildMenuPatch(item, {
      price_usd: validated.price_usd,
      description: validated.description,
    });
    if (!patch) {
      return;
    }

    setRowStatus((prev) => ({ ...prev, [item.id]: { kind: 'saving' } }));
    const result = await ownerWriteJson<{ item: OwnerMenuItem }>(
      `/api/owner/menu/${item.id}`,
      'PATCH',
      patch,
    );

    if (!result.ok) {
      setRowStatus((prev) => ({
        ...prev,
        [item.id]: { kind: 'error', message: result.message },
      }));
      return;
    }

    const updated = result.data.item;
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, ...updated } : entry,
      ),
    );
    setDrafts((prev) => ({
      ...prev,
      [item.id]: {
        priceText: Number(updated.price_usd).toFixed(2),
        description: updated.description ?? '',
      },
    }));
    setRowStatus((prev) => ({
      ...prev,
      [item.id]: { kind: 'saved', message: 'Saved.' },
    }));
  };

  const handleResetRow = (item: OwnerMenuItem) => {
    setDrafts((prev) => ({
      ...prev,
      [item.id]: {
        priceText: Number(item.price_usd).toFixed(2),
        description: item.description ?? '',
      },
    }));
    setRowStatus((prev) => ({ ...prev, [item.id]: { kind: 'idle' } }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/20 pb-4">
        <div>
          <p className="ph-label text-brass-text">Live counter catalogue</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">Menu</h1>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-ink-2">
            Search by dish name
            <input
              type="search"
              maxLength={80}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="For example: Chai or Pav"
              className="mt-1 block min-h-11 w-56 border border-ink bg-card px-3 text-sm text-ink sm:w-64"
            />
          </label>
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setAppliedSearch('');
              }}
              className="min-h-11 border border-ink/40 bg-card px-3 text-xs font-semibold text-ink hover:bg-paper-2"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => void fetchMenu()}
            disabled={loading}
            className="min-h-11 border border-ink bg-card px-3.5 text-sm font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      <p className="font-mono text-xs text-ink-2">
        {loading && items.length === 0
          ? 'Loading menu items...'
          : `${items.length} ${items.length === 1 ? 'item' : 'items'} shown · Price range $0.50 to $50.00 · Description max 300 characters`}
      </p>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border border-err bg-card p-4 text-sm text-err"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void fetchMenu()}
            className="min-h-11 border border-err bg-card px-3.5 font-semibold text-err hover:bg-paper-2"
          >
            Try again
          </button>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="border border-ink/20 bg-card p-8 text-sm text-ink-2">
          Loading menu items...
        </div>
      ) : items.length === 0 ? (
        <div className="border border-ink/20 bg-card p-8 text-sm text-ink-2">
          No menu items match that search.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const draft = getDraft(item);
            const status = rowStatus[item.id] ?? { kind: 'idle' };
            const saving = status.kind === 'saving';
            const validated = validateMenuEdit(draft);
            const hasDiff = validated.ok
              ? buildMenuPatch(item, {
                  price_usd: validated.price_usd,
                  description: validated.description,
                }) !== null
              : draft.priceText.trim() !== Number(item.price_usd).toFixed(2) ||
                draft.description.trim() !== (item.description ?? '').trim();

            return (
              <article
                key={item.id}
                data-menu-row={item.id}
                className="border border-ink bg-card p-4 shadow-ledger"
              >
                <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_7.5rem_minmax(0,1fr)_auto] md:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-2">
                        {item.id}
                      </span>
                      <span className="ph-label text-brass-text">
                        {item.category}
                      </span>
                    </div>
                    <h2 className="mt-1 font-display text-xl leading-snug">
                      {item.name}
                    </h2>
                    {item.subcategory && (
                      <p className="text-xs text-ink-2">{item.subcategory}</p>
                    )}
                    <p className="mt-1 font-mono text-xs text-ink-2">
                      Saved price: {formatUsd(item.price_usd)}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-2">
                      Price (USD)
                      <input
                        type="number"
                        step="0.05"
                        min={0.5}
                        max={50}
                        value={draft.priceText}
                        disabled={saving}
                        onChange={(event) =>
                          setItemDraft(item.id, {
                            ...draft,
                            priceText: event.target.value,
                          })
                        }
                        className="mt-1 min-h-11 w-full border border-ink bg-paper px-2.5 font-mono text-sm text-ink"
                      />
                    </label>
                  </div>

                  <div className="min-w-0">
                    <label className="block text-xs font-semibold text-ink-2">
                      Description ({draft.description.trim().length}/300)
                      <textarea
                        rows={2}
                        maxLength={320}
                        value={draft.description}
                        disabled={saving}
                        onChange={(event) =>
                          setItemDraft(item.id, {
                            ...draft,
                            description: event.target.value,
                          })
                        }
                        className="mt-1 w-full border border-ink bg-paper px-2.5 py-2 text-sm text-ink"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.available}
                      disabled={saving}
                      onClick={() => void handleToggleAvailable(item)}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 border px-3 text-xs font-semibold uppercase tracking-[0.05em] transition-colors disabled:opacity-60 ${
                        item.available
                          ? 'border-ok bg-ok/10 text-ok'
                          : 'border-err bg-err/10 text-err'
                      }`}
                    >
                      <span
                        className="size-2 rounded-full bg-current"
                        aria-hidden="true"
                      />
                      {item.available ? 'Available' : 'Unavailable'}
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={saving || !hasDiff}
                        onClick={() => void handleSaveDetails(item)}
                        className="min-h-11 flex-1 border border-ink bg-ink px-3.5 text-xs font-semibold text-paper disabled:opacity-40"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      {hasDiff && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleResetRow(item)}
                          className="min-h-11 border border-ink/40 bg-card px-3 text-xs font-semibold text-ink hover:bg-paper-2 disabled:opacity-50"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {status.kind === 'saved' && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="mt-2 font-mono text-xs text-ok"
                  >
                    {status.message}
                  </p>
                )}
                {status.kind === 'error' && (
                  <p role="alert" className="mt-2 text-xs font-medium text-err">
                    {status.message}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
