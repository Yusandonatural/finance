/**
 * claude.ai 版の保存先：アーティファクトの db（JSON 文書ストア）。
 * src/db.ts と同じ関数名・引数で実装し、db.ts は env.DOCS があるときここへ処理を渡す。
 *
 * 文書の配置
 *   meta/app                      会社名などの設定値
 *   meta/fiscal_years             会計年度の一覧
 *   meta/audit                    操作履歴（直近 200 件を1文書にまとめる）
 *   snapshots/<fy>_<kind>_<s>_<e> freee の試算表応答
 *   adjustments/<fy>-<month>      棚卸補正の設定と実地簡易棚卸の入力
 *   initiatives/<id>  attachments/<id>  loans/<id>  packages/<id>
 *   targets/<fy>                  今期の目標
 * 1文書は 256 KiB まで、全体で 25,000 文書まで。
 */
import type { Env } from '../env';
import type { FreeeFiscalYear, FreeeReport } from '../freee/types';
import type { Bundle, Settings } from '../report/assemble';
import type { InvCat, Method } from '../report/types';
import { lastMonth } from '../lib/fiscal';
import { assembleBundle, startMonthOf, type Attachment, type Initiative, type InventoryInput, type Loan, type PackageRow, type SnapshotKind, type SnapshotRow } from '../db';

type Doc = Record<string, any>;
const store = (env: Env) => env.DOCS;
const nowIso = () => new Date().toISOString();
const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

async function read(env: Env, path: string): Promise<Doc | null> {
  const snap = await store(env).doc(path).get();
  return snap.exists ? (snap.data() as Doc) : null;
}
async function write(env: Env, path: string, data: Doc): Promise<void> {
  await store(env).doc(path).set(JSON.parse(JSON.stringify(data)));
}
async function list(env: Env, collection: string, where?: [string, string, unknown]): Promise<Doc[]> {
  let q = store(env).collection(collection);
  if (where) q = q.where(where[0], where[1], where[2]);
  const snap = await q.get();
  return snap.docs.map((d: any) => d.data() as Doc);
}

// ---------- meta / fiscal years ----------
export async function getMeta(env: Env, key: string): Promise<string | null> {
  const d = await read(env, 'meta/app');
  return (d?.[key] as string | undefined) ?? null;
}
export async function setMeta(env: Env, key: string, value: string): Promise<void> {
  const d = (await read(env, 'meta/app')) ?? {};
  if (d[key] === value) return;
  await write(env, 'meta/app', { ...d, [key]: value });
}
export async function upsertFiscalYears(env: Env, fys: FreeeFiscalYear[]): Promise<void> {
  if (!fys.length) return;
  const cur = await listFiscalYears(env);
  const map = new Map(cur.map((f) => [f.fy, f]));
  for (const f of fys) map.set(f.fy, f);
  const next = [...map.values()].sort((a, b) => a.fy - b.fy);
  if (JSON.stringify(next) === JSON.stringify(cur)) return;
  await write(env, 'meta/fiscal_years', { list: next });
}
export async function listFiscalYears(env: Env): Promise<FreeeFiscalYear[]> {
  const d = await read(env, 'meta/fiscal_years');
  return ((d?.list as FreeeFiscalYear[]) ?? []).slice().sort((a, b) => a.fy - b.fy);
}

// ---------- snapshots ----------
const snapPath = (fy: number, kind: SnapshotKind, s: number, e: number) => `snapshots/${fy}_${kind}_${s}_${e}`;
export async function saveSnapshot(env: Env, fy: number, kind: SnapshotKind, sm: number, em: number, rep: FreeeReport, fetchedAt = nowIso()): Promise<void> {
  await write(env, snapPath(fy, kind, sm, em), { fy, kind, start_month: sm, end_month: em, report: rep, up_to_date: rep.up_to_date, fetched_at: fetchedAt });
}
export async function hasSnapshot(env: Env, fy: number, kind: SnapshotKind, sm: number, em: number): Promise<boolean> {
  return (await store(env).doc(snapPath(fy, kind, sm, em)).get()).exists;
}
export async function listPeriods(env: Env): Promise<{ fy: number; month: number; fetchedAt: string; upToDate: boolean }[]> {
  const [rows, fys] = await Promise.all([list(env, 'snapshots', ['kind', '==', 'bs3']), listFiscalYears(env)]);
  const ord = (p: { fy: number; month: number }) => ((p.month - startMonthOf(fys, p.fy) + 12) % 12) + 1;
  return rows
    .map((r) => ({ fy: r.fy as number, month: r.end_month as number, fetchedAt: r.fetched_at as string, upToDate: !!r.up_to_date }))
    .sort((a, b) => b.fy - a.fy || ord(b) - ord(a));
}
export async function loadBundle(env: Env, fy: number, month: number): Promise<Bundle> {
  const [fys, rows, name] = await Promise.all([listFiscalYears(env), list(env, 'snapshots', ['fy', 'in', [fy - 3, fy - 2, fy - 1, fy]]), getMeta(env, 'company_name')]);
  return assembleBundle(fy, month, fys, name, rows as SnapshotRow[]);
}
export async function getFyPl(env: Env, fy: number): Promise<FreeeReport | undefined> {
  const fys = await listFiscalYears(env);
  const s = startMonthOf(fys, fy);
  const d = await read(env, snapPath(fy, 'pl_fy', s, lastMonth(s)));
  return (d?.report as FreeeReport | undefined) ?? undefined;
}

