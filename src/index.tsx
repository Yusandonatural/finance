import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Env } from './env';
import { accessAuth, sameOrigin } from './auth/access';
import {
  audit,
  deleteAttachment,
  deleteInitiative,
  deleteLoan,
  getAttachment,
  getPackage,
  getSettings,
  insertAttachment,
  insertPackage,
  listAttachments,
  listFiscalYears,
  listInitiatives,
  listLoans,
  listPackages,
  listPeriods,
  loadBundle,
  recentAudit,
  saveInitiative,
  saveInventoryInput,
  saveLoan,
  saveSettings,
  saveSnapshot,
  setMeta,
  startMonthOf,
  updatePackageSubmission,
  upsertFiscalYears,
  type Initiative,
} from './db';
import { authorizeUrl, exchangeCode, saveToken, tokenStatus } from './freee/oauth';
import { monthsUpTo, previousClosedMonth } from './lib/fiscal';
import { randomToken } from './lib/crypto';
import { buildReport } from './report/assemble';
import type { InvCat, Method } from './report/types';
import { syncMonth } from './sync';
import { Layout } from './views/layout';
import { AdjustPage, EmptyPage, HistoryPage, InitiativesPage, LoansPage, ReportPage, SyncPage } from './views/pages';
import { PrintView, type PackageData } from './views/print';
import * as demo from './demo/fixtures';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
});
app.use('*', accessAuth);
app.use('*', sameOrigin);

// ---------- helpers ----------
const int = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};
const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

function flash(c: Context<AppEnv>, msg: string, kind: 'ok' | 'error' = 'ok') {
  setCookie(c, `flash_${kind}`, encodeURIComponent(msg), { path: '/', httpOnly: true, secure: c.env.DEV_MODE !== '1', sameSite: 'Lax', maxAge: 60 });
}
function takeFlash(c: Context<AppEnv>): { flash: string | null; error: string | null } {
  const ok = getCookie(c, 'flash_ok');
  const er = getCookie(c, 'flash_error');
  if (ok) deleteCookie(c, 'flash_ok', { path: '/' });
  if (er) deleteCookie(c, 'flash_error', { path: '/' });
  return { flash: ok ? decodeURIComponent(ok) : null, error: er ? decodeURIComponent(er) : null };
}

/** クエリ（fy&month または p=fy-month）から対象期間を決める。無ければ最新の取込月 */
async function resolvePeriod(c: Context<AppEnv>): Promise<{ fy: number; month: number } | null> {
  const p = c.req.query('p');
  if (p && /^\d{4}-\d{1,2}$/.test(p)) {
    const [fy, month] = p.split('-').map(Number);
    return { fy, month };
  }
  const fy = int(c.req.query('fy'));
  const month = int(c.req.query('month'));
  if (fy && month && month >= 1 && month <= 12) return { fy, month };
  const periods = await listPeriods(c.env);
  return periods[0] ? { fy: periods[0].fy, month: periods[0].month } : null;
}

async function reportFor(env: Env, fy: number, month: number) {
  const [bundle, settings] = await Promise.all([loadBundle(env, fy, month), getSettings(env, fy, month)]);
  return { report: buildReport(bundle, settings), bundle, settings };
}

async function packageData(env: Env, fy: number, month: number): Promise<PackageData> {
  const [{ report }, initiatives, attachments, loans] = await Promise.all([reportFor(env, fy, month), listInitiatives(env, fy), listAttachments(env, fy), listLoans(env)]);
  return { report, initiatives, attachments, loans };
}

// ---------- pages ----------
app.get('/', (c) => c.redirect('/report'));

app.get('/report', async (c) => {
  const period = await resolvePeriod(c);
  const f = takeFlash(c);
  if (!period) {
    const st = await tokenStatus(c.env);
    return c.html(
      <Layout title="試算表" active="/report" actor={c.get('actor')} {...f}>
        <EmptyPage connected={st.connected} />
      </Layout>,
    );
  }
  const [{ report }, periods, fys] = await Promise.all([reportFor(c.env, period.fy, period.month), listPeriods(c.env), listFiscalYears(c.env)]);
  if (!report.pl.length) f.error = f.error ?? 'この月のデータがありません。取込画面から取り込んでください。';
  return c.html(
    <Layout title="試算表" active="/report" actor={c.get('actor')} {...f}>
      <ReportPage r={report} periods={periods} fys={fys} />
    </Layout>,
  );
});

