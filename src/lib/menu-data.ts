// Server-only: parses the menu CSV. Never import this from a React island or the browser bundle.
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
// Bundled as text at build time. Reading the file from disk breaks in the Cloudflare prerender sandbox.
import menuCsv from '../../data/pigeonhole-menu.csv?raw';
import { MENU_CATEGORIES, type MenuItem } from './menu';

const yesNo = z.enum(['yes', 'no']).transform((value) => value === 'yes');
const rowSchema = z.object({
  id: z.string().regex(/^PH\d{4}$/),
  category: z.enum(MENU_CATEGORIES),
  subcategory: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  price_usd: z.coerce.number().nonnegative(),
  diet: z.literal('vegetarian'),
  vegan: yesNo,
  jain_option: yesNo,
  gluten_free: yesNo,
  allergens: z
    .string()
    .transform((value) =>
      value === 'none' || value === ''
        ? []
        : value.split(';').map((item) => item.trim().toLowerCase()),
    ),
  spice_level: z.coerce.number().int().min(0).max(3),
  prep_minutes: z.coerce.number().int().positive(),
  tags: z
    .string()
    .transform((value) =>
      value === ''
        ? []
        : value.split(';').map((item) => item.trim().toLowerCase()),
    ),
  available: yesNo,
});

export function parseMenuCsv(csv: string): MenuItem[] {
  const rows: unknown[] = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });
  const items = rows.map((row, sourceIndex) => ({
    ...rowSchema.parse(row),
    sourceIndex,
  })) as MenuItem[];
  if (items.length !== 240)
    throw new Error(`Expected 240 menu rows, received ${items.length}.`);
  return items;
}

export function loadMenu(): MenuItem[] {
  return parseMenuCsv(menuCsv);
}
