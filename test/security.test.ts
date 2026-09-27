import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyAccessJwt } from '../src/auth/access';
import { decryptString, encryptString } from '../src/lib/crypto';

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function makeJwt(payload: Record<string, unknown>, kid = 'k1') {
  const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid };
  const h = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return { token: `${h}.${p}.${b64url(sig)}`, jwk };
}

const TEAM = 'yusando.cloudflareaccess.com';
const AUD = 'aud-123';

describe('Cloudflare Access JWT', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('正しいトークンを受け入れ、改ざん・aud 違い・期限切れを拒否する', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const { token, jwk } = await makeJwt({ aud: [AUD], exp, iss: `https://${TEAM}`, email: 'isozaki@yusando.com' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }))));
    await expect(verifyAccessJwt(token, TEAM, AUD)).resolves.toEqual({ email: 'isozaki@yusando.com' });
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64url(JSON.stringify({ aud: [AUD], exp, iss: `https://${TEAM}`, email: 'evil@example.com' }))}.${s}`;
    await expect(verifyAccessJwt(forged, TEAM, AUD)).rejects.toThrow('署名不正');
    await expect(verifyAccessJwt(token, TEAM, 'other-aud')).rejects.toThrow('aud');
    await expect(verifyAccessJwt(token, TEAM, AUD, (exp + 10) * 1000)).rejects.toThrow('期限切れ');
  });
});

describe('トークン暗号化', () => {
  it('暗号化して復号できる。鍵が違えば失敗', async () => {
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const enc = await encryptString('{"access_token":"x"}', key);
    expect(enc).not.toContain('access_token');
    await expect(decryptString(enc, key)).resolves.toBe('{"access_token":"x"}');
    await expect(decryptString(enc, other)).rejects.toThrow();
  });
});
