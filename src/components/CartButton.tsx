import { useEffect, useState } from 'react';
import { cartCount, CART_STORAGE_KEY, readCart } from '../lib/cart';

export default function CartButton() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(cartCount(readCart()));
    const storage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) update();
    };
    update();
    window.addEventListener('storage', storage);
    window.addEventListener('ph-cart-change', update);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('ph-cart-change', update);
    };
  }, []);
  return (
    <a
      className="inline-flex min-h-11 items-center border border-ink px-4 font-semibold no-underline transition hover:bg-ink hover:text-paper"
      href="/order"
      aria-label={`Cart with ${count} items`}
    >
      Cart <span className="ml-2 font-mono text-sm">{count}</span>
    </a>
  );
}
