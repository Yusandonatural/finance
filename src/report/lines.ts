import type { FreeeReport, FreeeRow } from '../freee/types';
import type { Col3, Line } from './types';

export function rowKey(r: FreeeRow): string {
  if (r.total_line) return `T:${r.account_category_name ?? ''}`;
  return `I:${r.account_item_id ?? r.account_item_name ?? ''}`;
}

function col3(r: FreeeRow): Col3 {
  return [r.closing_balance ?? 0, r.last_year_closing_balance ?? 0, r.two_years_before_closing_balance ?? 0];
}

/** freee 応答（3期比較）を行モデルに変換 */
export function toLines(rep: FreeeReport | undefined): Line[] {
  if (!rep) return [];
  return rep.balances.map((r) => ({
    key: rowKey(r),
    // freee の合計行名「営業損益金額」などは「営業損益」と表示する
    name: r.total_line ? (r.account_category_name ?? '').replace(/金額$/, '') : (r.account_item_name ?? ''),
    category: r.account_category_name ?? '',
    level: r.hierarchy_level,
    isTotal: !!r.total_line,
    raw: col3(r),
    adj: [0, 0, 0],
  }));
}

export function adjusted(l: Line): Col3 {
  return [l.raw[0] + l.adj[0], l.raw[1] + l.adj[1], l.raw[2] + l.adj[2]];
}

export function findTotal(lines: Line[], category: string): Line | undefined {
  return lines.find((l) => l.isTotal && l.category === category);
}

export function totalRaw(lines: Line[], category: string): Col3 {
  return findTotal(lines, category)?.raw ?? [0, 0, 0];
}

/** 単年度応答から合計行の closing を取る */
export function fyTotal(rep: FreeeReport | undefined, category: string): number | null {
  const r = rep?.balances.find((b) => b.total_line && b.account_category_name === category);
  return r ? r.closing_balance : null;
}

export function fyItemsSum(rep: FreeeReport | undefined, pred: (r: FreeeRow) => boolean): number | null {
  if (!rep) return null;
  return rep.balances.filter((r) => !r.total_line && pred(r)).reduce((s, r) => s + r.closing_balance, 0);
}

/** 合計行に差分を足す（該当行が無ければ何もしない） */
export function addDelta(lines: Line[], category: string, delta: Col3): void {
  const l = findTotal(lines, category);
  if (!l) return;
  for (let i = 0; i < 3; i++) l.adj[i] += delta[i];
}

export function scale(c: Col3, k: number): Col3 {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function sum(...cs: Col3[]): Col3 {
  return cs.reduce<Col3>((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]);
}

export function isZero(c: Col3): boolean {
  return c[0] === 0 && c[1] === 0 && c[2] === 0;
}
