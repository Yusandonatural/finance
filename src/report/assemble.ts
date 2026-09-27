import type { FreeeFiscalYear, FreeeReport } from '../freee/types';
import { fyLabel, lastMonth, monthEndDate, monthIndex, monthLabel, monthStartDate, monthsUpTo, calendarYear } from '../lib/fiscal';
import { yen } from '../lib/format';
import { INV_CATS, INV_LABEL, carryForwardTotal, estimateInventory, invCol3, type ManualInputs } from './inventory';
import { addDelta, adjusted, findTotal, fyItemsSum, fyTotal, isZero, rowKey, scale, sum, toLines, totalRaw } from './lines';
import type { Check, Col3, InvColumn, Line, Method, MonthlySeries, PastFy, Report } from './types';

/** freee から取り込んだ一式 */
export interface Bundle {
  fy: number;
  month: number;
  fyStartMonth: number;
  companyName: string;
  pl3?: FreeeReport;
  cr3?: FreeeReport;
  bs3?: FreeeReport;
  /** 通期（決算確定）データ。キーは fy */
  fyData: Record<number, { pl?: FreeeReport; cr?: FreeeReport; bs?: FreeeReport }>;
  /** 単月 P/L 3期比較。キーは暦月 */
  monthly: Record<number, FreeeReport>;
  fetchedAt: string | null;
  fiscalYears?: FreeeFiscalYear[];
}

export interface Settings {
  method: Method;
  depreciationEnabled: boolean;
  /** null なら前期実績 ÷ 12 */
  depreciationMonthly: number | null;
  manual: ManualInputs;
}

export const DEFAULT_SETTINGS: Settings = {
  method: 'carry_forward',
  depreciationEnabled: false,
  depreciationMonthly: null,
  manual: {},
};

const NI_CHAIN_PL = ['営業損益金額', '経常損益金額', '税引前当期純損益金額', '当期純損益金額'];
const NI_CHAIN_BS = ['当期純損益金額', 'その他利益剰余金', '利益剰余金', '株主資本', '純資産', '負債及び純資産'];

function annualDepreciation(b: Bundle, fy: number): number | null {
  const d = b.fyData[fy];
  if (!d?.pl) return null;
  const isDep = (r: { account_item_name?: string }) => (r.account_item_name ?? '').includes('減価償却');
  return (fyItemsSum(d.pl, isDep) ?? 0) + (fyItemsSum(d.cr, isDep) ?? 0);
}

function rawDepreciationBooked(pl: Line[], cr: Line[], c: number): boolean {
  return [...pl, ...cr].some((l) => !l.isTotal && l.name.includes('減価償却') && l.raw[c] !== 0);
}

function insertAfterLast(lines: Line[], pred: (l: Line) => boolean, line: Line, fallbackBefore?: (l: Line) => boolean): void {
  let idx = -1;
  lines.forEach((l, i) => {
    if (pred(l)) idx = i;
  });
  if (idx >= 0) {
    lines.splice(idx + 1, 0, line);
    return;
  }
  const f = fallbackBefore ? lines.findIndex(fallbackBefore) : -1;
  if (f >= 0) lines.splice(f, 0, line);
  else lines.push(line);
}

function synthetic(key: string, name: string, category: string, level: number, adj: Col3): Line {
  return { key, name, category, level, isTotal: false, synthetic: true, raw: [0, 0, 0], adj };
}

