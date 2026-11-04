import { describe, expect, it } from 'vitest';
import { buildReport, DEFAULT_SETTINGS, type Bundle } from '../src/report/assemble';
import { buildTargetView } from '../src/report/targets';
import { BS3_2026_8, BS_FY2025, CR3_2026_8, CR_FY2025, MONTHLY_PL3_2026, PL3_2026_8, PL_FY2025 } from '../src/demo/fixtures';

const bundle: Bundle = {
  fy: 2026, month: 8, fyStartMonth: 3, companyName: '株式会社 悠三堂',
  pl3: PL3_2026_8, cr3: CR3_2026_8, bs3: BS3_2026_8,
  fyData: { 2025: { pl: PL_FY2025, cr: CR_FY2025, bs: BS_FY2025 } },
  monthly: MONTHLY_PL3_2026, fetchedAt: null,
};
const report = buildReport(structuredClone(bundle), DEFAULT_SETTINGS);
const row = (v: ReturnType<typeof buildTargetView>, key: string) => v.rows.find((r) => r.key === key)!;

describe('今期の目標', () => {
  it('目標未入力でも前期実績と当期実績を並べる', () => {
    const v = buildTargetView(2026, PL_FY2025, report, {});
    expect(row(v, 'sales').prior).toBe(26308383);
    expect(row(v, 'sales').ytd).toBe(13779723);
    expect(row(v, 'sales:389772212').prior).toBe(19383055);
    expect(row(v, 'cogs').prior).toBe(12785955);
    expect(row(v, 'ord').prior).toBe(285902);
    expect(row(v, 'sales').target).toBeNull();
    expect(row(v, 'ord').status).toBeNull();
  });

  it('目安は 目標 × 前期の同じ時期までの割合', () => {
    const v = buildTargetView(2026, PL_FY2025, report, { 'sales:389772212': 20000000 });
    const r = row(v, 'sales:389772212');
    // 前期 3〜8月の小売 10,448,809 ÷ 前期通期 19,383,055
    expect(r.priorShare).toBeCloseTo(10448809 / 19383055, 6);
    expect(r.expected).toBe(Math.round(20000000 * (10448809 / 19383055)));
    // 当期 9,029,122 は目安 約1,078万 を下回る（10%超）
    expect(r.status).toBe('bad');
  });

  it('全区分と費用を入れると利益の目標と目安が出る', () => {
    const saved = { 'sales:389772212': 20000000, 'sales:125493772': 4000000, 'sales:389772206': 1800000, 'sales:391331484': 3500000, cogs: 13500000, sga: 13000000, nonop_inc: 100000, nonop_exp: 60000 };
    const v = buildTargetView(2026, PL_FY2025, report, saved);
    expect(row(v, 'sales').target).toBe(29300000);
    expect(row(v, 'gross').target).toBe(29300000 - 13500000);
    expect(row(v, 'op').target).toBe(29300000 - 13500000 - 13000000);
    expect(row(v, 'ord').target).toBe(29300000 - 13500000 - 13000000 + 100000 - 60000);
    expect(row(v, 'ord').expected).not.toBeNull();
    expect(row(v, 'ord').ytd).toBe(3091618);
    // 費用は少ないほど良い
    expect(row(v, 'sga').better).toBe('lower');
  });

  it('当期の取込がなくても目標は設定できる', () => {
    const v = buildTargetView(2026, PL_FY2025, null, { cogs: 1 });
    expect(v.hasActual).toBe(false);
    expect(row(v, 'cogs').ytd).toBeNull();
    expect(row(v, 'cogs').status).toBeNull();
  });
});
