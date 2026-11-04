/**
 * claude.ai 版の起動コード。
 * Workers 版と同じ Hono アプリ（src/index.tsx）をブラウザの中で動かし、
 * リンクとフォームの送信を横取りして画面を差し替える。
 *   保存先   → アーティファクトの db（src/store/docs.ts）
 *   freee    → claude.ai の freee コネクタ（mcp）
 *   添付     → アーティファクトの assets
 *   提出用   → downloads で HTML ファイルとして保存（ブラウザで開いて PDF に印刷）
 */
import { app } from '../index';
import PRINT_CSS from '../../public/print.css';

declare global {
  interface Window {
    claude?: { use(name: string): Promise<any> };
    FinanceUI?: { initGlobal(): void; initPage(root?: ParentNode): void };
    __FINANCE_CLIENT__?: boolean;
  }
}

const BASE = 'https://finance.app';
const root = document.getElementById('root') as HTMLElement;
const ALLOWED_UPLOADS = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/csv', 'text/plain']);

let env: Record<string, unknown> = {};
let dbRef: any = null;

// ---- 保存前の入力（下書き）を、描き直しや読み込み直しの後に戻す ----
// フォームごとに「最初に表示した値」と違う欄だけを sessionStorage に保管する。
type Drafts = Record<string, Record<string, string | string[]>>;
const DRAFT_KEY = 'finance-drafts';
const readDrafts = (): Drafts => {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}') as Drafts;
  } catch {
    return {};
  }
};
const writeDrafts = (d: Drafts) => {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* 保管できない環境では、描き直しの間だけメモリで持つ */
  }
  memDrafts = d;
};
let memDrafts: Drafts = {};
let restoring = false;

function formKey(form: HTMLFormElement): string | null {
  if ((form.getAttribute('method') || 'get').toLowerCase() !== 'post') return null;
  const ids = ['fy', 'month', 'id', 'initiative_id', 'return']
    .map((n) => (form.querySelector(`input[type=hidden][name="${n}"]`) as HTMLInputElement | null)?.value ?? '')
    .join(',');
  return `${form.getAttribute('action') ?? ''}|${ids}`;
}

function fieldsOf(form: HTMLFormElement): (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[] {
  return [...form.elements].filter((el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false;
    if (!el.name) return false;
    if (el instanceof HTMLInputElement && ['hidden', 'file', 'submit', 'button', 'password'].includes(el.type)) return false;
    return true;
  });
}

/** フォームの、最初の表示から変わった欄だけを取り出す */
function changedValues(form: HTMLFormElement): Record<string, string | string[]> | null {
  const out: Record<string, string | string[]> = {};
  for (const el of fieldsOf(form)) {
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      if (el.checked !== el.defaultChecked) {
        if (el.type === 'radio') out[el.name] = el.checked ? el.value : (out[el.name] as string) ?? '';
        else out[`${el.name}::${el.value}`] = el.checked ? '1' : '0';
      }
      continue;
    }
    if (el instanceof HTMLSelectElement) {
      // 既定は selected 属性の付いた選択肢、なければ先頭（ブラウザが自動で選ぶもの）
      const def = [...el.options].find((o) => o.defaultSelected) ?? el.options[0];
      if (def && el.value !== def.value) out[el.name] = el.value;
      continue;
    }
    if (el.value !== el.defaultValue) out[el.name] = el.value;
  }
  for (const k of Object.keys(out)) if (out[k] === '' && !k.includes('::')) {
    // ラジオで「外れた側」だけが記録された場合は捨てる
    const r = form.querySelector(`input[type=radio][name="${k}"]`);
    if (r) delete out[k];
  }
  return Object.keys(out).length ? out : null;
}

/** いまの画面の下書きを保管する。except のフォームは対象外 */
function captureDrafts(except?: HTMLFormElement | null) {
  const page = currentPage();
  const all = readDrafts();
  for (const form of root.querySelectorAll('form')) {
    const key = formKey(form);
    if (!key || form === except) continue;
    const vals = changedValues(form);
    const k = `${page}#${key}`;
    if (vals) all[k] = vals;
    else delete all[k];
  }
  writeDrafts(all);
}

function restoreDrafts(): number {
  const page = currentPage();
  const all = readDrafts();
  let restored = 0;
  for (const form of root.querySelectorAll('form')) {
    const key = formKey(form);
    if (!key) continue;
    const vals = all[`${page}#${key}`];
    if (!vals) continue;
    for (const [name, v] of Object.entries(vals)) {
      if (name.includes('::')) {
        const [n, val] = name.split('::');
        const el = form.querySelector(`input[type=checkbox][name="${CSS.escape(n)}"][value="${CSS.escape(val)}"]`) as HTMLInputElement | null;
        if (el) el.checked = v === '1';
        continue;
      }
      const els = form.querySelectorAll(`[name="${CSS.escape(name)}"]`);
      els.forEach((el) => {
        if (el instanceof HTMLInputElement && el.type === 'radio') el.checked = el.value === v;
        else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.value = String(v);
      });
      restored++;
    }
    restoring = true;
    form.dispatchEvent(new Event('input', { bubbles: true }));
    restoring = false;
  }
  return restored;
}