// ---------- adjustments ----------
const adjPath = (fy: number, month: number) => `adjustments/${fy}-${month}`;
export async function getSettings(env: Env, fy: number, month: number): Promise<Settings & { note: string | null; updatedAt: string | null; inputs: InventoryInput[] }> {
  const d = await read(env, adjPath(fy, month));
  const inputs = Object.values((d?.inputs ?? {}) as Record<string, InventoryInput>);
  const manual: Settings['manual'] = {};
  for (const i of inputs) manual[i.category] = i.amount;
  return {
    method: (d?.method as Method) ?? 'carry_forward',
    depreciationEnabled: !!d?.depreciation_enabled,
    depreciationMonthly: (d?.depreciation_monthly as number | null) ?? null,
    manual,
    note: (d?.note as string | null) ?? null,
    updatedAt: (d?.updated_at as string | null) ?? null,
    inputs,
  };
}
export async function saveSettings(env: Env, fy: number, month: number, s: { method: Method; depreciationEnabled: boolean; depreciationMonthly: number | null; note: string | null }, actor: string): Promise<void> {
  const d = (await read(env, adjPath(fy, month))) ?? {};
  await write(env, adjPath(fy, month), { ...d, method: s.method, depreciation_enabled: s.depreciationEnabled, depreciation_monthly: s.depreciationMonthly, note: s.note, updated_by: actor, updated_at: nowIso() });
}
export async function listInventoryInputs(env: Env, fy: number, month: number): Promise<InventoryInput[]> {
  return (await getSettings(env, fy, month)).inputs;
}
export async function saveInventoryInput(env: Env, fy: number, month: number, i: InventoryInput | { category: InvCat; delete: true }, actor: string): Promise<void> {
  const d = (await read(env, adjPath(fy, month))) ?? {};
  const inputs = { ...((d.inputs ?? {}) as Record<string, InventoryInput>) };
  if ('delete' in i) {
    if (!(i.category in inputs)) return;
    delete inputs[i.category];
  } else {
    inputs[i.category] = { category: i.category, qty: i.qty, unit: i.unit, unit_cost: i.unit_cost, amount: i.amount, note: i.note };
  }
  await write(env, adjPath(fy, month), { ...d, inputs, updated_by: actor, updated_at: nowIso() });
}

// ---------- initiatives / attachments ----------
export async function listInitiatives(env: Env, fy: number): Promise<Initiative[]> {
  const rows = (await list(env, 'initiatives', ['fy', '==', fy])) as Initiative[];
  return rows.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}
export async function saveInitiative(env: Env, i: Omit<Initiative, 'id'> & { id?: number }): Promise<void> {
  const id = i.id ?? newId();
  await write(env, `initiatives/${id}`, { ...i, id, updated_at: nowIso() });
}
export async function deleteInitiative(env: Env, id: number): Promise<void> {
  const atts = (await list(env, 'attachments', ['initiative_id', '==', id])) as Attachment[];
  for (const a of atts) await write(env, `attachments/${a.id}`, { ...a, initiative_id: null });
  await store(env).doc(`initiatives/${id}`).delete();
}
export async function listAttachments(env: Env, fy: number): Promise<Attachment[]> {
  const rows = (await list(env, 'attachments', ['fy', '==', fy])) as Attachment[];
  return rows.sort((a, b) => (a.initiative_id === null ? 0 : 1) - (b.initiative_id === null ? 0 : 1) || (a.initiative_id ?? 0) - (b.initiative_id ?? 0) || a.id - b.id);
}
export async function getAttachment(env: Env, id: number): Promise<Attachment | null> {
  return (await read(env, `attachments/${id}`)) as Attachment | null;
}
export async function insertAttachment(env: Env, a: Omit<Attachment, 'id'>): Promise<void> {
  const id = newId();
  // 直前にアップロードした資産の id と URL を引き継ぐ（src/client の添付アダプタが保持）
  const up = env.FILES && (env.FILES as any).uploaded?.get?.(a.r2_key);
  await write(env, `attachments/${id}`, { ...a, id, asset_id: up?.id ?? a.asset_id ?? null, url: up?.url ?? a.url ?? null });
}
export async function deleteAttachment(env: Env, id: number): Promise<void> {
  const a = await getAttachment(env, id);
  if (a?.asset_id && env.ASSETS_STORE) {
    try {
      await env.ASSETS_STORE.delete(a.asset_id);
    } catch {
      // 資産がすでにない場合もあるので、記録の削除は続ける
    }
  }
  await store(env).doc(`attachments/${id}`).delete();
}

