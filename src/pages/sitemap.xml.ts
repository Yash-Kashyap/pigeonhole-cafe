import type { APIRoute } from 'astro';
import { PUBLIC_SITE_URL } from 'astro:env/server';
import { sitemapXml } from '../lib/seo';

export const prerender = false;
export const GET: APIRoute = ({ url }) =>
  new Response(sitemapXml(PUBLIC_SITE_URL ?? url.origin), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
