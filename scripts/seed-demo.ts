import { existsSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createServerSupabaseClient } from '../src/lib/supabase/server';

process.loadEnvFile('.env');
const client = createServerSupabaseClient(process.env);
const credentialsPath = '.demo-credentials';
const ownerEmail = 'owner@pigeonhole.demo';
const encoder = new TextEncoder();

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `${Buffer.from(bytes).toString('base64url')}Aa1!`;
}

async function stableUuid(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(value)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

const random = generator(4_004);
const choose = <T>(values: readonly T[]): T =>
  values[Math.floor(random() * values.length)] ?? values[0]!;
const integer = (minimum: number, maximum: number) =>
  minimum + Math.floor(random() * (maximum - minimum + 1));
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
});

async function ensureOwner() {
  let page = 1;
  let ownerId: string | null = null;
  while (!ownerId) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw error;
    ownerId = data.users.find((user) => user.email === ownerEmail)?.id ?? null;
    if (ownerId || data.users.length < 100) break;
    page += 1;
  }

  const needsCredentials = !existsSync(credentialsPath);
  const password = needsCredentials ? randomPassword() : null;
  if (!ownerId) {
    if (!password) throw new Error('Demo credentials are missing.');
    const { data, error } = await client.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      app_metadata: { role: 'owner' },
    });
    if (error || !data.user) throw error ?? new Error('Owner creation failed.');
  } else {
    const attributes: { app_metadata: { role: 'owner' }; password?: string } = {
      app_metadata: { role: 'owner' },
    };
    if (password) attributes.password = password;
    const { error } = await client.auth.admin.updateUserById(
      ownerId,
      attributes,
    );
    if (error) throw error;
  }

  if (password) {
    writeFileSync(
      credentialsPath,
      `Demo owner credentials\nEmail: ${ownerEmail}\nPassword: ${password}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
    console.log(`Demo owner: ${ownerEmail}`);
    console.log(`Generated password: ${password}`);
    console.log(
      'The generated password was written once to .demo-credentials.',
    );
  } else {
    console.log(
      'Demo owner already exists. Existing credentials were not printed.',
    );
  }
}

async function wipeSeededRows() {
  for (const table of [
    'assistant_logs',
    'enquiries',
    'bookings',
    'orders',
  ] as const) {
    const { error } = await client.from(table).delete().eq('seeded', true);
    if (error) throw error;
  }
}

type MenuItem = { id: string; name: string; price_usd: number };
const { data: menuData, error: menuError } = await client
  .from('menu_items')
  .select('id,name,price_usd')
  .eq('available', true)
  .order('id');
if (menuError) throw menuError;
const menu = (menuData ?? []) as MenuItem[];
if (menu.length < 20) throw new Error('The menu must be seeded first.');

await ensureOwner();
await wipeSeededRows();

const names = [
  'Demo Guest',
  'Demo Walker',
  'Demo Reader',
  'Demo Student',
] as const;
const orderStatuses = [
  'collected',
  'collected',
  'collected',
  'cancelled',
] as const;
const now = new Date();
const orderRows: Record<string, unknown>[] = [];
const orderItemRows: Record<string, unknown>[] = [];
const bookingRows: Record<string, unknown>[] = [];
const bookingSlotRows: Record<string, unknown>[] = [];
const occupied = new Map<string, { start: number; end: number }[]>();

const { data: existingSlots, error: existingSlotError } = await client
  .from('booking_slots')
  .select('slot_table_id,during');
if (existingSlotError) throw existingSlotError;
for (const row of existingSlots ?? []) {
  const values = String(row.during).slice(1, -1).split(',');
  const start = Date.parse((values[0] ?? '').replaceAll('"', '').trim());
  const end = Date.parse((values[1] ?? '').replaceAll('"', '').trim());
  if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
  const list = occupied.get(row.slot_table_id) ?? [];
  list.push({ start, end });
  occupied.set(row.slot_table_id, list);
}

const slotInventory = [
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `S${index + 1}`,
    seats: 2,
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `S${index + 9}`,
    seats: 4,
  })),
  ...Array.from({ length: 2 }, (_, index) => ({
    id: `S${index + 15}`,
    seats: 6,
  })),
];

for (let dayOffset = 0; dayOffset < 30; dayOffset += 1) {
  const localNoon = new Date(now.getTime() - dayOffset * 86_400_000);
  const date = dateFormatter.format(localNoon);
  const weekday = weekdayFormatter.format(new Date(`${date}T12:00:00+05:30`));
  const orderCount = integer(20, 50);
  for (let index = 0; index < orderCount; index += 1) {
    const id = await stableUuid(`demo-order-${date}-${index}`);
    const hour = choose([8, 9, 10, 11, 12, 12, 13, 14, 16, 17, 18, 18, 19, 20]);
    const minute = choose([0, 15, 30, 45]);
    const pickup = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`;
    const lineCount = integer(1, 4);
    const selected = new Set<number>();
    while (selected.size < lineCount) selected.add(integer(0, menu.length - 1));
    let subtotal = 0;
    for (const menuIndex of selected) {
      const item = menu[menuIndex]!;
      const quantity = integer(1, 3);
      subtotal += Number(item.price_usd) * quantity;
      orderItemRows.push({
        id: await stableUuid(`demo-order-item-${date}-${index}-${item.id}`),
        order_id: id,
        menu_item_id: item.id,
        name_snapshot: item.name,
        price_snapshot: item.price_usd,
        qty: quantity,
        note: null,
      });
    }
    const status = dayOffset === 0 && index < 3 ? 'new' : choose(orderStatuses);
    orderRows.push({
      id,
      code: `DEMO-ORD-${date.replaceAll('-', '')}-${String(index + 1).padStart(2, '0')}`,
      name: `${choose(names)} ${dayOffset * 50 + index + 1}`,
      phone: `+9190001${String(dayOffset * 50 + index).padStart(5, '0')}`,
      pickup_at: new Date(pickup).toISOString(),
      notes: null,
      subtotal: Number(subtotal.toFixed(2)),
      status,
      source: index % 9 === 0 ? 'assistant' : 'site',
      cancel_reason: status === 'cancelled' ? 'customer_request' : null,
      seeded: true,
      created_at: new Date(
        new Date(pickup).getTime() - integer(20, 120) * 60_000,
      ).toISOString(),
    });
  }

  if (weekday === 'Mon') continue;
  const bookingCount = integer(5, 15);
  for (let index = 0; index < bookingCount; index += 1) {
    const id = await stableUuid(`demo-booking-${date}-${index}`);
    const hour = choose([8, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20]);
    const minute = choose([0, 30]);
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const start = Date.parse(`${date}T${time}:00+05:30`);
    const end = start + 90 * 60_000;
    const partySize = integer(1, 10);
    let status: string =
      partySize >= 7 ? 'requested' : choose(['confirmed', 'seated', 'no_show']);
    let slotId: string | null = null;
    if (partySize <= 6) {
      const candidates = slotInventory.filter(
        (slot) => slot.seats >= partySize,
      );
      slotId =
        candidates.find((slot) =>
          (occupied.get(slot.id) ?? []).every(
            (range) => start >= range.end || end <= range.start,
          ),
        )?.id ?? null;
      if (!slotId) continue;
      const ranges = occupied.get(slotId) ?? [];
      ranges.push({ start, end });
      occupied.set(slotId, ranges);
    } else if (index % 4 === 0) {
      status = 'declined';
    }
    bookingRows.push({
      id,
      code: `DEMO-BK-${date.replaceAll('-', '')}-${String(index + 1).padStart(2, '0')}`,
      name: `Demo Guest ${dayOffset * 20 + index + 1}`,
      phone: `+9190002${String(dayOffset * 20 + index).padStart(5, '0')}`,
      email: null,
      date,
      start_time: `${time}:00`,
      party_size: partySize,
      status,
      occasion: null,
      notes: null,
      preorder: null,
      decline_reason:
        status === 'declined' ? 'Demo request could not be placed.' : null,
      cancel_reason: null,
      seeded: true,
      created_at: new Date(start - integer(1, 7) * 86_400_000).toISOString(),
    });
    if (slotId)
      bookingSlotRows.push({
        booking_id: id,
        slot_table_id: slotId,
        during: `[${new Date(start).toISOString()},${new Date(end).toISOString()})`,
      });
  }
}

