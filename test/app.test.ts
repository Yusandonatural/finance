import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

describe('本番の既定動作', () => {
  it('Access 未設定なら 403（公開事故を防ぐ）', async () => {
    const res = await app.request('/report', {}, { FREEE_COMPANY_ID: '796362', APP_ORIGIN: 'https://finance.yusando.com', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' });
    expect(res.status).toBe(403);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
  it('Access 設定済みでもトークンが無ければ 403', async () => {
    const res = await app.request('/report', {}, { FREEE_COMPANY_ID: '796362', APP_ORIGIN: 'https://finance.yusando.com', ACCESS_TEAM_DOMAIN: 'yusando.cloudflareaccess.com', ACCESS_AUD: 'x' });
    expect(res.status).toBe(403);
  });
  it('開発用デモ投入は DEV_MODE 以外では存在しない', async () => {
    const res = await app.request('/dev/seed', { method: 'POST' }, { FREEE_COMPANY_ID: '796362', APP_ORIGIN: 'https://finance.yusando.com', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' });
    expect(res.status).toBe(403);
  });
});
