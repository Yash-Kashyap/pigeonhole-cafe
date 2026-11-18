import { useCallback, useEffect, useState } from 'react';
import { ownerGetJson, ownerWriteJson } from '../../lib/owner-api';
import {
  ENQUIRY_KIND_LABELS,
  ENQUIRY_STATUS_LABELS,
  buildEnquiryReplyWhatsAppUrl,
  formatEnquiryPayloadEntries,
  formatTimeSince,
  type EnquiryKind,
  type EnquiryStatus,
  type OwnerEnquiriesResponse,
  type OwnerEnquiry,
} from '../../lib/owner-dashboard';
import { EnquiryStatusBadge } from './OwnerBadges';
import { useOwnerRealtime, type RealtimeTable } from './useOwnerRealtime';

const INBOX_TABLES: readonly RealtimeTable[] = ['enquiries'];
const TABS: readonly EnquiryKind[] = ['open_mic', 'private_table', 'general'];
const STATUS_OPTIONS: readonly EnquiryStatus[] = ['new', 'contacted', 'done'];

type Props = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export default function OwnerInbox({ supabaseUrl, supabaseAnonKey }: Props) {
  const [activeKind, setActiveKind] = useState<EnquiryKind>('open_mic');
  const [page, setPage] = useState(1);
  const [enquiries, setEnquiries] = useState<OwnerEnquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(tick);
  }, []);

  const fetchEnquiries = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const params = new URLSearchParams({
        kind: activeKind,
        page: String(page),
      });
      const result = await ownerGetJson<OwnerEnquiriesResponse>(
        `/api/owner/enquiries?${params.toString()}`,
      );
      if (!result.ok) {
        if (result.status !== 0) setError(result.message);
        setLoading(false);
        return;
      }
      setError(null);
      setEnquiries(result.data.enquiries);
      setTotal(result.data.total);
      setPageSize(result.data.pageSize);
      setLoading(false);
    },
    [activeKind, page],
  );

  useEffect(() => {
    void fetchEnquiries();
  }, [fetchEnquiries]);

  useOwnerRealtime({
    supabaseUrl,
    supabaseAnonKey,
    tables: INBOX_TABLES,
    onTableChange: () => {
      void fetchEnquiries({ silent: true });
    },
    onReconnect: () => {
      void fetchEnquiries({ silent: true });
    },
    onFallbackPoll: () => {
      void fetchEnquiries({ silent: true });
    },
  });

  const handleStatusChange = async (
    enquiryId: string,
    nextStatus: EnquiryStatus,
  ) => {
    if (busyIds[enquiryId]) return;
    setBusyIds((prev) => ({ ...prev, [enquiryId]: true }));
    setActionError(null);

    const result = await ownerWriteJson<{
      enquiry: { id: string; status: EnquiryStatus };
    }>(`/api/owner/enquiries/${enquiryId}`, 'PATCH', { status: nextStatus });

    setBusyIds((prev) => ({ ...prev, [enquiryId]: false }));
    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    setEnquiries((current) =>
      current.map((entry) =>
        entry.id === enquiryId
          ? { ...entry, status: result.data.enquiry.status }
          : entry,
      ),
    );
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/20 pb-4">
        <div>
          <p className="ph-label text-brass-text">Guest enquiries</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">Inbox</h1>
        </div>
        <button
          type="button"
          onClick={() => void fetchEnquiries()}
          disabled={loading}
          className="min-h-11 border border-ink bg-card px-3.5 text-sm font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
        >
          Refresh
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Enquiry categories"
        className="flex flex-wrap gap-2"
      >
        {TABS.map((kind) => {
          const active = activeKind === kind;
          return (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setActiveKind(kind);
                setPage(1);
              }}
              className={`min-h-11 border px-4 text-sm font-semibold transition-colors ${
                active
                  ? 'border-ink bg-ink text-paper'
                  : 'border-ink/40 bg-card text-ink hover:bg-paper-2'
              }`}
            >
              {ENQUIRY_KIND_LABELS[kind]}
            </button>
          );
        })}
      </div>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border border-err bg-card p-4 text-sm text-err"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void fetchEnquiries()}
            className="min-h-11 border border-err bg-card px-3.5 font-semibold text-err hover:bg-paper-2"
          >
            Try again
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="border border-err bg-card p-3.5 text-sm text-err"
        >
          {actionError}
        </div>
      )}

      {loading && enquiries.length === 0 ? (
        <div className="border border-ink/20 bg-card p-8 text-sm text-ink-2">
          Loading {ENQUIRY_KIND_LABELS[activeKind].toLowerCase()} enquiries...
        </div>
      ) : enquiries.length === 0 ? (
        <div className="border border-ink/20 bg-card p-8 text-sm text-ink-2">
          No {ENQUIRY_KIND_LABELS[activeKind].toLowerCase()} enquiries right
          now.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {enquiries.map((enquiry) => {
            const busy = Boolean(busyIds[enquiry.id]);
            const details = formatEnquiryPayloadEntries(enquiry.payload);
            const whatsAppUrl = buildEnquiryReplyWhatsAppUrl(
              enquiry.phone,
              enquiry.name,
              enquiry.kind,
            );
            return (
              <article
                key={enquiry.id}
                className="flex min-w-0 flex-col justify-between border border-ink bg-card p-4 shadow-ledger"
              >
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{enquiry.name}</p>
                      <p className="mt-0.5 font-mono text-xs text-ink-2">
                        {enquiry.phone ?? 'No phone listed'}
                        {enquiry.email ? ` · ${enquiry.email}` : ''}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-2">
                        Received {formatTimeSince(enquiry.created_at, now)}
                      </p>
                    </div>
                    <EnquiryStatusBadge status={enquiry.status} />
                  </div>

                  {details.length > 0 ? (
                    <dl className="mt-3 space-y-1.5 border-t border-ink/15 pt-3 text-sm">
                      {details.map((entry) => (
                        <div key={`${entry.label}-${entry.value}`}>
                          <dt className="ph-label text-brass-text">
                            {entry.label}
                          </dt>
                          <dd className="mt-0.5 text-ink">{entry.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-3 border-t border-ink/15 pt-3 text-xs text-ink-2">
                      No additional notes attached.
                    </p>
                  )}
                </div>

                <div className="mt-4 space-y-2.5 border-t border-ink/15 pt-3">
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((statusOption) => {
                      const isCurrent = enquiry.status === statusOption;
                      return (
                        <button
                          key={statusOption}
                          type="button"
                          disabled={busy || isCurrent}
                          aria-pressed={isCurrent}
                          onClick={() =>
                            void handleStatusChange(enquiry.id, statusOption)
                          }
                          className={`min-h-11 border px-3 text-xs font-semibold transition-colors ${
                            isCurrent
                              ? 'border-ink bg-ink text-paper'
                              : 'border-ink/40 bg-paper text-ink hover:bg-paper-2 disabled:opacity-50'
                          }`}
                        >
                          {ENQUIRY_STATUS_LABELS[statusOption]}
                        </button>
                      );
                    })}
                  </div>

                  {whatsAppUrl && (
                    <a
                      href={whatsAppUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center border border-ok/70 bg-card px-3.5 text-xs font-semibold text-ok no-underline hover:bg-paper-2"
                    >
                      Reply on WhatsApp
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <nav
        aria-label="Enquiries pagination"
        className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/20 pt-4 text-sm"
      >
        <p className="font-mono text-xs text-ink-2">
          Page {page} of {totalPages} ({total}{' '}
          {total === 1 ? 'enquiry' : 'enquiries'})
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="min-h-11 border border-ink bg-card px-4 text-xs font-semibold text-ink hover:bg-paper-2 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
            className="min-h-11 border border-ink bg-card px-4 text-xs font-semibold text-ink hover:bg-paper-2 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </nav>
    </div>
  );
}
