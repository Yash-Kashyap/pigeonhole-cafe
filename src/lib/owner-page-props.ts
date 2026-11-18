import {
  PUBLIC_SUPABASE_ANON_KEY,
  PUBLIC_SUPABASE_URL,
} from 'astro:env/server';

export type OwnerRealtimeProps = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

/** Reads public Supabase settings on the server for client Realtime hydration. */
export function getOwnerRealtimeProps(): OwnerRealtimeProps {
  return {
    supabaseUrl:
      PUBLIC_SUPABASE_URL ?? import.meta.env.PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey:
      PUBLIC_SUPABASE_ANON_KEY ??
      import.meta.env.PUBLIC_SUPABASE_ANON_KEY ??
      '',
  };
}
