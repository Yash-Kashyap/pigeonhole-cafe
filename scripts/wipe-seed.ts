import { createServerSupabaseClient } from '../src/lib/supabase/server';

process.loadEnvFile('.env');
const client = createServerSupabaseClient(process.env);

for (const table of [
  'assistant_logs',
  'enquiries',
  'bookings',
  'orders',
] as const) {
  const { error } = await client.from(table).delete().eq('seeded', true);
  if (error)
    throw new Error(`Could not wipe seeded ${table}: ${error.message}`);
}

console.log('Seeded demo rows removed. Non-seeded rows were not changed.');
