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

async function render(url: string, init?: RequestInit) {
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
  decorate();
  window.FinanceUI?.initPage(root);
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

async function go(url: string, init?: RequestInit, label?: string) {
  if (busy) return;
  busy = true;
  document.body.classList.add('client-busy');
  if (label) toast(label);
  try {
    await render(url, init);
    if (label) toast('');
  } catch (e) {
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
    const label = action === '/sync' ? 'freee から取り込んでいます。数十秒かかることがあります…' : action === '/attachments' ? 'アップロードしています…' : undefined;
    void go(action, { method: 'POST', body: data }, label);
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
  } catch {
    /* 既定の画面から始める */
  }
  await go(first);
  if (!mcp) toast('この表示では freee から取り込めません。取り込み済みのデータは見られます', 'info', 8000);
}

void start();
