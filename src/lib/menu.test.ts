import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filterMenu,
  parseFilters,
  serializeFilters,
  sortMenu,
} from './menu';
import { loadMenu } from './menu-data';

const menu = loadMenu();

describe('menu data and filters', () => {
  it('parses 240 rows and preserves a category containing commas', () => {
    expect(menu).toHaveLength(240);
    expect(
      menu.some((item) => item.category === 'Sandwiches, Burgers & Wraps'),
    ).toBe(true);
  });
  it('combines vegan and gluten-free with AND logic', () => {
    const found = filterMenu(menu, {
      ...DEFAULT_FILTERS,
      vegan: true,
      glutenFree: true,
    });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((item) => item.vegan && item.gluten_free)).toBe(true);
  });
  it('hides nut items', () => {
    const found = filterMenu(menu, { ...DEFAULT_FILTERS, avoid: ['nuts'] });
    expect(
      found.some((item) =>
        ['Walnut Brownie', 'Jaggery Kheer'].includes(item.name),
      ),
    ).toBe(false);
  });
  it('applies a price cap', () => {
    expect(
      filterMenu(menu, { ...DEFAULT_FILTERS, maxPrice: 2 }).every(
        (item) => item.price_usd <= 2,
      ),
    ).toBe(true);
  });
  it('searches Jain flags', () => {
    const found = filterMenu(menu, { ...DEFAULT_FILTERS, query: 'jain' });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((item) => item.jain_option)).toBe(true);
  });
  it('round trips URL state including comma categories', () => {
    const state = {
      ...DEFAULT_FILTERS,
      category: 'Continental, Mexican & Salads',
      vegan: true,
      avoid: ['nuts' as const],
      maxPrice: 4,
    };
    expect(parseFilters(serializeFilters(state))).toEqual(state);
  });
  it('sorts signatures before popular items', () => {
    const sorted = sortMenu(menu, 'recommended');
    expect(sorted[0]?.tags).toContain('signature');
  });
});