app.get('/print', async (c) => {
  const period = await resolvePeriod(c);
  if (!period) return c.redirect('/report');
  const data = await packageData(c.env, period.fy, period.month);
  return c.html(<PrintView data={data} version={null} createdAt={null} />);
});

app.get('/print/package/:id', async (c) => {
  const pkg = await getPackage(c.env, Number(c.req.param('id')));
  if (!pkg) return c.notFound();
  return c.html(<PrintView data={JSON.parse(pkg.report_json) as PackageData} version={pkg.version} createdAt={pkg.created_at} />);
});

// ---------- sync ----------
app.get('/sync', async (c) => {
  const [status, fys, periods, logs] = await Promise.all([tokenStatus(c.env), listFiscalYears(c.env), listPeriods(c.env), recentAudit(c.env)]);
  const sm = fys.length ? startMonthOf(fys, fys[fys.length - 1].fy) : 3;
  const suggest = previousClosedMonth(new Date(), sm);
  const configured = !!(c.env.FREEE_CLIENT_ID && c.env.FREEE_CLIENT_SECRET && c.env.TOKEN_ENC_KEY);
  return c.html(
    <Layout title="取込" active="/sync" actor={c.get('actor')} {...takeFlash(c)}>
      <SyncPage status={status} configured={configured} fys={fys} suggest={suggest} periods={periods} logs={logs} dev={c.env.DEV_MODE === '1'} />
    </Layout>,
  );
});

app.post('/sync', async (c) => {
  const body = await c.req.parseBody();
  const fy = int(body.fy);
  const month = int(body.month);
  if (!fy || !month) {
    flash(c, '年度と月を指定してください', 'error');
    return c.redirect('/sync');
  }
  try {
    const r = await syncMonth(c.env, fy, month, { force: body.force === '1', actor: c.get('actor') });
    flash(c, `取り込みました（freee API ${r.calls} 回）${r.warnings.length ? '。注意：' + r.warnings.join('、') : ''}`);
    return c.redirect(`/report?fy=${fy}&month=${month}`);
  } catch (e) {
    flash(c, (e as Error).message, 'error');
    return c.redirect('/sync');
  }
});

app.get('/auth/freee/start', async (c) => {
  if (!c.env.FREEE_CLIENT_ID) return c.text('FREEE_CLIENT_ID が未設定です', 500);
  const state = randomToken();
  setCookie(c, 'freee_state', state, { path: '/auth/freee', httpOnly: true, secure: c.env.DEV_MODE !== '1', sameSite: 'Lax', maxAge: 600 });
  return c.redirect(authorizeUrl(c.env, c.req.url, state));
});

app.get('/auth/freee/callback', async (c) => {
  const state = c.req.query('state');
  const code = c.req.query('code');
  const saved = getCookie(c, 'freee_state');
  deleteCookie(c, 'freee_state', { path: '/auth/freee' });
  if (!code || !state || !saved || state !== saved) {
    flash(c, 'freee 連携に失敗しました（state 不一致）。もう一度お試しください', 'error');
    return c.redirect('/sync');
  }
  try {
    const t = await exchangeCode(c.env, c.req.url, code);
    await saveToken(c.env, t);
    await audit(c.env, c.get('actor'), 'freee_connect', { company_id: t.company_id });
    flash(c, 'freee と接続しました');
  } catch (e) {
    flash(c, (e as Error).message, 'error');
  }
  return c.redirect('/sync');
});

