import { z } from 'zod';

const placeholder = /YOUR-|your-key|server-only|long-random-string/i;
const key = z
  .string()
  .min(12)
  .refine((value) => !placeholder.test(value), 'Use a configured key.');

export const publicEnvSchema = z.object({
  PUBLIC_SUPABASE_URL: z.url().startsWith('https://'),
  PUBLIC_SUPABASE_ANON_KEY: key.startsWith('sb_publishable_'),
  PUBLIC_SITE_URL: z.url(),
  PUBLIC_WHATSAPP_NUMBER: z
    .string()
    .regex(/^\d{10,15}$/)
    .optional(),
  PUBLIC_ALLOW_INDEX: z.enum(['true', 'false']).default('false'),
});

export const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_URL: z.url().startsWith('https://'),
  SUPABASE_SERVICE_KEY: key.startsWith('sb_secret_'),
  GEMINI_API_KEY: z.string().min(12).optional(),
  GEMINI_MODEL: z.string().min(1).optional(),
  RATE_LIMIT_SALT: z.string().min(24).optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parsePublicEnv(source: Record<string, unknown>): PublicEnv {
  return publicEnvSchema.parse(source);
}

export function parseServerEnv(source: Record<string, unknown>): ServerEnv {
  return serverEnvSchema.parse(source);
}
