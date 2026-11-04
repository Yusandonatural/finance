// claude.ai 版（アーティファクト）の1ファイルを作る: dist/finance-artifact.html
// 使い方: npm run build:artifact
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  jsx: 'automatic',
  jsxImportSource: 'hono/jsx',
  loader: { '.css': 'text' },
  legalComments: 'none',
});
const bundle = result.outputFiles[0].text;
const appCss = readFileSync('public/app.css', 'utf8');
const appJs = readFileSync('public/app.js', 'utf8');

const clientCss = `
/* ---- claude.ai 版だけの部品 ---- */
#client-toast { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 60; max-width: min(92vw, 560px); padding: 10px 16px; border-radius: 12px; background: var(--ink); color: var(--surface); font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.2); }
#client-toast[data-kind="error"] { background: var(--bad); color: #fff; }
body.client-busy main { opacity: .55; pointer-events: none; transition: opacity .2s; }
.client-confirm { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; background: rgba(0,0,0,.35); padding-inline: 16px; }
.client-confirm-box { background: var(--surface); color: var(--ink); border-radius: 14px; padding: 20px 22px; max-width: 380px; width: 100%; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
.client-confirm-box p { margin: 0 0 16px; }
.client-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
.client-fatal, .client-loading { max-width: 560px; margin: 12vh auto 0; padding-inline: 16px; text-align: center; color: var(--ink-2); }
.client-fatal h1 { font-size: 20px; color: var(--ink); }
.client-loading .mark { margin: 0 auto 14px; }
`;

const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Shippori+Mincho:wght@600&display=swap">';
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const page = `<title>悠三堂 試算表</title>
${fonts}
<style>
${appCss}
${clientCss}
</style>
<div id="root"><div class="client-loading"><span class="mark">悠</span><p>試算表を読み込んでいます…</p></div></div>
<script>window.__FINANCE_CLIENT__ = true;</script>
<script>
${safe(appJs)}
</script>
<script>
${safe(bundle)}
</script>
`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/finance-artifact.html', page);
console.log(`dist/finance-artifact.html ${(page.length / 1024).toFixed(0)} KB`);
