import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadMenu } from '../menu-data';
import {
  ALLERGY_EMERGENCY_TERMS,
  isComplaintMessage,
  isAllergyEmergencyMessage,
  runAssistant,
  type ModelUsage,
} from './service';

const usage: ModelUsage = {
  promptTokenCount: 10,
  candidatesTokenCount: 3,
  cachedContentTokenCount: 0,
  thoughtsTokenCount: 0,
  totalTokenCount: 13,
};
const request = {
  sessionId: 'session-1234',
  messages: [{ role: 'user' as const, text: 'Add two Masala Chai' }],
  page: 'order' as const,
  cart: [],
};
const base = () => ({
  menu: loadMenu(),
  overrides: [],
  now: new Date('2026-11-18T04:30:00.000Z'),
  loadAvailability: vi.fn().mockResolvedValue([]),
  logUnanswered: vi.fn().mockResolvedValue(undefined),
  recordUsage: vi.fn().mockResolvedValue(undefined),
  onPromptSize: vi.fn(),
});

describe('assistant model loop', () => {
  it.each(ALLERGY_EMERGENCY_TERMS)(
    'recognizes the allergy emergency term %s',
    (term) => {
      expect(isAllergyEmergencyMessage(`I have ${term} after eating.`)).toBe(
        true,
      );
    },
  );

  it.each([
    'What allergens are in Masala Chai?',
    'Is Siddu safe for a nut allergy?',
  ])('does not classify a normal allergen question as an emergency', (text) => {
    expect(isAllergyEmergencyMessage(text)).toBe(false);
  });

  it('returns deterministic emergency guidance and a handoff action', async () => {
    const callModel = vi.fn();
    const result = await runAssistant(
      {
        ...request,
        messages: [
          {
            role: 'user',
            text: 'I am having an allergy emergency after eating. What should I do?',
          },
        ],
      },
      { ...base(), callModel },
    );

    expect(result.text).toMatch(/emergency services|medical help/i);
    expect(result.text).not.toMatch(/\bsafe\b/i);
    expect(result.actions).toContainEqual({ type: 'handoff' });
    expect(callModel).not.toHaveBeenCalled();
  });

  it.each([
    'I have a complaint about the cafe.',
    'I want to complain about yesterday.',
    'I need a refund.',
    'The server was rude.',
    'I am unhappy with my visit.',
    'We had terrible service.',
    'I think this is food poisoning.',
    'I was overcharged.',
    'You gave me the wrong order.',
  ])('recognizes the complaint phrase in: %s', (text) => {
    expect(isComplaintMessage(text)).toBe(true);
  });

  it.each([
    'Is the biscuit complimentary?',
    'Are your ingredients compliant with local rules?',
    'Can I order food for pickup?',
    'Which dishes would make someone happy?',
    'Is table service available today?',
    'Do you refund train tickets?',
  ])('does not classify the near-miss phrase in: %s', (text) => {
    expect(isComplaintMessage(text)).toBe(false);
  });

  it('returns a deterministic complaint handoff and logs the topic', async () => {
    const callModel = vi.fn();
    const logUnanswered = vi.fn().mockResolvedValue(undefined);
    const complaint = "I want to complain about yesterday's service.";
    const deps = { ...base(), callModel, logUnanswered };
    const result = await runAssistant(
      {
        ...request,
        messages: [{ role: 'user', text: complaint }],
      },
      deps,
    );

    expect(result.text).toMatch(/sorry|team/i);
    expect(result.actions).toEqual([{ type: 'handoff' }]);
    expect(result.logged).toBe(true);
    expect(result.unansweredTopic).toBe(complaint);
    expect(logUnanswered).toHaveBeenCalledWith(complaint);
    expect(callModel).not.toHaveBeenCalled();
    expect(deps.recordUsage).not.toHaveBeenCalled();
    expect(deps.onPromptSize).not.toHaveBeenCalled();
  });

  it('returns proposal actions with menu prices and matching function results', async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'call-1',
                name: 'propose_cart_add',
                args: { items: [{ id: 'PH0001', qty: 2 }] },
              },
            },
          ],
        },
        usage,
      })
      .mockResolvedValueOnce({
        content: {
          role: 'model',
          parts: [{ text: 'I prepared that cart proposal.' }],
        },
        usage,
      });
    const deps = { ...base(), callModel };
    const result = await runAssistant(request, deps);
    const source = deps.menu.find((item) => item.id === 'PH0001')!;
    expect(result.actions).toEqual([
      {
        type: 'cart_add',
        items: [
          { id: source.id, name: source.name, qty: 2, price: source.price_usd },
        ],
      },
    ]);
    expect(result.ids).toContain('PH0001');
    expect(callModel.mock.calls[1]?.[0].contents.at(-1)).toMatchObject({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'call-1',
            name: 'propose_cart_add',
          },
        },
      ],
    });
    expect(deps.recordUsage).toHaveBeenCalledTimes(2);
    expect(deps.onPromptSize).toHaveBeenCalledWith(expect.any(Number));
  });

  it('stops after three tool-call rounds', async () => {
    let day = 20;
    const callModel = vi.fn().mockImplementation(async () => ({
      content: {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'get_hours',
              args: { date: `2026-11-${day++}` },
            },
          },
        ],
      },
      usage,
    }));
    const result = await runAssistant(request, { ...base(), callModel });
    expect(callModel).toHaveBeenCalledTimes(4);
    expect(result.actions).toEqual([{ type: 'handoff' }]);
    expect(result.fallback).toBe('tool_limit');
  });

  it('does not start another model call after the total budget is spent', async () => {
    let currentTime = 0;
    const callModel = vi.fn().mockImplementation(async () => {
      currentTime = 40_001;
      return {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'get_hours',
                args: { date: '2026-11-20' },
              },
            },
          ],
        },
        usage,
      };
    });
    await expect(
      runAssistant(request, {
        ...base(),
        callModel,
        clock: () => currentTime,
        totalBudgetMs: 40_000,
      }),
    ).rejects.toMatchObject({ kind: 'budget' });
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(callModel.mock.calls[0]?.[0]).toMatchObject({
      timeoutMs: 20_000,
      budgetMs: 40_000,
    });
  });

  it('reuses the first result for repeated identical tool calls', async () => {
    const loadAvailability = vi
      .fn()
      .mockResolvedValue([
        { start_time: '12:00:00', remaining: 1, requestable: false },
      ]);
    const firstArgs = {
      date: '2026-11-20',
      time: '12:00',
      party_size: 5,
    };
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'check_availability',
                args: firstArgs,
              },
            },
          ],
        },
        usage,
      })
      .mockResolvedValueOnce({
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'check_availability',
                args: {
                  party_size: 5,
                  time: '12:00',
                  date: '2026-11-20',
                },
              },
            },
          ],
        },
        usage,
      })
      .mockResolvedValueOnce({
        content: {
          role: 'model',
          parts: [{ text: 'A six-seat slot is available.' }],
        },
        usage,
      });
    const result = await runAssistant(request, {
      ...base(),
      loadAvailability,
      callModel,
    });
    expect(result.text).toBe('A six-seat slot is available.');
    expect(loadAvailability).toHaveBeenCalledTimes(1);
    expect(callModel).toHaveBeenCalledTimes(3);
  });

  it.each(["I'll check with the team", "I'll check with the team."])(
    'logs the current question when the final reply is %s',
    async (text) => {
      const logUnanswered = vi.fn().mockResolvedValue(undefined);
      const result = await runAssistant(
        {
          ...request,
          messages: [{ role: 'user', text: 'Do you sell train tickets?' }],
        },
        {
          ...base(),
          logUnanswered,
          callModel: vi.fn().mockResolvedValue({
            content: { role: 'model', parts: [{ text }] },
            usage,
          }),
        },
      );

      expect(logUnanswered).toHaveBeenCalledOnce();
      expect(logUnanswered).toHaveBeenCalledWith('Do you sell train tickets?');
      expect(result).toMatchObject({
        logged: true,
        unansweredTopic: 'Do you sell train tickets?',
        fallback: 'model',
      });
    },
  );

  it('does not log the stock reply twice after log_unanswered ran', async () => {
    const logUnanswered = vi.fn().mockResolvedValue(undefined);
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'log_unanswered',
                args: { topic: 'Train ticket refunds' },
              },
            },
          ],
        },
        usage,
      })
      .mockResolvedValueOnce({
        content: {
          role: 'model',
          parts: [{ text: "I'll check with the team." }],
        },
        usage,
      });

    const result = await runAssistant(request, {
      ...base(),
      logUnanswered,
      callModel,
    });

    expect(logUnanswered).toHaveBeenCalledOnce();
    expect(result.logged).toBe(true);
  });

  it('keeps guest-supplied item ids but strips ids added by the model', async () => {
    const result = await runAssistant(
      {
        ...request,
        messages: [{ role: 'user', text: 'Tell me about PH0001.' }],
      },
      {
        ...base(),
        callModel: vi.fn().mockResolvedValue({
          content: {
            role: 'model',
            parts: [
              {
                text: 'We have PH0001 on the menu. Try PH0002.',
              },
            ],
          },
          usage,
        }),
      },
    );

    expect(result.text).toContain('PH0001');
    expect(result.text).not.toContain('PH0002');
  });

  it('returns deterministic message when guest message contains unknown menu id', async () => {
    const callModel = vi.fn();
    const result = await runAssistant(
      {
        ...request,
        messages: [{ role: 'user', text: 'Add menu item PH9999 to my cart.' }],
      },
      { ...base(), callModel },
    );
    expect(result.text).toContain('not on the menu');
    expect(result.text).toContain('PH9999');
    expect(result.text).toMatch(/similar/i);
    expect(callModel).not.toHaveBeenCalled();
  });

  it('returns deterministic message when guest message contains unavailable menu id', async () => {
    const callModel = vi.fn();
    const menu = base().menu.map((item) =>
      item.id === 'PH0001' ? { ...item, available: false } : item,
    );
    const result = await runAssistant(
      {
        ...request,
        messages: [{ role: 'user', text: 'Add menu item PH0001 to my cart.' }],
      },
      { ...base(), menu, callModel },
    );
    expect(result.text).toContain('not available');
    expect(result.text).toContain('PH0001');
    expect(result.text).toMatch(/similar/i);
    expect(callModel).not.toHaveBeenCalled();
  });

  it('proceeds to model call when guest message contains a valid available menu id', async () => {
    const callModel = vi.fn().mockResolvedValue({
      content: { role: 'model', parts: [{ text: 'PH0001 is available.' }] },
      usage,
    });
    const result = await runAssistant(
      {
        ...request,
        messages: [{ role: 'user', text: 'Tell me about PH0001.' }],
      },
      { ...base(), callModel },
    );
    expect(callModel).toHaveBeenCalled();
    expect(result.text).toContain('PH0001');
  });

  it('sets fallback to model when model chooses the stock phrase', async () => {
    const result = await runAssistant(
      {
        ...request,
        messages: [{ role: 'user', text: 'Do you sell train tickets?' }],
      },
      {
        ...base(),
        callModel: vi.fn().mockResolvedValue({
          content: {
            role: 'model',
            parts: [{ text: "I'll check with the team." }],
          },
          usage,
        }),
      },
    );
    expect(result.fallback).toBe('model');
  });

  it('has no order or booking creation path', () => {
    const source = [
      'src/lib/assistant/tools.ts',
      'src/lib/assistant/service.ts',
      'src/lib/assistant/handler.ts',
      'src/pages/api/assistant.ts',
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/create_order|create_booking/);
  });
});
