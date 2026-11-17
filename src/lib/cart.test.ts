import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addItem,
  CART_STORAGE_KEY,
  cartCount,
  clampCart,
  clearCart,
  computeCartDetails,
  getOftenAddedSuggestions,
  readCart,
  removeItem,
  sanitizeCartItem,
  sanitizeNote,
  setNote,
  setQuantity,
  updateNote,
  updateQuantity,
  writeCart,
  type CartItem,
} from './cart';
import type { MenuItem } from './menu';

const dummyMenu: MenuItem[] = [
  {
    id: 'PH0003',
    name: 'Post Chai',
    description: 'House blend spiced tea',
    category: 'Chai & Tea',
    subcategory: 'Signature Chai',
    price_usd: 1.2,
    diet: 'vegetarian',
    vegan: false,
    jain_option: true,
    gluten_free: true,
    allergens: ['dairy'],
    spice_level: 1,
    prep_minutes: 5,
    tags: ['signature'],
    available: true,
    sourceIndex: 1,
  },
  {
    id: 'PH0060',
    name: 'Maska Pav',
    description: 'Toasted bun with butter',
    category: 'Breakfast',
    subcategory: 'Buns',
    price_usd: 1.0,
    diet: 'vegetarian',
    vegan: false,
    jain_option: true,
    gluten_free: false,
    allergens: ['dairy', 'gluten'],
    spice_level: 0,
    prep_minutes: 4,
    tags: ['signature'],
    available: true,
    sourceIndex: 2,
  },
  {
    id: 'PH0152',
    name: 'Himachali Siddu',
    description: 'Steamed wheat bun with walnut stuffing',
    category: 'Indian Mains',
    subcategory: 'Regional Specialties',
    price_usd: 3.5,
    diet: 'vegetarian',
    vegan: true,
    jain_option: false,
    gluten_free: false,
    allergens: ['gluten', 'nuts'],
    spice_level: 1,
    prep_minutes: 15,
    tags: ['signature'],
    available: true,
    sourceIndex: 3,
  },
  {
    id: 'PH0097',
    name: 'Pan-Fried Paneer Momos',
    description: 'Crispy dumplings with cottage cheese',
    category: 'Snacks & Small Plates',
    subcategory: 'Momos',
    price_usd: 2.8,
    diet: 'vegetarian',
    vegan: false,
    jain_option: true,
    gluten_free: false,
    allergens: ['dairy', 'gluten', 'soy'],
    spice_level: 2,
    prep_minutes: 12,
    tags: ['signature', 'popular'],
    available: true,
    sourceIndex: 4,
  },
];

describe('pure cart operations', () => {
  it('sanitizes notes and caps them at 80 characters', () => {
    expect(sanitizeNote('  extra hot, less sugar  ')).toBe(
      'extra hot, less sugar',
    );
    expect(sanitizeNote('   ')).toBeUndefined();
    expect(sanitizeNote(123)).toBeUndefined();
    const long = 'a'.repeat(100);
    const sanitized = sanitizeNote(long);
    expect(sanitized?.length).toBe(80);
  });

  it('sanitizes cart items and rejects invalid shapes', () => {
    expect(sanitizeCartItem(null)).toBeNull();
    expect(sanitizeCartItem({})).toBeNull();
    expect(sanitizeCartItem({ id: 'INVALID', quantity: 2 })).toBeNull();
    expect(sanitizeCartItem({ id: 'PH0001', quantity: 0 })).toBeNull();
    expect(sanitizeCartItem({ id: 'PH0001', quantity: 2.5 })).toBeNull();

    // Legacy shape (no note)
    expect(sanitizeCartItem({ id: 'PH0003', quantity: 2 })).toEqual({
      id: 'PH0003',
      quantity: 2,
    });

    // With note
    expect(
      sanitizeCartItem({ id: 'PH0003', quantity: 2, note: '  no dairy ' }),
    ).toEqual({
      id: 'PH0003',
      quantity: 2,
      note: 'no dairy',
    });
  });

  it('adds items, increments existing, and clamps per item to 20', () => {
    let cart: CartItem[] = [];
    cart = addItem(cart, 'PH0003', 2);
    expect(cart).toEqual([{ id: 'PH0003', quantity: 2 }]);

    cart = addItem(cart, 'PH0003', 3);
    expect(cart).toEqual([{ id: 'PH0003', quantity: 5 }]);

    // Exceeds 20 per item
    cart = addItem(cart, 'PH0003', 25);
    expect(cart[0]?.quantity).toBe(20);

    // Cannot add more once at 20
    cart = addItem(cart, 'PH0003', 1);
    expect(cart[0]?.quantity).toBe(20);
  });

  it('clamps total items in cart to 40', () => {
    let cart: CartItem[] = [
      { id: 'PH0001', quantity: 20 },
      { id: 'PH0002', quantity: 18 },
    ];
    // Total is 38. Adding 5 to PH0003 should only allow 2.
    cart = addItem(cart, 'PH0003', 5);
    expect(cartCount(cart)).toBe(40);
    expect(cart.find((i) => i.id === 'PH0003')?.quantity).toBe(2);

    // Cart is at 40; adding new item should be ignored
    cart = addItem(cart, 'PH0004', 1);
    expect(cart.find((i) => i.id === 'PH0004')).toBeUndefined();
  });

  it('updates quantity and removes item when quantity is 0 or negative', () => {
    let cart: CartItem[] = [{ id: 'PH0003', quantity: 5 }];
    cart = updateQuantity(cart, 'PH0003', 10);
    expect(cart[0]?.quantity).toBe(10);

    cart = updateQuantity(cart, 'PH0003', 0);
    expect(cart).toEqual([]);
  });

  it('updates and removes notes', () => {
    let cart: CartItem[] = [{ id: 'PH0003', quantity: 2 }];
    cart = updateNote(cart, 'PH0003', 'extra spicy');
    expect(cart[0]?.note).toBe('extra spicy');

    cart = updateNote(cart, 'PH0003', '');
    expect(cart[0]?.note).toBeUndefined();
  });

  it('removes items', () => {
    const cart: CartItem[] = [
      { id: 'PH0003', quantity: 2 },
      { id: 'PH0060', quantity: 1 },
    ];
    const updated = removeItem(cart, 'PH0003');
    expect(updated).toEqual([{ id: 'PH0060', quantity: 1 }]);
  });

  it('clamps and merges raw cart correctly', () => {
    const raw: CartItem[] = [
      { id: 'PH0003', quantity: 15 },
      { id: 'PH0003', quantity: 10, note: 'hot' },
      { id: 'PH0060', quantity: 30 },
    ];
    const clamped = clampCart(raw);
    expect(clamped[0]?.id).toBe('PH0003');
    expect(clamped[0]?.quantity).toBe(20);
    expect(clamped[0]?.note).toBe('hot');

    expect(clamped[1]?.id).toBe('PH0060');
    // Total was 40, so PH0060 takes remaining 20
    expect(clamped[1]?.quantity).toBe(20);
    expect(cartCount(clamped)).toBe(40);
  });
});

