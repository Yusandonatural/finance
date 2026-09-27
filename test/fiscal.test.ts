import { describe, expect, it } from 'vitest';
import { fiscalMonths, monthEndDate, monthIndex, monthsUpTo, previousClosedMonth } from '../src/lib/fiscal';
import { pct, yen } from '../src/lib/format';

describe('fiscal', () => {
  it('3月始まり', () => {
    expect(fiscalMonths(3)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2]);
    expect(monthIndex(3, 8)).toBe(6);
    expect(monthIndex(3, 2)).toBe(12);
    expect(monthsUpTo(3, 5)).toEqual([3, 4, 5]);
    expect(monthEndDate(2026, 3, 2)).toBe('2027-02-28');
    expect(monthEndDate(2027, 3, 2)).toBe('2028-02-29');
  });
  it('前月（JST）', () => {
    expect(previousClosedMonth(new Date('2026-09-27T03:00:00Z'), 3)).toEqual({ fy: 2026, month: 8 });
    expect(previousClosedMonth(new Date('2027-01-05T00:00:00Z'), 3)).toEqual({ fy: 2026, month: 12 });
    expect(previousClosedMonth(new Date('2027-03-31T16:00:00Z'), 3)).toEqual({ fy: 2027, month: 3 });
  });
});

describe('format', () => {
  it('▲ 表記', () => {
    expect(yen(-2092371)).toBe('▲2,092,371');
    expect(yen(1234)).toBe('1,234');
    expect(pct(110, 100)).toBe('+10.0%');
    expect(pct(-5, 10)).toBe('—');
  });
});
