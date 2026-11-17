import type { APIRoute } from 'astro';
import { loadMenu } from '../lib/menu-data';

export const prerender = true;

export const GET = (() =>
  new Response(JSON.stringify(loadMenu()), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })) satisfies APIRoute;
