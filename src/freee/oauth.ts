import type { Env } from '../env';
import { decryptString, encryptString } from '../lib/crypto';

const AUTHORIZE_URL = 'https://accounts.secure.freee.co.jp/public_api/authorize';
const TOKEN_URL = 'https://accounts.secure.freee.co.jp/public_api/token';

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  company_id?: number;
}

export function redirectUri(env: Env, reqUrl: string): string {
  const origin = env.DEV_MODE === '1' ? new URL(reqUrl).origin : env.APP_ORIGIN;
  return `${origin}/auth/freee/callback`;
}

export function authorizeUrl(env: Env, reqUrl: string, state: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('client_id', env.FREEE_CLIENT_ID ?? '');
  u.searchParams.set('redirect_uri', redirectUri(env, reqUrl));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  u.searchParams.set('prompt', 'select_company');
  return u.toString();
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenSet> {
  const body = new URLSearchParams({ client_id: env.FREEE_CLIENT_ID ?? '', client_secret: env.FREEE_CLIENT_SECRET ?? '', ...params });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`freee トークン取得に失敗しました（${res.status}）: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; company_id?: number };
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000, company_id: j.company_id };
}

export function exchangeCode(env: Env, reqUrl: string, code: string): Promise<TokenSet> {
  return tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, reqUrl) });
}

function requireKey(env: Env): string {
  if (!env.TOKEN_ENC_KEY) throw new Error('TOKEN_ENC_KEY が未設定です');
  return env.TOKEN_ENC_KEY;
}

export async function saveToken(env: Env, t: TokenSet, expectVersion?: number): Promise<boolean> {
  const enc = await encryptString(JSON.stringify(t), requireKey(env));
  const now = new Date().toISOString();
  const exp = new Date(t.expires_at).toISOString();
  if (expectVersion === undefined) {
    await env.DB.prepare(
      `INSERT INTO oauth_tokens (provider, enc_json, expires_at, version, updated_at) VALUES ('freee', ?1, ?2, 1, ?3)
       ON CONFLICT(provider) DO UPDATE SET enc_json = ?1, expires_at = ?2, version = oauth_tokens.version + 1, updated_at = ?3`,
    )
      .bind(enc, exp, now)
      .run();
    return true;
  }
  const r = await env.DB.prepare(`UPDATE oauth_tokens SET enc_json = ?1, expires_at = ?2, version = version + 1, updated_at = ?3 WHERE provider = 'freee' AND version = ?4`)
    .bind(enc, exp, now, expectVersion)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function loadToken(env: Env): Promise<{ token: TokenSet; version: number } | null> {
  const row = await env.DB.prepare(`SELECT enc_json, version FROM oauth_tokens WHERE provider = 'freee'`).first<{ enc_json: string; version: number }>();
  if (!row) return null;
  return { token: JSON.parse(await decryptString(row.enc_json, requireKey(env))) as TokenSet, version: row.version };
}

/** 有効なアクセストークンを返す。期限切れならリフレッシュ（リフレッシュトークンは使い捨てなので楽観ロック） */
export async function getAccessToken(env: Env, force = false): Promise<string> {
  const cur = await loadToken(env);
  if (!cur) throw new Error('freee と未接続です。取込画面の「freee と接続」から連携してください');
  if (!force && cur.token.expires_at > Date.now()) return cur.token.access_token;
  let next: TokenSet;
  try {
    next = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: cur.token.refresh_token });
  } catch (e) {
    // 他のリクエストが先に更新していれば、そちらのトークンを使う
    const again = await loadToken(env);
    if (again && again.version !== cur.version && again.token.expires_at > Date.now()) return again.token.access_token;
    throw e;
  }
  const saved = await saveToken(env, { ...next, company_id: next.company_id ?? cur.token.company_id }, cur.version);
  if (!saved) {
    const again = await loadToken(env);
    if (again) return again.token.access_token;
  }
  return next.access_token;
}

export async function tokenStatus(env: Env): Promise<{ connected: boolean; updatedAt?: string; error?: string }> {
  try {
    const row = await env.DB.prepare(`SELECT updated_at FROM oauth_tokens WHERE provider = 'freee'`).first<{ updated_at: string }>();
    return row ? { connected: true, updatedAt: row.updated_at } : { connected: false };
  } catch (e) {
    return { connected: false, error: (e as Error).message };
  }
}
