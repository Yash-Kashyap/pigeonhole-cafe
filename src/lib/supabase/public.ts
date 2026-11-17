import { createClient } from '@supabase/supabase-js';
import { parsePublicEnv } from '../env';

export function createPublicSupabaseClient(source: Record<string, unknown> = import.meta.env) {
  const env = parsePublicEnv(source);
  return createClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
