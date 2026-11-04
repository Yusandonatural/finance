import type { Env } from './env';
import type { FreeeFiscalYear, FreeeReport } from './freee/types';
import type { Bundle, Settings } from './report/assemble';
import type { InvCat, Method } from './report/types';
import { lastMonth, monthsUpTo } from './lib/fiscal';
import * as docs from './store/docs';
import { closingSummary } from './report/closings';
import type { PastFy } from './report/types';

export type SnapshotKind = 'pl3' | 'cr3' | 'bs3' | 'pl_fy' | 'cr_fy' | 'bs_fy';

const nowIso = () => new Date().toISOString();

// ---------- meta / fiscal years ----------
export async function getMeta(env: Env, key: string): Promise<string | null> {
  if (env.DOCS) return (docs.getMeta as (...a: unknown[]) => any)(...arguments);
  const r = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
export async function setMeta(env: Env, key: string, value: string): Promise<void> {
  if (env.DOCS) return (docs.setMeta as (...a: unknown[]) => any)(...arguments);
  await env.DB.prepare('INSERT INTO app_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind(key, value).run();
}

export async function upsertFiscalYears(env: Env, fys: FreeeFiscalYear[]): Promise<void> {
  if (env.DOCS) return (docs.upsertFiscalYears as (...a: unknown[]) => any)(...arguments);
  if (!fys.length) return;
  await env.DB.batch(
    fys.map((f) =>
      env.DB.prepare('INSERT INTO fiscal_years (fy, start_date, end_date) VALUES (?1, ?2, ?3) ON CONFLICT(fy) DO UPDATE SET start_date = ?2, end_date = ?3').bind(f.fy, f.start_date, f.end_date),
    ),
  );
}

export async function listFiscalYears(env: Env): Promise<FreeeFiscalYear[]> {
  if (env.DOCS) return (docs.listFiscalYears as (...a: unknown[]) => any)(...arguments);
  const r = await env.DB.prepare('SELECT fy, start_date, end_date FROM fiscal_years ORDER BY fy').all<FreeeFiscalYear>();
  return r.results;
}

/** 期末月。設立初年度のように短い期もあるので、freee の終了日から取る */
export function endMonthOf(fys: FreeeFiscalYear[], fy: number): number {
  const f = fys.find((x) => x.fy === fy);
  return f ? Number(f.end_date.slice(5, 7)) : lastMonth(startMonthOf(fys, fy));
}

export function startMonthOf(fys: FreeeFiscalYear[], fy: number): number {
  const f = fys.find((x) => x.fy === fy);
  return f ? Number(f.start_date.slice(5, 7)) : 3;
}

// ---------- snapshots ----------
export async function saveSnapshot(env: Env, fy: number, kind: SnapshotKind, sm: number, em: number, rep: FreeeReport, fetchedAt = nowIso()): Promise<void> {
  if (env.DOCS) return (docs.saveSnapshot as (...a: unknown[]) => any)(...arguments);
  await env.DB.prepare(
    `INSERT INTO snapshots (fy, kind, start_month, end_month, body_json, up_to_date, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(fy, kind, start_month, end_month) DO UPDATE SET body_json = ?5, up_to_date = ?6, fetched_at = ?7`,
  )
    .bind(fy, kind, sm, em, JSON.stringify(rep), rep.up_to_date ? 1 : 0, fetchedAt)
    .run();
}

export async function hasSnapshot(env: Env, fy: number, kind: SnapshotKind, sm: number, em: number): Promise<boolean> {
  if (env.DOCS) return (docs.hasSnapshot as (...a: unknown[]) => any)(...arguments);
  const r = await env.DB.prepare('SELECT 1 AS x FROM snapshots WHERE fy = ? AND kind = ? AND start_month = ? AND end_month = ?').bind(fy, kind, sm, em).first();
  return !!r;
}

/** 取込済みの対象月（累計 B/S がある月）一覧。新しい順 */
export async function listPeriods(env: Env): Promise<{ fy: number; month: number; fetchedAt: string; upToDate: boolean }[]> {
  if (env.DOCS) return (docs.listPeriods as (...a: unknown[]) => any)(...arguments);
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

export interface SnapshotRow {
  fy: number;
  kind: SnapshotKind;
  start_month: number;
  end_month: number;
  report: FreeeReport;
  fetched_at: string;
}

/** 保存済みのスナップショット群から、帳票の組立に使う一式を作る（保存先によらず共通） */
export function assembleBundle(fy: number, month: number, fys: FreeeFiscalYear[], companyName: string | null, rows: SnapshotRow[]): Bundle {
  const sm = startMonthOf(fys, fy);
  const get = (y: number, kind: SnapshotKind, s: number, e: number) => rows.find((r) => r.fy === y && r.kind === kind && r.start_month === s && r.end_month === e);
  const main = get(fy, 'bs3', sm, month);
  const bundle: Bundle = {
    fy,
    month,
    fyStartMonth: sm,
    companyName: companyName ?? '株式会社 悠三堂',
    pl3: get(fy, 'pl3', sm, month)?.report,
    cr3: get(fy, 'cr3', sm, month)?.report,
    bs3: main?.report,
    fyData: {},
    monthly: {},
    fetchedAt: main?.fetched_at ?? null,
    fiscalYears: fys,
  };
  for (const y of [fy - 1, fy - 2, fy - 3]) {
    const s = startMonthOf(fys, y);
    const e = endMonthOf(fys, y);
    const d = { pl: get(y, 'pl_fy', s, e)?.report, cr: get(y, 'cr_fy', s, e)?.report, bs: get(y, 'bs_fy', s, e)?.report };
    if (d.pl || d.cr || d.bs) bundle.fyData[y] = d;
  }
  for (const m of monthsUpTo(sm, month)) {
    const r = get(fy, 'pl3', m, m)?.report;
    if (r) bundle.monthly[m] = r;
  }
  return bundle;
}

export async function loadBundle(env: Env, fy: number, month: number): Promise<Bundle> {
  if (env.DOCS) return (docs.loadBundle as (...a: unknown[]) => any)(...arguments);
  const fys = await listFiscalYears(env);
  const rows = await env.DB.prepare('SELECT fy, kind, start_month, end_month, body_json, fetched_at FROM snapshots WHERE fy BETWEEN ?1 AND ?2')
    .bind(fy - 3, fy)
    .all<{ fy: number; kind: SnapshotKind; start_month: number; end_month: number; body_json: string; fetched_at: string }>();
  const list = rows.results.map((r) => ({ fy: r.fy, kind: r.kind, start_month: r.start_month, end_month: r.end_month, report: JSON.parse(r.body_json) as FreeeReport, fetched_at: r.fetched_at }));
  const bundle = assembleBundle(fy, month, fys, await getMeta(env, 'company_name'), list);
  bundle.closings = await listClosings(env);
  return bundle;
}

/** 取込済みの全期の決算要約 */
export async function listClosings(env: Env): Promise<PastFy[]> {
  if (env.DOCS) return docs.listClosings(env);
  const [fys, rows] = await Promise.all([
    listFiscalYears(env),
    env.DB.prepare("SELECT fy, kind, body_json FROM snapshots WHERE kind IN ('pl_fy', 'cr_fy', 'bs_fy')").all<{ fy: number; kind: SnapshotKind; body_json: string }>(),
  ]);
  const by = new Map<number, { pl?: FreeeReport; cr?: FreeeReport; bs?: FreeeReport }>();
  for (const r of rows.results) {
    const d = by.get(r.fy) ?? {};
    d[r.kind.replace('_fy', '') as 'pl' | 'cr' | 'bs'] = JSON.parse(r.body_json) as FreeeReport;
    by.set(r.fy, d);
  }
  return [...by].map(([fy, d]) => closingSummary(fy, fys.find((f) => f.fy === fy), d)).sort((a, b) => b.fy - a.fy);
}

// ---------- settings ----------
export async function getSettings(env: Env, fy: number, month: number): Promise<Settings & { note: string | null; updatedAt: string | null; inputs: InventoryInput[] }> {
  if (env.DOCS) return (docs.getSettings as (...a: unknown[]) => any)(...arguments);
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
  if (env.DOCS) return (docs.saveSettings as (...a: unknown[]) => any)(...arguments);
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
  if (env.DOCS) return (docs.listInventoryInputs as (...a: unknown[]) => any)(...arguments);
  const r = await env.DB.prepare('SELECT category, qty, unit, unit_cost, amount, note FROM inventory_inputs WHERE fy = ? AND month = ?').bind(fy, month).all<InventoryInput>();
  return r.results;
}

export async function saveInventoryInput(env: Env, fy: number, month: number, i: InventoryInput | { category: InvCat; delete: true }, actor: string): Promise<void> {
  if (env.DOCS) return (docs.saveInventoryInput as (...a: unknown[]) => any)(...arguments);
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
  if (env.DOCS) return (docs.listInitiatives as (...a: unknown[]) => any)(...arguments);
  const r = await env.DB.prepare('SELECT * FROM initiatives WHERE fy = ? ORDER BY sort_order, id').bind(fy).all<Initiative>();
  return r.results;
}

export async function saveInitiative(env: Env, i: Omit<Initiative, 'id'> & { id?: number }): Promise<void> {
  if (env.DOCS) return (docs.saveInitiative as (...a: unknown[]) => any)(...arguments);
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
  if (env.DOCS) return (docs.deleteInitiative as (...a: unknown[]) => any)(...arguments);
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
  /** 'closing' は過去の決算書（年度ごと）。null は施策・年度共通の添付 */
  category?: string | null;
  /** claude.ai 版：添付を開く URL（アップロードした資産の URL） */
  url?: string | null;
  asset_id?: string | null;
}

export async function listAttachments(env: Env, fy: number): Promise<Attachment[]> {
  if (env.DOCS) return (docs.listAttachments as (...a: unknown[]) => any)(...arguments);
  const r = await env.DB.prepare("SELECT * FROM attachments WHERE fy = ? AND (category IS NULL OR category != 'closing') ORDER BY initiative_id IS NOT NULL, initiative_id, id").bind(fy).all<Attachment>();
  return r.results;
}

/** 過去の決算書（全年度） */
export async function listClosingAttachments(env: Env): Promise<Attachment[]> {
  if (env.DOCS) return docs.listClosingAttachments(env);
  const r = await env.DB.prepare("SELECT * FROM attachments WHERE category = 'closing' ORDER BY fy DESC, id").all<Attachment>();
  return r.results;
}

export async function getAttachment(env: Env, id: number): Promise<Attachment | null> {
  if (env.DOCS) return (docs.getAttachment as (...a: unknown[]) => any)(...arguments);
  return env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first<Attachment>();
}

export async function insertAttachment(env: Env, a: Omit<Attachment, 'id'>): Promise<void> {
  if (env.DOCS) return (docs.insertAttachment as (...a: unknown[]) => any)(...arguments);
  await env.DB.prepare('INSERT INTO attachments (fy, initiative_id, title, filename, r2_key, content_type, size, uploaded_by, uploaded_at, category) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)')
    .bind(a.fy, a.initiative_id, a.title, a.filename, a.r2_key, a.content_type, a.size, a.uploaded_by, a.uploaded_at, a.category ?? null)
    .run();
}

export async function deleteAttachment(env: Env, id: number): Promise<void> {
  if (env.DOCS) return (docs.deleteAttachment as (...a: unknown[]) => any)(...arguments);
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
  if (env.DOCS) return (docs.listLoans as (...a: unknown[]) => any)(...arguments);
  const r = await env.DB.prepare('SELECT * FROM loans ORDER BY sort_order, id').all<Loan>();
  return r.results;
}

export async function saveLoan(env: Env, l: Omit<Loan, 'id'> & { id?: number }): Promise<void> {
  if (env.DOCS) return (docs.saveLoan as (...a: unknown[]) => any)(...arguments);
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
  if (env.DOCS) return (docs.deleteLoan as (...a: unknown[]) => any)(...arguments);
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
  if (env.DOCS) return (docs.listPackages as (...a: unknown[]) => any)(...arguments);
  const r = await env.DB.prepare('SELECT id, fy, month, version, submitted_to, submitted_on, memo, created_by, created_at FROM packages ORDER BY created_at DESC').all<Omit<PackageRow, 'report_json'>>();
  return r.results;
}

export async function getPackage(env: Env, id: number): Promise<PackageRow | null> {
  if (env.DOCS) return (docs.getPackage as (...a: unknown[]) => any)(...arguments);
  return env.DB.prepare('SELECT * FROM packages WHERE id = ?').bind(id).first<PackageRow>();
}

export async function insertPackage(env: Env, fy: number, month: number, json: string, actor: string): Promise<{ id: number; version: number }> {
  if (env.DOCS) return (docs.insertPackage as (...a: unknown[]) => any)(...arguments);
  const v = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM packages WHERE fy = ? AND month = ?').bind(fy, month).first<{ v: number }>();
  const version = v?.v ?? 1;
  const r = await env.DB.prepare('INSERT INTO packages (fy, month, version, report_json, created_by, created_at) VALUES (?1,?2,?3,?4,?5,?6) RETURNING id')
    .bind(fy, month, version, json, actor, nowIso())
    .first<{ id: number }>();
  return { id: r!.id, version };
}

export async function updatePackageSubmission(env: Env, id: number, to: string | null, on: string | null, memo: string | null): Promise<void> {
  if (env.DOCS) return (docs.updatePackageSubmission as (...a: unknown[]) => any)(...arguments);
  await env.DB.prepare('UPDATE packages SET submitted_to = ?1, submitted_on = ?2, memo = ?3 WHERE id = ?4').bind(to, on, memo, id).run();
}

// ---------- audit ----------
export async function audit(env: Env, actor: string | null, action: string, detail: unknown): Promise<void> {
  if (env.DOCS) return (docs.audit as (...a: unknown[]) => any)(...arguments);
  await env.DB.prepare('INSERT INTO audit_log (at, actor, action, detail_json) VALUES (?1, ?2, ?3, ?4)').bind(nowIso(), actor, action, JSON.stringify(detail ?? null)).run();
}

export async function recentAudit(env: Env, limit = 20): Promise<{ at: string; actor: string | null; action: string; detail_json: string | null }[]> {
  if (env.DOCS) return (docs.recentAudit as (...a: unknown[]) => any)(...arguments);
  const r = await env.DB.prepare('SELECT at, actor, action, detail_json FROM audit_log ORDER BY id DESC LIMIT ?').bind(limit).all<{ at: string; actor: string | null; action: string; detail_json: string | null }>();
  return r.results;
}

// ---------- targets ----------
export async function getTargets(env: Env, fy: number): Promise<{ values: Record<string, number>; note: string | null; updatedAt: string | null; updatedBy: string | null }> {
  if (env.DOCS) return (docs.getTargets as (...a: unknown[]) => any)(...arguments);
  const [rows, note] = await Promise.all([
    env.DB.prepare('SELECT key, amount FROM targets WHERE fy = ?').bind(fy).all<{ key: string; amount: number }>(),
    env.DB.prepare('SELECT note, updated_at, updated_by FROM target_notes WHERE fy = ?').bind(fy).first<{ note: string | null; updated_at: string | null; updated_by: string | null }>(),
  ]);
  return { values: Object.fromEntries(rows.results.map((r) => [r.key, r.amount])), note: note?.note ?? null, updatedAt: note?.updated_at ?? null, updatedBy: note?.updated_by ?? null };
}

/** values の null は削除。note は年度のメモ */
export async function saveTargets(env: Env, fy: number, values: Record<string, number | null>, note: string | null, actor: string): Promise<void> {
  if (env.DOCS) return (docs.saveTargets as (...a: unknown[]) => any)(...arguments);
  const at = nowIso();
  const stmts = Object.entries(values).map(([key, amount]) =>
    amount === null
      ? env.DB.prepare('DELETE FROM targets WHERE fy = ? AND key = ?').bind(fy, key)
      : env.DB.prepare('INSERT INTO targets (fy, key, amount, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(fy, key) DO UPDATE SET amount = ?3, updated_by = ?4, updated_at = ?5').bind(fy, key, amount, actor, at),
  );
  stmts.push(env.DB.prepare('INSERT INTO target_notes (fy, note, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(fy) DO UPDATE SET note = ?2, updated_by = ?3, updated_at = ?4').bind(fy, note, actor, at));
  await env.DB.batch(stmts);
}

/** 通期（決算確定）の P/L。目標画面で前期実績に使う */
export async function getFyPl(env: Env, fy: number): Promise<FreeeReport | undefined> {
  if (env.DOCS) return (docs.getFyPl as (...a: unknown[]) => any)(...arguments);
  const fys = await listFiscalYears(env);
  const s = startMonthOf(fys, fy);
  const r = await env.DB.prepare("SELECT body_json FROM snapshots WHERE fy = ? AND kind = 'pl_fy' AND start_month = ? AND end_month = ?").bind(fy, s, endMonthOf(fys, fy)).first<{ body_json: string }>();
  return r ? (JSON.parse(r.body_json) as FreeeReport) : undefined;
}
