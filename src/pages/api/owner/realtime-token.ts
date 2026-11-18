import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/owner/http';

export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
  if (!locals.owner)
    return jsonResponse({ message: 'Sign in is required.' }, 401);
  return jsonResponse({
    accessToken: locals.owner.accessToken,
    expiresAt: locals.owner.expiresAt,
  });
};
