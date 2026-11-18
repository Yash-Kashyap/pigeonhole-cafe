import { describe, expect, it } from 'vitest';
import { loadMenu } from '../lib/menu-data';
import { resolveTrekItems, TREK_ITEM_IDS } from './trek-items';

describe('trek menu data', () => {
  it('contains exactly the documented curated IDs', () => {
    expect(TREK_ITEM_IDS).toEqual([
      'PH0152',
      'PH0153',
      'PH0001',
      'PH0005',
      'PH0227',
      'PH0061',
      'PH0060',
      'PH0148',
      'PH0146',
      'PH0154',
      'PH0155',
      'PH0203',
      'PH0049',
    ]);
  });

  it('resolves every ID from menu data without copying prices or allergens', () => {
    const menu = loadMenu();
    const byId = new Map(menu.map((item) => [item.id, item]));
    const resolved = resolveTrekItems(menu);
    expect(resolved).toHaveLength(TREK_ITEM_IDS.length);
    for (const item of resolved) {
      expect(item).toBe(byId.get(item.id));
      expect(item.price_usd).toBeGreaterThan(0);
      expect(Array.isArray(item.allergens)).toBe(true);
    }
  });

  it('fails when a curated ID is absent', () => {
    const menu = loadMenu().filter((item) => item.id !== TREK_ITEM_IDS[0]);
    expect(() => resolveTrekItems(menu)).toThrow(TREK_ITEM_IDS[0]);
  });
});
