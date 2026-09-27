import type { Env } from './env';
import { fetchCompany, fetchReport, type ReportKind } from './freee/client';
import type { FreeeReport } from './freee/types';
import { audit, hasSnapshot, saveSnapshot, setMeta, startMonthOf, upsertFiscalYears, type SnapshotKind } from './db';
import { lastMonth, monthEndDate, monthsUpTo } from './lib/fiscal';

export interface SyncResult {
  fy: number;
  month: number;
  calls: number;
  upToDate: boolean;
  warnings: string[];
}

async function inBatches<T>(tasks: (() => Promise<T>)[], size = 4): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += size) out.push(...(await Promise.all(tasks.slice(i, i + size).map((t) => t()))));
  return out;
}

/**
 * freee から対象月の帳票一式を取り込み、D1 にスナップショット保存する。
 * - 当期：累計 3期比較（P/L・製造原価・B/S）と、期首月〜対象月の単月 P/L 3期比較
 * - 過去3期の通期（決算確定）データ：未取込のときだけ取得（force で再取得）
 */
export async function syncMonth(env: Env, fy: number, month: number, opts: { force?: boolean; actor?: string } = {}): Promise<SyncResult> {
  const company = await fetchCompany(env);
  await upsertFiscalYears(env, company.fiscalYears);
  if (company.name) await setMeta(env, 'company_name', company.name);
  if (!company.fiscalYears.some((f) => f.fy === fy)) throw new Error(`${fy}年度は freee に登録されていません`);
  const sm = startMonthOf(company.fiscalYears, fy);
  if (!monthsUpTo(sm, lastMonth(sm)).includes(month)) throw new Error('月の指定が不正です');

  const warnings: string[] = [];
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (monthEndDate(fy, sm, month) >= today) warnings.push('対象月はまだ締まっていません（月中の数値です）');

  const fetchedAt = new Date().toISOString();
  type Job = { fy: number; kind: SnapshotKind; api: ReportKind; s: number; e: number };
  const jobs: Job[] = [
    { fy, kind: 'pl3', api: 'trial_pl_three_years', s: sm, e: month },
    { fy, kind: 'cr3', api: 'trial_cr_three_years', s: sm, e: month },
    { fy, kind: 'bs3', api: 'trial_bs_three_years', s: sm, e: month },
    // 単月 P/L。期首月のみが対象のときは累計と同じ取得になるので重複させない
    ...monthsUpTo(sm, month)
      .filter((m) => !(m === sm && month === sm))
      .map((m) => ({ fy, kind: 'pl3' as const, api: 'trial_pl_three_years' as const, s: m, e: m })),
  ];
  for (const y of [fy - 1, fy - 2, fy - 3]) {
    if (!company.fiscalYears.some((f) => f.fy === y)) continue;
    const s = startMonthOf(company.fiscalYears, y);
    const e = lastMonth(s);
    for (const [kind, api] of [
      ['pl_fy', 'trial_pl'],
      ['cr_fy', 'trial_cr'],
      ['bs_fy', 'trial_bs'],
    ] as const) {
      if (opts.force || !(await hasSnapshot(env, y, kind, s, e))) jobs.push({ fy: y, kind, api, s, e });
    }
  }

  const results = await inBatches(
    jobs.map((j) => async () => {
      const rep: FreeeReport = await fetchReport(env, j.api, j.fy, j.s, j.e);
      await saveSnapshot(env, j.fy, j.kind, j.s, j.e, rep, fetchedAt);
      return rep.up_to_date;
    }),
  );
  const upToDate = results.every(Boolean);
  if (!upToDate) warnings.push('freee 側で集計が完了していないデータがあります');
  const result = { fy, month, calls: jobs.length + 1, upToDate, warnings };
  await audit(env, opts.actor ?? 'system', 'sync', result);
  return result;
}
