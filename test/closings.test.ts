import { describe, expect, it } from 'vitest';
import { closingSummary, fiveYearCompare, monthsOf, periodLabel } from '../src/report/closings';
import { BS_FY2025, CR_FY2025, PL_FY2025 } from '../src/demo/fixtures';
import type { PastFy } from '../src/report/types';

const fy2025 = { fy: 2025, start_date: '2025-03-01', end_date: '2026-02-28' };
const first = { fy: 2016, start_date: '2016-10-03', end_date: '2017-02-28' };

describe('決算の要約', () => {
  it('FY2025 の実データから主な数字を取り出す', () => {
    const c = closingSummary(2025, fy2025, { pl: PL_FY2025, cr: CR_FY2025, bs: BS_FY2025 });
    expect(c).toMatchObject({ fy: 2025, months: 12, sales: 26308383, grossProfit: 13522428, sga: 13420638, ordinaryIncome: 285902, netIncome: 145902, netAssets: -11663441, borrowings: 8712730, officerLoans: 13320386, depreciation: 394604 });
    expect(c.salesItems.map((i) => i.name)).toEqual(['小売売上高', '売上高（その他）', '海外売上高', 'EC売上高']);
    expect(c.salesItems.reduce((a, i) => a + i.amount, 0)).toBe(26308383);
    expect(c.label).toBe('2025年度（2025年3月〜2026年2月）');
  });
  it('設立初年度の短い期は実際の期間で表す', () => {
    expect(monthsOf(first)).toBe(5);
    expect(periodLabel(first, 2016)).toBe('2016年度（2016年10月〜2017年2月）');
  });
});

const mk = (fy: number, sales: number, ord: number, months = 12): PastFy => ({
  fy, label: `${fy}年度`, months, sales, salesItems: [{ name: '小売売上高', amount: sales * 0.7 }, { name: 'EC売上高', amount: sales * 0.3 }],
  grossProfit: sales * 0.5, sga: sales * 0.45, operatingIncome: ord, ordinaryIncome: ord, netIncome: ord, netAssets: 0, inventory: 0, borrowings: 0, officerLoans: 0, depreciation: 0,
});

describe('過去5期の比較', () => {
  const all = [mk(2016, 1e6, -1e6, 5), mk(2019, 10e6, -3e6), mk(2020, 12e6, -2e6), mk(2021, 15e6, -1e6), mk(2022, 18e6, 0), mk(2023, 20e6, 1e6), mk(2024, 22e6, 2e6), mk(2025, 26308383, 285902)];
  it('直近5期を古い順に並べ、年平均伸び率を出す', () => {
    const f = fiveYearCompare(all);
    expect(f.years.map((y) => y.fy)).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(f.rows[0].values).toEqual([15e6, 18e6, 20e6, 22e6, 26308383]);
    expect(f.salesCagr).toBeCloseTo((Math.pow(26308383 / 15e6, 1 / 4) - 1) * 100, 6);
    const rate = f.rows.find((r) => r.key === 'grossRate')!;
    expect(rate.values[0]).toBeCloseTo(50, 6);
  });
  it('12ヶ月未満の期は、年平均伸び率の計算から外す', () => {
    const f = fiveYearCompare([mk(2016, 1e6, 0, 5), mk(2017, 5e6, 0), mk(2018, 8e6, 0)]);
    expect(f.years.length).toBe(3);
    expect(f.cagrFrom).toBe(2017);
    expect(f.salesCagr).toBeCloseTo((8e6 / 5e6 - 1) * 100, 6);
  });
  it('期数を切り替えられる（3・5・10）', () => {
    expect(fiveYearCompare(all, 3).years.map((y) => y.fy)).toEqual([2023, 2024, 2025]);
    expect(fiveYearCompare(all, 10).years.map((y) => y.fy)).toEqual([2016, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(fiveYearCompare(all, 10).cagrFrom).toBe(2019);
  });
});

import { freeeDetail, isNoManufacturing } from '../src/freee/client';

describe('freee のエラー文', () => {
  const raw = 'APIリクエストエラー: API request failed: 400 エラー詳細: 不正なリクエストです。 製造業向け機能を使用しない設定になっています。 ヒント: 不正なリクエストエラーが発生しました。 既存のデータを取得して正しい構造を確認することをお勧めします。';
  it('要点だけを取り出す', () => {
    expect(freeeDetail(raw)).toBe('製造業向け機能を使用しない設定になっています。');
  });
  it('製造原価報告書を使っていない期のエラーを見分ける', () => {
    expect(isNoManufacturing(new Error(raw))).toBe(true);
    expect(isNoManufacturing(new Error('API request failed: 401'))).toBe(false);
  });
});
