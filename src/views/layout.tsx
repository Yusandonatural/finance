import type { Child, FC } from 'hono/jsx';
import { raw } from 'hono/html';

/** 線画アイコン（24px グリッド、stroke は currentColor） */
const ICONS: Record<string, string> = {
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1"/><path d="M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2"/>',
  adjust: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/>',
  initiatives: '<path d="M12 3c-4 4-6 8-6 11a6 6 0 0 0 12 0c0-3-2-7-6-11z"/><path d="M12 21v-8"/>',
  loans: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  history: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 12h8M8 16h5"/>',
};
export const Icon: FC<{ name: string }> = ({ name }) => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    {raw(ICONS[name] ?? '')}
  </svg>
);

const NAV = [
  ['/report', '試算表', 'report'],
  ['/adjust', '棚卸補正', 'adjust'],
  ['/initiatives', '施策・添付', 'initiatives'],
  ['/loans', '借入金', 'loans'],
  ['/history', '提出履歴', 'history'],
  ['/sync', 'freee 取込', 'sync'],
] as const;

export const Layout: FC<{ title: string; active?: string; actor?: string; flash?: string | null; error?: string | null; children?: Child }> = ({ title, active, actor, flash, error, children }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex,nofollow" />
      <meta name="theme-color" content="#f6f5f0" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#151715" media="(prefers-color-scheme: dark)" />
      <title>{`${title} ｜ 悠三堂 試算表`}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Shippori+Mincho:wght@600&display=swap" rel="stylesheet" />
      <link rel="stylesheet" href="/app.css" />
      <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23237a4f'/%3E%3Ctext x='16' y='22' font-size='16' text-anchor='middle' fill='white' font-family='serif'%3E%E6%82%A0%3C/text%3E%3C/svg%3E" />
      <script src="/app.js" defer></script>
    </head>
    <body>
      <div class="shell">
        <aside class="side">
          <a class="brand" href="/report">
            <span class="mark">悠</span>
            <span class="brand-text">
              <span class="brand-name">悠三堂</span>
              <span class="brand-sub">月次試算表</span>
            </span>
          </a>
          <nav>
            {NAV.map(([href, label, icon]) => (
              <a href={href} class={active === href ? 'on' : ''} aria-current={active === href ? 'page' : undefined}>
                <Icon name={icon} />
                <span>{label}</span>
              </a>
            ))}
          </nav>
          {actor && (
            <div class="actor" title={actor}>
              <span class="avatar">{actor.slice(0, 1).toUpperCase()}</span>
              <span class="actor-mail">{actor}</span>
            </div>
          )}
        </aside>
        <main>
          {flash && (
            <p class="flash" role="status">
              <span class="flash-mark">✓</span>
              {flash}
            </p>
          )}
          {error && (
            <p class="flash error" role="alert">
              <span class="flash-mark">!</span>
              {error}
            </p>
          )}
          {children}
        </main>
      </div>
    </body>
  </html>
);
