import type { FC } from 'hono/jsx';
import { raw } from 'hono/html';
import type { Attachment } from '../db';
import type { FreeeFiscalYear } from '../freee/types';
import { pct, yen } from '../lib/format';
import { fiveYearCompare, periodLabel } from '../report/closings';
import type { PastFy } from '../report/types';
import { groupedBars } from './charts';
import { FiveYearTable, PastFyList } from './components';

/** 過去5期の売上高・経常利益のグラフ（画面と提出用で共用） */
export const FiveYearCharts: FC<{ closings: PastFy[]; height?: number }> = ({ closings, height }) => {
  const f = fiveYearCompare(closings);
  if (f.years.length < 2) return null;
  const cats = f.years.map((y) => `${y.fy}年度`);
  const last = cats.length - 1;
  return (
    <div class="chart-row">
      <figure class="card-figure">
        <figcaption>売上高（過去{f.years.length}期）</figcaption>
        {raw(groupedBars({ categories: cats, series: [{ name: '売上高', cls: 'cur', values: f.years.map((y) => y.sales) }], label: [0, last], height, ariaLabel: '過去の売上高' }))}
      </figure>
      <figure class="card-figure">
        <figcaption>経常利益（過去{f.years.length}期）</figcaption>
        {raw(groupedBars({ categories: cats, series: [{ name: '経常利益', cls: 'cur', values: f.years.map((y) => y.ordinaryIncome) }], label: [0, last], height, ariaLabel: '過去の経常利益' }))}
      </figure>
    </div>
  );
};

