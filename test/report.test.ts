import { describe, expect, it } from 'vitest';
import { buildReport, DEFAULT_SETTINGS, type Bundle } from '../src/report/assemble';
import { adjusted, findTotal } from '../src/report/lines';
import { BS3_2026_8, BS_FY2025, CR3_2026_8, CR_FY2025, MONTHLY_PL3_2026, PL3_2026_8, PL_FY2025 } from '../src/demo/fixtures';

const bundle: Bundle = {
  fy: 2026,
  month: 8,
  fyStartMonth: 3,
  companyName: '株式会社 悠三堂',
  pl3: PL3_2026_8,
  cr3: CR3_2026_8,
  bs3: BS3_2026_8,
  fyData: { 2025: { pl: PL_FY2025, cr: CR_FY2025, bs: BS_FY2025 } },
  monthly: MONTHLY_PL3_2026,
  fetchedAt: '2026-09-27T20:43:25+09:00',
};

const total = (lines: ReturnType<typeof buildReport>['pl'], cat: string) => adjusted(findTotal(lines, cat)!);

describe('据置法（設計図 付録B の数値）', () => {
  const r = buildReport(structuredClone(bundle), DEFAULT_SETTINGS);

  it('月末棚卸は期首棚卸高と同額', () => {
    expect(r.inventory[0].closing).toEqual({ product: 368295, wip: 4675808, material: 139886, goods: 0 });
    expect(r.inventory[0].totalAdjustment).toBe(5183989);
    expect(r.inventory[1].totalAdjustment).toBe(5051549);
    expect(r.inventory[2].totalAdjustment).toBe(6836469);
  });

  it('B-1 製造原価報告書', () => {
    expect(total(r.cr, '材料費')[0]).toBe(595456);
    expect(total(r.cr, '総製造費用')[0]).toBe(4291190);
    expect(total(r.cr, '期末仕掛品棚卸')[0]).toBe(4675808);
    expect(total(r.cr, '製造原価')[0]).toBe(4291190);
  });

  it('B-2 損益計算書（当期・前期同期・前々期同期）', () => {
    expect(total(r.pl, '売上原価')).toEqual([4291190, 6040162, 6419979]);
    expect(total(r.pl, '売上総損益金額')).toEqual([9488533, 7345724, 4940129]);
    expect(total(r.pl, '営業損益金額')).toEqual([3071148, -446144, -2114581]);
    expect(total(r.pl, '経常損益金額')).toEqual([3091618, -374576, -2132191]);
    expect(total(r.pl, '当期純損益金額')).toEqual([3091618, -444576, -2202191]);
  });

  it('B-3 貸借対照表', () => {
    expect(total(r.bs, '資産')[0]).toBe(14386790);
    expect(total(r.bs, '負債及び純資産')[0]).toBe(14386790);
    expect(total(r.bs, '純資産')[0]).toBe(-8571823);
    const inv = r.bs.filter((l) => l.category === '棚卸資産').reduce((a, l) => a + adjusted(l)[0], 0);
    expect(inv).toBe(6115955);
    expect(findTotal(r.bs, '資産')!.fyEnd).toEqual([11424423, null]);
  });

  it('検算がすべて通る', () => {
    const errors = r.checks.filter((c) => c.severity === 'error' && !c.ok);
    expect(errors).toEqual([]);
  });

  it('ブリッジ', () => {
    expect(r.bridge.rawNetIncome).toBe(-2092371);
    expect(r.bridge.adjustedNetIncome).toBe(3091618);
  });

  it('感応度：原価率法は約 278 万円', () => {
    const c = r.sensitivity.find((x) => x.key === 'cost_ratio')!;
    expect(Math.abs(c.inventory - 2778000)).toBeLessThan(1000);
  });

  it('月次推移：累計と一致し、3月に期首振替の戻しが入る', () => {
    const gross = r.monthly.series.find((s) => s.key === 'gross')!;
    const sumCur = gross.values.reduce((a, v) => a + (v ? v[0] : 0), 0);
    expect(sumCur).toBe(9488533);
    expect(gross.values[0]![0]).toBe(-2747602 + 5183989);
    const sales = r.monthly.series.find((s) => s.key === 'sales')!;
    expect(sales.values.reduce((a, v) => a + (v ? v[0] : 0), 0)).toBe(13779723);
  });

  it('過去決算サマリー', () => {
    expect(r.pastFy[0]).toMatchObject({ fy: 2025, sales: 26308383, netIncome: 145902, netAssets: -11663441, inventory: 6115955, depreciation: 394604, officerLoans: 13320386, borrowings: 8712730 });
  });
});

describe('減価償却の月割', () => {
  it('前期実績÷12×経過月数を販管費に加算し、貸借は一致', () => {
    const r = buildReport(structuredClone(bundle), { ...DEFAULT_SETTINGS, depreciationEnabled: true });
    expect(r.depreciation[0]).toBe(Math.round(394604 / 12) * 6);
    expect(total(r.pl, '経常損益金額')[0]).toBe(3091618 - Math.round(394604 / 12) * 6);
    expect(r.checks.filter((c) => c.severity === 'error' && !c.ok)).toEqual([]);
    // 前期同期は前々期(FY2024)の通期データが無いので 0
    expect(r.depreciation[1]).toBe(0);
  });
});

describe('実地簡易入力（方法A）', () => {
  it('入力した区分だけ置き換え、他は据置', () => {
    const r = buildReport(structuredClone(bundle), { ...DEFAULT_SETTINGS, method: 'manual', manual: { wip: 3000000 } });
    expect(r.inventory[0].closing.wip).toBe(3000000);
    expect(r.inventory[0].source.wip).toBe('manual');
    expect(r.inventory[0].closing.product).toBe(368295);
    expect(r.bridge.adjustedNetIncome).toBe(-2092371 + 368295 + 139886 + 3000000);
    // 前期同期は据置のまま
    expect(r.inventory[1].totalAdjustment).toBe(5051549);
    expect(r.checks.filter((c) => c.severity === 'error' && !c.ok)).toEqual([]);
  });
});

describe('決算月：freee に期末棚卸が計上済みなら補正しない', () => {
  it('actual 扱いで補正額 0', () => {
    const b = structuredClone(bundle);
    b.pl3!.balances.find((r) => r.account_category_name === '期末製品棚卸')!.closing_balance = 400000;
    const r = buildReport(b, DEFAULT_SETTINGS);
    expect(r.inventory[0].source.product).toBe('actual');
    expect(r.inventory[0].adjustment.product).toBe(0);
  });
});
