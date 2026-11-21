import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ownerGetJson, ownerWriteJson } from '../../lib/owner-api';
import {
  formatKolkataTime,
  formatRelativeTime,
  type OwnerOverrideItem,
  type OwnerOverridesResponse,
  type OwnerQuestionItem,
  type OwnerQuestionsResponse,
} from '../../lib/owner-ai-helpers';
import { useOwnerRealtime, type RealtimeTable } from './useOwnerRealtime';

const QUESTIONS_TABLES: readonly RealtimeTable[] = [
  'assistant_logs' as RealtimeTable,
  'knowledge_overrides' as RealtimeTable,
];

type Props = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

type ActiveDialog =
  | {
      type: 'add';
      questionId: string;
      initialQuestion: string;
      trigger: HTMLElement | null;
    }
  | {
      type: 'edit';
      override: OwnerOverrideItem;
      trigger: HTMLElement | null;
    }
  | null;

export default function OwnerQuestions({
  supabaseUrl,
  supabaseAnonKey,
}: Props) {
  // Questions list state
  const [filter, setFilter] = useState<'unanswered' | 'all'>('unanswered');
  const [day, setDay] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [questions, setQuestions] = useState<OwnerQuestionItem[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  // Overrides list state
  const [overrides, setOverrides] = useState<OwnerOverrideItem[]>([]);
  const [overrideLimit, setOverrideLimit] = useState(50);
  const [loadingOverrides, setLoadingOverrides] = useState(true);
  const [overridesError, setOverridesError] = useState<string | null>(null);

  // Expanded excerpts state: set of question IDs
  const [expandedExcerpts, setExpandedExcerpts] = useState<Set<string>>(
    () => new Set(),
  );

  // Toast notification
  const [toast, setToast] = useState<string | null>(null);

  // Busy action IDs
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});

  // Active dialog state (add answer or edit override)
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [dialogQuestion, setDialogQuestion] = useState('');
  const [dialogAnswer, setDialogAnswer] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);

  // Delete confirmation for override ID
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Dialog DOM ref for focus trap
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch Questions
  const fetchQuestions = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoadingQuestions(true);
      const params = new URLSearchParams({
        filter,
        page: String(page),
      });
      if (day) params.set('day', day);

      const res = await ownerGetJson<OwnerQuestionsResponse>(
        `/api/owner/questions?${params.toString()}`,
      );
      if (!res.ok) {
        if (res.status !== 0) setQuestionsError(res.message);
        setLoadingQuestions(false);
        return;
      }
      setQuestionsError(null);
      setQuestions(res.data.questions);
      setTotalQuestions(res.data.total);
      setPageSize(res.data.pageSize);
      setLoadingQuestions(false);
    },
    [filter, day, page],
  );

  // Fetch Overrides
  const fetchOverrides = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingOverrides(true);
    const res = await ownerGetJson<OwnerOverridesResponse>(
      '/api/owner/overrides',
    );
    if (!res.ok) {
      if (res.status !== 0) setOverridesError(res.message);
      setLoadingOverrides(false);
      return;
    }
    setOverridesError(null);
    setOverrides(res.data.overrides);
    setOverrideLimit(res.data.limit || 50);
    setLoadingOverrides(false);
  }, []);

  useEffect(() => {
    void fetchQuestions();
  }, [fetchQuestions]);

  useEffect(() => {
    void fetchOverrides();
  }, [fetchOverrides]);

  // Realtime listeners
  useOwnerRealtime({
    supabaseUrl,
    supabaseAnonKey,
    tables: QUESTIONS_TABLES,
    onTableChange: () => {
      void fetchQuestions({ silent: true });
      void fetchOverrides({ silent: true });
    },
    onReconnect: () => {
      void fetchQuestions({ silent: true });
      void fetchOverrides({ silent: true });
    },
    onFallbackPoll: () => {
      void fetchQuestions({ silent: true });
      void fetchOverrides({ silent: true });
    },
  });

  // Toast timer
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Focus trap for active dialog
  useEffect(() => {
    if (!activeDialog) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
        return;
      }
      if (e.key === 'Tab') {
        const modal = dialogRef.current;
        if (!modal) return;
        const focusable = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const timer = window.setTimeout(() => {
      firstInputRef.current?.focus();
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(timer);
    };
  }, [activeDialog]);

  const openAddDialog = (
    qId: string,
    initialQuestion: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    setActiveDialog({
      type: 'add',
      questionId: qId,
      initialQuestion,
      trigger: event.currentTarget,
    });
    setDialogQuestion(initialQuestion);
    setDialogAnswer('');
    setDialogError(null);
  };

  const openEditDialog = (
    override: OwnerOverrideItem,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    setActiveDialog({
      type: 'edit',
      override,
      trigger: event.currentTarget,
    });
    setDialogQuestion(override.question);
    setDialogAnswer(override.answer);
    setDialogError(null);
  };

  const closeDialog = () => {
    const trigger = activeDialog?.trigger;
    setActiveDialog(null);
    setDialogError(null);
    setDialogSubmitting(false);
    trigger?.focus();
  };

  // Excerpt toggle
  const toggleExcerpt = (id: string) => {
    setExpandedExcerpts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Mark as handled
  const handleMarkHandled = async (id: string) => {
    if (busyIds[id]) return;
    setBusyIds((prev) => ({ ...prev, [id]: true }));
    const res = await ownerWriteJson<{ id: string; handled: boolean }>(
      `/api/owner/questions/${id}/handled`,
      'POST',
      {},
    );
    setBusyIds((prev) => ({ ...prev, [id]: false }));
    if (!res.ok) {
      setToast(res.message);
      return;
    }
    if (filter === 'unanswered') {
      setQuestions((prev) => prev.filter((q) => q.id !== id));
      setTotalQuestions((prev) => Math.max(0, prev - 1));
    } else {
      setQuestions((prev) =>
        prev.map((q) => (q.id === id ? { ...q, handled: true } : q)),
      );
    }
    setToast('Question marked as handled.');
  };

  // Submit Answer / Edit
  const handleDialogSubmit = async (
    e: React.SyntheticEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    if (dialogSubmitting || !activeDialog) return;

    const trimmedQ = dialogQuestion.trim();
    const trimmedA = dialogAnswer.trim();

    if (trimmedQ.length < 3 || trimmedQ.length > 300) {
      setDialogError('Question must be between 3 and 300 characters.');
      return;
    }
    if (trimmedA.length < 3 || trimmedA.length > 600) {
      setDialogError('Answer must be between 3 and 600 characters.');
      return;
    }

    setDialogError(null);
    setDialogSubmitting(true);

    if (activeDialog.type === 'add') {
      const res = await ownerWriteJson<{ id: string; handled: boolean }>(
        `/api/owner/questions/${activeDialog.questionId}/answer`,
        'POST',
        { question: trimmedQ, answer: trimmedA },
      );
      setDialogSubmitting(false);
      if (!res.ok) {
        setDialogError(res.message);
        return;
      }
      // Success
      if (filter === 'unanswered') {
        setQuestions((prev) =>
          prev.filter((q) => q.id !== activeDialog.questionId),
        );
        setTotalQuestions((prev) => Math.max(0, prev - 1));
      } else {
        setQuestions((prev) =>
          prev.map((q) =>
            q.id === activeDialog.questionId ? { ...q, handled: true } : q,
          ),
        );
      }
      void fetchOverrides({ silent: true });
      closeDialog();
      setToast(
        'Answer added. The assistant will use it within about a minute.',
      );
    } else if (activeDialog.type === 'edit') {
      const res = await ownerWriteJson<{ override: OwnerOverrideItem }>(
        `/api/owner/overrides/${activeDialog.override.id}`,
        'PATCH',
        { question: trimmedQ, answer: trimmedA },
      );
      setDialogSubmitting(false);
      if (!res.ok) {
        setDialogError(res.message);
        return;
      }
      setOverrides((prev) =>
        prev.map((item) =>
          item.id === activeDialog.override.id ? res.data.override : item,
        ),
      );
      closeDialog();
      setToast('Answer updated.');
    }
  };

  // Delete Override
  const handleDeleteOverride = async (id: string) => {
    if (busyIds[id]) return;
    setBusyIds((prev) => ({ ...prev, [id]: true }));
    const res = await ownerWriteJson<{ deleted: boolean; id: string }>(
      `/api/owner/overrides/${id}`,
      'DELETE',
    );
    setBusyIds((prev) => ({ ...prev, [id]: false }));
    setConfirmDeleteId(null);
    if (!res.ok) {
      setToast(res.message);
      return;
    }
    setOverrides((prev) => prev.filter((item) => item.id !== id));
    setToast('Answer removed.');
  };

  const totalPages = Math.max(1, Math.ceil(totalQuestions / pageSize));
  const isLimitReached = overrides.length >= overrideLimit;

  return (
    <div className="space-y-8">
      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="owner-toast"
          className="fixed top-4 right-4 z-50 flex items-center justify-between gap-3 border border-ink bg-card px-4 py-3 text-sm text-ink shadow-ledger"
        >
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="min-h-11 min-w-11 font-mono text-xs text-ink-2 hover:text-ink"
            aria-label="Close notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* Screen Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/20 pb-4">
        <div>
          <p className="ph-label text-brass-text">AI Learning Loop</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">Questions</h1>
        </div>
        <p className="text-sm text-ink-2">
          Teach the assistant answers to questions guests asked.
        </p>
      </div>

      {/* SECTION 1: Guest Questions */}
      <section aria-labelledby="questions-list-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="questions-list-heading" className="font-display text-2xl">
            Guest questions
          </h2>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="radiogroup"
              aria-label="Filter questions"
              className="inline-flex border border-ink bg-card"
            >
              <button
                type="button"
                role="radio"
                aria-checked={filter === 'unanswered'}
                onClick={() => {
                  setFilter('unanswered');
                  setPage(1);
                }}
                className={`min-h-11 px-3 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  filter === 'unanswered'
                    ? 'bg-ink text-paper'
                    : 'text-ink hover:bg-paper-2'
                }`}
              >
                Unanswered only
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={filter === 'all'}
                onClick={() => {
                  setFilter('all');
                  setPage(1);
                }}
                className={`min-h-11 border-l border-ink px-3 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  filter === 'all'
                    ? 'bg-ink text-paper'
                    : 'text-ink hover:bg-paper-2'
                }`}
              >
                All
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="questions-day-filter" className="sr-only">
                Filter by day
              </label>
              <input
                id="questions-day-filter"
                type="date"
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setPage(1);
                }}
                className="min-h-11 border border-ink bg-card px-2.5 font-mono text-xs text-ink"
                aria-label="Filter by day"
              />
              {day && (
                <button
                  type="button"
                  onClick={() => {
                    setDay('');
                    setPage(1);
                  }}
                  className="min-h-11 border border-ink/40 bg-card px-2.5 text-xs text-ink hover:bg-paper-2"
                >
                  Clear day
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Questions Status / Error */}
        {questionsError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 border border-err bg-card p-4 text-sm text-err"
          >
            <p>{questionsError}</p>
            <button
              type="button"
              onClick={() => void fetchQuestions()}
              className="min-h-11 border border-err bg-card px-3.5 font-semibold text-err hover:bg-paper-2"
            >
              Try again
            </button>
          </div>
        )}

        {/* Loading State */}
        {loadingQuestions && (
          <div className="border border-ink/20 bg-card p-8 text-center text-sm text-ink-2">
            Loading questions...
          </div>
        )}

        {/* Empty State */}
        {!loadingQuestions && !questionsError && questions.length === 0 && (
          <div className="border border-ink/20 bg-card p-8 text-center text-sm text-ink-2">
            No {filter === 'unanswered' ? 'unanswered ' : ''}questions found
            {day ? ` for ${day}` : ''}.
          </div>
        )}

        {/* Questions List */}
        {!loadingQuestions && !questionsError && questions.length > 0 && (
          <div className="space-y-3">
            {questions.map((q) => {
              const isExcerptOpen = expandedExcerpts.has(q.id);
              return (
                <article
                  key={q.id}
                  data-question-id={q.id}
                  className="border border-ink bg-card p-4 shadow-ledger transition-colors sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                        <span className="font-mono">
                          {formatKolkataTime(q.time)}
                        </span>
                        <span>•</span>
                        <span>{formatRelativeTime(q.time)}</span>
                        {q.unanswered_topic && (
                          <span className="border border-ink/30 bg-paper px-2 py-0.5 font-mono text-[11px] text-ink">
                            Topic: {q.unanswered_topic}
                          </span>
                        )}
                        {q.handled && (
                          <span className="border border-ok bg-ok/10 px-2 py-0.5 font-mono text-[11px] text-ok">
                            Handled
                          </span>
                        )}
                      </div>

                      {/* Guest question in large type */}
                      <p className="mt-2 font-display text-lg font-semibold text-ink sm:text-xl">
                        {q.question || q.unanswered_topic || 'Guest question'}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => openAddDialog(q.id, q.question, e)}
                        disabled={isLimitReached}
                        title={
                          isLimitReached
                            ? 'The 50-answer limit has been reached.'
                            : undefined
                        }
                        className="min-h-11 border border-ink bg-ink px-4 py-2 text-xs font-semibold text-paper transition hover:bg-ink-2 disabled:opacity-40"
                      >
                        Add an answer
                      </button>

                      {!q.handled && (
                        <button
                          type="button"
                          onClick={() => void handleMarkHandled(q.id)}
                          disabled={busyIds[q.id]}
                          className="min-h-11 border border-ink/40 bg-paper px-3 py-2 text-xs font-semibold text-ink transition hover:bg-paper-2 disabled:opacity-50"
                        >
                          Mark as handled
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Excerpt Toggle */}
                  {q.excerpt && q.excerpt.length > 0 && (
                    <div className="mt-3 border-t border-ink/10 pt-3">
                      <button
                        type="button"
                        onClick={() => toggleExcerpt(q.id)}
                        className="inline-flex min-h-11 items-center gap-1.5 font-mono text-xs text-brass-text underline hover:text-ink"
                        aria-expanded={isExcerptOpen}
                      >
                        {isExcerptOpen
                          ? 'Hide excerpt ▲'
                          : 'Show conversation excerpt ▼'}
                      </button>

                      {isExcerptOpen && (
                        <div
                          className="mt-2 space-y-2 border border-ink/20 bg-paper p-3 text-xs"
                          data-testid="conversation-excerpt"
                        >
                          {q.excerpt.map((msg, idx) => (
                            <div key={idx} className="space-y-0.5">
                              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                                {msg.role === 'user' ? 'Guest' : 'Assistant'}
                              </span>
                              <p className="whitespace-pre-wrap text-ink">
                                {msg.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-ink/20 pt-4 text-xs font-mono">
            <span className="text-ink-2">
              Page {page} of {totalPages} ({totalQuestions} total)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-h-11 border border-ink bg-card px-3 text-ink hover:bg-paper-2 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="min-h-11 border border-ink bg-card px-3 text-ink hover:bg-paper-2 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {/* SECTION 2: Answers You Have Taught */}
      <section
        aria-labelledby="overrides-heading"
        className="space-y-4 border-t border-ink/20 pt-8"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 id="overrides-heading" className="font-display text-2xl">
              Answers you have taught
            </h2>
            <p className="mt-1 text-xs text-ink-2">
              Overrides the assistant uses when answering questions.
            </p>
          </div>
          <span
            className={`font-mono text-xs font-semibold ${
              isLimitReached ? 'text-err' : 'text-brass-text'
            }`}
          >
            {overrides.length} of {overrideLimit} used
          </span>
        </div>

        {isLimitReached && (
          <p className="border border-warn bg-warn/10 p-3 text-xs text-warn">
            The 50-answer limit has been reached. Delete an answer before adding
            another.
          </p>
        )}

        {overridesError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 border border-err bg-card p-4 text-sm text-err"
          >
            <p>{overridesError}</p>
            <button
              type="button"
              onClick={() => void fetchOverrides()}
              className="min-h-11 border border-err bg-card px-3.5 font-semibold text-err hover:bg-paper-2"
            >
              Try again
            </button>
          </div>
        )}

        {loadingOverrides && (
          <div className="border border-ink/20 bg-card p-6 text-center text-sm text-ink-2">
            Loading taught answers...
          </div>
        )}

        {!loadingOverrides && !overridesError && overrides.length === 0 && (
          <div className="border border-ink/20 bg-card p-6 text-center text-sm text-ink-2">
            No custom answers taught yet. When you answer an unanswered guest
            question above, it will appear here.
          </div>
        )}

        {!loadingOverrides && !overridesError && overrides.length > 0 && (
          <div className="space-y-3">
            {overrides.map((item) => (
              <article
                key={item.id}
                data-override-id={item.id}
                className="border border-ink bg-card p-4 shadow-ledger"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <p className="ph-label text-brass-text">Question</p>
                      <p className="mt-1 font-semibold text-ink">
                        {item.question}
                      </p>
                    </div>
                    <div>
                      <p className="ph-label text-ink-2">Answer</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                        {item.answer}
                      </p>
                    </div>
                    <p className="font-mono text-[11px] text-ink-2">
                      Added {formatKolkataTime(item.created_at)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {confirmDeleteId === item.id ? (
                      <div className="flex items-center gap-1.5 border border-err bg-err/10 p-1.5">
                        <span className="text-xs text-err">Confirm?</span>
                        <button
                          type="button"
                          onClick={() => void handleDeleteOverride(item.id)}
                          disabled={busyIds[item.id]}
                          className="min-h-11 border border-err bg-err px-2.5 text-xs font-semibold text-paper hover:opacity-90"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="min-h-11 border border-ink/30 bg-card px-2 text-xs text-ink hover:bg-paper-2"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={(e) => openEditDialog(item, e)}
                          className="min-h-11 border border-ink/40 bg-paper px-3 text-xs font-semibold text-ink hover:bg-paper-2"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          className="min-h-11 border border-err/40 bg-card px-3 text-xs font-semibold text-err hover:bg-err/10"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Accessible Dialog: Add or Edit Answer */}
      {activeDialog && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
        >
          <div className="w-full max-w-lg border border-ink bg-paper p-5 text-ink shadow-ledger sm:p-6">
            <div className="flex items-start justify-between gap-3 border-b border-ink/20 pb-3">
              <div>
                <h3 id="dialog-title" className="font-display text-xl">
                  {activeDialog.type === 'add'
                    ? 'Add an answer'
                    : 'Edit taught answer'}
                </h3>
                <p className="mt-1 text-xs text-ink-2">
                  The assistant uses this answer within about a minute.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="min-h-11 min-w-11 font-mono text-sm text-ink-2 hover:text-ink"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDialogSubmit} className="mt-4 space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="dialog-question"
                    className="ph-label text-ink-2"
                  >
                    Question (3–300 chars)
                  </label>
                  <span className="font-mono text-[11px] text-ink-2">
                    {dialogQuestion.length} / 300
                  </span>
                </div>
                <textarea
                  ref={firstInputRef}
                  id="dialog-question"
                  value={dialogQuestion}
                  onChange={(e) =>
                    setDialogQuestion(e.target.value.slice(0, 300))
                  }
                  rows={2}
                  required
                  className="mt-1 block min-h-11 w-full border border-ink bg-card p-2.5 text-xs text-ink"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="dialog-answer"
                    className="ph-label text-ink-2"
                  >
                    Answer (3–600 chars)
                  </label>
                  <span className="font-mono text-[11px] text-ink-2">
                    {dialogAnswer.length} / 600
                  </span>
                </div>
                <textarea
                  id="dialog-answer"
                  value={dialogAnswer}
                  onChange={(e) =>
                    setDialogAnswer(e.target.value.slice(0, 600))
                  }
                  rows={4}
                  required
                  placeholder="Write clear, plain-text facts for the assistant..."
                  className="mt-1 block min-h-11 w-full border border-ink bg-card p-2.5 text-xs text-ink"
                />
              </div>

              {dialogError && (
                <p
                  role="alert"
                  className="border border-err bg-err/10 p-2.5 text-xs text-err"
                >
                  {dialogError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-ink/20 pt-3">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={dialogSubmitting}
                  className="min-h-11 border border-ink/40 bg-card px-4 text-xs font-semibold text-ink hover:bg-paper-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dialogSubmitting}
                  className="min-h-11 border border-ink bg-ink px-4 text-xs font-semibold text-paper transition hover:bg-ink-2 disabled:opacity-50"
                >
                  {dialogSubmitting
                    ? 'Saving...'
                    : activeDialog.type === 'add'
                      ? 'Save answer'
                      : 'Update answer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
