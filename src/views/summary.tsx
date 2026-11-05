import type { FC } from 'hono/jsx';
import type { Initiative } from '../db';
import { monthLabel } from '../lib/fiscal';
import { pct, signedYen, yen } from '../lib/format';
import { fiveYearCompare } from '../report/closings';
import { adjusted, findTotal } from '../report/lines';
import type { ProductTrend } from '../report/products';
import type { TargetRow } from '../report/targets';
import type { Report } from '../report/types';

const STATUS = { planned: '予定', active: '実施中', done: '完了' } as const;
const TARGET_STATUS: Record<string, string> = { ok: '目安以上', warn: 'やや下回る', bad: '下回る' };

/** 「→ 3. 損益計算書」のような参照（ページの番号は節番号） */
const Ref: FC<{ to: [number, string] | null }> = ({ to }) => (to ? <span class="sm-ref">詳細 → {to[0]}. {to[1]}</span> : null);

const Num: FC<{ v: number | null }> = ({ v }) => <td class={`num${v !== null && v < 0 ? ' neg' : ''}`}>{yen(v)}</td>;

/** 黒字・赤字の言い方 */
const profitWord = (v: number) => (v >= 0 ? `${yen(v)}円の黒字` : `${yen(-v)}円の赤字`);

export interface SummaryInput {
  r: Report;
  targets: { rows: TargetRow[] } | null;
  initiatives: Initiative[];
  products: ProductTrend | null;
  compareYears: number;
  /** 節のキーから [番号, 題名]。その節がなければ null */
  refOf: (key: string) => [number, string] | null;
}

