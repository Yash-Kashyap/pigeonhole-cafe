import { describe, expect, it, vi } from 'vitest';
import { ProviderRequestError, type ProviderResult } from '../assistant/gemini';
import { createDailySummary } from './summary';

const usage = {
  promptTokenCount: 12,
  candidatesTokenCount: 20,
  cachedContentTokenCount: 0,
  thoughtsTokenCount: 0,
  totalTokenCount: 32,
};
const result = (text: string): ProviderResult => ({
  content: { role: 'model', parts: [{ text }] },
  usage,
});
const valid = JSON.stringify({
  bullets: ['One', 'Two', 'Three', 'Four', 'Five'],
  suggestion: 'Review the afternoon staffing plan.',
});

describe('daily summary generation', () => {
  it('records provider usage before saving validated JSON text', async () => {
    const sequence: string[] = [];
    const save = vi.fn(async (content: string) => {
      sequence.push('save');
      return content;
    });
    const response = await createDailySummary('{"count":1}', {
      generate: vi.fn(async () => result(valid)),
      recordUsage: vi.fn(async (value) => {
        sequence.push('usage');
        expect(value).toEqual(usage);
      }),
      save,
    });
    expect(response.ok).toBe(true);
    expect(sequence).toEqual(['usage', 'save']);
    expect(save).toHaveBeenCalledWith(valid);
  });

  it('returns a quota fallback without writing usage or a summary', async () => {
    const recordUsage = vi.fn();
    const save = vi.fn();
    const response = await createDailySummary('{}', {
      generate: vi.fn(async () => {
        throw new ProviderRequestError('quota', 429);
      }),
      recordUsage,
      save,
    });
    expect(response).toEqual({ ok: false, reason: 'quota' });
    expect(recordUsage).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects malformed model output and does not save it', async () => {
    const recordUsage = vi.fn(async () => undefined);
    const save = vi.fn();
    const response = await createDailySummary('{}', {
      generate: vi.fn(async () =>
        result('{"bullets":["only one"],"suggestion":"Too short"}'),
      ),
      recordUsage,
      save,
    });
    expect(response).toEqual({ ok: false, reason: 'invalid' });
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });

  it('turns provider outages into a no-write fallback', async () => {
    const recordUsage = vi.fn();
    const save = vi.fn();
    const response = await createDailySummary('{}', {
      generate: vi.fn(async () => {
        throw new ProviderRequestError('unavailable', 503);
      }),
      recordUsage,
      save,
    });
    expect(response).toEqual({ ok: false, reason: 'provider' });
    expect(recordUsage).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