/** B/S に前期末・前々期末の確定値を付ける。3期比較に無い行は同じ区分の末尾に差し込む */
function attachFyEnd(bs: Line[], prev: FreeeReport | undefined, prev2: FreeeReport | undefined): void {
  const maps = [prev, prev2].map((r) => new Map((r?.balances ?? []).map((row) => [rowKey(row), row])));
  for (const l of bs) {
    l.fyEnd = [maps[0].size ? (maps[0].get(l.key)?.closing_balance ?? null) : null, maps[1].size ? (maps[1].get(l.key)?.closing_balance ?? null) : null];
  }
  const known = new Set(bs.map((l) => l.key));
  [prev, prev2].forEach((rep, which) => {
    for (const row of rep?.balances ?? []) {
      const key = rowKey(row);
      if (known.has(key) || row.total_line || row.closing_balance === 0) continue;
      const line: Line = {
        key,
        name: row.account_item_name ?? '',
        category: row.account_category_name ?? '',
        level: row.hierarchy_level,
        isTotal: false,
        raw: [0, 0, 0],
        adj: [0, 0, 0],
        fyEnd: [which === 0 ? row.closing_balance : (maps[0].get(key)?.closing_balance ?? null), which === 1 ? row.closing_balance : (maps[1].get(key)?.closing_balance ?? null)],
      };
      insertAfterLast(bs, (l) => !l.isTotal && l.category === line.category, line);
      known.add(key);
    }
  });
}