/** 提出用資料の要点（この後のページの数字をまとめる） */
export const SummaryDoc: FC<SummaryInput> = ({ r, targets, initiatives, products, compareYears, refOf: ref }) => {
  const m = r.meta;
  /** 例：2026年3月〜10月累計 */
  const cum = `${monthLabel(m.fy, m.fyStartMonth, m.fyStartMonth)}〜${m.month}月累計`;
  const t = (cat: string) => {
    const l = findTotal(r.pl, cat);
    return l ? adjusted(l) : null;
  };
  const plRows = [
    ['売上高', t('売上高')],
    ['売上総利益', t('売上総損益金額')],
    ['営業利益', t('営業損益金額')],
    ['経常利益', t('経常損益金額')],
  ] as const;
  const sales = t('売上高');
  const ord = t('経常損益金額');

  // 財政状態（当月末と前期末）
  const sumBs = (pred: (name: string, cat: string) => boolean): [number, number | null] | null => {
    const ls = r.bs.filter((l) => !l.isTotal && pred(l.name, l.category));
    if (!ls.length) return null;
    const cur = ls.reduce((s, l) => s + adjusted(l)[0], 0);
    const prev = ls.every((l) => l.fyEnd?.[0] !== undefined && l.fyEnd?.[0] !== null) ? ls.reduce((s, l) => s + (l.fyEnd?.[0] ?? 0), 0) : null;
    return [cur, prev];
  };
  const invSum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
  const na = findTotal(r.bs, '純資産');
  const bank = r.borrowings.filter((b) => !b.name.includes('役員'));
  const officer = r.borrowings.filter((b) => b.name.includes('役員'));
  const sumB = (bs: typeof bank): [number, number | null] | null =>
    bs.length ? [bs.reduce((s, b) => s + b.cur, 0), bs.every((b) => b.prevFyEnd !== null) ? bs.reduce((s, b) => s + (b.prevFyEnd ?? 0), 0) : null] : null;
  const bsRows: [string, [number, number | null] | null][] = [
    ['現金・預金', sumBs((_, cat) => cat === '現金・預金')],
    [`棚卸資産（${m.method === 'manual' ? '実地簡易棚卸' : '据置法の見積'}）`, [invSum(r.inventory[0].closing), invSum(r.inventory[0].opening)]],
    ['借入金（金融機関）', sumB(bank)],
    ['役員借入金', sumB(officer)],
    ['純資産', na ? [adjusted(na)[0], na.fyEnd?.[0] ?? null] : null],
  ];
  const naV = na ? adjusted(na)[0] : null;
  const offV = sumB(officer)?.[0] ?? null;

  const tgRows = (targets?.rows ?? []).filter((x) => ['sales', 'gross', 'op', 'ord'].includes(x.key) && x.target !== null);
  const five = fiveYearCompare(r.pastFy, compareYears);
  const first = five.years[0];
  const last = five.years[five.years.length - 1];
  const errors = r.checks.filter((c) => !c.ok && c.severity === 'error');

  const points: string[] = [];
  if (sales) points.push(`${cum}の売上高は ${yen(sales[0])}円で、前期同期比 ${pct(sales[0], sales[1])}（前期同期 ${yen(sales[1])}円）。`);
  if (ord) points.push(`経常利益は${profitWord(ord[0])}。前期同期（${ord[1] >= 0 ? '黒字' : '赤字'} ${yen(Math.abs(ord[1]))}円）から ${signedYen(ord[0] - ord[1])}円。`);
  if (naV !== null && offV !== null) points.push(`純資産 ${yen(naV)}円に役員借入金 ${yen(offV)}円を加えた実質純資産は ${yen(naV + offV)}円。`);
  if (first && last && five.years.length >= 2) points.push(`売上高は ${first.fy}年度 ${yen(first.sales)}円から ${last.fy}年度 ${yen(last.sales)}円へ${five.salesCagr !== null ? `（年平均 ${five.salesCagr >= 0 ? '+' : '▲'}${Math.abs(five.salesCagr).toFixed(1)}%）` : ''}。`);
  if (products?.rows.length) {
    const top3 = products.rows.slice(0, 3).reduce((s, x) => s + (x.share ?? 0), 0);
    points.push(`Shopify の売れ筋1位は「${products.rows[0].short}」（${products.basisFy}年度の構成比 ${products.rows[0].share?.toFixed(1)}%）。上位3商品で ${top3.toFixed(1)}%。`);
  }

  return (
    <div class="summary">
      <ul class="sm-points">
        {points.map((p) => (
          <li>{p}</li>
        ))}
      </ul>

      <div class="sm-block">
        <h3>
          業績（{cum}・棚卸補正後）
          <Ref to={ref('pl')} />
        </h3>
        <table class="fin sm-table">
          <thead>
            <tr>
              <th class="name">科目</th>
              <th>{r.labels.cur}</th>
              <th>{r.labels.ly}</th>
              <th>前期比</th>
              <th>{r.labels.ly2}</th>
            </tr>
          </thead>
          <tbody>
            {plRows.map(([name, v]) =>
              v ? (
                <tr class={name === '経常利益' ? 'total' : ''}>
                  <td class="name">{name}</td>
                  <Num v={v[0]} />
                  <Num v={v[1]} />
                  <td class="num">{name === '売上高' ? pct(v[0], v[1]) : signedYen(v[0] - v[1])}</td>
                  <Num v={v[2]} />
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>

      <div class="sm-block">
        <h3>
          財政状態（{r.labels.bsCur}）
          <Ref to={ref('bs')} />
        </h3>
        <table class="fin sm-table">
          <thead>
            <tr>
              <th class="name">項目</th>
              <th>{r.labels.bsCur}</th>
              <th>{r.labels.prevFyEnd}</th>
              <th>増減</th>
            </tr>
          </thead>
          <tbody>
            {bsRows.map(([name, v]) =>
              v ? (
                <tr>
                  <td class="name">{name}</td>
                  <Num v={v[0]} />
                  <Num v={v[1]} />
                  <td class="num">{v[1] === null ? '—' : signedYen(v[0] - v[1])}</td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>

      {tgRows.length > 0 && (
        <div class="sm-block">
          <h3>
            今期の目標と進捗
            <Ref to={ref('targets')} />
          </h3>
          <table class="fin sm-table">
            <thead>
              <tr>
                <th class="name">科目</th>
                <th>前期実績</th>
                <th>今期目標</th>
                <th>〜{m.month}月 実績</th>
                <th>進捗</th>
                <th class="name">状況</th>
              </tr>
            </thead>
            <tbody>
              {tgRows.map((x) => (
                <tr>
                  <td class="name">{x.name}</td>
                  <Num v={x.prior} />
                  <Num v={x.target} />
                  <Num v={x.ytd} />
                  <td class="num">{x.target && x.ytd !== null && x.target > 0 ? `${((x.ytd / x.target) * 100).toFixed(1)}%` : '—'}</td>
                  <td class="name">{x.status ? TARGET_STATUS[x.status] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {initiatives.length > 0 && (
        <div class="sm-block">
          <h3>
            当期の施策（{initiatives.length}件）
            <Ref to={ref('initiatives')} />
          </h3>
          <ol class="sm-list">
            {initiatives.map((i) => (
              <li>
                {i.title}
                <span class="sm-tag">{STATUS[i.status]}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div class="sm-block sm-refs">
        <h3>このあとのページ</h3>
        <p>
          {['pl', 'cr', 'bs', 'monthly', 'inventory', 'loans', 'targets', 'initiatives', 'closings', 'products']
            .map((k) => ref(k))
            .filter((x): x is [number, string] => !!x)
            .map((x) => `${x[0]}. ${x[1]}`)
            .join('　')}
        </p>
        <p class={errors.length ? 'sm-check bad' : 'sm-check'}>{errors.length ? `検算：${errors.length}件の不一致があります（${errors.map((e) => e.label).join('、')}）` : '検算：貸借一致・損益計算書と貸借対照表の利益一致など、すべて確認済み'}</p>
      </div>
    </div>
  );
};
