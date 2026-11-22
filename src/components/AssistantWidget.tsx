import { useEffect, useRef, useState } from 'react';
import { readCart, type CartItem, CART_STORAGE_KEY } from '../lib/cart';
import type { AssistantPage } from '../lib/assistant-ui';
import AssistantDialog from './assistant/AssistantDialog';

interface AssistantWidgetProps {
  page?: AssistantPage;
}

function PostmarkIcon() {
  return (
    <svg
      className="size-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" strokeDasharray="3 2" />
      <circle cx="12" cy="12" r="6" />
      <path
        d="M9.5 9.5h1.8a1.2 1.2 0 0 1 0 2.4H9.5m0-2.4v4.5"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 9.5v4.5m0-2.2h2.2m0-2.3v4.5"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function AssistantWidget({
  page = 'other',
}: AssistantWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>(() => readCart());
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Synchronize cart state on changes
  useEffect(() => {
    const updateCart = () => setCartItems(readCart());
    const onStorage = (e: StorageEvent) => {
      if (e.key === CART_STORAGE_KEY) updateCart();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('ph-cart-change', updateCart);

    // Listen to external triggers with [data-open-assistant]
    const handleDocumentClick = (e: MouseEvent) => {
      const target =
        e.target instanceof Element
          ? e.target.closest('[data-open-assistant]')
          : null;
      if (target) {
        setIsOpen(true);
      }
    };
    document.addEventListener('click', handleDocumentClick);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('ph-cart-change', updateCart);
      document.removeEventListener('click', handleDocumentClick);
    };
  }, []);

  return (
    <aside
      className="fixed right-4 bottom-4 z-40 transition-all duration-200 sm:right-6 sm:bottom-6"
      data-assistant-widget="true"
      aria-label="Café assistant"
    >
      {!isOpen && (
        <button
          ref={buttonRef}
          id="assistant-open"
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex min-h-11 items-center gap-2.5 border border-ink bg-ink px-4 py-2 font-display text-sm font-semibold tracking-wide text-paper shadow-ledger transition-transform hover:scale-[1.02] active:scale-[0.98]"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label="Ask the Pigeonhole"
        >
          <PostmarkIcon />
          <span>Ask</span>
        </button>
      )}

      {isOpen && (
        <AssistantDialog
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          page={page}
          cartItems={cartItems}
          triggerRef={buttonRef}
        />
      )}
    </aside>
  );
}