/** 保存していない変更があるフォームに「未保存」を表示する */
function markDirty(form: HTMLFormElement) {
  if (!formKey(form)) return;
  const dirty = !!changedValues(form);
  form.classList.toggle('is-dirty', dirty);
  const btn = form.querySelector('button.btn.primary, button:not([type=button])') as HTMLButtonElement | null;
  if (!btn) return;
  let note = form.querySelector('.unsaved-note') as HTMLElement | null;
  if (dirty && !note) {
    note = document.createElement('span');
    note.className = 'unsaved-note';
    note.textContent = '未保存の変更があります';
    btn.insertAdjacentElement('afterend', note);
  }
  if (note) note.hidden = !dirty;
}

function forgetDraft(form: HTMLFormElement) {
  const key = formKey(form);
  if (!key) return;
  const all = readDrafts();
  delete all[`${currentPage()}#${key}`];
  writeDrafts(all);
}

let pagePath = '/report';
/** 入力中の下書き保管の待ち時間。画面を描き直すときは取り消す */
let editTimer: ReturnType<typeof setTimeout> | null = null;
/** 下書きの持ち主になる画面（パスだけ。年度・月はフォーム内の hidden 項目で区別する） */
const currentPage = () => pagePath.replace(/[?#].*$/, '');

// ---- エラーの記録（あとで原因を調べるため。直近 50 件） ----
async function logError(where: string, e: unknown) {
  try {
    if (!dbRef) return;
    const ref = dbRef.doc('meta/errors');
    const snap = await ref.get();
    const entries = ((snap.exists ? snap.data()?.entries : []) as unknown[]) ?? [];
    const err = e as { code?: string; message?: string; stack?: string };
    entries.unshift({ at: new Date().toISOString(), where, page: pagePath, code: err?.code ?? null, message: String(err?.message ?? e).slice(0, 500), stack: String(err?.stack ?? '').slice(0, 800) });
    await ref.set({ entries: entries.slice(0, 50) });
  } catch {
    /* 記録できなくても画面は続ける */
  }
}
let downloads: any = null;
let busy = false;

function toast(text: string, kind: 'info' | 'error' = 'info', ms = 0) {
  let el = document.getElementById('client-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'client-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.dataset.kind = kind;
  el.hidden = !text;
  if (ms) setTimeout(() => el && el.textContent === text && (el.hidden = true), ms);
}

function showFatal(title: string, body: string) {
  root.innerHTML = '';
  const box = document.createElement('section');
  box.className = 'client-fatal';
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;
  box.append(h, p);
  root.appendChild(box);
}

/** アプリにリクエストを送り、リダイレクトをたどって最終的な応答を返す */
async function request(url: string, init: RequestInit = {}): Promise<{ res: Response; url: string }> {
  let target = new URL(url, BASE).toString();
  let opts: RequestInit = init;
  for (let i = 0; i < 6; i++) {
    const res = await app.fetch(new Request(target, opts), env as never);
    const loc = res.headers.get('Location');
    if (res.status >= 300 && res.status < 400 && loc) {
      target = new URL(loc, target).toString();
      opts = {};
      continue;
    }
    return { res, url: target };
  }
  throw new Error('画面の移動が多すぎます');
}

function pathOf(full: string): string {
  const u = new URL(full);
  return u.pathname + u.search + u.hash;
}

async function render(url: string, init?: RequestInit, submitted?: HTMLFormElement | null) {
  // 描き直す前に、送信したフォーム以外の入力を保管しておく（入力中の保管待ちは取り消す）
  if (editTimer) clearTimeout(editTimer);
  editTimer = null;
  captureDrafts(submitted);
  const submittedKey = submitted ? formKey(submitted) : null;
  const submittedVals = submitted ? changedValues(submitted) : null;
  const fromPage = currentPage();
  const { res, url: finalUrl } = await request(url, init);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  root.innerHTML = doc.body.innerHTML;
  if (doc.title) document.title = doc.title;
  const path = pathOf(finalUrl);
  try {
    sessionStorage.setItem('finance-path', path.replace(/#.*$/, ''));
  } catch {
    /* 保存できなくても動く */
  }
  pagePath = path;
  decorate();
  window.FinanceUI?.initPage(root);
  if (res.status >= 500) void logError(`render ${pathOf(finalUrl)}`, new Error(doc.querySelector('main p')?.textContent ?? `HTTP ${res.status}`));
  // 保存に失敗して同じ画面に戻ったときは、送信した入力も戻す
  if (submittedKey && submittedVals) {
    const failed = !!root.querySelector('[data-flash="error"]') || res.status >= 400;
    const all = readDrafts();
    if (failed) all[`${fromPage}#${submittedKey}`] = submittedVals;
    else delete all[`${fromPage}#${submittedKey}`];
    writeDrafts(all);
  }
  const restored = restoreDrafts();
  root.querySelectorAll('form').forEach((f) => markDirty(f));
  if (restored) toast('保存していない入力を戻しました。保存ボタンを押すまでは保存されません', 'info', 7000);
  const hash = new URL(finalUrl).hash.slice(1);
  const target = hash ? document.getElementById(decodeURIComponent(hash)) : null;
  if (target) target.scrollIntoView({ block: 'start' });
  else if (init?.method !== 'POST' || !hash) window.scrollTo(0, 0);
}

/** claude.ai 版に合わせて表示を少し変える */
function decorate() {
  root.querySelectorAll<HTMLAnchorElement>('a[href^="/print"]').forEach((a) => {
    a.removeAttribute('target');
    a.textContent = a.closest('.history, section.card')?.querySelector('h2') ? '提出用ファイルを保存' : '提出用ファイルを保存（HTML）';
  });
  root.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((i) => (i.accept = '.pdf,.png,.jpg,.jpeg,.webp,.csv'));
  if (!downloads) root.querySelectorAll<HTMLAnchorElement>('a[href^="/print"]').forEach((a) => (a.hidden = true));
}

let busySince = 0;
async function go(url: string, init?: RequestInit, label?: string, submitted?: HTMLFormElement | null) {
  // 前の処理が終わらないまま止まっていても、1分たてば次の操作を受け付ける
  if (busy && Date.now() - busySince < 60000) {
    toast('処理中です。終わるまでお待ちください', 'info', 3000);
    return;
  }
  busy = true;
  busySince = Date.now();
  document.body.classList.add('client-busy');
  if (label) toast(label);
  try {
    await render(url, init, submitted);
    if (label) toast('');
  } catch (e) {
    void logError(`go ${init?.method ?? 'GET'} ${url}`, e);
    toast((e as Error).message || 'うまく表示できませんでした', 'error', 8000);
  } finally {
    busy = false;
    document.body.classList.remove('client-busy');
  }
}

/** 提出用ページを、ブラウザで開いて PDF に印刷できる HTML ファイルとして保存する */
async function savePrint(href: string) {
  if (!downloads) return toast('この表示ではファイルを保存できません', 'error', 6000);
  try {
    toast('提出用ファイルを作っています…');
    const { res } = await request(href);
    let html = await res.text();
    html = html.replace('<link rel="stylesheet" href="/print.css"/>', `<style>${PRINT_CSS}</style>`).replace('<link rel="stylesheet" href="/print.css">', `<style>${PRINT_CSS}</style>`);
    const title = (html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '月次試算表').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
    toast('');
    await downloads.save({ filename: `${title}.html`, data: html });
    toast('保存しました。ブラウザで開き、印刷から「PDF に保存」を選んでください', 'info', 9000);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'declined') return toast('');
    toast(code === 'rate_limited' ? '少し待ってからもう一度お試しください' : (e as Error).message || '保存できませんでした', 'error', 8000);
  }
}

/** 削除などの確認（claude.ai ではブラウザの confirm が使えないため） */
function confirmBox(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'client-confirm';
    wrap.innerHTML = '<div class="client-confirm-box" role="dialog" aria-modal="true"><p></p><div class="client-confirm-actions"><button type="button" class="btn" data-a="no">やめる</button><button type="button" class="btn danger" data-a="yes">削除する</button></div></div>';
    (wrap.querySelector('p') as HTMLElement).textContent = text;
    const done = (v: boolean) => {
      wrap.remove();
      resolve(v);
    };
    wrap.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a) done(a === 'yes');
      else if (e.target === wrap) done(false);
    });
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') {
        document.removeEventListener('keydown', esc);
        done(false);
      }
    });
    document.body.appendChild(wrap);
    (wrap.querySelector('[data-a="no"]') as HTMLButtonElement).focus();
  });
}

