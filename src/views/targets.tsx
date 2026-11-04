import type { FC } from 'hono/jsx';
import type { Initiative } from '../db';
import type { FreeeFiscalYear } from '../freee/types';
import { fyLabel, monthLabel } from '../lib/fiscal';
import { pct, signedYen, yen } from '../lib/format';
import type { TargetRow, TargetView } from '../report/targets';
import { Yen } from './components';

const STATUS_LABEL = {
  higher: { ok: '目安以上', warn: 'やや下回る', bad: '下回る' },
  lower: { ok: '目安以内', warn: 'やや超過', bad: '超過' },
} as const;

const Status: FC<{ r: TargetRow }> = ({ r }) =>
  r.status ? <span class={`badge ${r.status === 'ok' ? 'ok' : r.status === 'warn' ? 'planned' : 'bad'}`}>{STATUS_LABEL[r.better][r.status]}</span> : <span class="muted">—</span>;

const STATUS = { planned: '予定', active: '実施中', done: '完了' } as const;

/** 利益の行は前期が0円近くになりやすく、率では読めないので差額で出す */
const PROFIT = new Set(['gross', 'op', 'ord']);

const fmtInput = (v: number | null) => (v === null ? '' : v.toLocaleString('ja-JP'));

export const TargetsPage: FC<{
  view: TargetView;
  fys: FreeeFiscalYear[];
  asOf: { fy: number; month: number } | null;
  note: string | null;
  updated: { at: string | null; by: string | null };
  initiatives: Initiative[];
}> = ({ view, fys, asOf, note, updated, initiatives }) => {
  const fy = view.fy;
  const sm = (y: number) => Number(fys.find((f) => f.fy === y)?.start_date.slice(5, 7) ?? 3);
  const asOfLabel = asOf ? `〜${asOf.month}月` : '';
  const row = (k: string) => view.rows.find((r) => r.key === k)!;
  const sales = row('sales');
  const ord = row('ord');
  const salesPace = sales.target && sales.ytd !== null ? sales.ytd / sales.target : null;
  return (
    <>
      <header class="pagehead">
        <div>
          <p class="eyebrow">{fyLabel(fy, sm(fy))}</p>
          <h1>{fy}年度の目標</h1>
        </div>
        <div class="head-actions">
          <form method="get" action="/targets" class="period">
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
        </div>
      </header>
      <p class="lead">
        前期の実績を見ながら、今期の売上と費用の目標を入れます。利益は売上と費用から自動で計算します。
        {asOf ? `取込済みの${monthLabel(asOf.fy, sm(asOf.fy), asOf.month)}末までの実績が、目標に対してどこまで進んでいるかも表示します。` : ''}
      </p>
      {!view.hasPrior && <p class="flash error">前期（{fy - 1}年度）の決算データがまだ取り込まれていません。取込画面で取り込むと、前期実績が表示されます。</p>}

      <section class="kpis" aria-label="目標の要約">
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-label">売上高の目標</span>
            {sales.target !== null && sales.prior ? <span class="delta flat">前期比 {pct(sales.target, sales.prior)}</span> : null}
          </div>
          <div class="kpi-val" data-sum="sales">
            {sales.target === null ? '未設定' : yen(sales.target)}
            {sales.target !== null && <span class="unit">円</span>}
          </div>
          <div class="kpi-foot">
            <span class="kpi-sub">前期実績 {yen(sales.prior)}</span>
          </div>
        </div>
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-label">経常利益の目標</span>
            {ord.target !== null && ord.prior ? <span class="delta flat">前期 {yen(ord.prior)}</span> : null}
          </div>
          <div class={`kpi-val${ord.target !== null && ord.target < 0 ? ' neg' : ''}`}>
            {ord.target === null ? '未設定' : yen(ord.target)}
            {ord.target !== null && <span class="unit">円</span>}
          </div>
          <div class="kpi-foot">
            <span class="kpi-sub">売上・費用をすべて入れると計算されます</span>
          </div>
        </div>
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-label">売上の進み具合{asOfLabel && `（${asOfLabel}）`}</span>
            {sales.status && <Status r={sales} />}
          </div>
          <div class="kpi-val">{salesPace === null ? '—' : `${(salesPace * 100).toFixed(1)}`}{salesPace !== null && <span class="unit">%</span>}</div>
          <div class="kpi-foot">
            <span class="kpi-sub">{sales.priorShare !== null ? `前期の同じ時期は通期の ${(sales.priorShare * 100).toFixed(1)}%` : '当期の取込後に表示'}</span>
          </div>
        </div>
      </section>

      <form method="post" action="/targets" class="stack wide" id="targets-form">
        <input type="hidden" name="fy" value={String(fy)} />
        <section class="card flush">
          <div class="card-head pad">
            <div>
              <h2>科目別の目標</h2>
              <p class="card-sub">金額は円。費用は棚卸補正後の売上原価・販売管理費で比べます</p>
            </div>
            <div class="target-tools">
              <label class="inline-field">
                売上を前期比
                <input type="text" inputmode="decimal" id="yoy-pct" value="105" aria-label="前期比（%）" />%
              </label>
              <button type="button" class="btn small" data-fill="yoy">売上に入れる</button>
              <button type="button" class="btn small" data-fill="prior">空欄に前期実績を入れる</button>
            </div>
          </div>
          <div class="scroll">
            <table class="fin targets">
              <thead>
                <tr>
                  <th class="name">科目</th>
                  <th>前期実績</th>
                  <th>今期目標</th>
                  <th>前期比（利益は差額）</th>
                  <th>{asOfLabel} 実績</th>
                  <th>{asOfLabel} 目安</th>
                  <th>実績 − 目安</th>
                  <th class="name">状況</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => {
                  const diff = r.ytd !== null && r.expected !== null ? r.ytd - r.expected : null;
                  return (
                    <tr class={`${r.kind === 'derived' ? 'total lv1' : 'lv2'}`} data-row={r.key}>
                      <td class="name">{r.name}</td>
                      <Yen v={r.prior} />
                      <td class="num">
                        {r.kind === 'input' ? (
                          <input
                            type="text"
                            inputmode="numeric"
                            name={`t_${r.key}`}
                            id={`t_${r.key.replace(':', '_')}`}
                            value={fmtInput(r.target)}
                            placeholder={r.prior === null ? '' : yen(r.prior)}
                            data-key={r.key}
                            data-prior={r.prior === null ? '' : String(r.prior)}
                            data-group={r.key.startsWith('sales:') ? 'sales' : r.key}
                            aria-label={`${r.name} の今期目標`}
                          />
                        ) : (
                          <span data-derived={r.key}>{r.target === null ? '—' : yen(r.target)}</span>
                        )}
                      </td>
                      <td class="num" data-yoy={r.key} data-prior={r.prior === null ? '' : String(r.prior)} data-mode={PROFIT.has(r.key) ? 'diff' : 'pct'}>
                        {r.target === null || r.prior === null ? '—' : PROFIT.has(r.key) ? signedYen(r.target - r.prior) : pct(r.target, r.prior)}
                      </td>
                      <Yen v={r.ytd} />
                      <Yen v={r.expected} />
                      <td class={`num${diff !== null && ((r.better === 'higher' && diff < 0) || (r.better === 'lower' && diff > 0)) ? ' neg' : ''}`}>{diff === null ? '—' : signedYen(diff)}</td>
                      <td class="name">
                        <Status r={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p class="panel-note foot-note">
            目安は「今期目標 × 前期の同じ時期までに通期の何割だったか」。茶の売上は季節で大きく動くため、単純な月割にはしていません。前期実績は決算確定値、当期の実績と目安は試算表と同じ棚卸補正後の値です。
          </p>
        </section>
        <section class="card">
          <h2>目標の考え方</h2>
          <p class="card-sub" style="margin-bottom:12px">
            売上を伸ばす根拠や、費用を見直す点など。銀行に目標を説明するときの下書きにも使えます。
          </p>
          <textarea name="note" rows={5} style="width:100%" id="target-note">
            {note ?? ''}
          </textarea>
        </section>
        <div class="form-actions">
          <button class="btn primary">目標を保存</button>
          {updated.at && (
            <span class="muted">
              最終更新 {new Date(updated.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
              {updated.by ? `・${updated.by}` : ''}
            </span>
          )}
        </div>
      </form>

      <section class="card" id="initiatives">
        <div class="card-head">
          <div>
            <h2>今期の施策</h2>
            <p class="card-sub">目標を達成するために今期取り組んでいること。銀行提出用ページの「当期の施策」に載ります</p>
          </div>
          <a class="btn small" href={`/initiatives?fy=${fy}`}>
            資料の添付・編集
          </a>
        </div>
        {initiatives.length > 0 ? (
          <ul class="init-list">
            {initiatives.map((i) => (
              <li>
                <div class="init-main">
                  <b>{i.title}</b>
                  <span class={`badge ${i.status}`}>{STATUS[i.status]}</span>
                  {i.related_accounts && <span class="chip">{i.related_accounts}</span>}
                </div>
                <div class="muted">
                  {i.started_on ? `${i.started_on} 開始` : '開始時期 未設定'}
                  {i.expected_effect ? `・期待効果：${i.expected_effect}` : ''}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">まだ登録がありません。下から追加できます。</p>
        )}
        <form method="post" action="/initiatives" class="stack wide init-add">
          <input type="hidden" name="fy" value={String(fy)} />
          <input type="hidden" name="return" value="targets" />
          <input type="hidden" name="status" value="active" />
          <input type="hidden" name="sort_order" value={String(initiatives.length + 1)} />
          <h3>施策を追加</h3>
          <div class="row">
            <label style="flex:2 1 260px">
              施策名
              <input type="text" name="title" id="init-title" required placeholder="例：卸先の新規開拓" />
            </label>
            <label>
              開始月
              <input type="month" name="started_on" id="init-start" />
            </label>
            <label>
              効く目標
              <select name="related_accounts" id="init-related">
                <option value="">選ばない</option>
                {view.rows
                  .filter((r) => r.kind === 'input')
                  .map((r) => (
                    <option value={r.name}>{r.name}</option>
                  ))}
              </select>
            </label>
          </div>
          <div class="row">
            <label>
              目的
              <input type="text" name="purpose" id="init-purpose" placeholder="例：小売に偏った売上を卸で補う" />
            </label>
            <label>
              期待効果
              <input type="text" name="expected_effect" id="init-effect" placeholder="例：卸の売上を年 200万円増やす" />
            </label>
          </div>
          <div class="form-actions">
            <button class="btn">施策を追加</button>
            <span class="muted">区分・進捗の記入や資料の添付は「施策・添付」画面で行えます</span>
          </div>
        </form>
      </section>
    </>
  );
};
