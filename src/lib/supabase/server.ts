import { createClient } from '@supabase/supabase-js';
import { parseServerEnv } from '../env';

const SERVER_USER_AGENT = 'pigeonhole-cafe-server';

export function createServerSupabaseClient(source: Record<string, unknown>) {
  const env = parseServerEnv(source);
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'User-Agent': SERVER_USER_AGENT } },
  });
}

export function createPublicServerSupabaseClient(
  source: Record<string, unknown>,
) {
  const env = parseServerEnv(source);
  return createClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { 'User-Agent': SERVER_USER_AGENT } },
  });
}
