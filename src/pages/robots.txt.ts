import type { APIRoute } from 'astro';
import { PUBLIC_ALLOW_INDEX, PUBLIC_SITE_URL } from 'astro:env/server';
import { robotsText } from '../lib/seo';

export const prerender = false;
export const GET: APIRoute = ({ url }) =>
  new Response(robotsText(PUBLIC_ALLOW_INDEX, PUBLIC_SITE_URL ?? url.origin), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
