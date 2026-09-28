import type { FC } from 'hono/jsx';
import type { Attachment, Initiative, InventoryInput, Loan } from '../db';
import type { FreeeFiscalYear } from '../freee/types';
import { fyLabel, lastMonth, monthLabel, monthsUpTo } from '../lib/fiscal';
import { pct, signedYen, yen } from '../lib/format';
import { raw } from 'hono/html';
import { groupedBars, sparkline, waterfall, type WaterfallStep } from './charts';
import { findTotal, adjusted } from '../report/lines';
import type { Report } from '../report/types';
import { BridgeTable, BsTable, Checks, FlowTable, InventoryTable, MonthlyTable, PastFyTable, SensitivityTable, Yen } from './components';

type Period = { fy: number; month: number; fetchedAt: string; upToDate: boolean };

export const PeriodSelect: FC<{ periods: Period[]; fy: number; month: number; action: string; fys: FreeeFiscalYear[] }> = ({ periods, fy, month, action, fys }) => {
  const sm = (y: number) => Number(fys.find((f) => f.fy === y)?.start_date.slice(5, 7) ?? 3);
  return (
    <form method="get" action={action} class="period">
      <label class="select">
        <span class="select-label">対象月</span>
        <select name="p" data-autosubmit="">
          {periods.map((p) => (
            <option value={`${p.fy}-${p.month}`} selected={p.fy === fy && p.month === month}>
              {monthLabel(p.fy, sm(p.fy), p.month)}末
            </option>
          ))}
        </select>
      </label>
      <noscript>
        <button class="btn small">表示</button>
      </noscript>
    </form>
  );
};

/** 前期同期との比較チップ。率が出せないとき（符号が変わる等）は差額を出す */
const Delta: FC<{ cur: number; base: number }> = ({ cur, base }) => {
  const p = pct(cur, base);
  const diff = cur - base;
  const text = p === '—' ? `${diff >= 0 ? '+' : ''}${yen(diff)}` : p;
  const good = diff >= 0;
  return (
    <span class={`delta ${diff === 0 ? 'flat' : good ? 'good' : 'bad'}`}>
      <span class="delta-arrow" aria-hidden="true">
        {diff === 0 ? '→' : good ? '↑' : '↓'}
      </span>
      {text}
    </span>
  );
};

const Kpi: FC<{ label: string; cur: number; ly: number; spark: (number | null)[] }> = ({ label, cur, ly, spark }) => (
  <div class="kpi">
    <div class="kpi-head">
      <span class="kpi-label">{label}</span>
      <Delta cur={cur} base={ly} />
    </div>
    <div class={`kpi-val${cur < 0 ? ' neg' : ''}`}>
      {yen(cur)}
      <span class="unit">円</span>
    </div>
    <div class="kpi-foot">
      <span class="kpi-sub">前期同期 {yen(ly)}</span>
      {raw(sparkline(spark, `${label}の月次推移`))}
    </div>
  </div>
);

const Legend: FC<{ items: [string, string][] }> = ({ items }) => (
  <div class="legend">
    {items.map(([cls, label]) => (
      <span class="legend-item">
        <span class={`sw ${cls}`}></span>
        {label}
      </span>
    ))}
  </div>
);

