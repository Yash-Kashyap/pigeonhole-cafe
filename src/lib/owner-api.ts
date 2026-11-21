import { mapOwnerApiError } from './owner-dashboard';

export type OwnerApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; message: string; errors?: string[] };

function redirectToOwnerLogin() {
  if (typeof window !== 'undefined') {
    window.location.assign('/owner');
  }
}

export async function ownerGetJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<OwnerApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.status === 401) {
      redirectToOwnerLogin();
      return {
        ok: false,
        status: 401,
        message: mapOwnerApiError(401),
      };
    }
    if (!response.ok) {
      const serverMessage =
        payload &&
        typeof payload === 'object' &&
        'message' in payload &&
        typeof payload.message === 'string'
          ? payload.message
          : null;
      return {
        ok: false,
        status: response.status,
        message: mapOwnerApiError(response.status, serverMessage),
      };
    }
    return { ok: true, data: payload as T, status: response.status };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, status: 0, message: '' };
    }
    return {
      ok: false,
      status: 0,
      message:
        'Could not reach the server. Check your connection and try again.',
    };
  }
}

export async function ownerWriteJson<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: object,
): Promise<OwnerApiResult<T>> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.status === 401) {
      redirectToOwnerLogin();
      return {
        ok: false,
        status: 401,
        message: mapOwnerApiError(401),
      };
    }
    if (!response.ok) {
      const record =
        payload && typeof payload === 'object'
          ? (payload as { message?: unknown; errors?: unknown })
          : null;
      const serverMessage =
        record && typeof record.message === 'string' ? record.message : null;
      const errors =
        record && Array.isArray(record.errors)
          ? record.errors.filter(
              (entry): entry is string => typeof entry === 'string',
            )
          : undefined;
      return {
        ok: false,
        status: response.status,
        message: mapOwnerApiError(response.status, serverMessage),
        errors,
      };
    }
    return { ok: true, data: payload as T, status: response.status };
  } catch {
    return {
      ok: false,
      status: 0,
      message:
        'Could not reach the server. Check your connection and try again.',
    };
  }
}
