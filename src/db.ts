import type { Env } from './env';
import type { FreeeFiscalYear, FreeeReport } from './freee/types';
import type { Bundle, Settings } from './report/assemble';
import type { InvCat, Method } from './report/types';
import { lastMonth, monthsUpTo } from './lib/fiscal';

export type SnapshotKind = 'pl3' | 'cr3' | 'bs3' | 'pl_fy' | 'cr_fy' | 'bs_fy';

const nowIso = () => new Date().toISOString();

// ---------- meta / fiscal years ----------
export async function getMeta(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
export async function setMeta(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare('INSERT INTO app_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind(key, value).run();
}

export async function upsertFiscalYears(env: Env, fys: FreeeFiscalYear[]): Promise<void> {
  if (!fys.length) return;
  await env.DB.batch(
    fys.map((f) =>
      env.DB.prepare('INSERT INTO fiscal_years (fy, start_date, end_date) VALUES (?1, ?2, ?3) ON CONFLICT(fy) DO UPDATE SET start_date = ?2, end_date = ?3').bind(f.fy, f.start_date, f.end_date),
    ),
  );
}

export async function listFiscalYears(env: Env): Promise<FreeeFiscalYear[]> {
  const r = await env.DB.prepare('SELECT fy, start_date, end_date FROM fiscal_years ORDER BY fy').all<FreeeFiscalYear>();
  return r.results;
}

export function startMonthOf(fys: FreeeFiscalYear[], fy: number): number {
  const f = fys.find((x) => x.fy === fy);
  return f ? Number(f.start_date.slice(5, 7)) : 3;
}

// ---------- snapshots ----------
export async function saveSnapshot(env: Env, fy: number, kind: SnapshotKind, sm: number, em: number, rep: FreeeReport, fetchedAt = nowIso()): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO snapshots (fy, kind, start_month, end_month, body_json, up_to_date, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(fy, kind, start_month, end_month) DO UPDATE SET body_json = ?5, up_to_date = ?6, fetched_at = ?7`,
  )
    .bind(fy, kind, sm, em, JSON.stringify(rep), rep.up_to_date ? 1 : 0, fetchedAt)
    .run();
}

export async function hasSnapshot(env: Env, fy: number, kind: SnapshotKind, sm: number, em: number): Promise<boolean> {
  const r = await env.DB.prepare('SELECT 1 AS x FROM snapshots WHERE fy = ? AND kind = ? AND start_month = ? AND end_month = ?').bind(fy, kind, sm, em).first();
  return !!r;
}

/** 取込済みの対象月（累計 B/S がある月）一覧。新しい順 */
export async function listPeriods(env: Env): Promise<{ fy: number; month: number; fetchedAt: string; upToDate: boolean }[]> {
  const r = await env.DB.prepare("SELECT fy, end_month AS month, fetched_at AS fetchedAt, up_to_date AS u FROM snapshots WHERE kind = 'bs3'").all<{ fy: number; month: number; fetchedAt: string; u: number }>();
  const fys = await listFiscalYears(env);
  return r.results
    .map((x) => ({ fy: x.fy, month: x.month, fetchedAt: x.fetchedAt, upToDate: x.u === 1 }))
    .sort((a, b) => b.fy - a.fy || ord(fys, b) - ord(fys, a));
}
function ord(fys: FreeeFiscalYear[], p: { fy: number; month: number }): number {
  const sm = startMonthOf(fys, p.fy);
  return ((p.month - sm + 12) % 12) + 1;
}

export async function loadBundle(env: Env, fy: number, month: number): Promise<Bundle> {
  const fys = await listFiscalYears(env);
  const sm = startMonthOf(fys, fy);
  const rows = await env.DB.prepare('SELECT fy, kind, start_month, end_month, body_json, fetched_at FROM snapshots WHERE fy BETWEEN ?1 AND ?2')
    .bind(fy - 3, fy)
    .all<{ fy: number; kind: SnapshotKind; start_month: number; end_month: number; body_json: string; fetched_at: string }>();
  const get = (y: number, kind: SnapshotKind, s: number, e: number) => rows.results.find((r) => r.fy === y && r.kind === kind && r.start_month === s && r.end_month === e);
  const parse = (r?: { body_json: string }) => (r ? (JSON.parse(r.body_json) as FreeeReport) : undefined);
  const main = get(fy, 'bs3', sm, month);
  const bundle: Bundle = {
    fy,
    month,
    fyStartMonth: sm,
    companyName: (await getMeta(env, 'company_name')) ?? '株式会社 悠三堂',
    pl3: parse(get(fy, 'pl3', sm, month)),
    cr3: parse(get(fy, 'cr3', sm, month)),
    bs3: parse(main),
    fyData: {},
    monthly: {},
    fetchedAt: main?.fetched_at ?? null,
    fiscalYears: fys,
  };
  for (const y of [fy - 1, fy - 2, fy - 3]) {
    const s = startMonthOf(fys, y);
    const e = lastMonth(s);
    const d = { pl: parse(get(y, 'pl_fy', s, e)), cr: parse(get(y, 'cr_fy', s, e)), bs: parse(get(y, 'bs_fy', s, e)) };
    if (d.pl || d.cr || d.bs) bundle.fyData[y] = d;
  }
  for (const m of monthsUpTo(sm, month)) {
    const r = parse(get(fy, 'pl3', m, m));
    if (r) bundle.monthly[m] = r;
  }
  return bundle;
}

// ---------- settings ----------
export async function getSettings(env: Env, fy: number, month: number): Promise<Settings & { note: string | null; updatedAt: string | null; inputs: InventoryInput[] }> {
  const a = await env.DB.prepare('SELECT method, depreciation_enabled, depreciation_monthly, note, updated_at FROM adjustments WHERE fy = ? AND month = ?')
    .bind(fy, month)
    .first<{ method: Method; depreciation_enabled: number; depreciation_monthly: number | null; note: string | null; updated_at: string | null }>();
  const inputs = await listInventoryInputs(env, fy, month);
  const manual: Settings['manual'] = {};
  for (const i of inputs) manual[i.category] = i.amount;
  return {
    method: a?.method ?? 'carry_forward',
    depreciationEnabled: a?.depreciation_enabled === 1,
    depreciationMonthly: a?.depreciation_monthly ?? null,
    manual,
    note: a?.note ?? null,
    updatedAt: a?.updated_at ?? null,
    inputs,
  };
}

export async function saveSettings(env: Env, fy: number, month: number, s: { method: Method; depreciationEnabled: boolean; depreciationMonthly: number | null; note: string | null }, actor: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO adjustments (fy, month, method, depreciation_enabled, depreciation_monthly, note, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(fy, month) DO UPDATE SET method = ?3, depreciation_enabled = ?4, depreciation_monthly = ?5, note = ?6, updated_by = ?7, updated_at = ?8`,
  )
    .bind(fy, month, s.method, s.depreciationEnabled ? 1 : 0, s.depreciationMonthly, s.note, actor, nowIso())
    .run();
}

export interface InventoryInput {
  category: InvCat;
  qty: number | null;
  unit: string | null;
  unit_cost: number | null;
  amount: number;
  note: string | null;
}

export async function listInventoryInputs(env: Env, fy: number, month: number): Promise<InventoryInput[]> {
  const r = await env.DB.prepare('SELECT category, qty, unit, unit_cost, amount, note FROM inventory_inputs WHERE fy = ? AND month = ?').bind(fy, month).all<InventoryInput>();
  return r.results;
}

export async function saveInventoryInput(env: Env, fy: number, month: number, i: InventoryInput | { category: InvCat; delete: true }, actor: string): Promise<void> {
  if ('delete' in i) {
    await env.DB.prepare('DELETE FROM inventory_inputs WHERE fy = ? AND month = ? AND category = ?').bind(fy, month, i.category).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO inventory_inputs (fy, month, category, qty, unit, unit_cost, amount, note, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(fy, month, category) DO UPDATE SET qty = ?4, unit = ?5, unit_cost = ?6, amount = ?7, note = ?8, updated_by = ?9, updated_at = ?10`,
  )
    .bind(fy, month, i.category, i.qty, i.unit, i.unit_cost, i.amount, i.note, actor, nowIso())
    .run();
}

// ---------- initiatives / attachments ----------
export interface Initiative {
  id: number;
  fy: number;
  title: string;
  started_on: string | null;
  category: string | null;
  purpose: string | null;
  related_accounts: string | null;
  expected_effect: string | null;
  progress: string | null;
  status: 'planned' | 'active' | 'done';
  sort_order: number;
}

export async function listInitiatives(env: Env, fy: number): Promise<Initiative[]> {
  const r = await env.DB.prepare('SELECT * FROM initiatives WHERE fy = ? ORDER BY sort_order, id').bind(fy).all<Initiative>();
  return r.results;
}

export async function saveInitiative(env: Env, i: Omit<Initiative, 'id'> & { id?: number }): Promise<void> {
  const vals = [i.fy, i.title, i.started_on, i.category, i.purpose, i.related_accounts, i.expected_effect, i.progress, i.status, i.sort_order, nowIso()];
  if (i.id) {
    await env.DB.prepare(
      'UPDATE initiatives SET fy=?1, title=?2, started_on=?3, category=?4, purpose=?5, related_accounts=?6, expected_effect=?7, progress=?8, status=?9, sort_order=?10, updated_at=?11 WHERE id=?12',
    )
      .bind(...vals, i.id)
      .run();
  } else {
    await env.DB.prepare(
      'INSERT INTO initiatives (fy, title, started_on, category, purpose, related_accounts, expected_effect, progress, status, sort_order, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)',
    )
      .bind(...vals)
      .run();
  }
}

export async function deleteInitiative(env: Env, id: number): Promise<void> {
  await env.DB.prepare('UPDATE attachments SET initiative_id = NULL WHERE initiative_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM initiatives WHERE id = ?').bind(id).run();
}

export interface Attachment {
  id: number;
  fy: number;
  initiative_id: number | null;
  title: string;
  filename: string;
  r2_key: string;
  content_type: string | null;
  size: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export async function listAttachments(env: Env, fy: number): Promise<Attachment[]> {
  const r = await env.DB.prepare('SELECT * FROM attachments WHERE fy = ? ORDER BY initiative_id IS NOT NULL, initiative_id, id').bind(fy).all<Attachment>();
  return r.results;
}

export async function getAttachment(env: Env, id: number): Promise<Attachment | null> {
  return env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first<Attachment>();
}

export async function insertAttachment(env: Env, a: Omit<Attachment, 'id'>): Promise<void> {
  await env.DB.prepare('INSERT INTO attachments (fy, initiative_id, title, filename, r2_key, content_type, size, uploaded_by, uploaded_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)')
    .bind(a.fy, a.initiative_id, a.title, a.filename, a.r2_key, a.content_type, a.size, a.uploaded_by, a.uploaded_at)
    .run();
}

export async function deleteAttachment(env: Env, id: number): Promise<void> {
  await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
}

// ---------- loans ----------
export interface Loan {
  id: number;
  lender: string;
  account_name: string | null;
  principal: number | null;
  rate: number | null;
  started_on: string | null;
  ends_on: string | null;
  monthly_payment: number | null;
  balance_override: number | null;
  note: string | null;
  sort_order: number;
}

export async function listLoans(env: Env): Promise<Loan[]> {
  const r = await env.DB.prepare('SELECT * FROM loans ORDER BY sort_order, id').all<Loan>();
  return r.results;
}

export async function saveLoan(env: Env, l: Omit<Loan, 'id'> & { id?: number }): Promise<void> {
  const vals = [l.lender, l.account_name, l.principal, l.rate, l.started_on, l.ends_on, l.monthly_payment, l.balance_override, l.note, l.sort_order];
  if (l.id) {
    await env.DB.prepare('UPDATE loans SET lender=?1, account_name=?2, principal=?3, rate=?4, started_on=?5, ends_on=?6, monthly_payment=?7, balance_override=?8, note=?9, sort_order=?10 WHERE id=?11')
      .bind(...vals, l.id)
      .run();
  } else {
    await env.DB.prepare('INSERT INTO loans (lender, account_name, principal, rate, started_on, ends_on, monthly_payment, balance_override, note, sort_order) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)')
      .bind(...vals)
      .run();
  }
}

export async function deleteLoan(env: Env, id: number): Promise<void> {
  await env.DB.prepare('DELETE FROM loans WHERE id = ?').bind(id).run();
}

// ---------- packages ----------
export interface PackageRow {
  id: number;
  fy: number;
  month: number;
  version: number;
  report_json: string;
  submitted_to: string | null;
  submitted_on: string | null;
  memo: string | null;
  created_by: string | null;
  created_at: string;
}

export async function listPackages(env: Env): Promise<Omit<PackageRow, 'report_json'>[]> {
  const r = await env.DB.prepare('SELECT id, fy, month, version, submitted_to, submitted_on, memo, created_by, created_at FROM packages ORDER BY created_at DESC').all<Omit<PackageRow, 'report_json'>>();
  return r.results;
}

export async function getPackage(env: Env, id: number): Promise<PackageRow | null> {
  return env.DB.prepare('SELECT * FROM packages WHERE id = ?').bind(id).first<PackageRow>();
}

export async function insertPackage(env: Env, fy: number, month: number, json: string, actor: string): Promise<{ id: number; version: number }> {
  const v = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM packages WHERE fy = ? AND month = ?').bind(fy, month).first<{ v: number }>();
  const version = v?.v ?? 1;
  const r = await env.DB.prepare('INSERT INTO packages (fy, month, version, report_json, created_by, created_at) VALUES (?1,?2,?3,?4,?5,?6) RETURNING id')
    .bind(fy, month, version, json, actor, nowIso())
    .first<{ id: number }>();
  return { id: r!.id, version };
}

export async function updatePackageSubmission(env: Env, id: number, to: string | null, on: string | null, memo: string | null): Promise<void> {
  await env.DB.prepare('UPDATE packages SET submitted_to = ?1, submitted_on = ?2, memo = ?3 WHERE id = ?4').bind(to, on, memo, id).run();
}

// ---------- audit ----------
export async function audit(env: Env, actor: string | null, action: string, detail: unknown): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (at, actor, action, detail_json) VALUES (?1, ?2, ?3, ?4)').bind(nowIso(), actor, action, JSON.stringify(detail ?? null)).run();
}

export async function recentAudit(env: Env, limit = 20): Promise<{ at: string; actor: string | null; action: string; detail_json: string | null }[]> {
  const r = await env.DB.prepare('SELECT at, actor, action, detail_json FROM audit_log ORDER BY id DESC LIMIT ?').bind(limit).all<{ at: string; actor: string | null; action: string; detail_json: string | null }>();
  return r.results;
}