// ---------- adjustments ----------
app.get('/adjust', async (c) => {
  const period = await resolvePeriod(c);
  if (!period) return c.redirect('/sync');
  const [{ report, bundle, settings }, periods, fys] = await Promise.all([reportFor(c.env, period.fy, period.month), listPeriods(c.env), listFiscalYears(c.env)]);
  const prev = bundle.fyData[period.fy - 1];
  const dep = prev?.pl ? prev.pl.balances.filter((r) => !r.total_line && (r.account_item_name ?? '').includes('減価償却')).reduce((a, r) => a + r.closing_balance, 0) : null;
  return c.html(
    <Layout title="棚卸補正" active="/adjust" actor={c.get('actor')} {...takeFlash(c)}>
      <AdjustPage r={report} periods={periods} fys={fys} settings={settings} autoMonthlyDep={dep === null ? null : Math.round(dep / 12)} />
    </Layout>,
  );
});

app.post('/adjust', async (c) => {
  const b = await c.req.parseBody();
  const fy = int(b.fy);
  const month = int(b.month);
  if (!fy || !month) return c.redirect('/adjust');
  const actor = c.get('actor');
  const method: Method = b.method === 'manual' ? 'manual' : 'carry_forward';
  await saveSettings(c.env, fy, month, { method, depreciationEnabled: b.dep === '1', depreciationMonthly: int(b.dep_monthly), note: str(b.note) }, actor);
  for (const k of ['product', 'wip', 'material', 'goods'] as InvCat[]) {
    const qty = num(b[`qty_${k}`]);
    const unitCost = int(b[`unit_cost_${k}`]);
    let amount = int(b[`amount_${k}`]);
    if (amount === null && qty !== null && unitCost !== null) amount = Math.round(qty * unitCost);
    if (amount === null) {
      await saveInventoryInput(c.env, fy, month, { category: k, delete: true }, actor);
    } else {
      await saveInventoryInput(c.env, fy, month, { category: k, qty, unit: str(b[`unit_${k}`]), unit_cost: unitCost, amount, note: str(b[`note_${k}`]) }, actor);
    }
  }
  await audit(c.env, actor, 'adjust', { fy, month, method });
  flash(c, '補正を保存しました');
  return c.redirect(`/adjust?fy=${fy}&month=${month}`);
});

// ---------- initiatives & attachments ----------
async function currentFy(c: Context<AppEnv>): Promise<number> {
  const q = int(c.req.query('fy'));
  if (q) return q;
  const periods = await listPeriods(c.env);
  if (periods[0]) return periods[0].fy;
  return previousClosedMonth(new Date(), 3).fy;
}

app.get('/initiatives', async (c) => {
  const fy = await currentFy(c);
  const [items, attachments, fys] = await Promise.all([listInitiatives(c.env, fy), listAttachments(c.env, fy), listFiscalYears(c.env)]);
  const editId = int(c.req.query('edit'));
  return c.html(
    <Layout title="施策・添付" active="/initiatives" actor={c.get('actor')} {...takeFlash(c)}>
      <InitiativesPage fy={fy} fys={fys} items={items} attachments={attachments} edit={items.find((i) => i.id === editId) ?? null} />
    </Layout>,
  );
});

app.post('/initiatives', async (c) => {
  const b = await c.req.parseBody();
  const fy = int(b.fy);
  const title = str(b.title);
  if (!fy || !title) {
    flash(c, '施策名は必須です', 'error');
    return c.redirect(`/initiatives?fy=${fy ?? ''}`);
  }
  const status = (['planned', 'active', 'done'].includes(String(b.status)) ? b.status : 'active') as Initiative['status'];
  await saveInitiative(c.env, {
    id: int(b.id) ?? undefined,
    fy,
    title,
    started_on: str(b.started_on),
    category: str(b.category),
    purpose: str(b.purpose),
    related_accounts: str(b.related_accounts),
    expected_effect: str(b.expected_effect),
    progress: str(b.progress),
    status,
    sort_order: int(b.sort_order) ?? 0,
  });
  await audit(c.env, c.get('actor'), 'initiative_save', { fy, title });
  flash(c, '施策を保存しました');
  return c.redirect(`/initiatives?fy=${fy}`);
});

app.post('/initiatives/:id/delete', async (c) => {
  const b = await c.req.parseBody();
  await deleteInitiative(c.env, Number(c.req.param('id')));
  await audit(c.env, c.get('actor'), 'initiative_delete', { id: c.req.param('id') });
  flash(c, '施策を削除しました');
  return c.redirect(`/initiatives?fy=${int(b.fy) ?? ''}`);
});