export function buildReport(b: Bundle, s: Settings = DEFAULT_SETTINGS, now: Date = new Date()): Report {
  const { fy, month, fyStartMonth: sm } = b;
  const pl = toLines(b.pl3);
  const cr = toLines(b.cr3);
  const bs = toLines(b.bs3);
  const monthsElapsed = monthIndex(sm, month);

  // ---- 棚卸補正 ----
  const inv = estimateInventory(pl, cr, s.method, s.manual);
  const Ep = invCol3(inv, 'product');
  const Eg = invCol3(inv, 'goods');
  const Em = invCol3(inv, 'material');
  const Ew = invCol3(inv, 'wip');
  const E = sum(Ep, Eg, Em, Ew);

  // ---- 減価償却 月割（任意）----
  const annual: (number | null)[] = [annualDepreciation(b, fy - 1), annualDepreciation(b, fy - 2), annualDepreciation(b, fy - 3)];
  const D: Col3 = [0, 0, 0];
  if (s.depreciationEnabled) {
    for (let c = 0; c < 3; c++) {
      if (rawDepreciationBooked(pl, cr, c)) continue;
      const monthly = c === 0 && s.depreciationMonthly !== null ? s.depreciationMonthly : annual[c] !== null ? Math.round((annual[c] as number) / 12) : 0;
      D[c] = monthly * monthsElapsed;
    }
  }
  const dNeg = scale(D, -1);
  const niDelta = sum(E, dNeg);

  // ---- P/L ----
  addDelta(pl, '期末製品棚卸', Ep);
  addDelta(pl, '期末商品棚卸', Eg);
  addDelta(pl, '当期製品製造原価', scale(sum(Em, Ew), -1));
  addDelta(pl, '製品売上原価', scale(sum(Ep, Em, Ew), -1));
  addDelta(pl, '商品売上原価', scale(Eg, -1));
  addDelta(pl, '売上原価', scale(E, -1));
  addDelta(pl, '売上総損益金額', E);
  if (!isZero(D)) {
    insertAfterLast(pl, (l) => !l.isTotal && l.category === '販売管理費', synthetic('S:dep', '減価償却費（月割見積）', '販売管理費', 3, D), (l) => l.isTotal && l.category === '販売管理費');
    addDelta(pl, '販売管理費', D);
  }
  for (const c of NI_CHAIN_PL) addDelta(pl, c, niDelta);

  // ---- 製造原価報告書 ----
  addDelta(cr, '期末原材料棚卸', Em);
  addDelta(cr, '材料費', scale(Em, -1));
  addDelta(cr, '総製造費用', scale(Em, -1));
  addDelta(cr, '期末仕掛品棚卸', Ew);
  addDelta(cr, '製造原価', scale(sum(Em, Ew), -1));

  // ---- B/S ----
  attachFyEnd(bs, b.fyData[fy - 1]?.bs, b.fyData[fy - 2]?.bs);
  if (!isZero(E)) {
    const name = s.method === 'manual' && inv[0].source.product !== 'actual' && INV_CATS.some((k) => inv[0].source[k] === 'manual') ? '月末棚卸見積（実地簡易棚卸）' : '月末棚卸見積（期首棚卸高を据置）';
    const line = synthetic('S:inv', name, '棚卸資産', 3, E);
    line.fyEnd = [null, null];
    insertAfterLast(bs, (l) => l.category === '棚卸資産', line, (l) => l.isTotal && l.category === '流動資産');
    addDelta(bs, '流動資産', E);
  }
  if (!isZero(D)) {
    const line = synthetic('S:dep', '減価償却累計額（月割見積）', '固定資産', 3, dNeg);
    line.fyEnd = [null, null];
    insertAfterLast(bs, () => false, line, (l) => l.isTotal && l.category === '固定資産');
    addDelta(bs, '固定資産', dNeg);
  }
  addDelta(bs, '資産', niDelta);
  for (const c of NI_CHAIN_BS) addDelta(bs, c, niDelta);

  // ---- ブリッジ（当期列）----
  const rawNI = totalRaw(pl, '当期純損益金額')[0];
  const bridgeItems: { label: string; amount: number }[] = [];
  for (const k of INV_CATS) {
    if (inv[0].adjustment[k] !== 0) bridgeItems.push({ label: `月末${INV_LABEL[k]}棚卸 見積`, amount: inv[0].adjustment[k] });
  }
  if (D[0] !== 0) bridgeItems.push({ label: `減価償却費 月割（${monthsElapsed}ヶ月）`, amount: -D[0] });
  const adjNI = rawNI + bridgeItems.reduce((a, x) => a + x.amount, 0);

  // ---- 感応度（当期列）----
  const sales = totalRaw(pl, '売上高');
  const rawCogs = totalRaw(pl, '売上原価');
  const prevSales = fyTotal(b.fyData[fy - 1]?.pl, '売上高');
  const prevCogs = fyTotal(b.fyData[fy - 1]?.pl, '売上原価');
  const carryE = carryForwardTotal(inv[0]);
  const sensitivity: Report['sensitivity'] = [
    { key: 'carry_forward', label: '据置法（期首棚卸高を据置）', inventory: carryE, netIncome: rawNI + carryE - D[0], adopted: s.method === 'carry_forward', note: '年1回棚卸の事業で一般的な月次の扱い' },
  ];
  if (prevSales && prevCogs !== null) {
    const ratio = prevCogs / prevSales;
    const eC = Math.round(rawCogs[0] - sales[0] * ratio);
    sensitivity.push({ key: 'cost_ratio', label: '原価率法（前期原価率で売上原価を推定）', inventory: eC, netIncome: rawNI + eC - D[0], adopted: false, note: `前期原価率 ${(ratio * 100).toFixed(1)}%。参考値` });
  }
  const manualVals = INV_CATS.filter((k) => typeof s.manual[k] === 'number');
  if (manualVals.length) {
    const eA = INV_CATS.reduce((a, k) => a + (typeof s.manual[k] === 'number' ? (s.manual[k] as number) : inv[0].opening[k]), 0);
    sensitivity.push({ key: 'manual', label: '実地簡易棚卸（入力値。未入力区分は据置）', inventory: eA, netIncome: rawNI + eA - D[0], adopted: s.method === 'manual', note: '代表による月末時点の数量×単価' });
  }

  // ---- 月次推移 ----
  const months = monthsUpTo(sm, month);
  const carryCols: Col3 = [carryForwardTotal(inv[0]), carryForwardTotal(inv[1]), carryForwardTotal(inv[2])];
  const finalCols: Col3 = [inv[0].totalAdjustment, inv[1].totalAdjustment, inv[2].totalAdjustment];
  const cumE = (i: number): Col3 => (i < 0 ? [0, 0, 0] : i === months.length - 1 ? finalCols : carryCols);
  const monthlyD: Col3 = monthsElapsed ? [D[0] / monthsElapsed, D[1] / monthsElapsed, D[2] / monthsElapsed] : [0, 0, 0];
  const seriesDef: { key: string; name: string; cat: string; addE: boolean; addD: boolean }[] = [
    { key: 'sales', name: '売上高', cat: '売上高', addE: false, addD: false },
    { key: 'gross', name: '売上総利益', cat: '売上総損益金額', addE: true, addD: false },
    { key: 'sga', name: '販売管理費', cat: '販売管理費', addE: false, addD: true },
    { key: 'op', name: '営業利益', cat: '営業損益金額', addE: true, addD: true },
    { key: 'ord', name: '経常利益', cat: '経常損益金額', addE: true, addD: true },
  ];
  const series: MonthlySeries[] = seriesDef.map((d) => ({
    key: d.key,
    name: d.name,
    values: months.map((m, i) => {
      const rep = b.monthly[m];
      const row = rep?.balances.find((r) => r.total_line && r.account_category_name === d.cat);
      if (!row) return null;
      const raw: Col3 = [row.closing_balance ?? 0, row.last_year_closing_balance ?? 0, row.two_years_before_closing_balance ?? 0];
      const dE = sum(cumE(i), scale(cumE(i - 1), -1));
      const out: Col3 = [...raw] as Col3;
      for (let c = 0; c < 3; c++) {
        if (d.addE) out[c] += dE[c];
        if (d.addD) out[c] += d.key === 'sga' ? monthlyD[c] : -monthlyD[c];
        out[c] = Math.round(out[c]);
      }
      return out;
    }),
  }));

  // ---- 過去の決算 ----
  const pastFy: PastFy[] = [fy - 1, fy - 2, fy - 3]
    .filter((y) => b.fyData[y]?.pl || b.fyData[y]?.bs)
    .map((y) => {
      const d = b.fyData[y];
      const isInv = (r: { account_category_name?: string }) => r.account_category_name === '棚卸資産';
      const isOfficer = (r: { account_item_name?: string }) => (r.account_item_name ?? '').includes('役員借入金');
      const isLoan = (r: { account_item_name?: string }) => (r.account_item_name ?? '').includes('借入金') && !isOfficer(r);
      return {
        fy: y,
        label: fyLabel(y, sm),
        sales: fyTotal(d.pl, '売上高'),
        grossProfit: fyTotal(d.pl, '売上総損益金額'),
        operatingIncome: fyTotal(d.pl, '営業損益金額'),
        ordinaryIncome: fyTotal(d.pl, '経常損益金額'),
        netIncome: fyTotal(d.pl, '当期純損益金額'),
        netAssets: fyTotal(d.bs, '純資産'),
        inventory: fyItemsSum(d.bs, isInv),
        borrowings: fyItemsSum(d.bs, isLoan),
        officerLoans: fyItemsSum(d.bs, isOfficer),
        depreciation: annualDepreciation(b, y),
      };
    });

  const borrowings = bs
    .filter((l) => !l.isTotal && l.name.includes('借入金'))
    .map((l) => ({ name: l.name, cur: adjusted(l)[0], prevFyEnd: l.fyEnd?.[0] ?? null }));

  // ---- 検算 ----
  const checks: Check[] = [];
  const bsA = findTotal(bs, '資産');
  const bsLE = findTotal(bs, '負債及び純資産');
  if (bsA && bsLE) {
    const a = adjusted(bsA);
    const le = adjusted(bsLE);
    const ok = a.every((v, i) => v === le[i]);
    checks.push({ key: 'bs_balance', label: '貸借一致（資産 = 負債・純資産）', ok, severity: 'error', detail: ok ? `当期 ${yen(a[0])}` : `資産 ${a.map(yen).join(' / ')}、負債・純資産 ${le.map(yen).join(' / ')}` });
  }
  const plNI = findTotal(pl, '当期純損益金額');
  const bsNI = findTotal(bs, '当期純損益金額');
  if (plNI && bsNI) {
    const p = adjusted(plNI);
    const q = adjusted(bsNI);
    const ok = p.every((v, i) => v === q[i]);
    checks.push({ key: 'pl_bs', label: 'P/L 当期純損益 = B/S 当期純損益', ok, severity: 'error', detail: `P/L ${yen(p[0])}、B/S ${yen(q[0])}` });
  }
  const crCost = findTotal(cr, '製造原価');
  const plCost = findTotal(pl, '当期製品製造原価');
  if (crCost && plCost) {
    const p = adjusted(crCost);
    const q = adjusted(plCost);
    const ok = p.every((v, i) => v === q[i]);
    checks.push({ key: 'cr_pl', label: '製造原価報告書 = P/L 当期製品製造原価', ok, severity: 'error', detail: `製造原価 ${yen(p[0])}、P/L ${yen(q[0])}` });
  }
  const upToDate = [b.pl3, b.cr3, b.bs3].every((r) => r?.up_to_date !== false) && Object.values(b.monthly).every((r) => r.up_to_date !== false);
  checks.push({ key: 'up_to_date', label: 'freee の集計が完了している', ok: upToDate, severity: 'error', detail: upToDate ? '集計完了' : 'freee 側で集計中のデータがあります。時間をおいて再取込してください' });
  if (!b.pl3 || !b.cr3 || !b.bs3) {
    checks.push({ key: 'data', label: 'freee データの取込', ok: false, severity: 'error', detail: 'この月のデータがありません。取込画面から取り込んでください' });
  }
  // 上限チェック（警告のみ）
  const bound = (label: string, value: number, limit: number) =>
    checks.push({ key: `bound_${label}`, label: `月末${label}棚卸が投入額以内`, ok: value <= limit, severity: 'warn', detail: `見積 ${yen(value)}、期首＋当期投入 ${yen(limit)}` });
  if (b.pl3 && b.cr3) {
    bound('仕掛品', inv[0].closing.wip, inv[0].opening.wip + adjusted(findTotal(cr, '総製造費用') ?? synthetic('', '', '', 0, [0, 0, 0]))[0]);
    bound('原材料', inv[0].closing.material, inv[0].opening.material + totalRaw(cr, '当期原材料仕入高')[0]);
    bound('製品', inv[0].closing.product, inv[0].opening.product + adjusted(plCost ?? synthetic('', '', '', 0, [0, 0, 0]))[0]);
  }
  if (!b.fyData[fy - 1]?.bs) {
    checks.push({ key: 'prev_fy', label: '前期末の確定データ', ok: false, severity: 'warn', detail: '前期の通期データが未取込です' });
  }
  if (s.method === 'manual' && manualVals.length === 0) {
    checks.push({ key: 'manual_missing', label: '実地簡易棚卸の入力', ok: false, severity: 'warn', detail: '方法が実地簡易棚卸ですが入力がありません。据置法で計算しています' });
  }

  // ---- 注記 ----
  const notes: string[] = [];
  const cur = inv[0];
  const parts = INV_CATS.filter((k) => cur.closing[k] !== 0).map((k) => `${INV_LABEL[k]} ${yen(cur.closing[k])}円`);
  const sources = new Set(INV_CATS.filter((k) => cur.closing[k] !== 0 || cur.opening[k] !== 0).map((k) => cur.source[k]));
  if (sources.has('actual') && sources.size === 1) {
    notes.push(`期末棚卸高は決算時の実地棚卸高です（${parts.join('、')}）。`);
  } else {
    let text = '当社は実地棚卸を期末（年1回）に行っており、月末には行っていません。';
    if (sources.has('manual')) {
      const manualParts = INV_CATS.filter((k) => cur.source[k] === 'manual').map((k) => INV_LABEL[k]);
      text += `このため本試算表の月末棚卸高は、${manualParts.join('・')}を月末時点の実地簡易棚卸（数量×単価）により見積り、その他の区分は期首棚卸高（前期末の実地棚卸高）と同額を据え置いて計上しています`;
    } else {
      text += 'このため本試算表の月末棚卸高は、期首棚卸高（前期末の実地棚卸高）と同額を据え置いて計上しています（据置法）';
    }
    text += `。月末棚卸高 合計 ${yen(INV_CATS.reduce((a, k) => a + cur.closing[k], 0))}円（${parts.join('、')}）。`;
    notes.push(text);
    notes.push('比較のため、前期同期・前々期同期の数値にも同じ方法（期首棚卸高の据置）を適用しています。');
  }
  const residual = bs.filter((l) => !l.synthetic && l.category === '棚卸資産').reduce((a, l) => a + l.raw[0], 0);
  if (residual !== 0 && !isZero(E)) {
    notes.push(`貸借対照表の棚卸資産は、会計帳簿上の棚卸資産勘定残高 ${yen(residual)}円 に月末棚卸見積 ${yen(E[0])}円 を加えた金額です。`);
  }
  if (s.depreciationEnabled && D[0] !== 0) {
    notes.push(`減価償却費は決算時に年1回計上しているため、月割見積額（月 ${yen(Math.round(D[0] / monthsElapsed))}円 × ${monthsElapsed}ヶ月 = ${yen(D[0])}円）を計上しています。`);
  } else if (annual[0]) {
    notes.push(`減価償却費は決算時に年1回計上するため、本試算表には含まれていません（前期実績 年 ${yen(annual[0])}円）。`);
  }
  notes.push('上記の補正は本資料上の見積であり、freee 会計の帳簿は変更していません。');
  notes.push('月次推移表では、棚卸補正を期首月の期首棚卸振替の戻しとして表示しています（各月の売上総利益が実態に近くなるように）。');

  const periodEnd = monthEndDate(fy, sm, month);
  const ly = (y: number) => `${calendarYear(y, sm, sm)}年${sm}月〜${calendarYear(y, sm, month)}年${month}月`;
  const lm = lastMonth(sm);

  return {
    meta: {
      fy,
      month,
      fyStartMonth: sm,
      periodStart: monthStartDate(fy, sm),
      periodEnd,
      periodLabel: `${fyLabel(fy, sm)} ${monthLabel(fy, sm, sm)}〜${monthLabel(fy, sm, month)} 累計`,
      monthsElapsed,
      method: s.method,
      depreciationEnabled: s.depreciationEnabled,
      upToDate,
      generatedAt: now.toISOString(),
      fetchedAt: b.fetchedAt,
      companyName: b.companyName,
    },
    labels: {
      cur: `当期 ${ly(fy)}`,
      ly: `前期同期 ${ly(fy - 1)}`,
      ly2: `前々期同期 ${ly(fy - 2)}`,
      bsCur: `${monthLabel(fy, sm, month)}末`,
      bsLy: `${monthLabel(fy - 1, sm, month)}末`,
      bsLy2: `${monthLabel(fy - 2, sm, month)}末`,
      prevFyEnd: `前期末 ${monthLabel(fy - 1, sm, lm)}末`,
      prev2FyEnd: `前々期末 ${monthLabel(fy - 2, sm, lm)}末`,
    },
    inventory: inv,
    depreciation: D,
    pl,
    cr,
    bs,
    bridge: { rawNetIncome: rawNI, items: bridgeItems, adjustedNetIncome: adjNI },
    sensitivity,
    monthly: { months: months.map((m) => ({ month: m, label: `${m}月` })), series },
    pastFy,
    borrowings,
    checks,
    notes,
  };
}

export type { InvColumn };