async function insertChunks(table: string, rows: Record<string, unknown>[]) {
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await client
      .from(table)
      .insert(rows.slice(index, index + 200));
    if (error) throw new Error(`Could not seed ${table}: ${error.message}`);
  }
}

await insertChunks('orders', orderRows);
await insertChunks('order_items', orderItemRows);
await insertChunks('bookings', bookingRows);
await insertChunks('booking_slots', bookingSlotRows);

const enquiryKinds = ['open_mic', 'private_table', 'general'] as const;
const enquiries = await Promise.all(
  Array.from({ length: 6 }, async (_, index) => ({
    id: await stableUuid(`demo-enquiry-${index}`),
    kind: enquiryKinds[index % enquiryKinds.length],
    name: `Demo Guest ${700 + index}`,
    phone: `+91900030000${index}`,
    email: null,
    payload: { message: `Fictional demo enquiry ${index + 1}.` },
    status: index < 3 ? 'new' : index < 5 ? 'contacted' : 'done',
    seeded: true,
  })),
);
await insertChunks('enquiries', enquiries);

const logs = await Promise.all(
  Array.from({ length: 40 }, async (_, index) => ({
    id: await stableUuid(`demo-assistant-log-${index}`),
    session_id: `demo-session-${String(Math.floor(index / 2) + 1).padStart(2, '0')}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content:
      index < 8
        ? `Fictional unanswered demo question ${index + 1}.`
        : `Fictional demo conversation message ${index + 1}.`,
    answered: index >= 8,
    unanswered_topic: index < 8 ? `Demo topic ${index + 1}` : null,
    handled: false,
    tool_calls: null,
    seeded: true,
  })),
);
await insertChunks('assistant_logs', logs);

console.log(
  `Seeded ${orderRows.length} orders, ${bookingRows.length} bookings, 6 enquiries and 40 conversation rows.`,
);
