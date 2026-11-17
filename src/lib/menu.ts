// Client-safe menu types and filter logic. Anything that reads or parses the CSV lives in menu-data.ts (server only).
export const MENU_CATEGORIES = [
  'Chai & Tea',
  'Coffee & Hot Drinks',
  'Cold Drinks',
  'Breakfast',
  'Snacks & Small Plates',
  'Sandwiches, Burgers & Wraps',
  'Pizza & Pasta',
  'Indian Mains',
  'Indo-Chinese & Asian',
  'Continental, Mexican & Salads',
  'Desserts',
  'Kids Menu',
  'Combos & Offers',
  'Add-ons',
  'Bakery',
] as const;

export const ALLERGENS = ['dairy', 'gluten', 'nuts', 'soy', 'honey'] as const;
export type Allergen = (typeof ALLERGENS)[number];
export type MenuSort =
  'recommended' | 'price-asc' | 'price-desc' | 'name' | 'quickest';
export type SpiceFilter = 'any' | 'mild' | 'medium' | 'hot';

export type MenuCategory = (typeof MENU_CATEGORIES)[number];

export type MenuItem = {
  id: string;
  category: MenuCategory;
  subcategory: string;
  name: string;
  description: string;
  price_usd: number;
  diet: 'vegetarian';
  vegan: boolean;
  jain_option: boolean;
  gluten_free: boolean;
  allergens: string[];
  spice_level: 0 | 1 | 2 | 3;
  prep_minutes: number;
  tags: string[];
  available: boolean;
  sourceIndex: number;
};

export type MenuFilters = {
  query: string;
  category: string;
  vegan: boolean;
  jain: boolean;
  glutenFree: boolean;
  spice: SpiceFilter;
  avoid: Allergen[];
  maxPrice: number | null;
  sort: MenuSort;
  kids: boolean;
  quick: boolean;
};

export const DEFAULT_FILTERS: MenuFilters = {
  query: '',
  category: '',
  vegan: false,
  jain: false,
  glutenFree: false,
  spice: 'any',
  avoid: [],
  maxPrice: null,
  sort: 'recommended',
  kids: false,
  quick: false,
};

export function filterMenu(items: MenuItem[], state: MenuFilters): MenuItem[] {
  const query = state.query.trim().toLowerCase();
  return items.filter((item) => {
    const searchText = [
      item.name,
      item.description,
      item.subcategory,
      ...item.tags,
      item.jain_option ? 'jain' : '',
    ]
      .join(' ')
      .toLowerCase();
    if (query && !searchText.includes(query)) return false;
    if (state.category && item.category !== state.category) return false;
    if (state.vegan && !item.vegan) return false;
    if (state.jain && !item.jain_option) return false;
    if (state.glutenFree && !item.gluten_free) return false;
    if (state.avoid.some((allergen) => item.allergens.includes(allergen)))
      return false;
    if (state.maxPrice !== null && item.price_usd > state.maxPrice)
      return false;
    if (state.kids && item.category !== 'Kids Menu') return false;
    if (state.quick && item.prep_minutes >= 6) return false;
    if (state.spice === 'mild' && item.spice_level !== 0) return false;
    if (state.spice === 'medium' && ![1, 2].includes(item.spice_level))
      return false;
    if (state.spice === 'hot' && item.spice_level !== 3) return false;
    return true;
  });
}

export function sortMenu(items: MenuItem[], sort: MenuSort): MenuItem[] {
  return [...items].sort((a, b) => {
    if (sort === 'price-asc')
      return a.price_usd - b.price_usd || a.sourceIndex - b.sourceIndex;
    if (sort === 'price-desc')
      return b.price_usd - a.price_usd || a.sourceIndex - b.sourceIndex;
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'quickest')
      return a.prep_minutes - b.prep_minutes || a.sourceIndex - b.sourceIndex;
    const rank = (item: MenuItem) =>
      item.tags.includes('signature')
        ? 0
        : item.tags.includes('popular')
          ? 1
          : 2;
    return rank(a) - rank(b) || a.sourceIndex - b.sourceIndex;
  });
}

function asUrl(input: URL | string): URL {
  return input instanceof URL ? input : new URL(input, 'https://example.test');
}

export function parseFilters(input: URL | string): MenuFilters {
  const params = asUrl(input).searchParams;
  const spice = params.get('spice');
  const sort = params.get('sort');
  const avoid = params
    .getAll('avoid')
    .filter((value): value is Allergen =>
      ALLERGENS.includes(value as Allergen),
    );
  const price = Number(params.get('max'));
  return {
    query: params.get('q') ?? '',
    category: MENU_CATEGORIES.includes(
      params.get('cat') as (typeof MENU_CATEGORIES)[number],
    )
      ? params.get('cat')!
      : '',
    vegan: params.get('vegan') === '1',
    jain: params.get('jain') === '1',
    glutenFree: params.get('gf') === '1',
    spice: ['mild', 'medium', 'hot'].includes(spice ?? '')
      ? (spice as SpiceFilter)
      : 'any',
    avoid: [...new Set(avoid)],
    maxPrice: [2, 3, 4, 6].includes(price) ? price : null,
    sort: ['price-asc', 'price-desc', 'name', 'quickest'].includes(sort ?? '')
      ? (sort as MenuSort)
      : 'recommended',
    kids: params.get('kids') === '1',
    quick: params.get('quick') === '1',
  };
}

export function serializeFilters(state: MenuFilters): string {
  const params = new URLSearchParams();
  if (state.query.trim()) params.set('q', state.query.trim());
  if (state.category) params.set('cat', state.category);
  if (state.vegan) params.set('vegan', '1');
  if (state.jain) params.set('jain', '1');
  if (state.glutenFree) params.set('gf', '1');
  if (state.spice !== 'any') params.set('spice', state.spice);
  state.avoid.forEach((allergen) => params.append('avoid', allergen));
  if (state.maxPrice !== null) params.set('max', String(state.maxPrice));
  if (state.sort !== 'recommended') params.set('sort', state.sort);
  if (state.kids) params.set('kids', '1');
  if (state.quick) params.set('quick', '1');
  const query = params.toString();
  return query ? `?${query}` : '';
}
