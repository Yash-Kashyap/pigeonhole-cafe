import type { MenuItem } from '../lib/menu';

export const TREK_ITEM_IDS = [
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
] as const;

export function resolveTrekItems(items: readonly MenuItem[]): MenuItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return TREK_ITEM_IDS.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`Required trek menu item ${id} is missing.`);
    return item;
  });
}
