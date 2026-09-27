import type { Child, FC } from 'hono/jsx';

const NAV = [
  ['/report', '試算表'],
  ['/sync', '取込'],
  ['/adjust', '棚卸補正'],
  ['/initiatives', '施策・添付'],
  ['/loans', '借入金'],
  ['/history', '提出履歴'],
] as const;

export const Layout: FC<{ title: string; active?: string; actor?: string; flash?: string | null; error?: string | null; children?: Child }> = ({ title, active, actor, flash, error, children }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex,nofollow" />
      <title>{`${title} ｜ 悠三堂 試算表`}</title>
      <link rel="stylesheet" href="/app.css" />
    </head>
    <body>
      <header class="top">
        <a class="brand" href="/report">
          悠三堂 試算表
        </a>
        <nav>
          {NAV.map(([href, label]) => (
            <a href={href} class={active === href ? 'on' : ''}>
              {label}
            </a>
          ))}
        </nav>
        {actor && <span class="actor">{actor}</span>}
      </header>
      <main>
        {flash && <p class="flash">{flash}</p>}
        {error && <p class="flash error">{error}</p>}
        {children}
      </main>
    </body>
  </html>
);
