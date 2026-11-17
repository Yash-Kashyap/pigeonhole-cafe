export const CART_STORAGE_KEY = 'ph_cart_v1';

export type CartItem = { id: string; quantity: number };

export function readCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(CART_STORAGE_KEY) ?? '[]',
    );
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is CartItem =>
        typeof item === 'object' &&
        item !== null &&
        /^PH\d{4}$/.test(String((item as CartItem).id)) &&
        Number.isInteger((item as CartItem).quantity) &&
        (item as CartItem).quantity > 0,
    );
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]): void {
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('ph-cart-change'));
}

export function addToCart(id: string, quantity = 1): void {
  const items = readCart();
  const current = items.find((item) => item.id === id);
  if (current) current.quantity = Math.min(20, current.quantity + quantity);
  else items.push({ id, quantity: Math.min(20, Math.max(1, quantity)) });
  writeCart(items);
}

export function cartCount(items = readCart()): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}
