/**
 * 今期の目標と、前期実績・当期実績（取込済みの月まで）の比較。
 *
 * 目安（その時点までに達しているはずの額）は、目標 × 前期の同じ時期までの割合 で出す。
 * 茶の売上は5月に集中するなど季節の偏りが大きいため、単純な月割（目標 × 経過月/12）は使わない。
 * 当期実績・前期同期は試算表と同じ棚卸補正後の値、前期実績は決算確定値。
 */
import type { FreeeReport } from '../freee/types';
import { adjusted, findTotal, fyTotal } from './lines';
import type { Report } from './types';

export type TargetStatus = 'ok' | 'warn' | 'bad' | null;

export interface TargetRow {
  key: string;
  name: string;
  kind: 'input' | 'derived';
  /** 売上は多いほど良い、費用は少ないほど良い、利益は多いほど良い */
  better: 'higher' | 'lower';
  level: 1 | 2;
  prior: number | null;
  target: number | null;
  ytd: number | null;
  lyYtd: number | null;
  /** 前期の同じ時期までに通期の何割に達していたか */
  priorShare: number | null;
  /** 目標 × priorShare（派生行は構成行の目安から計算） */
  expected: number | null;
  status: TargetStatus;
}

export interface TargetView {
  fy: number;
  hasPrior: boolean;
  hasActual: boolean;
  rows: TargetRow[];
}

const INPUTS = [
  { key: 'cogs', name: '売上原価', category: '売上原価', better: 'lower' as const },
  { key: 'sga', name: '販売管理費', category: '販売管理費', better: 'lower' as const },
  { key: 'nonop_inc', name: '営業外収益', category: '営業外収益', better: 'higher' as const },
  { key: 'nonop_exp', name: '営業外費用', category: '営業外費用', better: 'lower' as const },
];

function status(better: 'higher' | 'lower', ytd: number | null, expected: number | null, scale: number | null): TargetStatus {
  if (ytd === null || expected === null) return null;
  const diff = better === 'higher' ? ytd - expected : expected - ytd;
  if (diff >= 0) return 'ok';
  const base = Math.abs(scale ?? expected) || 1;
  return -diff <= base * 0.1 ? 'warn' : 'bad';
}

const sumOrNull = (vals: (number | null)[]) => (vals.every((v) => v === null) ? null : vals.reduce<number>((a, v) => a + (v ?? 0), 0));
const allOrNull = (vals: (number | null)[]) => (vals.some((v) => v === null) ? null : (vals as number[]).reduce((a, v) => a + v, 0));

export function buildTargetView(fy: number, priorPl: FreeeReport | undefined, report: Report | null, saved: Record<string, number>): TargetView {
  const priorItems = (priorPl?.balances ?? []).filter((r) => !r.total_line && r.account_category_name === '売上高');
  const curItems = (report?.pl ?? []).filter((l) => !l.isTotal && l.category === '売上高');
  // 売上区分：前期と当期の勘定科目をあわせて並べる
  const salesKeys = new Map<string, string>();
  // freee の勘定科目名がそのまま「売上高」のものは、合計行と区別するため（その他）を付ける
  const salesName = (n: string) => (n === '売上高' ? '売上高（その他）' : n);
  for (const r of priorItems) salesKeys.set(`sales:${r.account_item_id}`, salesName(r.account_item_name ?? ''));
  for (const l of curItems) {
    const id = l.key.replace(/^I:/, '');
    if (!salesKeys.has(`sales:${id}`)) salesKeys.set(`sales:${id}`, salesName(l.name));
  }

  const make = (key: string, name: string, better: 'higher' | 'lower', prior: number | null, ytd: number | null, lyYtd: number | null): TargetRow => {
    const target = key in saved ? saved[key] : null;
    const priorShare = prior && lyYtd !== null && prior !== 0 ? lyYtd / prior : null;
    const expected = target !== null && priorShare !== null ? Math.round(target * priorShare) : null;
    return { key, name, kind: 'input', better, level: 2, prior, target, ytd, lyYtd, priorShare, expected, status: status(better, ytd, expected, null) };
  };

  const sales: TargetRow[] = [...salesKeys].map(([key, name]) => {
    const id = key.slice('sales:'.length);
    const pr = priorItems.find((r) => String(r.account_item_id) === id);
    const cur = curItems.find((l) => l.key === `I:${id}`);
    const a = cur ? adjusted(cur) : null;
    return make(key, name, 'higher', priorPl ? (pr?.closing_balance ?? 0) : null, report ? (a?.[0] ?? 0) : null, report ? (a?.[1] ?? 0) : null);
  });
  const inputs = Object.fromEntries(
    INPUTS.map((d) => {
      const l = report ? findTotal(report.pl, d.category) : undefined;
      const a = l ? adjusted(l) : null;
      return [d.key, make(d.key, d.name, d.better, fyTotal(priorPl, d.category) ?? (priorPl ? 0 : null), report ? (a?.[0] ?? 0) : null, report ? (a?.[1] ?? 0) : null)];
    }),
  ) as Record<string, TargetRow>;

  const derived = (key: string, name: string, plus: TargetRow[], minus: TargetRow[], level: 1 | 2 = 1): TargetRow => {
    const pick = (f: (r: TargetRow) => number | null, combine: (v: (number | null)[]) => number | null) => {
      const p = combine(plus.map(f));
      const m = minus.length ? combine(minus.map(f)) : 0;
      return p === null || m === null ? null : p - m;
    };
    const target = pick((r) => r.target, key === 'sales' ? sumOrNull : allOrNull);
    const expected = pick((r) => r.expected, allOrNull);
    const ytd = pick((r) => r.ytd, allOrNull);
    const prior = pick((r) => r.prior, allOrNull);
    const lyYtd = pick((r) => r.lyYtd, allOrNull);
    const scale = salesTotal ? salesTotal.target : target;
    return { key, name, kind: 'derived', better: 'higher', level, prior, target, ytd, lyYtd, priorShare: prior && lyYtd !== null ? lyYtd / prior : null, expected, status: status('higher', ytd, expected, scale) };
  };

  let salesTotal: TargetRow | null = null;
  salesTotal = derived('sales', '売上高', sales, []);
  // 売上合計の目安は、入力された区分の目安の合計（全区分入力済みのときのみ）
  salesTotal.expected = allOrNull(sales.map((r) => r.expected));
  salesTotal.status = status('higher', salesTotal.ytd, salesTotal.expected, null);
  const gross = derived('gross', '売上総利益', [salesTotal], [inputs.cogs]);
  const op = derived('op', '営業利益', [gross], [inputs.sga]);
  const ord = derived('ord', '経常利益', [op, inputs.nonop_inc], [inputs.nonop_exp]);

  return {
    fy,
    hasPrior: !!priorPl,
    hasActual: !!report,
    rows: [...sales, salesTotal, inputs.cogs, gross, inputs.sga, op, inputs.nonop_inc, inputs.nonop_exp, ord],
  };
}

/** 目標として保存できるキー（画面から来た値の検証用） */
export function targetKeys(view: TargetView): string[] {
  return view.rows.filter((r) => r.kind === 'input').map((r) => r.key);
}
