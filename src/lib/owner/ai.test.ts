import { describe, expect, it } from 'vitest';
import {
  answerInputSchema,
  buildSummaryPayload,
  generatedSummarySchema,
  insightsQuerySchema,
  overridePatchSchema,
  parseGeneratedSummary,
  questionsQuerySchema,
  summaryInputSchema,
  summarySystemInstruction,
  type SummaryAggregate,
} from './ai';

const aggregate: SummaryAggregate = {
  range: 'today',
  start: '2026-11-21',
  end: '2026-11-21',
  orderCount: 8,
  orderTotal: 42.5,
  bookingCount: 3,
  ordersPerDay: [{ day: '2026-11-21', count: 8 }],
  topItems: [{ id: 'PH0001', name: 'Masala Chai', quantity: 5 }],
  ordersPerHour: [{ hour: 17, count: 4 }],
  bookingsByPartySize: [{ partySize: 4, count: 2 }],
  assistant: {
    conversations: 2,
    answeredRate: 0.5,
    cartActions: 1,
    bookingActions: null,
  },
};

describe('owner AI input and summary helpers', () => {
  it('accepts trimmed plain text at the allowed lengths and rejects controls or markup', () => {
    expect(
      answerInputSchema.parse({
        question: '  Where is parking? ',
        answer: '  Nearby street parking is available.  ',
      }),
    ).toEqual({
      question: 'Where is parking?',
      answer: 'Nearby street parking is available.',
    });
    expect(
      answerInputSchema.safeParse({ question: 'ab', answer: 'Answer' }).success,
    ).toBe(false);
    expect(
      answerInputSchema.safeParse({ question: 'Question', answer: 'a\nanswer' })
        .success,
    ).toBe(false);
    expect(
      answerInputSchema.safeParse({
        question: 'Question',
        answer: 'a\u0085answer',
      }).success,
    ).toBe(false);
    expect(
      answerInputSchema.safeParse({
        question: 'Question',
        answer: '<b>Answer</b>',
      }).success,
    ).toBe(false);
    expect(
      answerInputSchema.safeParse({
        question: 'Question',
        answer: 'x'.repeat(601),
      }).success,
    ).toBe(false);
    expect(
      answerInputSchema.safeParse({
        question: 'Question',
        answer: 'Answer',
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('requires a nonempty strict override patch', () => {
    expect(overridePatchSchema.safeParse({}).success).toBe(false);
    expect(
      overridePatchSchema.safeParse({ answer: 'Updated answer' }).success,
    ).toBe(true);
    expect(
      overridePatchSchema.safeParse({ answer: 'Updated answer', extra: true })
        .success,
    ).toBe(false);
  });

  it('validates question pagination, day filters and insight ranges strictly', () => {
    expect(questionsQuerySchema.parse({ page: '2' })).toMatchObject({
      filter: 'unanswered',
      page: 2,
    });
    expect(questionsQuerySchema.safeParse({ day: '2026-02-30' }).success).toBe(
      false,
    );
    expect(questionsQuerySchema.safeParse({ filter: 'handled' }).success).toBe(
      false,
    );
    expect(insightsQuerySchema.parse({ range: '30d' })).toEqual({
      range: '30d',
    });
    expect(insightsQuerySchema.safeParse({ range: '90d' }).success).toBe(false);
    expect(
      summaryInputSchema.safeParse({ regenerate: true, anything: 1 }).success,
    ).toBe(false);
  });

  it('builds the summary prompt payload from aggregates only', () => {
    const payload = buildSummaryPayload(aggregate);
    expect(payload).toContain('"orderCount":8');
    expect(payload).toContain('"orderTotal":42.5');
    expect(payload).toContain('"peakHour":{"hour":17,"count":4}');
    expect(payload).not.toContain('phone');
    expect(payload).not.toContain('email');
    expect(payload).not.toContain('guest');
    expect(payload).not.toContain('id');
    expect(summarySystemInstruction()).toContain('Return only strict JSON');
  });

  it('accepts exactly five short bullets and one suggestion', () => {
    const value = {
      bullets: ['One', 'Two', 'Three', 'Four', 'Five'],
      suggestion: 'Check the evening staffing plan.',
    };
    expect(parseGeneratedSummary(JSON.stringify(value))).toEqual(value);
    expect(
      generatedSummarySchema.safeParse({ ...value, bullets: ['One'] }).success,
    ).toBe(false);
    expect(
      generatedSummarySchema.safeParse({ ...value, extra: 'value' }).success,
    ).toBe(false);
    expect(
      generatedSummarySchema.safeParse({
        ...value,
        bullets: ['x'.repeat(161), ...value.bullets.slice(1)],
      }).success,
    ).toBe(false);
    expect(() => parseGeneratedSummary('not json')).toThrow('summary_invalid');
  });

  it('accepts a summary wrapped in a markdown code fence', () => {
    const value = {
      bullets: ['One', 'Two', 'Three', 'Four', 'Five'],
      suggestion: 'Check the evening staffing plan.',
    };
    const fenced = '```json\n' + JSON.stringify(value) + '\n```';
    expect(parseGeneratedSummary(fenced)).toEqual(value);
    expect(
      parseGeneratedSummary('```\n' + JSON.stringify(value) + '\n```'),
    ).toEqual(value);
  });
});
