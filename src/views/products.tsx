import type { FC } from 'hono/jsx';
import { raw } from 'hono/html';
import { pct, yen } from '../lib/format';
import { COMPARE_CHOICES } from '../report/closings';
import { TOP_CHOICES, type ProductMetric, type ProductTrend, type ProductYear } from '../report/products';
import { sparkline } from './charts';

const METRIC_LABEL: Record<ProductMetric, string> = { sales: '売上', qty: '販売数' };

/** 列見出し：今期の途中は「11/4まで」と添える */
function colHead(c: ProductTrend['cols'][number], short: boolean): string {
  const y = short ? `${String(c.fy).slice(2)}年度` : `${c.fy}年度`;
  if (c.complete) return y;
  const [, m, d] = c.until.split('-').map(Number);
  return `${y}（${m}/${d}まで）`;
}

const num = (v: number, metric: ProductMetric) => (metric === 'qty' ? v.toLocaleString('ja-JP') : yen(v));

/** 売れ筋商品の推移表（画面と提出用で共用） */
export const ProductTrendTable: FC<{ t: ProductTrend; spark?: boolean }> = ({ t, spark = true }) => {
  const short = t.cols.length > 5;
  const label = METRIC_LABEL[t.metric];
  return (
    <table class="fin five products">
      <thead>
        <tr>
          <th class="rank">順位</th>
          <th class="name">商品（{label}）</th>
          {t.cols.map((c) => (
            <th class={c.fy === t.basisFy ? 'basis' : ''}>{colHead(c, short)}</th>
          ))}
          <th>構成比</th>
          {spark && <th class="spark-col">推移</th>}
        </tr>
      </thead>
      <tbody>
        {t.rows.map((r) => (
          <tr class="lv2">
            <td class="rank">{r.rank}</td>
            <td class="name" title={r.title}>
              {r.short}
            </td>
            {r.values.map((v, i) => {
              const prev = i > 0 ? r.values[i - 1] : null;
              return (
                <td class={`num${t.cols[i].fy === t.basisFy ? ' basis' : ''}`}>
                  {v ? num(v, t.metric) : '—'}
                  {i > 0 && t.cols[i].complete && t.cols[i - 1].complete && prev ? <span class="yoy">{pct(v, prev)}</span> : null}
                </td>
              );
            })}
            <td class="num">{r.share === null ? '—' : `${r.share.toFixed(1)}%`}</td>
            {spark && <td class="spark-col">{raw(sparkline(r.values.filter((_, i) => t.cols[i].complete), `${r.short}の${label}の推移`))}</td>}
          </tr>
        ))}
        <tr class="lv2 sub-total">
          <td class="rank"></td>
          <td class="name">その他の商品</td>
          {t.other.map((v) => (
            <td class="num">{num(v, t.metric)}</td>
          ))}
          <td class="num"></td>
          {spark && <td></td>}
        </tr>
        <tr class="lv2 sub-total">
          <td class="rank"></td>
          <td class="name">商品登録のない売上（下書き注文の手入力など）</td>
          {t.unlisted.map((v) => (
            <td class="num">{num(v, t.metric)}</td>
          ))}
          <td class="num"></td>
          {spark && <td></td>}
        </tr>
        <tr class="total lv1">
          <td class="rank"></td>
          <td class="name">Shopify 合計</td>
          {t.total.map((v, i) => (
            <td class="num">
              {num(v, t.metric)}
              {i > 0 && t.cols[i].complete && t.cols[i - 1].complete && t.total[i - 1] ? <span class="yoy">{pct(v, t.total[i - 1])}</span> : null}
            </td>
          ))}
          <td class="num"></td>
          {spark && <td></td>}
        </tr>
      </tbody>
    </table>
  );
};

export const PRODUCT_NOTE = 'Shopify の純売上（割引・返品を差し引いた税抜の金額。送料・税は含まない）で、freee の売上高とは一致しません。商品名は Shopify の現在の名前で集計されます（名前を変えて使い続けている商品は、過去の年度も今の名前で出ます）。';

