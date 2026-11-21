import { describe, expect, it, vi } from 'vitest';
import {
  callProvider,
  PROVIDER_CALL_TIMEOUT_MS,
  PROVIDER_MIN_RETRY_TIME_MS,
  PROVIDER_TOTAL_BUDGET_MS,
  type ProviderFetch,
} from '@assistant-provider';

const input = {
  apiKey: 'test-key-not-a-secret',
  model: 'test-model',
  systemInstruction: 'System facts',
  contents: [{ role: 'user' as const, parts: [{ text: 'Hello' }] }],
  tools: [
    {
      name: 'get_hours' as const,
      description: 'Get hours',
      parameters: { type: 'object', properties: {} },
    },
  ],
};

const successResponse = () =>
  new Response(
    JSON.stringify({
      candidates: [
        { content: { role: 'model', parts: [{ text: 'Available.' }] } },
      ],
      usageMetadata: {},
    }),
    { status: 200 },
  );

describe('assistant REST client', () => {
  it('uses the 20 second call timeout and 40 second total budget', () => {
    expect(PROVIDER_CALL_TIMEOUT_MS).toBe(20_000);
    expect(PROVIDER_TOTAL_BUDGET_MS).toBe(40_000);
  });

  it('sends the documented request shape and parses calls and usage', async () => {
    const fetchFn = vi.fn<ProviderFetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      id: 'call-1',
                      name: 'get_hours',
                      args: { date: '2026-11-23' },
                    },
                    thoughtSignature: 'opaque-signature',
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 12,
            cachedContentTokenCount: 20,
            thoughtsTokenCount: 3,
            totalTokenCount: 115,
          },
        }),
        { status: 200 },
      ),
    );
    const result = await callProvider(input, fetchFn);
    const [url, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(String(url)).toContain('/test-model:generateContent');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(input.apiKey);
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: 'System facts' }] },
      tools: [{ functionDeclarations: input.tools }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
    });
    expect(result.content.parts[0]).toMatchObject({
      functionCall: { id: 'call-1', name: 'get_hours' },
      thoughtSignature: 'opaque-signature',
    });
    expect(result.usage).toEqual({
      promptTokenCount: 100,
      candidatesTokenCount: 12,
      cachedContentTokenCount: 20,
      thoughtsTokenCount: 3,
      totalTokenCount: 115,
    });
  });

  it('omits function calling configuration when the caller has no tools', async () => {
    const fetchFn = vi.fn<ProviderFetch>().mockResolvedValue(successResponse());
    await callProvider({ ...input, tools: [] }, fetchFn);
    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('toolConfig');
  });

  it.each([
    ['bad request', 400, 'upstream'],
    ['unauthorized', 401, 'auth'],
    ['forbidden', 403, 'auth'],
    ['not found', 404, 'notfound'],
    ['quota', 429, 'quota'],
  ] as const)('maps %s without retrying', async (_label, status, kind) => {
    const fetchFn = vi
      .fn<ProviderFetch>()
      .mockResolvedValue(new Response('{}', { status }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(callProvider(input, fetchFn, { sleep })).rejects.toMatchObject(
      { kind, status },
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries one 503 after the configured delay', async () => {
    const fetchFn = vi
      .fn<ProviderFetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      callProvider(input, fetchFn, { sleep }),
    ).resolves.toMatchObject({ content: { role: 'model' } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(700);
  });

  it('retries one timeout and then succeeds', async () => {
    const fetchFn = vi
      .fn<ProviderFetch>()
      .mockImplementationOnce(
        (_request, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      )
      .mockResolvedValueOnce(successResponse());
    await expect(
      callProvider(input, fetchFn, {
        timeoutMs: 5,
        // Generous total budget: on a loaded machine a tight one runs out before
        // the retry starts, which would test CPU speed instead of the retry.
        budgetMs: 2000,
        retryDelayMs: 0,
      }),
    ).resolves.toMatchObject({ content: { role: 'model' } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('stops after one retry when 503 persists', async () => {
    const fetchFn = vi
      .fn<ProviderFetch>()
      .mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(
      callProvider(input, fetchFn, { retryDelayMs: 0 }),
    ).rejects.toMatchObject({ kind: 'unavailable', status: 503 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not retry without the minimum useful request time remaining', async () => {
    let currentTime = 0;
    const fetchFn = vi.fn<ProviderFetch>().mockImplementation(async () => {
      currentTime = 1_301;
      return new Response('{}', { status: 503 });
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      callProvider(input, fetchFn, {
        budgetMs: 3_000,
        retryDelayMs: 700,
        now: () => currentTime,
        sleep,
      }),
    ).rejects.toMatchObject({ kind: 'unavailable', status: 503 });
    expect(PROVIDER_MIN_RETRY_TIME_MS).toBe(1_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
