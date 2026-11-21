import React, { useEffect, useRef, useState } from 'react';
import type { CartItem } from '../../lib/cart';
import { whatsAppRedirectPath } from '../../lib/whatsapp';
import {
  STARTER_CHIPS,
  buildAssistantRequest,
  generateSessionId,
  parseAssistantResponse,
  parseAssistantTextBlocks,
  type AssistantPage,
  type ChatMessage,
} from '../../lib/assistant-ui';
import {
  BookingProposalCard,
  CartAddCard,
  HandoffCard,
} from './AssistantActionCards';

interface AssistantDialogProps {
  isOpen: boolean;
  onClose: () => void;
  page: AssistantPage;
  cartItems: CartItem[];
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const SESSION_STORAGE_KEY = 'ph_assistant_chat_v1';

type PersistedChat = {
  sessionId: string;
  messages: ChatMessage[];
};

function loadSession(): PersistedChat {
  if (typeof window === 'undefined') {
    return { sessionId: generateSessionId(), messages: [] };
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      const fresh = { sessionId: generateSessionId(), messages: [] };
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw) as PersistedChat;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.sessionId === 'string' &&
      Array.isArray(parsed.messages)
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return { sessionId: generateSessionId(), messages: [] };
}

function saveSession(data: PersistedChat) {
  if (typeof window === 'undefined') return;
  try {
    // Strip any sensitive form fields if present (ChatMessage only stores safe text & server actions)
    const safeData: PersistedChat = {
      sessionId: data.sessionId,
      messages: data.messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        actions: m.actions,
        resting: m.resting,
        isError: m.isError,
      })),
    };
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify(safeData),
    );
  } catch {
    /* ignore */
  }
}

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult:
    | ((event: {
        results?: {
          [index: number]: { [index: number]: { transcript: string } };
        };
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

export default function AssistantDialog({
  isOpen,
  onClose,
  page,
  cartItems,
  triggerRef,
}: AssistantDialogProps) {
  const [session, setSession] = useState<PersistedChat>(() => loadSession());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [supportsSpeech, setSupportsSpeech] = useState(false);
  const [isResting, setIsResting] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Check speech recognition support
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const win = window as SpeechRecognitionWindow;
      const SpeechRecognition =
        win.SpeechRecognition || win.webkitSpeechRecognition;
      setSupportsSpeech(Boolean(SpeechRecognition));
    }
  }, []);

  // Update resting state based on session
  useEffect(() => {
    const lastMsg = session.messages[session.messages.length - 1];
    if (lastMsg?.resting) {
      setIsResting(true);
    }
  }, [session.messages]);

  // Focus trap & Esc handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusableElements = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const focusable = Array.from(focusableElements);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Initial focus on input or close button
    const timer = setTimeout(() => {
      if (textareaRef.current && !isResting) {
        textareaRef.current.focus();
      } else {
        closeButtonRef.current?.focus();
      }
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
      triggerRef.current?.focus();
    };
  }, [isOpen, onClose, triggerRef, isResting]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [session.messages, loading, isOpen]);

  const handleNewChat = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
    const fresh = { sessionId: generateSessionId(), messages: [] };
    setSession(fresh);
    setIsResting(false);
    saveSession(fresh);
  };

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || loading || isResting) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      text: trimmed.slice(0, 500),
    };

    const nextMessages = [...session.messages, userMessage];
    const nextSession = { ...session, messages: nextMessages };
    setSession(nextSession);
    saveSession(nextSession);
    setInput('');
    setLoading(true);

    try {
      const outgoing = nextMessages
        .filter((m) => !m.isError)
        .map((m) => ({ role: m.role, text: m.text }));

      const requestBody = buildAssistantRequest(
        session.sessionId,
        outgoing,
        page,
        cartItems,
      );

      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const rawData: unknown = await response.json();
      const parsed = parseAssistantResponse(rawData);

      if (!parsed) {
        // Generic bubble if Zod validation fails
        const errorMsg: ChatMessage = {
          id: `msg-${Date.now()}-err`,
          role: 'assistant',
          text: 'We could not get an answer right now. Please try again.',
          isError: true,
        };
        const updated = {
          ...session,
          messages: [...nextMessages, errorMsg],
        };
        setSession(updated);
        saveSession(updated);
        return;
      }

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-asst`,
        role: 'assistant',
        text: parsed.text,
        actions: parsed.actions,
        resting: parsed.resting,
      };

      if (parsed.resting) {
        setIsResting(true);
      }

      const updated = {
        ...session,
        messages: [...nextMessages, assistantMessage],
      };
      setSession(updated);
      saveSession(updated);
    } catch {
      // Friendly non-200 / network error bubble with Retry
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-err`,
        role: 'assistant',
        text: 'We could not connect to the assistant right now. Please try again.',
        isError: true,
      };
      const updated = {
        ...session,
        messages: [...nextMessages, errorMsg],
      };
      setSession(updated);
      saveSession(updated);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    // Find the last user message and retry sending it
    const lastUser = [...session.messages]
      .reverse()
      .find((m) => m.role === 'user');
    if (lastUser) {
      // Remove trailing error messages
      const pruned = session.messages.filter((m) => !m.isError);
      setSession({ ...session, messages: pruned });
      sendMessage(lastUser.text);
    }
  };

  const handleKeyDownInput = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const win = window as SpeechRecognitionWindow;
    const SpeechRecognition =
      win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang =
        typeof navigator !== 'undefined'
          ? navigator.language || 'en-US'
          : 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setInput((prev) => {
            const next = prev ? `${prev} ${transcript}` : transcript;
            return next.slice(0, 500);
          });
        }
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  if (!isOpen) return null;

  const starterChip = STARTER_CHIPS[page] || STARTER_CHIPS.home;
  const hasUserMessages = session.messages.some((m) => m.role === 'user');

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-dialog-title"
      className="fixed inset-0 z-50 flex flex-col bg-paper text-ink shadow-ledger sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[560px] sm:max-h-[85vh] sm:w-[380px] sm:border sm:border-ink"
      data-testid="assistant-dialog"
    >
      {/* Header */}
      <header className="flex items-start justify-between border-b border-ink/20 bg-card p-3.5">
        <div>
          <h2
            id="assistant-dialog-title"
            className="font-display text-lg leading-tight text-ink"
          >
            Ask the Pigeonhole
          </h2>
          <p className="mt-0.5 text-xs text-ink-2">
            Answers only from what the café has written down.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleNewChat}
            className="inline-flex min-h-11 items-center justify-center border border-ink/30 bg-paper px-2.5 py-1 text-xs font-semibold text-ink transition hover:bg-paper-2"
            title="Clear chat and start fresh"
          >
            New chat
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center border border-ink bg-ink px-2.5 py-1 text-xs font-semibold text-paper transition hover:bg-ink-2"
            aria-label="Close assistant"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Message List */}
      <div
        role="log"
        aria-live="polite"
        className="flex-1 space-y-3 overflow-y-auto p-3.5 text-sm"
        data-testid="assistant-message-list"
      >
        {session.messages.length === 0 && (
          <div className="rounded-none border border-ink/20 bg-card p-3 text-xs leading-relaxed text-ink-2">
            <p className="font-semibold text-ink">Welcome to the café.</p>
            <p className="mt-1">
              Ask about our food, chai, trek packs, opening times, or booking a
              table. Everything comes straight from our written ledger.
            </p>
          </div>
        )}

        {/* Starter chip (only before first user message) */}
        {!hasUserMessages && (
          <div className="pt-1">
            <p className="ph-label text-ink-2">Suggested question</p>
            <button
              type="button"
              onClick={() => sendMessage(starterChip)}
              className="mt-1.5 inline-flex min-h-11 max-w-full items-center text-left border border-ink bg-paper-2 px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-ink hover:text-paper"
              data-testid="starter-chip"
            >
              “{starterChip}” →
            </button>
          </div>
        )}

        {/* Chat bubbles */}
        {session.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`max-w-[90%] px-3.5 py-2 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'border border-ink bg-ink text-paper'
                  : 'border border-ink/20 bg-card text-ink'
              }`}
            >
              {/* PLAIN TEXT rendering - strictly safe, no innerHTML */}
              <div className="space-y-1.5">
                {parseAssistantTextBlocks(msg.text).map((block, idx) =>
                  block.type === 'paragraph' ? (
                    <p key={idx} className="whitespace-pre-wrap">
                      {block.text}
                    </p>
                  ) : (
                    <ul key={idx} className="space-y-1 pl-4">
                      {block.items.map((item, itemIdx) => (
                        <li key={itemIdx} className="list-disc">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ),
                )}
              </div>

              {/* Action Cards */}
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-2 space-y-2">
                  {msg.actions.map((action, actionIdx) => {
                    if (action.type === 'cart_add') {
                      return <CartAddCard key={actionIdx} action={action} />;
                    }
                    if (action.type === 'booking_proposal') {
                      return (
                        <BookingProposalCard key={actionIdx} action={action} />
                      );
                    }
                    if (action.type === 'handoff') {
                      return <HandoffCard key={actionIdx} />;
                    }
                    return null;
                  })}
                </div>
              )}

              {/* Retry button for error bubbles */}
              {msg.isError && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="inline-flex min-h-11 items-center justify-center border border-err bg-paper px-3 py-1 text-xs font-semibold text-err hover:bg-paper-2"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex items-center gap-2 border border-ink/20 bg-card px-3 py-2 text-xs text-ink-2 self-start">
            <span
              className="inline-block size-2 animate-ping rounded-full bg-brass"
              aria-hidden="true"
            />
            <span className="font-mono">Consulting the ledger...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Footer / Input Area */}
      <footer className="border-t border-ink/20 bg-card p-3">
        {isResting ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-2">
              The assistant is currently resting for the day.
            </p>
            <a
              href={whatsAppRedirectPath(
                'Hello, the assistant is resting. I have a question.',
              )}
              className="inline-flex min-h-11 w-full items-center justify-center border border-ink bg-ink px-4 py-2 text-xs font-semibold text-paper no-underline transition hover:bg-ink-2"
            >
              Talk to the team →
            </a>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="space-y-2"
          >
            <div className="relative flex items-center gap-1.5">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 500))}
                onKeyDown={handleKeyDownInput}
                disabled={loading}
                maxLength={500}
                rows={1}
                placeholder="Ask about menu, hours, or table booking..."
                className="block min-h-11 max-h-24 flex-1 resize-none border border-ink bg-paper px-3 py-2 text-xs text-ink placeholder:text-ink-2/60 focus:bg-card"
                aria-label="Ask a question"
              />

              {supportsSpeech && (
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  disabled={loading}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center border border-ink text-xs transition ${
                    isListening
                      ? 'animate-pulse bg-stamp text-paper'
                      : 'bg-paper text-ink hover:bg-paper-2'
                  }`}
                  aria-label={
                    isListening
                      ? 'Stop listening'
                      : 'Voice input via microphone'
                  }
                  title="Voice input"
                >
                  🎤
                </button>
              )}

              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="inline-flex min-h-11 min-w-11 items-center justify-center border border-ink bg-ink px-3 py-2 text-xs font-semibold text-paper transition hover:bg-ink-2 disabled:opacity-40"
                aria-label="Send message"
              >
                Send
              </button>
            </div>
          </form>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px] text-ink-2">
          <span>
            AI assistant. It can make mistakes. For allergies, tell the team.
          </span>
          <a
            href={whatsAppRedirectPath()}
            className="text-brass-text underline hover:text-ink"
          >
            Talk to the team
          </a>
        </div>
      </footer>
    </div>
  );
}