const MAX_UPLOAD = 20 * 1024 * 1024;
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

app.post('/attachments', async (c) => {
  const b = await c.req.parseBody();
  const fy = int(b.fy);
  const file = b.file;
  const title = str(b.title);
  if (!fy || !title || !(file instanceof File) || file.size === 0) {
    flash(c, '資料名とファイルを指定してください', 'error');
    return c.redirect(`/initiatives?fy=${fy ?? ''}`);
  }
  if (file.size > MAX_UPLOAD) {
    flash(c, 'ファイルは 20MB までです', 'error');
    return c.redirect(`/initiatives?fy=${fy}`);
  }
  const safeName = file.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(-120);
  const key = `attachments/${fy}/${crypto.randomUUID()}-${safeName}`;
  // R2 は長さ不明のストリームを受け付けないため、20MB 上限の範囲でメモリに読み込んで保存する
  await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  await insertAttachment(c.env, {
    fy,
    initiative_id: int(b.initiative_id),
    title,
    filename: safeName,
    r2_key: key,
    content_type: file.type || null,
    size: file.size,
    uploaded_by: c.get('actor'),
    uploaded_at: new Date().toISOString(),
  });
  await audit(c.env, c.get('actor'), 'attachment_upload', { fy, title, key });
  flash(c, '添付しました');
  return c.redirect(`/initiatives?fy=${fy}`);
});

app.get('/files/:id', async (c) => {
  const a = await getAttachment(c.env, Number(c.req.param('id')));
  if (!a) return c.notFound();
  const obj = await c.env.FILES.get(a.r2_key);
  if (!obj) return c.notFound();
  const type = a.content_type ?? 'application/octet-stream';
  const disp = INLINE_TYPES.has(type) ? 'inline' : 'attachment';
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Disposition': `${disp}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  };
  // PDF は Chrome の PDF ビューアが sandbox CSP 下で表示できないため付けない。それ以外はスクリプト実行を封じる
  if (type !== 'application/pdf') headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
  return new Response(obj.body, { headers });
});

app.post('/attachments/:id/delete', async (c) => {
  const b = await c.req.parseBody();
  const a = await getAttachment(c.env, Number(c.req.param('id')));
  if (a) {
    // 確定済みパッケージは添付名のみを保持しているため、ファイル本体は削除してよい
    await c.env.FILES.delete(a.r2_key);
    await deleteAttachment(c.env, a.id);
    await audit(c.env, c.get('actor'), 'attachment_delete', { id: a.id, title: a.title });
  }
  flash(c, '添付を削除しました');
  return c.redirect(`/initiatives?fy=${int(b.fy) ?? ''}`);
});

// ---------- loans ----------
app.get('/loans', async (c) => {
  const loans = await listLoans(c.env);
  const periods = await listPeriods(c.env);
  const borrowings = periods[0] ? (await reportFor(c.env, periods[0].fy, periods[0].month)).report.borrowings : null;
  const editId = int(c.req.query('edit'));
  return c.html(
    <Layout title="借入金" active="/loans" actor={c.get('actor')} {...takeFlash(c)}>
      <LoansPage loans={loans} borrowings={borrowings} edit={loans.find((l) => l.id === editId) ?? null} />
    </Layout>,
  );
});

app.post('/loans', async (c) => {
  const b = await c.req.parseBody();
  const lender = str(b.lender);
  if (!lender) {
    flash(c, '借入先は必須です', 'error');
    return c.redirect('/loans');
  }
  await saveLoan(c.env, {
    id: int(b.id) ?? undefined,
    lender,
    account_name: str(b.account_name),
    principal: int(b.principal),
    rate: num(b.rate),
    started_on: str(b.started_on),
    ends_on: str(b.ends_on),
    monthly_payment: int(b.monthly_payment),
    balance_override: int(b.balance_override),
    note: str(b.note),
    sort_order: int(b.sort_order) ?? 0,
  });
  await audit(c.env, c.get('actor'), 'loan_save', { lender });
  flash(c, '借入を保存しました');
  return c.redirect('/loans');
});

