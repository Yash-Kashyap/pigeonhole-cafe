import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

const root = process.cwd();
if (!existsSync(resolve(root, '.env'))) {
  console.log(
    'Menu verification skipped: .env is missing. Copy .env.example to .env when configuration is available.',
  );
  process.exit(0);
}

const yesNo = z.enum(['yes', 'no']).transform((value) => value === 'yes');
const menuRowSchema = z.object({
  id: z.string().regex(/^PH\d{4}$/),
  category: z.string().min(1),
  subcategory: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  price_usd: z.coerce.number().nonnegative(),
  diet: z.literal('vegetarian'),
  vegan: yesNo,
  jain_option: yesNo,
  gluten_free: yesNo,
  allergens: z.string().transform(splitList),
  spice_level: z.coerce.number().int().min(0).max(3),
  prep_minutes: z.coerce.number().int().positive(),
  tags: z.string().transform(splitList),
  available: yesNo,
});

type MenuRow = z.infer<typeof menuRowSchema>;

function splitList(value: string): string[] {
  return value
    ? value
        .split(';')
        .map((item) => item.trim())
        .filter((item) => item !== 'none')
    : [];
}

function extractTuples(sql: string): string[] {
  const body = sql.slice(
    sql.indexOf(' values') + 7,
    sql.lastIndexOf('on conflict'),
  );
  const tuples: string[] = [];
  let quoted = false;
  let depth = 0;
  let start = -1;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "'") {
      if (quoted && body[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted && char === '(') {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (!quoted && char === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) tuples.push(body.slice(start, index));
    }
  }
  return tuples;
}

function splitFields(tuple: string): string[] {
  const fields: string[] = [];
  let quoted = false;
  let squareDepth = 0;
  let start = 0;
  for (let index = 0; index < tuple.length; index += 1) {
    const char = tuple[index];
    if (char === "'") {
      if (quoted && tuple[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted && char === '[') squareDepth += 1;
    else if (!quoted && char === ']') squareDepth -= 1;
    else if (!quoted && squareDepth === 0 && char === ',') {
      fields.push(tuple.slice(start, index).trim());
      start = index + 1;
    }
  }
  fields.push(tuple.slice(start).trim());
  return fields;
}

function stringValue(value: string): string {
  const match = /^'(.*)'$/s.exec(value);
  if (!match) throw new Error(`Unexpected SQL string: ${value}`);
  return (match[1] ?? '').replaceAll("''", "'");
}

function arrayValue(value: string): string[] {
  if (value === "'{}'::text[]") return [];
  const match = /^array\[(.*)\]::text\[\]$/s.exec(value);
  if (!match) throw new Error(`Unexpected SQL array: ${value}`);
  return splitFields(match[1] ?? '')
    .map(stringValue)
    .filter((item) => item !== 'none');
}

function sqlRow(tuple: string): Omit<MenuRow, 'diet'> {
  const f = splitFields(tuple);
  if (f.length !== 14)
    throw new Error(`Expected 14 SQL fields, received ${f.length}.`);
  const field = (index: number) => {
    const value = f[index];
    if (value === undefined) throw new Error(`Missing SQL field ${index}.`);
    return value;
  };
  return {
    id: stringValue(field(0)),
    category: stringValue(field(1)),
    subcategory: stringValue(field(2)),
    name: stringValue(field(3)),
    description: stringValue(field(4)),
    price_usd: Number(field(5)),
    vegan: field(6) === 'true',
    jain_option: field(7) === 'true',
    gluten_free: field(8) === 'true',
    allergens: arrayValue(field(9)),
    spice_level: Number(field(10)),
    prep_minutes: Number(field(11)),
    tags: arrayValue(field(12)),
    available: field(13) === 'true',
  };
}

const csvText = readFileSync(resolve(root, 'data/pigeonhole-menu.csv'), 'utf8');
const sqlText = readFileSync(
  resolve(root, 'supabase/migrations/0002_seed_menu.sql'),
  'utf8',
);
const csvRows = z
  .array(menuRowSchema)
  .parse(parse(csvText, { columns: true, skip_empty_lines: true }));
const seedRows = extractTuples(sqlText).map(sqlRow);
const seedById = new Map(seedRows.map((row) => [row.id, row]));
const mismatches: string[] = [];

for (const { diet: _diet, ...csvRow } of csvRows) {
  void _diet;
  const seeded = seedById.get(csvRow.id);
  if (!seeded) mismatches.push(`${csvRow.id}: missing from seed`);
  else if (JSON.stringify(seeded) !== JSON.stringify(csvRow))
    mismatches.push(`${csvRow.id}: fields differ`);
}
for (const seeded of seedRows)
  if (!csvRows.some((row) => row.id === seeded.id))
    mismatches.push(`${seeded.id}: missing from CSV`);

console.log(
  `Menu verification: CSV ${csvRows.length} rows; seed ${seedRows.length} rows; mismatches ${mismatches.length}.`,
);
if (mismatches.length) {
  for (const mismatch of mismatches) console.error(mismatch);
  process.exitCode = 1;
}
