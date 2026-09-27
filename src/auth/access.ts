import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { b64ToBytes } from '../lib/crypto';

/**
 * Cloudflare Access の JWT（Cf-Access-Jwt-Assertion）を検証する。
 * - ACCESS_TEAM_DOMAIN と ACCESS_AUD が設定されていれば必ず検証
 * - 未設定の本番は 403（Access を通さずに公開されるのを防ぐ）
 * - DEV_MODE=1 のローカル開発のみ検証を省略
 */

interface Jwk extends JsonWebKey {
  kid: string;
}
let certCache: { at: number; team: string; keys: Jwk[] } | null = null;

async function getKeys(team: string): Promise<Jwk[]> {
  if (certCache && certCache.team === team && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs 取得失敗 ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  certCache = { at: Date.now(), team, keys: body.keys };
  return body.keys;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return b64ToBytes(b64);
}

export async function verifyAccessJwt(token: string, team: string, aud: string, now = Date.now()): Promise<{ email: string }> {
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) throw new Error('JWT 形式が不正');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h))) as { kid: string; alg: string };
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as { aud: string | string[]; exp: number; iss: string; email?: string; common_name?: string };
  if (header.alg !== 'RS256') throw new Error('alg 不正');
  const keys = await getKeys(team);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('鍵が見つからない');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('署名不正');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('aud 不一致');
  if (payload.exp * 1000 < now) throw new Error('期限切れ');
  if (payload.iss !== `https://${team}`) throw new Error('iss 不一致');
  return { email: payload.email ?? payload.common_name ?? 'unknown' };
}

export const accessAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.env;
  if (env.DEV_MODE === '1') {
    c.set('actor', c.req.header('Cf-Access-Authenticated-User-Email') ?? 'dev@local');
    return next();
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return c.text('Cloudflare Access が未設定のため利用できません（wrangler.toml の ACCESS_TEAM_DOMAIN / ACCESS_AUD を設定してください）', 403);
  }
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) return c.text('認証が必要です', 403);
  try {
    const { email } = await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
    c.set('actor', email);
  } catch (e) {
    return c.text(`認証に失敗しました: ${(e as Error).message}`, 403);
  }
  return next();
};

/** 変更系リクエストは同一オリジンからのみ受け付ける（CSRF 対策） */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  const origin = c.req.header('Origin');
  const host = new URL(c.req.url).host;
  if (origin && new URL(origin).host !== host) return c.text('不正なリクエスト元です', 403);
  return next();
};
