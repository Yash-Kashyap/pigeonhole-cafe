import { MAX_ITEMS_PER_ORDER, MAX_QUANTITY_PER_ITEM } from './rules';
import type { MenuItem } from './menu';

export const CART_STORAGE_KEY = 'ph_cart_v1';
export const MAX_NOTE_LENGTH = 80;

export type CartItem = {
  id: string;
  quantity: number;
  note?: string;
};

export type CartLine = {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  note?: string;
  allergens: string[];
  prepMinutes: number;
  category: string;
  available: boolean;
};

export type CartDetails = {
  lines: CartLine[];
  subtotal: number;
  itemCount: number;
  allergens: string[];
  unknownIds: string[];
  maxPrepMinutes: number;
};

export function sanitizeNote(note: unknown): string | undefined {
  if (typeof note !== 'string') return undefined;
  const trimmed = note.trim().slice(0, MAX_NOTE_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

export function sanitizeCartItem(raw: unknown): CartItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const id = String(candidate.id ?? '');
  if (!/^PH\d{4}$/.test(id)) return null;
  const quantity = Number(candidate.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  const note = sanitizeNote(candidate.note);
  return note ? { id, quantity, note } : { id, quantity };
}

export function clampCart(items: CartItem[]): CartItem[] {
  const merged = new Map<string, { quantity: number; note?: string }>();
  for (const item of items) {
    const valid = sanitizeCartItem(item);
    if (!valid) continue;
    const existing = merged.get(valid.id);
    if (existing) {
      existing.quantity += valid.quantity;
      if (valid.note) existing.note = valid.note;
    } else {
      merged.set(valid.id, {
        quantity: valid.quantity,
        ...(valid.note ? { note: valid.note } : {}),
      });
    }
  }

  const result: CartItem[] = [];
  let totalCount = 0;

  for (const [id, data] of merged.entries()) {
    if (totalCount >= MAX_ITEMS_PER_ORDER) break;
    const itemMax = Math.min(MAX_QUANTITY_PER_ITEM, data.quantity);
    const allowed = Math.min(itemMax, MAX_ITEMS_PER_ORDER - totalCount);
    if (allowed > 0) {
      result.push({
        id,
        quantity: allowed,
        ...(data.note ? { note: data.note } : {}),
      });
      totalCount += allowed;
    }
  }

  return result;
}

export function addItem(
  items: CartItem[],
  id: string,
  quantity = 1,
  note?: string,
): CartItem[] {
  if (!/^PH\d{4}$/.test(id) || quantity < 1) return items;
  const currentTotal = items.reduce((sum, item) => sum + item.quantity, 0);
  if (currentTotal >= MAX_ITEMS_PER_ORDER) return items;

  const cleanNote = sanitizeNote(note);
  const existingIndex = items.findIndex((item) => item.id === id);

  if (existingIndex >= 0) {
    const existing = items[existingIndex]!;
    const spaceInItem = MAX_QUANTITY_PER_ITEM - existing.quantity;
    const spaceInCart = MAX_ITEMS_PER_ORDER - currentTotal;
    const addAmount = Math.min(quantity, spaceInItem, spaceInCart);
    if (addAmount <= 0) {
      if (cleanNote && cleanNote !== existing.note) {
        const next = [...items];
        next[existingIndex] = { ...existing, note: cleanNote };
        return next;
      }
      return items;
    }
    const next = [...items];
    next[existingIndex] = {
      ...existing,
      quantity: existing.quantity + addAmount,
      ...(cleanNote
        ? { note: cleanNote }
        : existing.note
          ? { note: existing.note }
          : {}),
    };
    return next;
  }

  const spaceInCart = MAX_ITEMS_PER_ORDER - currentTotal;
  const initialQty = Math.min(quantity, MAX_QUANTITY_PER_ITEM, spaceInCart);
  if (initialQty <= 0) return items;

  return [
    ...items,
    {
      id,
      quantity: initialQty,
      ...(cleanNote ? { note: cleanNote } : {}),
    },
  ];
}

export function updateQuantity(
  items: CartItem[],
  id: string,
  quantity: number,
): CartItem[] {
  if (quantity <= 0) {
    return items.filter((item) => item.id !== id);
  }
  const existing = items.find((item) => item.id === id);
  if (!existing) return items;

  const otherTotal = items
    .filter((item) => item.id !== id)
    .reduce((sum, item) => sum + item.quantity, 0);
  const targetQty = Math.min(
    Math.max(1, Math.floor(quantity)),
    MAX_QUANTITY_PER_ITEM,
    MAX_ITEMS_PER_ORDER - otherTotal,
  );

  return items.map((item) =>
    item.id === id ? { ...item, quantity: targetQty } : item,
  );
}

export function updateNote(
  items: CartItem[],
  id: string,
  note?: string,
): CartItem[] {
  const cleanNote = sanitizeNote(note);
  return items.map((item) => {
    if (item.id !== id) return item;
    if (!cleanNote) {
      const rest = { ...item };
      delete rest.note;
      return rest;
    }
    return { ...item, note: cleanNote };
  });
}

export function removeItem(items: CartItem[], id: string): CartItem[] {
  return items.filter((item) => item.id !== id);
}

export function computeCartDetails(
  items: CartItem[],
  menuSource: MenuItem[] | Map<string, MenuItem>,
): CartDetails {
  const menuMap =
    menuSource instanceof Map
      ? menuSource
      : new Map(menuSource.map((item) => [item.id, item]));

  const lines: CartLine[] = [];
  const unknownIds: string[] = [];

  for (const item of items) {
    const menuItem = menuMap.get(item.id);
    if (!menuItem) {
      unknownIds.push(item.id);
      continue;
    }
    const lineTotal = Number((item.quantity * menuItem.price_usd).toFixed(2));
    lines.push({
      id: menuItem.id,
      name: menuItem.name,
      unitPrice: menuItem.price_usd,
      quantity: item.quantity,
      lineTotal,
      note: item.note,
      allergens: menuItem.allergens,
      prepMinutes: menuItem.prep_minutes,
      category: menuItem.category,
      available: menuItem.available,
    });
  }

  const subtotal = Number(
    lines.reduce((sum, line) => sum + line.lineTotal, 0).toFixed(2),
  );
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const allergens = Array.from(
    new Set(lines.flatMap((line) => line.allergens)),
  ).sort();
  const maxPrepMinutes = lines.reduce(
    (max, line) => Math.max(max, line.prepMinutes),
    0,
  );

  return {
    lines,
    subtotal,
    itemCount,
    allergens,
    unknownIds,
    maxPrepMinutes,
  };
}

export function getOftenAddedSuggestions(
  cartItems: CartItem[],
  menuItems: MenuItem[],
  limit = 4,
): MenuItem[] {
  const cartIds = new Set(cartItems.map((item) => item.id));
  const menuMap = new Map(menuItems.map((item) => [item.id, item]));

  const hasChai = cartItems.some((item) => {
    const mi = menuMap.get(item.id);
    return (
      mi &&
      (mi.category === 'Chai & Tea' || mi.name.toLowerCase().includes('chai'))
    );
  });

  const hasMain = cartItems.some((item) => {
    const mi = menuMap.get(item.id);
    if (!mi) return false;
    return (
      mi.category === 'Indian Mains' ||
      mi.category === 'Indo-Chinese & Asian' ||
      mi.category === 'Continental, Mexican & Salads' ||
      mi.category === 'Pizza & Pasta' ||
      mi.category === 'Sandwiches, Burgers & Wraps'
    );
  });

  const suggestions: MenuItem[] = [];
  const addedIds = new Set<string>();

  const tryAdd = (item: MenuItem | undefined) => {
    if (
      !item ||
      !item.available ||
      cartIds.has(item.id) ||
      addedIds.has(item.id)
    )
      return false;
    suggestions.push(item);
    addedIds.add(item.id);
    return true;
  };

  // Rule 1: If cart has a chai, suggest Maska Pav (PH0060)
  if (hasChai) {
    tryAdd(menuMap.get('PH0060'));
  }

  // Rule 2: If cart has a main, suggest popular/signature from Chai & Tea or Cold Drinks
  if (hasMain && suggestions.length < limit) {
    const drinkMatch = menuItems.find((mi) => {
      if (!mi.available || cartIds.has(mi.id) || addedIds.has(mi.id))
        return false;
      const isDrink =
        mi.category === 'Chai & Tea' || mi.category === 'Cold Drinks';
      const isTop =
        mi.tags.includes('popular') || mi.tags.includes('signature');
      return isDrink && isTop;
    });
    if (drinkMatch) {
      tryAdd(drinkMatch);
    }
  }

  // Rule 3: Signature items not yet in cart
  const signatureIds = [
    'PH0003',
    'PH0060',
    'PH0152',
    'PH0097',
    'PH0203',
    'PH0049',
  ];
  for (const sigId of signatureIds) {
    if (suggestions.length >= limit) break;
    tryAdd(menuMap.get(sigId));
  }

  // Fallback: popular items
  if (suggestions.length < limit) {
    for (const item of menuItems) {
      if (suggestions.length >= limit) break;
      if (item.tags.includes('popular')) {
        tryAdd(item);
      }
    }
  }

  return suggestions.slice(0, limit);
}

let cachedMenuPromise: Promise<MenuItem[]> | null = null;

export async function fetchMenuData(): Promise<MenuItem[]> {
  if (cachedMenuPromise) return cachedMenuPromise;
  if (typeof window === 'undefined') {
    return [];
  }
  cachedMenuPromise = fetch('/menu.json')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load menu: ${res.status}`);
      return res.json() as Promise<MenuItem[]>;
    })
    .catch((err) => {
      cachedMenuPromise = null;
      console.error('Error fetching menu.json:', err);
      return [];
    });
  return cachedMenuPromise;
}

export function readCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(CART_STORAGE_KEY) ?? '[]',
    );
    if (!Array.isArray(raw)) return [];
    const validItems: CartItem[] = [];
    for (const entry of raw) {
      const sanitized = sanitizeCartItem(entry);
      if (sanitized) validItems.push(sanitized);
    }
    return clampCart(validItems);
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]): void {
  if (typeof window === 'undefined') return;
  const clamped = clampCart(items);
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(clamped));
  window.dispatchEvent(new CustomEvent('ph-cart-change'));
}

export function addToCart(id: string, quantity = 1, note?: string): void {
  const current = readCart();
  const next = addItem(current, id, quantity, note);
  writeCart(next);
}

export function setQuantity(id: string, quantity: number): void {
  const current = readCart();
  const next = updateQuantity(current, id, quantity);
  writeCart(next);
}

export function setNote(id: string, note?: string): void {
  const current = readCart();
  const next = updateNote(current, id, note);
  writeCart(next);
}

export function removeFromCart(id: string): void {
  const current = readCart();
  const next = removeItem(current, id);
  writeCart(next);
}

export function clearCart(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CART_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('ph-cart-change'));
}

export function cartCount(items = readCart()): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}
