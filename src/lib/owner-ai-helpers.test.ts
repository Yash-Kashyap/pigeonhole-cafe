import { describe, expect, it } from 'vitest';
import {
  formatHourLabel,
  formatKolkataTime,
  formatNullableCount,
  formatPercent,
  formatRelativeTime,
  formatUsd,
  parseSummaryContent,
  thinDayLabels,
  zeroFill24Hours,
} from './owner-ai-helpers';

describe('owner-ai-helpers', () => {
  describe('formatUsd', () => {
    it('formats numbers into USD currency with 2 decimals', () => {
      expect(formatUsd(0)).toBe('$0.00');
      expect(formatUsd(14.5)).toBe('$14.50');
      expect(formatUsd(1250.75)).toBe('$1,250.75');
    });
  });

  describe('formatPercent', () => {
    it('formats 0 to 1 rates into percentage string', () => {
      expect(formatPercent(0.85)).toBe('85%');
      expect(formatPercent(1)).toBe('100%');
      expect(formatPercent(0)).toBe('0%');
    });

    it('returns "Not tracked yet" for null or NaN', () => {
      expect(formatPercent(null)).toBe('Not tracked yet');
      expect(formatPercent(Number.NaN)).toBe('Not tracked yet');
    });
  });

  describe('formatNullableCount', () => {
    it('formats valid count or returns "Not tracked yet"', () => {
      expect(formatNullableCount(42)).toBe('42');
      expect(formatNullableCount(0)).toBe('0');
      expect(formatNullableCount(null)).toBe('Not tracked yet');
      expect(formatNullableCount(Number.NaN)).toBe('Not tracked yet');
    });
  });

  describe('zeroFill24Hours', () => {
    it('fills all hours from 0 to 23 with 0 count for missing hours', () => {
      const sparse = [
        { hour: 9, count: 5 },
        { hour: 14, count: 12 },
      ];
      const filled = zeroFill24Hours(sparse);
      expect(filled.length).toBe(24);
      expect(filled[0]).toEqual({ hour: 0, count: 0 });
      expect(filled[9]).toEqual({ hour: 9, count: 5 });
      expect(filled[14]).toEqual({ hour: 14, count: 12 });
      expect(filled[23]).toEqual({ hour: 23, count: 0 });
    });
  });

  describe('formatHourLabel', () => {
    it('formats 24-hour integers into 12-hour AM/PM format', () => {
      expect(formatHourLabel(0)).toBe('12 AM');
      expect(formatHourLabel(8)).toBe('8 AM');
      expect(formatHourLabel(12)).toBe('12 PM');
      expect(formatHourLabel(17)).toBe('5 PM');
      expect(formatHourLabel(23)).toBe('11 PM');
    });
  });

  describe('thinDayLabels', () => {
    it('shows all labels for range today or 7d', () => {
      const days = [
        { day: '2026-11-15', count: 4 },
        { day: '2026-11-16', count: 6 },
      ];
      const thinned = thinDayLabels(days, '7d');
      expect(thinned.every((d) => d.showLabel)).toBe(true);
    });

    it('thins out labels on 30d range to avoid collisions', () => {
      const days = Array.from({ length: 30 }, (_, i) => ({
        day: `2026-11-${String(i + 1).padStart(2, '0')}`,
        count: i,
      }));
      const thinned = thinDayLabels(days, '30d');
      expect(thinned[0]?.showLabel).toBe(true);
      expect(thinned[1]?.showLabel).toBe(false);
      expect(thinned[5]?.showLabel).toBe(true);
      expect(thinned[29]?.showLabel).toBe(true);
    });
  });

  describe('parseSummaryContent', () => {
    it('parses valid JSON with 5 bullets and suggestion', () => {
      const valid = JSON.stringify({
        bullets: ['B1', 'B2', 'B3', 'B4', 'B5'],
        suggestion: 'Make more chai',
      });
      const parsed = parseSummaryContent(valid);
      expect(parsed).toEqual({
        bullets: ['B1', 'B2', 'B3', 'B4', 'B5'],
        suggestion: 'Make more chai',
      });
    });

    it('returns null on invalid JSON or incorrect bullet count', () => {
      expect(parseSummaryContent('not-json')).toBeNull();
      expect(
        parseSummaryContent(
          JSON.stringify({ bullets: ['B1'], suggestion: 'Short' }),
        ),
      ).toBeNull();
      expect(
        parseSummaryContent(
          JSON.stringify({
            bullets: ['1', '2', '3', '4', '5'],
            suggestion: 123,
          }),
        ),
      ).toBeNull();
    });
  });

  describe('formatKolkataTime and formatRelativeTime', () => {
    it('formats timestamp in Asia/Kolkata', () => {
      const iso = '2026-11-21T06:30:00.000Z'; // 12:00 PM IST
      const text = formatKolkataTime(iso);
      expect(text).toContain('Nov');
      expect(text).toContain('12:00');
      expect(text).toContain('pm');
    });

    it('formats relative time based on current time', () => {
      const now = new Date('2026-11-21T12:00:00Z');
      const justNow = '2026-11-21T11:59:45Z';
      const minsAgo = '2026-11-21T11:45:00Z';
      const hoursAgo = '2026-11-21T09:00:00Z';
      const daysAgo = '2026-11-19T12:00:00Z';

      expect(formatRelativeTime(justNow, now)).toBe('Just now');
      expect(formatRelativeTime(minsAgo, now)).toBe('15m ago');
      expect(formatRelativeTime(hoursAgo, now)).toBe('3h ago');
      expect(formatRelativeTime(daysAgo, now)).toBe('2d ago');
    });
  });
});