function wireEvents() {
  const onEdit = (e: Event) => {
    const f = (e.target as HTMLElement)?.closest?.('form') as HTMLFormElement | null;
    if (f && root.contains(f)) markDirty(f);
    if (busy || restoring || !root.contains(e.target as Node)) return;
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      editTimer = null;
      if (!busy) captureDrafts();
    }, 400);
  };
  document.addEventListener('input', onEdit);
  document.addEventListener('change', onEdit);
  window.addEventListener('error', (e) => void logError('window.error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => void logError('unhandledrejection', e.reason));
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest?.('a') as HTMLAnchorElement | null;
    if (!a || !root.contains(a)) return;
    const href = a.getAttribute('href') ?? '';
    if (a.getAttribute('aria-disabled') === 'true') return e.preventDefault();
    if (href.startsWith('#')) return; // ページ内リンク
    if (!href.startsWith('/') || href.startsWith('/_blob/')) return; // 添付ファイルや外部リンクはそのまま
    e.preventDefault();
    if (href.startsWith('/print')) return void savePrint(href);
    void go(href);
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target as HTMLFormElement;
    if (!root.contains(form) || form.dataset.previewForm !== undefined) return;
    e.preventDefault();
    if (form.dataset.confirm && !(await confirmBox(form.dataset.confirm))) return;
    const action = form.getAttribute('action') || '/report';
    const method = (form.getAttribute('method') || 'get').toUpperCase();
    const data = new FormData(form, (e as SubmitEvent).submitter ?? undefined);
    if (method === 'GET') {
      const q = new URLSearchParams();
      for (const [k, v] of data) if (typeof v === 'string') q.append(k, v);
      return void go(`${action}?${q}`);
    }
    const label =
      action === '/sync' ? 'freee から取り込んでいます。数十秒かかることがあります…' : action === '/closings/sync' ? 'freee から過去の決算を取り込んでいます。1〜2分かかることがあります…' : action === '/attachments' ? 'アップロードしています…' : undefined;
    // 送信内容は空にしない（claude.ai の画面では、空のフォームを読み戻すと失敗することがある）
    data.append('_sent', '1');
    const hasFile = [...data.values()].some((v) => typeof v !== 'string');
    // ファイルを含まないフォームは、読み戻しが確実な URL エンコード形式で送る
    const body = hasFile ? data : new URLSearchParams([...data].map(([k, v]) => [k, String(v)]));
    const headers = hasFile ? undefined : { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
    void go(action, { method: 'POST', body, headers }, label, form);
  });
}

