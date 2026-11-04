import type { Env } from './env';
import { fetchCompany, fetchReport, isNoManufacturing, type ReportKind } from './freee/client';
import type { FreeeReport } from './freee/types';
import { audit, endMonthOf, hasSnapshot, saveSnapshot, setMeta, startMonthOf, upsertFiscalYears, type SnapshotKind } from './db';
import { lastMonth, monthEndDate, monthsUpTo } from './lib/fiscal';

/** 製造原価報告書がない期（製造業向け機能を使っていない期）の代わりに保存する空の報告 */
const NO_CR: FreeeReport = { up_to_date: true, balances: [] };

/** 試算表を取る。製造原価報告書を使っていない期は空の報告を返す（その期の取込は止めない） */
async function fetchReportOrEmpty(env: Env, api: ReportKind, fy: number, s: number, e: number): Promise<FreeeReport> {
  try {
    return await fetchReport(env, api, fy, s, e);
  } catch (err) {
    if (api.startsWith('trial_cr') && isNoManufacturing(err)) return NO_CR;
    throw err;
  }
}

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
    const e = endMonthOf(company.fiscalYears, y);
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
      const rep: FreeeReport = await fetchReportOrEmpty(env, j.api, j.fy, j.s, j.e);
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

export interface ClosingSyncResult {
  years: number[];
  calls: number;
  skipped: number;
  failed: { fy: number; message: string }[];
}

/**
 * freee にある過去の全期（進行中の今期を除く）の通期データ（P/L・製造原価・B/S）を取り込む。
 * 取込済みの期は飛ばす（force で取り直す）。1期あたり freee API 3回。
 */
export async function syncAllClosings(env: Env, opts: { force?: boolean; actor?: string } = {}): Promise<ClosingSyncResult> {
  const company = await fetchCompany(env);
  await upsertFiscalYears(env, company.fiscalYears);
  if (company.name) await setMeta(env, 'company_name', company.name);
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const past = company.fiscalYears.filter((f) => f.end_date < today).sort((a, b) => b.fy - a.fy);
  const fetchedAt = new Date().toISOString();
  const result: ClosingSyncResult = { years: [], calls: 1, skipped: 0, failed: [] };
  for (const f of past) {
    const s = startMonthOf(company.fiscalYears, f.fy);
    const e = endMonthOf(company.fiscalYears, f.fy);
    try {
      let fetched = 0;
      for (const [kind, api] of [
        ['pl_fy', 'trial_pl'],
        ['cr_fy', 'trial_cr'],
        ['bs_fy', 'trial_bs'],
      ] as const) {
        if (!opts.force && (await hasSnapshot(env, f.fy, kind, s, e))) continue;
        const rep = await fetchReportOrEmpty(env, api, f.fy, s, e);
        result.calls++;
        await saveSnapshot(env, f.fy, kind, s, e, rep, fetchedAt);
        fetched++;
      }
      if (fetched) result.years.push(f.fy);
      else result.skipped++;
    } catch (err) {
      result.failed.push({ fy: f.fy, message: (err as Error).message.slice(0, 200) });
    }
  }
  await audit(env, opts.actor ?? 'system', 'sync_closings', result);
  return result;
}
