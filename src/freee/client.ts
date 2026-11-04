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

/** freee のエラー文から要点だけを取り出す（「エラー詳細」の部分。決まり文句のヒントは省く） */
export function freeeDetail(msg: string): string {
  const m = msg.match(/エラー詳細[:：]\s*([\s\S]*?)(?:\s*ヒント[:：]|$)/);
  const text = (m ? m[1] : msg).replace(/\s+/g, ' ').replace(/^不正なリクエストです。\s*/, '').trim();
  return text.slice(0, 200) || msg.slice(0, 200);
}

/** 製造業向け機能（製造原価報告書）を使っていない期のエラーか */
export function isNoManufacturing(e: unknown): boolean {
  return /製造業向け機能を使用しない/.test(String((e as Error)?.message ?? e));
}

/** claude.ai 版：freee コネクタ（freee_api_get）経由で呼ぶ。エラーは対処がわかる文にして投げる */
async function freeeViaConnector<T>(env: Env, path: string, query: Record<string, string | number>): Promise<T> {
  try {
    const r = await env.FREEE_MCP.callTool('freee', 'freee_api_get', { service: 'accounting', path, query }, { cache: false });
    const p = r.payload;
    if (typeof p === 'string') throw new FreeeError(`freee の応答を読み取れませんでした: ${p.slice(0, 200)}`, 502);
    return p as T;
  } catch (e) {
    if (e instanceof FreeeError) throw e;
    const code = (e as { code?: string }).code;
    const msg = (e as { message?: string }).message ?? '';
    const text: Record<string, string> = {
      needs_reauth: 'freee の接続が切れています。claude.ai の「設定 → コネクタ」で freee を接続し直してください',
      server_not_connected: 'freee がつながっていません。claude.ai の「設定 → コネクタ」で freee を追加してください',
      selection_required: 'freee のコネクタが複数あります。表示された画面で使う方を選んでください',
      not_in_manifest: 'この画面での freee の利用が許可されていません。アーティファクトの権限メニューから freee を許可してください',
      approval_required: 'freee の利用を許可してから、もう一度取り込んでください',
      blocked_by_policy: '組織の設定で、この画面から freee を使うことが止められています',
      server_unavailable: 'freee に一時的につながりません。少し待ってから取り込み直してください',
      tool_error: `freee がエラーを返しました: ${freeeDetail(msg)}`,
    };
    throw new FreeeError(text[code ?? ''] ?? `freee の呼び出しに失敗しました（${code ?? 'unknown'}）: ${msg.slice(0, 200)}`, 502);
  }
}

export async function freeeGet<T>(env: Env, path: string, query: Record<string, string | number>): Promise<T> {
  if (env.FREEE_MCP) return freeeViaConnector<T>(env, path, query);
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
  let fys = (body.company.fiscal_years ?? []).map((f) => ({ fy: Number(f.start_date.slice(0, 4)), start_date: f.start_date, end_date: f.end_date }));
  if (!fys.length) {
    // 会社情報に年度が含まれない応答のときは、3月始まりとして直近の年度を作る
    const y = new Date().getFullYear();
    fys = [y - 4, y - 3, y - 2, y - 1, y].map((fy) => ({ fy, start_date: `${fy}-03-01`, end_date: `${fy + 1}-02-${new Date(Date.UTC(fy + 1, 2, 0)).getUTCDate()}` }));
  }
  return { name: (body.company.display_name || body.company.name || '').replace(/　/g, ' '), fiscalYears: fys };
}