async function start() {
  if (!window.claude || typeof window.claude.use !== 'function') {
    showFatal('claude.ai で開いてください', 'この試算表アプリは claude.ai のアーティファクトとして動きます。保存先と freee への接続は claude.ai が用意します。');
    return;
  }
  const [db, mcp, assets, dl] = await Promise.all(['db', 'mcp', 'assets', 'downloads'].map((n) => window.claude!.use(n).catch(() => null)));
  if (!db) {
    showFatal('この表示ではデータを読み込めません', 'claude.ai にログインした状態で、このアーティファクトを開いてください。共有されたリンクから開いている場合は、持ち主に編集の権限をもらってください。');
    return;
  }
  downloads = dl;
  dbRef = db;
  const uploaded = new Map<string, { id: string; url: string }>();
  const files = {
    uploaded,
    async put(key: string, data: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      if (!assets) throw new Error('この表示では添付できません（編集の権限が必要です）');
      const type = opts?.httpMetadata?.contentType || 'application/octet-stream';
      if (!ALLOWED_UPLOADS.has(type)) throw new Error('添付できるのは PDF・画像（PNG / JPEG / WebP）・CSV です。Excel や Word は PDF にしてから添付してください');
      const r = await assets.upload(new Blob([data], { type }));
      uploaded.set(key, { id: r.id, url: r.url });
    },
    async get() {
      return null;
    },
    async delete() {
      /* 資産の削除は deleteAttachment で行う */
    },
  };
  env = {
    DOCS: db,
    FREEE_MCP: mcp ?? undefined,
    SHOPIFY_MCP: mcp ?? undefined,
    ASSETS_STORE: assets ?? undefined,
    FILES: files,
    FLASH: { ok: null, error: null },
    CLIENT_MODE: '1',
    FREEE_COMPANY_ID: '796362',
    APP_ORIGIN: '',
    ACCESS_TEAM_DOMAIN: '',
    ACCESS_AUD: '',
  };
  wireEvents();
  window.FinanceUI?.initGlobal();
  let first = '/report';
  try {
    first = sessionStorage.getItem('finance-path') || '/report';
    pagePath = first;
  } catch {
    /* 既定の画面から始める */
  }
  await go(first);
  if (!mcp) toast('この表示では freee から取り込めません。取り込み済みのデータは見られます', 'info', 8000);
}

void start();
