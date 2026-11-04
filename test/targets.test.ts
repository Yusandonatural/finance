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

import { parseNote } from '../src/report/note';

describe('目標の考え方の組版', () => {
  const note = [
    '2027年2月期 事業の展望',
    '株式会社悠三堂 代表取締役 礒崎遼太郎 · 2026年11月5日',
    '1. 前期の振り返り',
    '前期は数年ぶりに黒字化を達成しました。',
    '• 売上の回復と成長:売上は順調に回復しています。',
    '• 一貫体制を構築しました。',
    '2. 今期の重点事業',
    '1. 古民家カフェの開業:来訪客への直接販売と体験の場をつくります。',
    '2. 協会の設立:普及と教育の受け皿とします。',
    '目標とする財務バランスは次のとおりです。',
    '項目', '目標額', '備考',
    '現金・預金', '500万円', '経費の約3か月分',
    '在庫', '1,000万円', '借入金と同額を維持',
    '長期借入金', '1,000万円', '現在約800万円。同額の在庫で裏付け',
    '3. 財務の現状と方針',
  ].join('\n');
  const b = parseNote(note);
  it('表題・署名・見出し・箇条書き・番号付き項目・表を見分ける', () => {
    expect(b.map((x) => x.type)).toEqual(['title', 'byline', 'h', 'p', 'ul', 'h', 'ol', 'p', 'table', 'h']);
  });
  it('箇条書きの「見出し：本文」を分ける', () => {
    const ul = b[4] as Extract<(typeof b)[number], { type: 'ul' }>;
    expect(ul.items[0]).toEqual({ label: '売上の回復と成長', text: '売上は順調に回復しています。' });
    expect(ul.items[1].label).toBeNull();
  });
  it('1セル1行の表を3列に戻す', () => {
    const t = b[8] as Extract<(typeof b)[number], { type: 'table' }>;
    expect(t.head).toEqual(['項目', '目標額', '備考']);
    expect(t.rows).toEqual([['現金・預金', '500万円', '経費の約3か月分'], ['在庫', '1,000万円', '借入金と同額を維持'], ['長期借入金', '1,000万円', '現在約800万円。同額の在庫で裏付け']]);
  });
  it('ふつうの文だけなら段落のまま', () => {
    expect(parseNote('売上を伸ばします。\n利益も改善します。').map((x) => x.type)).toEqual(['p', 'p']);
  });
});
