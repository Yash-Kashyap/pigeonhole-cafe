import { createClient } from '@supabase/supabase-js';
import { parseServerEnv } from '../env';

const SERVER_USER_AGENT = 'pigeonhole-cafe-server';

export function createServerSupabaseClient(source: Record<string, unknown> = import.meta.env) {
  if (!import.meta.env.SSR) throw new Error('The server Supabase client cannot run in a browser.');
  const env = parseServerEnv(source);
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'User-Agent': SERVER_USER_AGENT } },
  });
}
