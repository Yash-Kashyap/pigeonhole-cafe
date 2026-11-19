import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';
import { fileURLToPath, URL } from 'node:url';

const assistantProvider = fileURLToPath(
  new URL('./src/lib/assistant/gemini.ts', import.meta.url),
);

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [react()],
  // The dev overlay adds extra headings and sometimes fails to load its own chunks, which makes browser checks flaky.
  devToolbar: { enabled: false },
  env: {
    schema: {
      PUBLIC_SUPABASE_URL: envField.string({
        context: 'server',
        access: 'public',
        optional: true,
      }),
      PUBLIC_SUPABASE_ANON_KEY: envField.string({
        context: 'server',
        access: 'public',
        optional: true,
      }),
      PUBLIC_SITE_URL: envField.string({
        context: 'server',
        access: 'public',
        optional: true,
      }),
      PUBLIC_WHATSAPP_NUMBER: envField.string({
        context: 'server',
        access: 'public',
        optional: true,
      }),
      PUBLIC_ALLOW_INDEX: envField.string({
        context: 'server',
        access: 'public',
        optional: true,
      }),
      SUPABASE_URL: envField.string({
        context: 'server',
        access: 'public',
        optional: true,
      }),
      GEMINI_MODEL: envField.string({
        context: 'server',
        access: 'public',
        optional: true,
      }),
      ASSISTANT_DAILY_TOKEN_CAP: envField.string({
        context: 'server',
        access: 'public',
        optional: true,
      }),
      SUPABASE_SERVICE_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      GEMINI_API_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      RATE_LIMIT_SALT: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
    },
  },
  security: { checkOrigin: true },
  vite: {
    plugins: [tailwindcss()],
    resolve: { alias: { '@assistant-provider': assistantProvider } },
  },
});