// ---------- loans ----------
export async function listLoans(env: Env): Promise<Loan[]> {
  const rows = (await list(env, 'loans')) as Loan[];
  return rows.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}
export async function saveLoan(env: Env, l: Omit<Loan, 'id'> & { id?: number }): Promise<void> {
  const id = l.id ?? newId();
  await write(env, `loans/${id}`, { ...l, id });
}
export async function deleteLoan(env: Env, id: number): Promise<void> {
  await store(env).doc(`loans/${id}`).delete();
}

// ---------- packages ----------
export async function listPackages(env: Env): Promise<Omit<PackageRow, 'report_json'>[]> {
  const rows = (await list(env, 'packages')) as PackageRow[];
  return rows.map(({ report_json: _r, ...rest }) => rest).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
export async function getPackage(env: Env, id: number): Promise<PackageRow | null> {
  return (await read(env, `packages/${id}`)) as PackageRow | null;
}
export async function insertPackage(env: Env, fy: number, month: number, json: string, actor: string): Promise<{ id: number; version: number }> {
  if (json.length > 240 * 1024) throw new Error('確定版のデータが大きすぎて保存できません（240KB まで）。添付や施策の文章を短くしてお試しください');
  const same = (await list(env, 'packages', ['fy', '==', fy])).filter((p) => p.month === month);
  const version = same.reduce((m, p) => Math.max(m, p.version as number), 0) + 1;
  const id = newId();
  await write(env, `packages/${id}`, { id, fy, month, version, report_json: json, submitted_to: null, submitted_on: null, memo: null, created_by: actor, created_at: nowIso() });
  return { id, version };
}
export async function updatePackageSubmission(env: Env, id: number, to: string | null, on: string | null, memo: string | null): Promise<void> {
  const p = await getPackage(env, id);
  if (!p) return;
  await write(env, `packages/${id}`, { ...p, submitted_to: to, submitted_on: on, memo });
}

// ---------- audit ----------
let auditChain: Promise<void> = Promise.resolve();
export async function audit(env: Env, actor: string | null, action: string, detail: unknown): Promise<void> {
  // 同じ文書への書き込みは1つずつ
  auditChain = auditChain.then(async () => {
    const d = (await read(env, 'meta/audit')) ?? { entries: [] };
    const entries = [{ at: nowIso(), actor, action, detail_json: JSON.stringify(detail ?? null) }, ...((d.entries as unknown[]) ?? [])].slice(0, 200);
    await write(env, 'meta/audit', { entries });
  });
  return auditChain.catch(() => undefined);
}
export async function recentAudit(env: Env, limit = 20): Promise<{ at: string; actor: string | null; action: string; detail_json: string | null }[]> {
  const d = await read(env, 'meta/audit');
  return ((d?.entries as any[]) ?? []).slice(0, limit);
}

// ---------- targets ----------
export async function getTargets(env: Env, fy: number): Promise<{ values: Record<string, number>; note: string | null; updatedAt: string | null; updatedBy: string | null }> {
  const d = await read(env, `targets/${fy}`);
  return { values: (d?.values as Record<string, number>) ?? {}, note: (d?.note as string | null) ?? null, updatedAt: (d?.updated_at as string | null) ?? null, updatedBy: (d?.updated_by as string | null) ?? null };
}
export async function saveTargets(env: Env, fy: number, values: Record<string, number | null>, note: string | null, actor: string): Promise<void> {
  const cur = await getTargets(env, fy);
  const next = { ...cur.values };
  for (const [k, v] of Object.entries(values)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  await write(env, `targets/${fy}`, { fy, values: next, note, updated_by: actor, updated_at: nowIso() });
}