export const ReportPage: FC<{ r: Report; periods: Period[]; fys: FreeeFiscalYear[] }> = ({ r, periods, fys }) => {
  const t = (cat: string) => {
    const l = findTotal(r.pl, cat);
    return l ? adjusted(l) : [0, 0, 0];
  };
  const errors = r.checks.filter((c) => !c.ok && c.severity === 'error');
  const warns = r.checks.filter((c) => !c.ok && c.severity === 'warn');
  const q = `fy=${r.meta.fy}&month=${r.meta.month}`;
  const ser = (key: string) => r.monthly.series.find((s) => s.key === key);
  const col = (key: string, c: number) => (ser(key)?.values ?? []).map((v) => (v ? v[c] : null));
  const cats = r.monthly.months.map((m) => m.label);
  const steps: WaterfallStep[] = [
    { label: 'freee 上の\n純損益', value: r.bridge.rawNetIncome, kind: 'total' },
    ...r.bridge.items.map((i) => ({ label: i.label.replace(/^月末/, '').replace(/棚卸 見積$/, '').replace('（荒茶など）', '').replace(/^減価償却費 月割.*/, '減価償却\n月割') + (i.label.startsWith('月末') ? '\n棚卸' : ''), value: i.amount, kind: 'delta' as const })),
    { label: '補正後の\n純損益', value: r.bridge.adjustedNetIncome, kind: 'total' },
  ];
  const fetched = r.meta.fetchedAt ? new Date(r.meta.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  return (
    <>
      <header class="pagehead">
        <div>
          <p class="eyebrow">{fyLabel(r.meta.fy, r.meta.fyStartMonth)}</p>
          <h1>{monthLabel(r.meta.fy, r.meta.fyStartMonth, r.meta.month)}末 試算表</h1>
          <div class="chips">
            <span class="chip">
              {monthLabel(r.meta.fy, r.meta.fyStartMonth, r.meta.fyStartMonth)}〜{r.meta.month}月 累計（{r.meta.monthsElapsed}ヶ月）
            </span>
            <span class="chip accent">棚卸：{r.meta.method === 'manual' ? '実地簡易棚卸' : '据置法'}</span>
            <span class="chip">減価償却月割：{r.meta.depreciationEnabled ? 'あり' : 'なし'}</span>
            <span class={`chip ${r.meta.upToDate ? '' : 'warn'}`}>freee 取込 {fetched}{r.meta.upToDate ? '' : '（集計中）'}</span>
          </div>
        </div>
        <div class="head-actions">
          <PeriodSelect periods={periods} fy={r.meta.fy} month={r.meta.month} action="/report" fys={fys} />
          <a class="btn primary" href={`/print?${q}`} target="_blank">
            提出用ページを開く
          </a>
        </div>
      </header>

      <section class="kpis" aria-label="主要指標（棚卸補正後）">
        <Kpi label="売上高" cur={t('売上高')[0]} ly={t('売上高')[1]} spark={col('sales', 0)} />
        <Kpi label="売上総利益" cur={t('売上総損益金額')[0]} ly={t('売上総損益金額')[1]} spark={col('gross', 0)} />
        <Kpi label="営業利益" cur={t('営業損益金額')[0]} ly={t('営業損益金額')[1]} spark={col('op', 0)} />
        <Kpi label="経常利益" cur={t('経常損益金額')[0]} ly={t('経常損益金額')[1]} spark={col('ord', 0)} />
      </section>

      <div class="grid-main">
        <section class="card">
          <div class="card-head">
            <div>
              <h2>月次売上高</h2>
              <p class="card-sub">当期と前期同月の比較</p>
            </div>
            <Legend items={[['cur', '当期'], ['prev', '前期']]} />
          </div>
          {raw(groupedBars({ categories: cats, series: [{ name: '当期', cls: 'cur', values: col('sales', 0) }, { name: '前期', cls: 'prev', values: col('sales', 1) }], label: [0, cats.length - 1], ariaLabel: '月次売上高 当期と前期' }))}
        </section>
        <section class="card">
          <div class="card-head">
            <div>
              <h2>棚卸補正のブリッジ</h2>
              <p class="card-sub">freee 上の純損益から補正後まで</p>
            </div>
          </div>
          {raw(waterfall(steps, '当期純損益の補正内訳'))}
          <div class="bridge-foot">
            <span>補正額合計</span>
            <b class="num">{signedYen(r.bridge.adjustedNetIncome - r.bridge.rawNetIncome)} 円</b>
          </div>
        </section>
        <section class="card">
          <div class="card-head">
            <div>
              <h2>月次経常利益</h2>
              <p class="card-sub">棚卸補正後。補正は期首月に反映</p>
            </div>
            <Legend items={[['cur', '当期'], ['prev', '前期']]} />
          </div>
          {raw(groupedBars({ categories: cats, series: [{ name: '当期', cls: 'cur', values: col('ord', 0) }, { name: '前期', cls: 'prev', values: col('ord', 1) }], ariaLabel: '月次経常利益 当期と前期' }))}
        </section>
        <section class="card">
          <div class="card-head">
            <div>
              <h2>検算</h2>
              <p class="card-sub">{errors.length ? `${errors.length} 件のエラー` : warns.length ? `エラーなし・注意 ${warns.length} 件` : 'すべて問題ありません'}</p>
            </div>
            <span class={`status ${errors.length ? 'error' : warns.length ? 'warn' : 'ok'}`}>{errors.length ? '要確認' : '確定できます'}</span>
          </div>
          <Checks r={r} />
          <form method="post" action="/packages" class="finalize">
            <input type="hidden" name="fy" value={String(r.meta.fy)} />
            <input type="hidden" name="month" value={String(r.meta.month)} />
            <button class="btn block" disabled={errors.length > 0}>
              この内容で確定して提出履歴に保存
            </button>
            <a class="link" href={`/adjust?${q}`}>
              棚卸補正を変更する →
            </a>
          </form>
        </section>
      </div>

      <section class="card flush">
        <div class="card-head pad">
          <div>
            <h2>月末棚卸</h2>
            <p class="card-sub">期首棚卸高と、この試算表で使った月末の金額</p>
          </div>
        </div>
        <div class="scroll">
          <InventoryTable r={r} />
        </div>
      </section>

      <section class="card flush statements">
        <div class="tabs" role="tablist">
          {TABS.map(([id, label], i) => (
            <>
              <input type="radio" name="tab" id={`tab-${id}`} class="tab-input" checked={i === 0} />
              <label for={`tab-${id}`} class="tab" role="tab">
                {label}
              </label>
            </>
          ))}
          <div class="tab-panel" data-for="pl">
            <p class="panel-note">
              {r.labels.cur} ／ {r.labels.ly} ／ {r.labels.ly2}　単位：円
            </p>
            <div class="scroll">
              <FlowTable lines={r.pl} labels={r.labels} />
            </div>
          </div>
          <div class="tab-panel" data-for="cr">
            <p class="panel-note">単位：円</p>
            <div class="scroll">
              <FlowTable lines={r.cr} labels={r.labels} />
            </div>
          </div>
          <div class="tab-panel" data-for="bs">
            <p class="panel-note">当月末は棚卸補正後、前期末・前々期末は決算確定値　単位：円</p>
            <div class="scroll">
              <BsTable lines={r.bs} labels={r.labels} />
            </div>
          </div>
          <div class="tab-panel" data-for="monthly">
            <p class="panel-note">棚卸補正後　単位：円</p>
            <div class="scroll">
              <MonthlyTable r={r} />
            </div>
          </div>
          <div class="tab-panel" data-for="sens">
            <p class="panel-note">月末棚卸の見積方法による当期純損益の違い</p>
            <div class="scroll">
              <SensitivityTable r={r} />
            </div>
          </div>
          <div class="tab-panel" data-for="past">
            <p class="panel-note">決算確定値　単位：円</p>
            <div class="scroll">
              <PastFyTable r={r} />
            </div>
          </div>
          <div class="tab-panel" data-for="notes">
            <ol class="notes">
              {r.notes.map((n) => (
                <li>{n}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </>
  );
};

const TABS = [
  ['pl', '損益計算書'],
  ['cr', '製造原価報告書'],
  ['bs', '貸借対照表'],
  ['monthly', '月次推移'],
  ['sens', '見積方法の比較'],
  ['past', '過去の決算'],
  ['notes', '作成基準'],
] as const;

export const EmptyPage: FC<{ connected: boolean }> = ({ connected }) => (
  <section class="card empty">
    <span class="mark">悠</span>
    <h1>まだ試算表がありません</h1>
    <p>freee からデータを取り込むと、ここに試算表が表示されます。</p>
    <a class="btn primary" href="/sync">
      {connected ? '取込画面へ' : 'freee と接続する'}
    </a>
  </section>
);

const jst = (iso: string, opt: Intl.DateTimeFormatOptions = {}) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', ...opt });
const ACTION_LABEL: Record<string, string> = {
  sync: '取込',
  sync_error: '自動取込エラー',
  freee_connect: 'freee 接続',
  adjust: '棚卸補正を保存',
  initiative_save: '施策を保存',
  initiative_delete: '施策を削除',
  attachment_upload: '添付を追加',
  attachment_delete: '添付を削除',
  loan_save: '借入を保存',
  loan_delete: '借入を削除',
  package_finalize: '確定版を保存',
  dev_seed: 'デモデータ投入',
};

export const SyncPage: FC<{
  status: { connected: boolean; updatedAt?: string; error?: string };
  configured: boolean;
  fys: FreeeFiscalYear[];
  suggest: { fy: number; month: number };
  periods: Period[];
  logs: { at: string; actor: string | null; action: string; detail_json: string | null }[];
  dev: boolean;
}> = ({ status, configured, fys, suggest, periods, logs, dev }) => {
  const years = fys.length ? fys.map((f) => f.fy).reverse() : [suggest.fy, suggest.fy - 1];
  const sm = (y: number) => Number(fys.find((f) => f.fy === y)?.start_date.slice(5, 7) ?? 3);
  return (
    <>
      <header class="pagehead">
        <div>
          <p class="eyebrow">freee 会計（株式会社 悠三堂）</p>
          <h1>freee から取込</h1>
        </div>
      </header>
      <div class="two-col">
        <section class="card">
          <div class="card-head">
            <div>
              <h2>取り込む月</h2>
              <p class="card-sub">期首からこの月末までの累計を、前期・前々期と比較できる形で取り込みます</p>
            </div>
          </div>
          <form method="post" action="/sync" class="stack wide">
            <div class="row">
              <label>
                年度
                <select name="fy">
                  {years.map((y) => (
                    <option value={String(y)} selected={y === suggest.fy}>
                      {fyLabel(y, sm(y))}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                対象月
                <select name="month">
                  {monthsUpTo(sm(suggest.fy), lastMonth(sm(suggest.fy))).map((m) => (
                    <option value={String(m)} selected={m === suggest.month}>
                      {m}月末
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label class="check">
              <input type="checkbox" name="force" value="1" /> 前期以前の決算データも取り直す
            </label>
            <div class="form-actions">
              <button class="btn primary" disabled={!status.connected}>
                取り込む
              </button>
              <span class="muted">数秒〜十数秒かかります。毎月5日の朝にも前月分を自動で取り込みます。</span>
            </div>
          </form>
          {dev && (
            <form method="post" action="/dev/seed" class="upload">
              <button class="btn small">開発用：デモデータ（2026年8月）を投入</button>
            </form>
          )}
        </section>
        <section class="card">
          <div class="card-head">
            <div>
              <h2>freee との接続</h2>
              <p class="card-sub">試算表の参照のみ。freee の帳簿は変更しません</p>
            </div>
            <span class={`status ${status.connected ? 'ok' : 'warn'}`}>{status.connected ? '接続済み' : '未接続'}</span>
          </div>
          {status.connected && status.updatedAt && <p class="muted">トークン更新 {jst(status.updatedAt)}</p>}
          {status.error && <p class="muted">{status.error}</p>}
          {configured ? (
            <a class="btn" href="/auth/freee/start">
              {status.connected ? 'freee と再接続' : 'freee と接続'}
            </a>
          ) : (
            <p class="muted">freee の Client ID / Secret と TOKEN_ENC_KEY が未設定です（README の「初回セットアップ」参照）。</p>
          )}
        </section>
      </div>
      <div class="two-col" style="margin-top:18px">
        <section class="card flush">
          <div class="card-head pad">
            <h2>取込済みの月</h2>
          </div>
          <table class="fin">
            <thead>
              <tr>
                <th class="name">対象月</th>
                <th class="name">取込日時</th>
                <th class="name">集計</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr>
                  <td class="name">
                    <a href={`/report?fy=${p.fy}&month=${p.month}`}>{monthLabel(p.fy, sm(p.fy), p.month)}末</a>
                  </td>
                  <td class="name">{jst(p.fetchedAt)}</td>
                  <td class="name">
                    <span class={`badge ${p.upToDate ? 'ok' : 'warn'}`}>{p.upToDate ? '完了' : '集計中'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section class="card">
          <h2>操作履歴</h2>
          <ul class="log">
            {logs.map((l) => (
              <li>
                <span class="muted">{jst(l.at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span>
                  <b>{ACTION_LABEL[l.action] ?? l.action}</b> <span class="muted">{l.actor}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
};

export const AdjustPage: FC<{
  r: Report;
  periods: Period[];
  fys: FreeeFiscalYear[];
  settings: { method: string; depreciationEnabled: boolean; depreciationMonthly: number | null; note: string | null; inputs: InventoryInput[] };
  autoMonthlyDep: number | null;
}> = ({ r, periods, fys, settings, autoMonthlyDep }) => {
  const cats = [
    ['wip', '仕掛品（荒茶など）', 'kg'],
    ['product', '製品', '個'],
    ['material', '原材料', ''],
    ['goods', '商品', ''],
  ] as const;
  const input = (k: string) => settings.inputs.find((i) => i.category === k);
  return (
    <>
      <header class="pagehead">
        <div>
          <p class="eyebrow">{fyLabel(r.meta.fy, r.meta.fyStartMonth)}</p>
          <h1>棚卸補正 {monthLabel(r.meta.fy, r.meta.fyStartMonth, r.meta.month)}末</h1>
        </div>
        <div class="head-actions">
          <PeriodSelect periods={periods} fy={r.meta.fy} month={r.meta.month} action="/adjust" fys={fys} />
        </div>
      </header>
      <p class="lead">月末には実地棚卸をしていないため、月末の在庫をどう見積るかをここで決めます。標準は、期首の棚卸高と同じ在庫が月末にもあるとみなす据置法です。</p>
      <form method="post" action="/adjust" class="stack wide">
        <input type="hidden" name="fy" value={String(r.meta.fy)} />
        <input type="hidden" name="month" value={String(r.meta.month)} />
        <section class="card">
          <h2>月末棚卸の見積方法</h2>
          <div class="choice" style="margin-top:12px">
            <label class="radio">
              <input type="radio" name="method" value="carry_forward" checked={settings.method !== 'manual'} />
              <span>
                <span class="opt-title">据置法（標準）</span>
                <span class="opt-desc">期首棚卸高（前期末の実地棚卸高）と同額が月末にもあるとみなします</span>
              </span>
            </label>
            <label class="radio">
              <input type="radio" name="method" value="manual" checked={settings.method === 'manual'} />
              <span>
                <span class="opt-title">実地簡易棚卸</span>
                <span class="opt-desc">下の表に入力した区分だけ入力値を使い、入力しない区分は据置のままにします</span>
              </span>
            </label>
          </div>
          <h3>実地簡易棚卸の入力</h3>
          <div class="scroll">
            <table class="fin inputs">
              <thead>
                <tr>
                  <th class="name">区分</th>
                  <th>期首棚卸高</th>
                  <th>数量</th>
                  <th>単位</th>
                  <th>単価</th>
                  <th>金額（直接入力可）</th>
                  <th class="name">メモ</th>
                </tr>
              </thead>
              <tbody>
                {cats.map(([k, label, unit]) => {
                  const i = input(k);
                  return (
                    <tr>
                      <td class="name">{label}</td>
                      <Yen v={r.inventory[0].opening[k]} />
                      <td>
                        <input type="number" step="any" name={`qty_${k}`} value={i?.qty ?? ''} />
                      </td>
                      <td>
                        <input type="text" name={`unit_${k}`} value={i?.unit ?? unit} size={4} style="min-width:60px" />
                      </td>
                      <td>
                        <input type="number" name={`unit_cost_${k}`} value={i?.unit_cost ?? ''} />
                      </td>
                      <td>
                        <input type="number" name={`amount_${k}`} value={i?.amount ?? ''} placeholder="空欄＝据置" />
                      </td>
                      <td>
                        <input type="text" name={`note_${k}`} value={i?.note ?? ''} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p class="muted">金額が空欄で数量と単価があれば、数量×単価で計算します。すべて空欄にすると入力を削除します。</p>
        </section>
        <div class="two-col">
          <section class="card">
            <h2>減価償却費の月割</h2>
            <p class="card-sub" style="margin-bottom:12px">決算時に年1回計上している減価償却費を、月割で見積って費用に加えます</p>
            <div class="stack">
              <label class="check">
                <input type="checkbox" name="dep" value="1" checked={settings.depreciationEnabled} /> 月割の見積額を計上する
              </label>
              <label>
                月額（空欄なら前期実績÷12 = {autoMonthlyDep === null ? '前期データなし' : `${yen(autoMonthlyDep)}円`}）
                <input type="number" name="dep_monthly" value={settings.depreciationMonthly ?? ''} />
              </label>
            </div>
          </section>
          <section class="card">
            <h2>メモ</h2>
            <p class="card-sub" style="margin-bottom:12px">税理士や銀行への説明など、この月の補正についての覚え書き</p>
            <textarea name="note" rows={4} style="width:100%">
              {settings.note ?? ''}
            </textarea>
          </section>
        </div>
        <div class="form-actions">
          <button class="btn primary">保存して再計算</button>
          <a class="link" href={`/report?fy=${r.meta.fy}&month=${r.meta.month}`}>
            試算表に戻る
          </a>
        </div>
      </form>
      <h2 style="margin:34px 0 12px">現在の計算結果</h2>
      <section class="card flush">
        <div class="card-head pad">
          <h2>月末棚卸</h2>
        </div>
        <div class="scroll">
          <InventoryTable r={r} />
        </div>
      </section>
      <div class="two-col">
        <section class="card flush">
          <div class="card-head pad">
            <h2>当期純損益への影響</h2>
          </div>
          <BridgeTable r={r} />
        </section>
        <section class="card flush">
          <div class="card-head pad">
            <h2>見積方法の比較</h2>
          </div>
          <div class="scroll">
            <SensitivityTable r={r} />
          </div>
        </section>
      </div>
    </>
  );
};

const STATUS = { planned: '予定', active: '実施中', done: '完了' } as const;

export const InitiativesPage: FC<{ fy: number; fys: FreeeFiscalYear[]; items: Initiative[]; attachments: Attachment[]; edit: Initiative | null }> = ({ fy, fys, items, attachments, edit }) => {
  const sm = Number(fys.find((f) => f.fy === fy)?.start_date.slice(5, 7) ?? 3);
  const common = attachments.filter((a) => a.initiative_id === null);
  return (
    <>
      <header class="pagehead">
        <div>
          <p class="eyebrow">{fyLabel(fy, sm)}</p>
          <h1>当期の施策・添付資料</h1>
        </div>
        <div class="head-actions">
          <form method="get" action="/initiatives" class="period">
            <label class="select">
              <span class="select-label">年度</span>
              <select name="fy" data-autosubmit="">
                {(fys.length ? fys.map((f) => f.fy).reverse() : [fy]).map((y) => (
                  <option value={String(y)} selected={y === fy}>
                    {y}年度
                  </option>
                ))}
              </select>
            </label>
          </form>
          <a class="btn primary" href={`/initiatives?fy=${fy}#form`}>
            施策を追加
          </a>
        </div>
      </header>
      <p class="lead">この年度に新しく始めた施策です。銀行提出用ページに、一覧と添付資料名が載ります。</p>
      {items.length > 0 && (
        <div class="initiative-grid">
          {items.map((i) => (
            <section class="card">
              <div class="card-head">
                <div>
                  <h2>{i.title}</h2>
                  <p class="card-sub">
                    {i.started_on ? `${i.started_on} 開始` : '開始時期 未設定'}
                    {i.category ? `・${i.category}` : ''}
                  </p>
                </div>
                <span class={`badge ${i.status}`}>{STATUS[i.status]}</span>
              </div>
              <dl class="kv">
                {i.purpose && (
                  <>
                    <dt>目的</dt>
                    <dd>{i.purpose}</dd>
                  </>
                )}
                {i.related_accounts && (
                  <>
                    <dt>関連科目</dt>
                    <dd>{i.related_accounts}</dd>
                  </>
                )}
                {i.expected_effect && (
                  <>
                    <dt>期待効果</dt>
                    <dd>{i.expected_effect}</dd>
                  </>
                )}
                {i.progress && (
                  <>
                    <dt>進捗</dt>
                    <dd>{i.progress}</dd>
                  </>
                )}
              </dl>
              <AttachmentList items={attachments.filter((a) => a.initiative_id === i.id)} fy={fy} />
              <UploadForm fy={fy} initiativeId={i.id} />
              <div class="card-tools" style="margin-top:12px">
                <a class="btn small" href={`/initiatives?fy=${fy}&edit=${i.id}#form`}>
                  編集
                </a>
                <form method="post" action={`/initiatives/${i.id}/delete`} class="inline" onsubmit="return confirm('この施策を削除しますか？')">
                  <input type="hidden" name="fy" value={String(fy)} />
                  <button class="btn small danger">削除</button>
                </form>
              </div>
            </section>
          ))}
        </div>
      )}
      <section class="card">
        <div class="card-head">
          <div>
            <h2>年度共通の添付資料</h2>
            <p class="card-sub">事業計画書、資金繰り表、パンフレットなど</p>
          </div>
        </div>
        <AttachmentList items={common} fy={fy} />
        <UploadForm fy={fy} initiativeId={null} />
      </section>
      <section id="form" class="card">
        <h2 style="margin-bottom:14px">{edit ? '施策を編集' : '施策を追加'}</h2>
        <form method="post" action="/initiatives" class="stack wide">
          <input type="hidden" name="fy" value={String(fy)} />
          {edit && <input type="hidden" name="id" value={String(edit.id)} />}
          <label>
            施策名 <input type="text" name="title" required value={edit?.title ?? ''} placeholder="例：卸売の新規開拓" />
          </label>
          <div class="row">
            <label>
              開始月 <input type="month" name="started_on" value={edit?.started_on ?? ''} />
            </label>
            <label>
              区分 <input type="text" name="category" placeholder="販路拡大・製造・設備 など" value={edit?.category ?? ''} />
            </label>
            <label>
              状態
              <select name="status">
                {(['planned', 'active', 'done'] as const).map((st) => (
                  <option value={st} selected={(edit?.status ?? 'active') === st}>
                    {STATUS[st]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              並び順 <input type="number" name="sort_order" value={String(edit?.sort_order ?? items.length + 1)} />
            </label>
          </div>
          <label>
            目的 <textarea name="purpose" rows={2}>{edit?.purpose ?? ''}</textarea>
          </label>
          <label>
            関連する勘定科目・数値 <input type="text" name="related_accounts" placeholder="例：売上高（卸）、外注加工費（製茶）" value={edit?.related_accounts ?? ''} />
          </label>
          <div class="row">
            <label>
              期待効果 <textarea name="expected_effect" rows={3}>{edit?.expected_effect ?? ''}</textarea>
            </label>
            <label>
              進捗・実績 <textarea name="progress" rows={3}>{edit?.progress ?? ''}</textarea>
            </label>
          </div>
          <div class="form-actions">
            <button class="btn primary">{edit ? '更新する' : '追加する'}</button>
            {edit && (
              <a class="link" href={`/initiatives?fy=${fy}`}>
                キャンセル
              </a>
            )}
          </div>
        </form>
      </section>
    </>
  );
};

const extOf = (name: string) => (name.split('.').pop() ?? '').slice(0, 4).toUpperCase();

const AttachmentList: FC<{ items: Attachment[]; fy: number }> = ({ items, fy }) =>
  items.length ? (
    <ul class="files">
      {items.map((a) => (
        <li>
          <span class="file-ico">{extOf(a.filename)}</span>
          <span class="grow">
            <a href={`/files/${a.id}`} target="_blank">
              {a.title}
            </a>
            <br />
            <span class="muted">
              {a.filename}・{Math.ceil((a.size ?? 0) / 1024).toLocaleString()} KB
            </span>
          </span>
          <form method="post" action={`/attachments/${a.id}/delete`} class="inline" onsubmit="return confirm('添付を削除しますか？')">
            <input type="hidden" name="fy" value={String(fy)} />
            <button class="btn small danger">削除</button>
          </form>
        </li>
      ))}
    </ul>
  ) : (
    <p class="muted">添付はまだありません</p>
  );

const UploadForm: FC<{ fy: number; initiativeId: number | null }> = ({ fy, initiativeId }) => (
  <form method="post" action="/attachments" enctype="multipart/form-data" class="upload">
    <input type="hidden" name="fy" value={String(fy)} />
    {initiativeId !== null && <input type="hidden" name="initiative_id" value={String(initiativeId)} />}
    <input type="text" name="title" placeholder="資料名（例：2026年度 事業計画書）" required />
    <input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.doc,.csv" />
    <button class="btn small">添付する</button>
  </form>
);

export const LoansPage: FC<{ loans: Loan[]; borrowings: Report['borrowings'] | null; edit: Loan | null }> = ({ loans, borrowings, edit }) => (
  <>
    <header class="pagehead">
      <div>
        <p class="eyebrow">銀行提出用ページの「借入金明細」に載ります</p>
        <h1>借入金明細</h1>
      </div>
      <div class="head-actions">
        <a class="btn primary" href="/loans#form">
          借入を追加
        </a>
      </div>
    </header>
    {borrowings && (
      <div class="kpis">
        {borrowings.map((b) => (
          <div class="kpi">
            <div class="kpi-head">
              <span class="kpi-label">{b.name}</span>
              {b.prevFyEnd !== null && <Delta cur={b.cur} base={b.prevFyEnd} />}
            </div>
            <div class="kpi-val">
              {yen(b.cur)}
              <span class="unit">円</span>
            </div>
            <div class="kpi-foot">
              <span class="kpi-sub">前期末 {yen(b.prevFyEnd)}（freee、最新の取込月）</span>
            </div>
          </div>
        ))}
      </div>
    )}
    <section class="card flush">
      <div class="card-head pad">
        <div>
          <h2>借入先ごとの条件</h2>
          <p class="card-sub">freee は勘定科目単位の残高しか持たないため、借入先・金利・返済額はここに入力します</p>
        </div>
      </div>
      {loans.length ? (
        <div class="scroll">
          <table class="fin">
            <thead>
              <tr>
                <th class="name">借入先</th>
                <th class="name">科目</th>
                <th>当初元本</th>
                <th>年利</th>
                <th class="name">借入日</th>
                <th class="name">最終返済</th>
                <th>月返済額</th>
                <th>残高</th>
                <th class="name">備考</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr>
                  <td class="name">
                    <b>{l.lender}</b>
                  </td>
                  <td class="name">{l.account_name ?? ''}</td>
                  <Yen v={l.principal} />
                  <td class="num">{l.rate === null ? '—' : `${l.rate}%`}</td>
                  <td class="name">{l.started_on ?? ''}</td>
                  <td class="name">{l.ends_on ?? ''}</td>
                  <Yen v={l.monthly_payment} />
                  <Yen v={l.balance_override} />
                  <td class="name">{l.note ?? ''}</td>
                  <td class="num">
                    <a class="btn small" href={`/loans?edit=${l.id}#form`}>
                      編集
                    </a>{' '}
                    <form method="post" action={`/loans/${l.id}/delete`} class="inline" onsubmit="return confirm('削除しますか？')">
                      <button class="btn small danger">削除</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="muted" style="padding:0 20px 18px">まだ登録がありません</p>
      )}
    </section>
    <section id="form" class="card">
      <h2 style="margin-bottom:14px">{edit ? '借入を編集' : '借入を追加'}</h2>
      <form method="post" action="/loans" class="stack wide">
        {edit && <input type="hidden" name="id" value={String(edit.id)} />}
        <div class="row">
          <label>
            借入先 <input type="text" name="lender" required value={edit?.lender ?? ''} placeholder="例：日本政策金融公庫" />
          </label>
          <label>
            科目
            <select name="account_name">
              {['長期借入金', '短期借入金', '役員借入金'].map((a) => (
                <option value={a} selected={edit?.account_name === a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            当初元本 <input type="number" name="principal" value={edit?.principal ?? ''} />
          </label>
          <label>
            年利（%） <input type="number" step="0.001" name="rate" value={edit?.rate ?? ''} />
          </label>
        </div>
        <div class="row">
          <label>
            借入日 <input type="date" name="started_on" value={edit?.started_on ?? ''} />
          </label>
          <label>
            最終返済日 <input type="date" name="ends_on" value={edit?.ends_on ?? ''} />
          </label>
          <label>
            月返済額 <input type="number" name="monthly_payment" value={edit?.monthly_payment ?? ''} />
          </label>
          <label>
            残高 <input type="number" name="balance_override" value={edit?.balance_override ?? ''} />
          </label>
          <label>
            並び順 <input type="number" name="sort_order" value={String(edit?.sort_order ?? loans.length + 1)} />
          </label>
        </div>
        <label>
          備考 <input type="text" name="note" value={edit?.note ?? ''} placeholder="例：据置期間 2027年3月まで、保証協会付き" />
        </label>
        <div class="form-actions">
          <button class="btn primary">{edit ? '更新する' : '追加する'}</button>
          {edit && (
            <a class="link" href="/loans">
              キャンセル
            </a>
          )}
        </div>
      </form>
    </section>
  </>
);

export const HistoryPage: FC<{ items: { id: number; fy: number; month: number; version: number; submitted_to: string | null; submitted_on: string | null; memo: string | null; created_by: string | null; created_at: string }[]; fys: FreeeFiscalYear[] }> = ({ items, fys }) => {
  const sm = (y: number) => Number(fys.find((f) => f.fy === y)?.start_date.slice(5, 7) ?? 3);
  return (
    <>
      <header class="pagehead">
        <div>
          <p class="eyebrow">確定した試算表パッケージ</p>
          <h1>提出履歴</h1>
        </div>
      </header>
      <p class="lead">確定後に freee の数値や補正を変えても、ここに保存した版は変わりません。提出先と提出日を記録しておけます。</p>
      {items.length === 0 && (
        <section class="card empty">
          <p>まだ確定版はありません。試算表の画面で「この内容で確定」を押すとここに保存されます。</p>
        </section>
      )}
      {items.map((p) => (
        <section class="card">
          <div class="card-head">
            <div>
              <h2>
                {monthLabel(p.fy, sm(p.fy), p.month)}末 <span class="badge">第{p.version}版</span>
              </h2>
              <p class="card-sub">
                {jst(p.created_at)} 確定・{p.created_by ?? ''}
              </p>
            </div>
            <a class="btn small" href={`/print/package/${p.id}`} target="_blank">
              提出用ページを開く
            </a>
          </div>
          <form method="post" action={`/packages/${p.id}`} class="upload">
            <input type="text" name="submitted_to" value={p.submitted_to ?? ''} placeholder="提出先（例：南都銀行 ○○支店）" />
            <input type="date" name="submitted_on" value={p.submitted_on ?? ''} />
            <input type="text" name="memo" value={p.memo ?? ''} placeholder="メモ" />
            <button class="btn small">保存</button>
          </form>
        </section>
      ))}
    </>
  );
};
