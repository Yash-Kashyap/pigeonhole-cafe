import { saltedRateLimitKey } from '../orders/place-order';

export const OWNER_JSON_LIMIT = 16_384;

export function jsonResponse(
  body: object,
  status = 200,
  extra: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      ...extra,
    },
  });
}

export function requestIp(request: Request): string {
  if (import.meta.env.DEV) {
    const testIp = request.headers.get('x-ph-test-ip');
    if (testIp) return testIp;
  }
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

export async function readJsonBody(
  request: Request,
  maximumBytes = OWNER_JSON_LIMIT,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  if (!isSameOrigin(request))
    return {
      ok: false,
      response: jsonResponse({ message: 'Invalid request origin.' }, 400),
    };
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return {
      ok: false,
      response: jsonResponse({ message: 'Send JSON data.' }, 400),
    };
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maximumBytes)
    return {
      ok: false,
      response: jsonResponse({ message: 'Request is too large.' }, 400),
    };
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes)
      return {
        ok: false,
        response: jsonResponse({ message: 'Request is too large.' }, 400),
      };
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: jsonResponse({ message: 'Send valid JSON data.' }, 400),
    };
  }
}

export async function sha256(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

type RateLimitClient = {
  rpc(
    name: string,
    params: { p_key: string; p_window_seconds: number; p_max: number },
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function ownerWriteAllowed(
  client: RateLimitClient,
  salt: string,
  ownerId: string,
): Promise<boolean> {
  const key = await saltedRateLimitKey(
    { hash: sha256, salt },
    'owner-write',
    ownerId,
  );
  const { data, error } = await client.rpc('hit_rate_limit', {
    p_key: key,
    p_window_seconds: 600,
    p_max: 300,
  });
  if (error) throw error;
  return data === true;
}

export function queryObject(url: URL): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(result, key)) return null;
    result[key] = value;
  }
  return result;
}
