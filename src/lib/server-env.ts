import {
  ASSISTANT_DAILY_TOKEN_CAP,
  GEMINI_MODEL,
  PUBLIC_ALLOW_INDEX,
  PUBLIC_SITE_URL,
  PUBLIC_SUPABASE_ANON_KEY,
  PUBLIC_SUPABASE_URL,
  PUBLIC_WHATSAPP_NUMBER,
  SUPABASE_URL,
  getSecret,
} from 'astro:env/server';
import { parseServerEnv, type ServerEnv } from './env';

/** Reads runtime values in Astro server modules only. */
export function readServerEnv(): ServerEnv {
  return parseServerEnv({
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY,
    PUBLIC_SITE_URL,
    PUBLIC_WHATSAPP_NUMBER,
    PUBLIC_ALLOW_INDEX,
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY: getSecret('SUPABASE_SERVICE_KEY'),
    GEMINI_API_KEY: getSecret('GEMINI_API_KEY'),
    GEMINI_MODEL,
    ASSISTANT_DAILY_TOKEN_CAP,
    RATE_LIMIT_SALT: getSecret('RATE_LIMIT_SALT'),
  });
}