export const ClosingsPage: FC<{ closings: PastFy[]; docs: Attachment[]; fys: FreeeFiscalYear[]; connected: boolean }> = ({ closings, docs, fys, connected }) => {
  const f = fiveYearCompare(closings);
  const latest = f.years[f.years.length - 1];
  const oldest = f.years[0];
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const pastFys = fys.filter((x) => x.end_date < today).sort((a, b) => b.fy - a.fy);
  const imported = new Set(closings.map((c) => c.fy));
  const missing = pastFys.filter((x) => !imported.has(x.fy)).length;
  return (
    <>
      <header class="pagehead">
        <div>
          <p class="eyebrow">決算確定値（freee 会計の通期試算表）</p>
          <h1>過去の決算</h1>
        </div>
      </header>
      <p class="lead">freee にある過去の全期の決算を取り込み、売上や利益の推移を比べます。税理士から受け取った決算書の PDF も、年度ごとにここへ登録できます。</p>

      <section class="card">
        <div class="card-head">
          <div>
            <h2>freee から取り込む</h2>
            <p class="card-sub">
              {pastFys.length ? `freee にある過去の期：${pastFys.length}期（取込済み ${pastFys.length - missing}期・未取込 ${missing}期）` : '年度の一覧は、最初の取込で freee から読み込みます'}
            </p>
          </div>
          <span class={`status ${missing || !pastFys.length ? 'warn' : 'ok'}`}>{missing || !pastFys.length ? '未取込あり' : 'すべて取込済み'}</span>
        </div>
        <form method="post" action="/closings/sync" class="upload">
          <button class="btn primary" disabled={!connected}>
            過去の決算をすべて取り込む
          </button>
          <label class="check inline-field">
            <input type="checkbox" name="force" value="1" /> 取込済みの期も取り直す
          </label>
          <span class="muted">1期あたり freee API 3回。10期で1〜2分かかります。</span>
        </form>
      </section>

      {f.years.length >= 2 && (
        <>
          <section class="kpis" aria-label="過去の推移の要約">
            <div class="kpi">
              <div class="kpi-head">
                <span class="kpi-label">直近期の売上高（{latest.fy}年度）</span>
                <span class="delta flat">{f.years.length}期前比 {pct(latest.sales ?? 0, oldest.sales)}</span>
              </div>
              <div class="kpi-val">
                {yen(latest.sales)}
                <span class="unit">円</span>
              </div>
              <div class="kpi-foot">
                <span class="kpi-sub">
                  {oldest.fy}年度 {yen(oldest.sales)}
                </span>
              </div>
            </div>
            <div class="kpi">
              <div class="kpi-head">
                <span class="kpi-label">売上高の年平均伸び率</span>
              </div>
              <div class="kpi-val">
                {f.salesCagr === null ? '—' : `${f.salesCagr >= 0 ? '+' : '▲'}${Math.abs(f.salesCagr).toFixed(1)}`}
                {f.salesCagr !== null && <span class="unit">%／年</span>}
              </div>
              <div class="kpi-foot">
                <span class="kpi-sub">
                  {oldest.fy}〜{latest.fy}年度（{f.years.length}期）{f.salesCagr === null ? '・12ヶ月未満の期を含むため出していません' : ''}
                </span>
              </div>
            </div>
            <div class="kpi">
              <div class="kpi-head">
                <span class="kpi-label">直近期の経常利益</span>
              </div>
              <div class={`kpi-val${(latest.ordinaryIncome ?? 0) < 0 ? ' neg' : ''}`}>
                {yen(latest.ordinaryIncome)}
                <span class="unit">円</span>
              </div>
              <div class="kpi-foot">
                <span class="kpi-sub">純資産 {yen(latest.netAssets)}</span>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h2>過去{f.years.length}期の推移</h2>
                <p class="card-sub">棒にマウスを乗せると金額が出ます</p>
              </div>
            </div>
            <FiveYearCharts closings={closings} />
          </section>

          <section class="card flush">
            <div class="card-head pad">
              <div>
                <h2>過去{f.years.length}期の比較</h2>
                <p class="card-sub">単位：円。金額の下の小さな数字は前年比</p>
              </div>
            </div>
            <div class="scroll">
              <FiveYearTable f={f} />
            </div>
          </section>
        </>
      )}

      {closings.length > 0 && (
        <section class="card flush">
          <div class="card-head pad">
            <div>
              <h2>全期の決算</h2>
              <p class="card-sub">取込済みの {closings.length}期（新しい順）</p>
            </div>
          </div>
          <div class="scroll">
            <PastFyList items={closings} />
          </div>
        </section>
      )}

      <section class="card" id="docs">
        <div class="card-head">
          <div>
            <h2>決算書の登録</h2>
            <p class="card-sub">税理士から受け取った決算書・申告書の PDF。提出用資料の「過去の決算」に、別添の資料として名前が載ります</p>
          </div>
        </div>
        {(pastFys.length ? pastFys : closings.map((c) => ({ fy: c.fy, start_date: '', end_date: '' }))).map((y) => {
          const mine = docs.filter((d) => d.fy === y.fy);
          return (
            <div class="closing-doc">
              <div class="closing-doc-head">
                <b>{y.start_date ? periodLabel(y as FreeeFiscalYear, y.fy) : `${y.fy}年度`}</b>
                {!imported.has(y.fy) && <span class="badge planned">数字は未取込</span>}
              </div>
              {mine.length > 0 && (
                <ul class="files">
                  {mine.map((a) => (
                    <li>
                      <span class="file-ico">PDF</span>
                      <span class="grow">
                        <a href={a.url ?? `/files/${a.id}`} target="_blank" rel="noopener">
                          {a.title}
                        </a>
                        <br />
                        <span class="muted">
                          {a.filename}・{Math.ceil((a.size ?? 0) / 1024).toLocaleString()} KB
                        </span>
                      </span>
                      <form method="post" action={`/attachments/${a.id}/delete`} class="inline" data-confirm="この決算書を削除しますか？">
                        <input type="hidden" name="fy" value={String(y.fy)} />
                        <input type="hidden" name="return" value="closings" />
                        <button class="btn small danger">削除</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form method="post" action="/attachments" enctype="multipart/form-data" class="upload">
                <input type="hidden" name="fy" value={String(y.fy)} />
                <input type="hidden" name="category" value="closing" />
                <input type="hidden" name="return" value="closings" />
                <input type="text" name="title" value={`${y.fy}年度 決算書`} required aria-label={`${y.fy}年度の資料名`} />
                <input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg" aria-label={`${y.fy}年度の決算書ファイル`} />
                <button class="btn small">登録する</button>
              </form>
            </div>
          );
        })}
      </section>
    </>
  );
};
