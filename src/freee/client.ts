import type { Env } from '../env';
import { getAccessToken } from './oauth';
import type { FreeeFiscalYear, FreeeReport, FreeeRow } from './types';

const API = 'https://api.freee.co.jp';

export class FreeeError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function freeeGet<T>(env: Env, path: string, query: Record<string, string | number>): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  let token = await getAccessToken(env);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (res.status === 401 && attempt === 0) {
      token = await getAccessToken(env, true);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new FreeeError(`freee API ${path} が失敗しました（${res.status}）: ${text.slice(0, 300)}`, res.status);
    }
    return (await res.json()) as T;
  }
  throw new FreeeError('freee API 認証に失敗しました', 401);
}

export type ReportKind = 'trial_bs' | 'trial_pl' | 'trial_cr' | 'trial_bs_three_years' | 'trial_pl_three_years' | 'trial_cr_three_years';

/** 試算表を取得して正規化する。応答は { trial_xxx: { balances }, up_to_date } */
export async function fetchReport(env: Env, kind: ReportKind, fy: number, startMonth: number, endMonth: number): Promise<FreeeReport> {
  const body = await freeeGet<Record<string, unknown>>(env, `/api/1/reports/${kind}`, {
    company_id: env.FREEE_COMPANY_ID,
    fiscal_year: fy,
    start_month: startMonth,
    end_month: endMonth,
    display_type: 'group',
  });
  const inner = body[kind] as { balances?: FreeeRow[] } | undefined;
  return { up_to_date: body.up_to_date !== false, balances: inner?.balances ?? [] };
}

export async function fetchCompany(env: Env): Promise<{ name: string; fiscalYears: FreeeFiscalYear[] }> {
  const body = await freeeGet<{ company: { display_name?: string; name?: string; fiscal_years?: { start_date: string; end_date: string }[] } }>(env, `/api/1/companies/${env.FREEE_COMPANY_ID}`, {});
  const fys = (body.company.fiscal_years ?? []).map((f) => ({ fy: Number(f.start_date.slice(0, 4)), start_date: f.start_date, end_date: f.end_date }));
  return { name: (body.company.display_name || body.company.name || '').replace(/　/g, ' '), fiscalYears: fys };
}
