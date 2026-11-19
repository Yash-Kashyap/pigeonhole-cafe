import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMenu } from '../menu-data';
import { clearKnowledgeOverrideCache } from './facts';
import {
  ASSISTANT_GLOBAL_DAILY_CAP,
  assistantFallbackDiagnostic,
  formatAssistantFallbackWarning,
  handleAssistantRequest,
  type AssistantHandlerDependencies,
} from './handler';

const now = new Date('2026-11-18T04:30:00.000Z');
const request = (text = 'Are you open?') => ({
  sessionId: 'session-1234',
  messages: [{ role: 'user' as const, text }],
  page: 'home' as const,
});
const usage = {
  promptTokenCount: 10,
  candidatesTokenCount: 4,
  cachedContentTokenCount: 0,
  thoughtsTokenCount: 0,
  totalTokenCount: 14,
};

function dependencies(
  overrides: Partial<AssistantHandlerDependencies> = {},
): AssistantHandlerDependencies {
  return {
    salt: 'test-salt-that-is-long-enough',
    hash: vi.fn(async (value: string) => `hash:${value}`),
    hitRateLimit: vi.fn().mockResolvedValue(true),
    readDailyTokens: vi.fn().mockResolvedValue(0),
    dailyTokenCap: 1_000,
    configured: true,
    loadMenu: vi.fn().mockResolvedValue(loadMenu()),
    loadOverrides: vi.fn().mockResolvedValue([]),
    loadAvailability: vi.fn().mockResolvedValue([]),
    callModel: vi.fn().mockResolvedValue({
      content: { role: 'model', parts: [{ text: 'Open today.' }] },
      usage,
    }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    logUnanswered: vi.fn().mockResolvedValue(undefined),
    logExchange: vi.fn().mockResolvedValue(undefined),
    onPromptSize: vi.fn(),
    warnFallback: vi.fn(),
    ...overrides,
  };
}

describe('assistant request handler', () => {
  beforeEach(() => clearKnowledgeOverrideCache());

  it('rejects bad schemas before rate-limit work', async () => {
    const deps = dependencies();
    const result = await handleAssistantRequest(
      { ...request(), unknown: true },
      '198.51.100.1',
      now,
      deps,
    );
    expect(result.status).toBe(400);
    expect(deps.hitRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ['IP', [false], 600],
    ['session', [true, false], 86_400],
  ] as const)('enforces the %s rate limit', async (_label, results, retry) => {
    const queue: boolean[] = [...results];
    const deps = dependencies({
      hitRateLimit: vi
        .fn()
        .mockImplementation(async () => queue.shift() ?? true),
    });
    const result = await handleAssistantRequest(
      request(),
      '198.51.100.2',
      now,
      deps,
    );
    expect(result.status).toBe(429);
    expect(result.retryAfter).toBe(retry);
  });

  it('rests when the global request cap is exceeded', async () => {
    const results = [true, true, false];
    const deps = dependencies({
      hitRateLimit: vi
        .fn()
        .mockImplementation(async () => results.shift() ?? true),
    });
    const result = await handleAssistantRequest(
      request(),
      '198.51.100.3',
      now,
      deps,
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ resting: true });
    expect(deps.callModel).not.toHaveBeenCalled();
    expect(ASSISTANT_GLOBAL_DAILY_CAP).toBe(200);
    expect(deps.hitRateLimit).toHaveBeenNthCalledWith(
      3,
      expect.any(String),
      86_400,
      200,
    );
  });

  it('scrubs deterministic unanswered logging for the stock reply', async () => {
    const logUnanswered = vi.fn().mockResolvedValue(undefined);
    const deps = dependencies({
      logUnanswered,
      callModel: vi.fn().mockResolvedValue({
        content: {
          role: 'model',
          parts: [{ text: "I'll check with the team." }],
        },
        usage,
      }),
    });
    const result = await handleAssistantRequest(
      request('Call 9876543210 about train refunds'),
      '198.51.100.30',
      now,
      deps,
    );

    expect(result.body).toMatchObject({ logged: true });
    expect(logUnanswered).toHaveBeenCalledOnce();
    expect(logUnanswered).toHaveBeenCalledWith(
      'session-1234',
      'Call [phone removed] about train refunds',
    );
  });

  it('rests when the daily token cap is reached', async () => {
    const deps = dependencies({
      dailyTokenCap: 100,
      readDailyTokens: vi.fn().mockResolvedValue(100),
    });
    const result = await handleAssistantRequest(
      request(),
      '198.51.100.4',
      now,
      deps,
    );
    expect(result.body).toMatchObject({ resting: true });
    expect(deps.callModel).not.toHaveBeenCalled();
  });

  it('uses deterministic fallback when not configured', async () => {
    const deps = dependencies({ configured: false });
    const result = await handleAssistantRequest(
      request('Can I reserve a table?'),
      '198.51.100.5',
      now,
      deps,
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ resting: true });
    expect(JSON.stringify(result.body)).toContain('/reserve');
    expect(deps.callModel).not.toHaveBeenCalled();
  });

  it.each(['quota', 'server failure', 'timeout'])(
    'falls back without an error response on %s',
    async () => {
      const deps = dependencies({
        callModel: vi.fn().mockRejectedValue(new Error('internal detail')),
      });
      const result = await handleAssistantRequest(
        request('Show me the menu'),
        '198.51.100.6',
        now,
        deps,
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ resting: true });
      expect(JSON.stringify(result.body)).not.toContain('internal detail');
    },
  );

  it('reports only fallback kind and status to diagnostics', async () => {
    const warnFallback = vi.fn();
    const deps = dependencies({
      warnFallback,
      callModel: vi.fn().mockRejectedValue({
        kind: 'notfound',
        status: 404,
        body: 'sensitive upstream response',
      }),
    });
    const result = await handleAssistantRequest(
      request('Show me vegan dishes.'),
      '198.51.100.9',
      now,
      deps,
    );
    expect(result.status).toBe(200);
    expect(warnFallback).toHaveBeenCalledWith({
      kind: 'notfound',
      status: 404,
    });
    expect(JSON.stringify(warnFallback.mock.calls)).not.toContain('sensitive');
    expect(
      assistantFallbackDiagnostic({
        kind: 'notfound',
        status: 404,
        apiKey: 'must-not-appear',
      }),
    ).toEqual({ kind: 'notfound', status: 404 });
    expect(
      formatAssistantFallbackWarning({ kind: 'notfound', status: 404 }),
    ).toBe('assistant_fallback kind=notfound status=404');
  });

  it('reports budget exhaustion before returning fallback', async () => {
    const warnFallback = vi.fn();
    const deps = dependencies({
      warnFallback,
      callModel: vi.fn().mockRejectedValue({ kind: 'budget' }),
    });
    const result = await handleAssistantRequest(
      request('Show me vegan dishes.'),
      '198.51.100.10',
      now,
      deps,
    );
    expect(result.body).toMatchObject({ resting: true });
    expect(warnFallback).toHaveBeenCalledWith({ kind: 'budget' });
  });

  it('scrubs contact data, long digits and markup before logging', async () => {
    const logExchange = vi.fn().mockResolvedValue(undefined);
    const deps = dependencies({
      logExchange,
      callModel: vi.fn().mockResolvedValue({
        content: {
          role: 'model',
          parts: [{ text: '<b>Reply</b> to owner@example.com' }],
        },
        usage,
      }),
    });
    await handleAssistantRequest(
      request('Contact <b>me</b> at guest@example.com or 9876543210'),
      '198.51.100.7',
      now,
      deps,
    );
    const logged = JSON.stringify(logExchange.mock.calls[0]?.[0]);
    expect(logged).not.toContain('<b>');
    expect(logged).not.toContain('guest@example.com');
    expect(logged).not.toContain('9876543210');
    expect(logged).not.toContain('owner@example.com');
    expect(logged).toContain('[email removed]');
    expect(logged).toContain('[phone removed]');
  });

  it('returns a clean service error when rate storage fails', async () => {
    const result = await handleAssistantRequest(
      request(),
      '198.51.100.8',
      now,
      dependencies({
        hitRateLimit: vi.fn().mockRejectedValue(new Error('database details')),
      }),
    );
    expect(result).toEqual({
      status: 500,
      body: { message: 'Assistant service is unavailable.' },
    });
  });
});
