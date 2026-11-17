import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [react()],
  // The dev overlay adds extra headings and sometimes fails to load its own chunks, which makes browser checks flaky.
  devToolbar: { enabled: false },
  security: { checkOrigin: true },
  vite: { plugins: [tailwindcss()] },
});