export const ProductsPage: FC<{ years: ProductYear[]; trend: ProductTrend; connected: boolean; n: number; top: number }> = ({ years, trend, connected, n, top }) => {
  const withData = years.filter((y) => y.total.sales || y.total.qty);
  const latestFetch = years.reduce<string | null>((m, y) => (!m || y.fetched_at > m ? y.fetched_at : m), null);
  const t = trend;
  const bi = t.cols.findIndex((c) => c.fy === t.basisFy);
  const leader = t.rows[0];
  const topShare = t.rows.slice(0, 3).reduce((s, r) => s + (r.share ?? 0), 0);
  const prevTotal = bi > 0 ? t.total[bi - 1] : null;
  return (
    <>
      <header class="pagehead">
        <div>
          <p class="eyebrow">Shopify の商品別売上（会計年度 3月〜2月）</p>
          <h1>売れ筋商品</h1>
        </div>
      </header>
      <p class="lead">Shopify の注文から、商品ごとの売上と販売数を年度ごとに集計し、売れ筋の移り変わりを比べます。順位は直近の終わった年度で決めます。</p>

      <section class="card">
        <div class="card-head">
          <div>
            <h2>Shopify から取り込む</h2>
            <p class="card-sub">{withData.length ? `取込済み ${withData.length}年度（${withData[0].fy}〜${withData[withData.length - 1].fy}年度）${latestFetch ? `・最終取込 ${new Date(latestFetch).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}` : 'まだ取り込んでいません'}</p>
          </div>
          <span class={`status ${withData.length ? 'ok' : 'warn'}`}>{withData.length ? '取込済み' : '未取込'}</span>
        </div>
        <form method="post" action="/products/sync" class="upload">
          <button class="btn primary" disabled={!connected}>
            Shopify から取り込む
          </button>
          <label class="check inline-field">
            <input type="checkbox" name="force" value="1" /> 終わった年度も取り直す
          </label>
          <span class="muted">終わった年度は一度だけ取り込み、今期は毎回取り直します。</span>
        </form>
      </section>

      {withData.length > 0 && (
        <div class="seg-row">
          <form method="post" action="/products/view" class="segmented" aria-label="比べる期数">
            <span class="segmented-label">期数</span>
            {COMPARE_CHOICES.map((c) => (
              <button type="submit" name="n" value={String(c)} class={c === n ? 'on' : ''} aria-pressed={c === n ? 'true' : 'false'}>
                {c}期
              </button>
            ))}
          </form>
          <form method="post" action="/products/view" class="segmented" aria-label="表示する商品数">
            <span class="segmented-label">上位</span>
            {TOP_CHOICES.map((c) => (
              <button type="submit" name="top" value={String(c)} class={c === top ? 'on' : ''} aria-pressed={c === top ? 'true' : 'false'}>
                {c}商品
              </button>
            ))}
          </form>
          <form method="post" action="/products/view" class="segmented" aria-label="並べる基準">
            <span class="segmented-label">基準</span>
            {(['sales', 'qty'] as const).map((m) => (
              <button type="submit" name="metric" value={m} class={m === t.metric ? 'on' : ''} aria-pressed={m === t.metric ? 'true' : 'false'}>
                {METRIC_LABEL[m]}
              </button>
            ))}
          </form>
        </div>
      )}

      {leader && bi >= 0 && (
        <section class="kpis" aria-label="売れ筋の要約">
          <div class="kpi">
            <div class="kpi-head">
              <span class="kpi-label">{t.basisFy}年度の1位</span>
            </div>
            <div class="kpi-val kpi-text">{leader.short}</div>
            <div class="kpi-foot">
              <span class="kpi-sub">
                {num(leader.values[bi], t.metric)}
                {t.metric === 'qty' ? '個' : '円'}・構成比 {leader.share?.toFixed(1)}%
              </span>
            </div>
          </div>
          <div class="kpi">
            <div class="kpi-head">
              <span class="kpi-label">上位3商品の構成比</span>
            </div>
            <div class="kpi-val">
              {topShare.toFixed(1)}
              <span class="unit">%</span>
            </div>
            <div class="kpi-foot">
              <span class="kpi-sub">商品登録のある売上に占める割合</span>
            </div>
          </div>
          <div class="kpi">
            <div class="kpi-head">
              <span class="kpi-label">Shopify 合計（{t.basisFy}年度）</span>
              {prevTotal ? <span class="delta flat">前年比 {pct(t.total[bi], prevTotal)}</span> : null}
            </div>
            <div class="kpi-val">
              {num(t.total[bi], t.metric)}
              <span class="unit">{t.metric === 'qty' ? '個' : '円'}</span>
            </div>
            <div class="kpi-foot">
              <span class="kpi-sub">商品登録のない売上を含む</span>
            </div>
          </div>
        </section>
      )}

      {t.rows.length > 0 && (
        <section class="card">
          <div class="card-head">
            <div>
              <h2>
                上位{t.rows.length}商品の{METRIC_LABEL[t.metric]}推移
              </h2>
              <p class="card-sub">
                順位は{t.basisFy}年度の{METRIC_LABEL[t.metric]}の順。数字の下の小さな値は前年比
              </p>
            </div>
          </div>
          <div class="scroll">
            <ProductTrendTable t={t} />
          </div>
          <p class="note">{PRODUCT_NOTE}</p>
        </section>
      )}
    </>
  );
};