app.post('/loans/:id/delete', async (c) => {
  await deleteLoan(c.env, Number(c.req.param('id')));
  await audit(c.env, c.get('actor'), 'loan_delete', { id: c.req.param('id') });
  flash(c, '借入を削除しました');
  return c.redirect('/loans');
});

// ---------- packages ----------
app.get('/history', async (c) => {
  const [items, fys] = await Promise.all([listPackages(c.env), listFiscalYears(c.env)]);
  return c.html(
    <Layout title="提出履歴" active="/history" actor={c.get('actor')} {...takeFlash(c)}>
      <HistoryPage items={items} fys={fys} />
    </Layout>,
  );
});

app.post('/packages', async (c) => {
  const b = await c.req.parseBody();
  const fy = int(b.fy);
  const month = int(b.month);
  if (!fy || !month) return c.redirect('/report');
  const data = await packageData(c.env, fy, month);
  const errors = data.report.checks.filter((x) => !x.ok && x.severity === 'error');
  if (errors.length) {
    flash(c, `検算エラーがあるため確定できません：${errors.map((e) => e.label).join('、')}`, 'error');
    return c.redirect(`/report?fy=${fy}&month=${month}`);
  }
  const { id, version } = await insertPackage(c.env, fy, month, JSON.stringify(data), c.get('actor'));
  await audit(c.env, c.get('actor'), 'package_finalize', { fy, month, version, id });
  flash(c, `第${version}版として確定しました`);
  return c.redirect('/history');
});

app.post('/packages/:id', async (c) => {
  const b = await c.req.parseBody();
  await updatePackageSubmission(c.env, Number(c.req.param('id')), str(b.submitted_to), str(b.submitted_on), str(b.memo));
  flash(c, '提出情報を保存しました');
  return c.redirect('/history');
});

// ---------- dev ----------
app.post('/dev/seed', async (c) => {
  if (c.env.DEV_MODE !== '1') return c.notFound();
  const env = c.env;
  await upsertFiscalYears(env, demo.FISCAL_YEARS);
  await setMeta(env, 'company_name', '株式会社 悠三堂');
  const at = '2026-09-27T11:43:25.000Z';
  await saveSnapshot(env, 2026, 'pl3', 3, 8, demo.PL3_2026_8, at);
  await saveSnapshot(env, 2026, 'cr3', 3, 8, demo.CR3_2026_8, at);
  await saveSnapshot(env, 2026, 'bs3', 3, 8, demo.BS3_2026_8, at);
  await saveSnapshot(env, 2025, 'pl_fy', 3, 2, demo.PL_FY2025, at);
  await saveSnapshot(env, 2025, 'cr_fy', 3, 2, demo.CR_FY2025, at);
  await saveSnapshot(env, 2025, 'bs_fy', 3, 2, demo.BS_FY2025, at);
  for (const m of monthsUpTo(3, 8)) await saveSnapshot(env, 2026, 'pl3', m, m, demo.MONTHLY_PL3_2026[m], at);
  await audit(env, c.get('actor'), 'dev_seed', { fy: 2026, month: 8 });
  flash(c, 'デモデータ（2026年8月）を投入しました');
  return c.redirect('/report?fy=2026&month=8');
});

app.onError((err, c) => {
  console.error(err);
  return c.html(
    <Layout title="エラー" actor={c.get('actor')}>
      <h1>エラーが発生しました</h1>
      <p>{err.message}</p>
      <a class="btn" href="/report">
        試算表へ戻る
      </a>
    </Layout>,
    500,
  );
});

export default {
  fetch: app.fetch,
  /** 毎月5日：前月分を自動取込 */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try {
          const fys = await listFiscalYears(env);
          const sm = fys.length ? startMonthOf(fys, fys[fys.length - 1].fy) : 3;
          const { fy, month } = previousClosedMonth(new Date(), sm);
          await syncMonth(env, fy, month, { actor: 'cron' });
        } catch (e) {
          await audit(env, 'cron', 'sync_error', { message: (e as Error).message });
        }
      })(),
    );
  },
};

export { app };
