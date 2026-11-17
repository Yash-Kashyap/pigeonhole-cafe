import { describe, expect, it } from 'vitest';
import { FAQ_ITEMS } from './faq';
import { SIGNATURE_DISHES } from './signatures';

describe('Signature dishes data', () => {
  it('has exactly 6 signature dishes', () => {
    expect(SIGNATURE_DISHES).toHaveLength(6);
  });

  it('includes all 6 required signature items', () => {
    const ids = SIGNATURE_DISHES.map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'PH0003',
        'PH0060',
        'PH0152',
        'PH0097',
        'PH0203',
        'PH0049',
      ]),
    );
  });

  it('assigns valid icons and cells for all signature dishes', () => {
    for (const dish of SIGNATURE_DISHES) {
      expect(['mug', 'book', 'jar']).toContain(dish.icon);
      expect(dish.price).toBeGreaterThan(0);
      expect(dish.name.length).toBeGreaterThan(0);
    }
  });
});

describe('FAQ items data', () => {
  it('has exactly 13 FAQ items', () => {
    expect(FAQ_ITEMS).toHaveLength(13);
  });

  it('ensures each question has an id starting with faq-', () => {
    for (const item of FAQ_ITEMS) {
      expect(item.id.startsWith('faq-')).toBe(true);
    }
  });

  it('ensures every sentence in FAQ answers is under 22 words', () => {
    for (const item of FAQ_ITEMS) {
      // Split answer into sentences by . ! ?
      const sentences = item.answer
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const sentence of sentences) {
        const wordCount = sentence.split(/\s+/).length;
        expect(wordCount).toBeLessThan(22);
      }
    }
  });

  it('ensures all FAQ answers are under 45 words total', () => {
    for (const item of FAQ_ITEMS) {
      const totalWords = item.answer.trim().split(/\s+/).length;
      expect(totalWords).toBeLessThanOrEqual(45);
    }
  });
});