describe('computeCartDetails', () => {
  it('computes line totals, subtotal, itemCount, allergens and drops unknown IDs', () => {
    const cart: CartItem[] = [
      { id: 'PH0003', quantity: 2, note: 'steaming' },
      { id: 'PH0060', quantity: 1 },
      { id: 'PH9999', quantity: 4 }, // unknown
    ];

    const details = computeCartDetails(cart, dummyMenu);
    expect(details.lines.length).toBe(2);
    expect(details.unknownIds).toEqual(['PH9999']);

    // Line 1: Post Chai $1.20 x 2 = $2.40
    expect(details.lines[0]?.lineTotal).toBe(2.4);
    expect(details.lines[0]?.note).toBe('steaming');

    // Line 2: Maska Pav $1.00 x 1 = $1.00
    expect(details.lines[1]?.lineTotal).toBe(1.0);

    // Subtotal: 2.40 + 1.00 = 3.40
    expect(details.subtotal).toBe(3.4);
    expect(details.itemCount).toBe(3);

    // Allergens: dairy, gluten
    expect(details.allergens).toEqual(['dairy', 'gluten']);
    // Max prep minutes: max(5, 4) = 5
    expect(details.maxPrepMinutes).toBe(5);
  });
});

describe('getOftenAddedSuggestions', () => {
  it('suggests Maska Pav when cart has a chai', () => {
    const cart: CartItem[] = [{ id: 'PH0003', quantity: 1 }]; // Post Chai
    const suggestions = getOftenAddedSuggestions(cart, dummyMenu);
    expect(suggestions.some((s) => s.id === 'PH0060')).toBe(true);
  });

  it('suggests a drink or signature when cart has a main', () => {
    const cart: CartItem[] = [{ id: 'PH0152', quantity: 1 }]; // Himachali Siddu (main)
    const suggestions = getOftenAddedSuggestions(cart, dummyMenu);
    expect(suggestions.some((s) => s.id === 'PH0003')).toBe(true); // Post Chai
  });
});

describe('cart storage wrapper', () => {
  class MockStorage {
    private store = new Map<string, string>();
    getItem(key: string) {
      return this.store.get(key) ?? null;
    }
    setItem(key: string, value: string) {
      this.store.set(key, String(value));
    }
    removeItem(key: string) {
      this.store.delete(key);
    }
    clear() {
      this.store.clear();
    }
  }

  const originalWindow = globalThis.window;

  beforeEach(() => {
    const storage = new MockStorage();
    globalThis.window = {
      localStorage: storage,
      dispatchEvent: () => true,
      CustomEvent: class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      },
    } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it('reads legacy carts and handles corrupt JSON', () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([{ id: 'PH0003', quantity: 2 }]),
    );
    expect(readCart()).toEqual([{ id: 'PH0003', quantity: 2 }]);

    window.localStorage.setItem(CART_STORAGE_KEY, '{ corrupt json');
    expect(readCart()).toEqual([]);
  });

  it('writes and updates cart in storage', () => {
    writeCart([{ id: 'PH0003', quantity: 3 }]);
    expect(readCart()).toEqual([{ id: 'PH0003', quantity: 3 }]);

    setQuantity('PH0003', 5);
    expect(readCart()).toEqual([{ id: 'PH0003', quantity: 5 }]);

    setNote('PH0003', 'hot');
    expect(readCart()).toEqual([{ id: 'PH0003', quantity: 5, note: 'hot' }]);

    clearCart();
    expect(readCart()).toEqual([]);
  });
});
