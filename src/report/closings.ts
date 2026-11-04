/**
 * 決算（通期・確定値）の要約と、過去5期の比較。
 * freee の通期試算表（P/L・製造原価・B/S）から、銀行が見る主な数字だけを取り出す。
 */
import type { FreeeFiscalYear, FreeeReport } from '../freee/types';
import { fyItemsSum, fyTotal } from './lines';
import type { PastFy } from './types';

const isDep = (r: { account_item_name?: string }) => (r.account_item_name ?? '').includes('減価償却');
const isInv = (r: { account_category_name?: string }) => r.account_category_name === '棚卸資産';
const isOfficer = (r: { account_item_name?: string }) => (r.account_item_name ?? '').includes('役員借入金');
const isLoan = (r: { account_item_name?: string }) => (r.account_item_name ?? '').includes('借入金') && !isOfficer(r);

/** 期間のラベル。設立初年度のように12ヶ月に満たない期も、実際の日付で書く */
export function periodLabel(f: FreeeFiscalYear | undefined, fy: number): string {
  if (!f) return `${fy}年度`;
  const [sy, sm] = f.start_date.split('-').map(Number);
  const [ey, em] = f.end_date.split('-').map(Number);
  return `${fy}年度（${sy}年${sm}月〜${ey}年${em}月）`;
}

/** 期の月数（設立初年度などの短い期を見分ける） */
export function monthsOf(f: FreeeFiscalYear | undefined): number {
  if (!f) return 12;
  const [sy, sm] = f.start_date.split('-').map(Number);
  const [ey, em] = f.end_date.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

export function closingSummary(fy: number, f: FreeeFiscalYear | undefined, d: { pl?: FreeeReport; cr?: FreeeReport; bs?: FreeeReport }): PastFy {
  const salesItems = (d.pl?.balances ?? [])
    .filter((r) => !r.total_line && r.account_category_name === '売上高')
    .map((r) => ({ name: r.account_item_name === '売上高' ? '売上高（その他）' : (r.account_item_name ?? ''), amount: r.closing_balance }));
  return {
    fy,
    label: periodLabel(f, fy),
    months: monthsOf(f),
    sales: fyTotal(d.pl, '売上高'),
    salesItems,
    costOfSales: fyTotal(d.pl, '売上原価'),
    grossProfit: fyTotal(d.pl, '売上総損益金額'),
    sga: fyTotal(d.pl, '販売管理費'),
    operatingIncome: fyTotal(d.pl, '営業損益金額'),
    ordinaryIncome: fyTotal(d.pl, '経常損益金額'),
    netIncome: fyTotal(d.pl, '当期純損益金額'),
    netAssets: fyTotal(d.bs, '純資産'),
    totalAssets: fyTotal(d.bs, '資産'),
    inventory: fyItemsSum(d.bs, isInv),
    borrowings: fyItemsSum(d.bs, isLoan),
    officerLoans: fyItemsSum(d.bs, isOfficer),
    depreciation: d.pl ? (fyItemsSum(d.pl, isDep) ?? 0) + (fyItemsSum(d.cr, isDep) ?? 0) : null,
  };
}

export interface CompareRow {
  key: string;
  name: string;
  level: 1 | 2;
  values: (number | null)[];
  /** 率で見せる行（粗利率など）は % 表示 */
  percent?: boolean;
  /** 前年比を出す行 */
  yoy?: boolean;
}

export interface FiveYear {
  years: PastFy[];
  rows: CompareRow[];
  /** 年平均伸び率（売上高）。12ヶ月そろった期だけで計算する（設立初年度などの短い期は除く） */
  salesCagr: number | null;
  /** 伸び率の計算に使った最初と最後の年度 */
  cagrFrom: number | null;
  cagrTo: number | null;
}

/** 選べる比較の期数 */
export const COMPARE_CHOICES = [3, 5, 10] as const;
export function normalizeYears(v: unknown): number {
  const n = Number(v);
  return (COMPARE_CHOICES as readonly number[]).includes(n) ? n : 5;
}

/** 直近 n 期（古い順）の比較表 */
export function fiveYearCompare(closings: PastFy[], n = 5): FiveYear {
  const years = closings
    .filter((c) => c.sales !== null)
    .sort((a, b) => a.fy - b.fy)
    .slice(-n);
  const col = (f: (p: PastFy) => number | null) => years.map(f);
  const names = [...new Set(years.flatMap((y) => y.salesItems.map((i) => i.name)))];
  const rows: CompareRow[] = [
    { key: 'sales', name: '売上高', level: 1, values: col((p) => p.sales), yoy: true },
    ...names.map((nm) => ({ key: `sales:${nm}`, name: nm, level: 2 as const, values: col((p) => p.salesItems.find((i) => i.name === nm)?.amount ?? 0), yoy: true })),
    { key: 'gross', name: '売上総利益', level: 1, values: col((p) => p.grossProfit), yoy: true },
    { key: 'grossRate', name: '粗利率', level: 2, values: col((p) => (p.sales && p.grossProfit !== null ? (p.grossProfit / p.sales) * 100 : null)), percent: true },
    { key: 'sga', name: '販売管理費', level: 1, values: col((p) => p.sga ?? null), yoy: true },
    { key: 'op', name: '営業利益', level: 1, values: col((p) => p.operatingIncome) },
    { key: 'ord', name: '経常利益', level: 1, values: col((p) => p.ordinaryIncome) },
    { key: 'net', name: '当期純利益', level: 1, values: col((p) => p.netIncome) },
    { key: 'netAssets', name: '純資産', level: 1, values: col((p) => p.netAssets) },
    { key: 'borrowings', name: '借入金', level: 1, values: col((p) => p.borrowings) },
    { key: 'officer', name: '役員借入金', level: 1, values: col((p) => p.officerLoans) },
  ];
  const full = years.filter((y) => (y.months ?? 12) >= 12 && (y.sales ?? 0) > 0);
  const first = full[0];
  const last = full[full.length - 1];
  const span = first && last ? last.fy - first.fy : 0;
  const salesCagr = span >= 1 ? (Math.pow((last.sales as number) / (first.sales as number), 1 / span) - 1) * 100 : null;
  return { years, rows, salesCagr, cagrFrom: span >= 1 ? first.fy : null, cagrTo: span >= 1 ? last.fy : null };
}
