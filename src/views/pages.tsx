import type { FC } from 'hono/jsx';
import type { Attachment, Initiative, InventoryInput, Loan } from '../db';
import type { FreeeFiscalYear } from '../freee/types';
import { fyLabel, lastMonth, monthLabel, monthsUpTo } from '../lib/fiscal';
import { pct, yen } from '../lib/format';
import { findTotal, adjusted } from '../report/lines';
import type { Report } from '../report/types';
import { BridgeTable, BsTable, Checks, FlowTable, InventoryTable, MonthlyTable, PastFyTable, SensitivityTable, Yen } from './components';

type Period = { fy: number; month: number; fetchedAt: string; upToDate: boolean };

export const PeriodSelect: FC<{ periods: Period[]; fy: number; month: number; action: string; fys: FreeeFiscalYear[] }> = ({ periods, fy, month, action, fys }) => {
  const sm = (y: number) => Number(fys.find((f) => f.fy === y)?.start_date.slice(5, 7) ?? 3);
  return (
    <form method="get" action={action} class="period">
      <select name="p" onchange="this.form.submit()">
        {periods.map((p) => (
          <option value={`${p.fy}-${p.month}`} selected={p.fy === fy && p.month === month}>
            {monthLabel(p.fy, sm(p.fy), p.month)}末（{p.fy}年度）
          </option>
        ))}
      </select>
      <noscript>
        <button>表示</button>
      </noscript>
    </form>
  );
};

const Kpi: FC<{ label: string; cur: number; ly: number }> = ({ label, cur, ly }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-val${cur < 0 ? ' neg' : ''}`}>{yen(cur)}</div>
    <div class="k-sub">
      前期同期 {yen(ly)}（{pct(cur, ly)}）
    </div>
  </div>
);

export const ReportPage: FC<{ r: Report; periods: Period[]; fys: FreeeFiscalYear[] }> = ({ r, periods, fys }) => {
  const t = (cat: string) => {
    const l = findTotal(r.pl, cat);
    return l ? adjusted(l) : [0, 0, 0];
  };
  const errors = r.checks.filter((c) => !c.ok && c.severity === 'error');
  const q = `fy=${r.meta.fy}&month=${r.meta.month}`;
  return (
    <>
      <div class="pagehead">
        <div>
          <h1>{monthLabel(r.meta.fy, r.meta.fyStartMonth, r.meta.month)}末 試算表</h1>
          <p class="muted">
            {r.meta.periodLabel} ／ 棚卸：{r.meta.method === 'manual' ? '実地簡易棚卸' : '据置法'} ／ 減価償却月割：{r.meta.depreciationEnabled ? 'あり' : 'なし'} ／ freee 取込{' '}
            {r.meta.fetchedAt ? new Date(r.meta.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—'}
          </p>
        </div>
        <PeriodSelect periods={periods} fy={r.meta.fy} month={r.meta.month} action="/report" fys={fys} />
      </div>
      <div class="actions">
        <a class="btn primary" href={`/print?${q}`} target="_blank">
          銀行提出用ページを開く（印刷・PDF）
        </a>
        <a class="btn" href={`/adjust?${q}`}>
          棚卸補正を変更
        </a>
        <form method="post" action="/packages" class="inline">
          <input type="hidden" name="fy" value={String(r.meta.fy)} />
          <input type="hidden" name="month" value={String(r.meta.month)} />
          <button class="btn" disabled={errors.length > 0} title={errors.length ? '検算エラーがあるため確定できません' : ''}>
            この内容で確定（提出履歴に保存）
          </button>
        </form>
      </div>

      <section class="kpis">
        <Kpi label="売上高" cur={t('売上高')[0]} ly={t('売上高')[1]} />
        <Kpi label="売上総利益" cur={t('売上総損益金額')[0]} ly={t('売上総損益金額')[1]} />
        <Kpi label="営業利益" cur={t('営業損益金額')[0]} ly={t('営業損益金額')[1]} />
        <Kpi label="経常利益" cur={t('経常損益金額')[0]} ly={t('経常損益金額')[1]} />
      </section>

      <div class="grid2">
        <section>
          <h2>棚卸補正のブリッジ</h2>
          <BridgeTable r={r} />
        </section>
        <section>
          <h2>検算</h2>
          <Checks r={r} />
        </section>
      </div>

      <section>
        <h2>月末棚卸</h2>
        <InventoryTable r={r} />
      </section>

      <nav class="toc">
        <a href="#pl">損益計算書</a> <a href="#cr">製造原価報告書</a> <a href="#bs">貸借対照表</a> <a href="#monthly">月次推移</a> <a href="#sens">見積方法の比較</a> <a href="#past">過去の決算</a> <a href="#notes">作成基準</a>
      </nav>
      <section id="pl">
        <h2>損益計算書（累計）</h2>
        <p class="muted">
          {r.labels.cur} ／ {r.labels.ly} ／ {r.labels.ly2}
        </p>
        <div class="scroll">
          <FlowTable lines={r.pl} labels={r.labels} />
        </div>
      </section>
      <section id="cr">
        <h2>製造原価報告書（累計）</h2>
        <div class="scroll">
          <FlowTable lines={r.cr} labels={r.labels} />
        </div>
      </section>
      <section id="bs">
        <h2>貸借対照表</h2>
        <div class="scroll">
          <BsTable lines={r.bs} labels={r.labels} />
        </div>
      </section>
      <section id="monthly">
        <h2>月次推移（補正後）</h2>
        <div class="scroll">
          <MonthlyTable r={r} />
        </div>
      </section>
      <section id="sens">
        <h2>見積方法の比較（感応度）</h2>
        <SensitivityTable r={r} />
      </section>
      <section id="past">
        <h2>過去の決算</h2>
        <div class="scroll">
          <PastFyTable r={r} />
        </div>
      </section>
      <section id="notes">
        <h2>作成基準（注記）</h2>
        <ol class="notes">
          {r.notes.map((n) => (
            <li>{n}</li>
          ))}
        </ol>
      </section>
    </>
  );
};

export const EmptyPage: FC<{ connected: boolean }> = ({ connected }) => (
  <section>
    <h1>まだ試算表がありません</h1>
    <p>freee からデータを取り込むと、ここに試算表が表示されます。</p>
    <a class="btn primary" href="/sync">
      {connected ? '取込画面へ' : 'freee と接続する'}
    </a>
  </section>
);

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
      <h1>freee から取込</h1>
      <section>
        <h2>freee 接続</h2>
        {status.connected ? (
          <p>
            <span class="badge ok">接続済み</span> 最終更新 {status.updatedAt ? new Date(status.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : ''}
          </p>
        ) : (
          <p>
            <span class="badge warn">未接続</span> {status.error}
          </p>
        )}
        {configured ? (
          <a class="btn" href="/auth/freee/start">
            {status.connected ? 'freee と再接続' : 'freee と接続'}
          </a>
        ) : (
          <p class="muted">freee の Client ID / Secret と TOKEN_ENC_KEY が未設定です（README の「初回セットアップ」参照）。</p>
        )}
      </section>
      <section>
        <h2>取り込む月</h2>
        <form method="post" action="/sync" class="stack">
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
            対象月（期首からこの月末までの累計）
            <select name="month">
              {monthsUpTo(sm(suggest.fy), lastMonth(sm(suggest.fy))).map((m) => (
                <option value={String(m)} selected={m === suggest.month}>
                  {m}月
                </option>
              ))}
            </select>
          </label>
          <label class="check">
            <input type="checkbox" name="force" value="1" /> 前期以前の決算データも取り直す
          </label>
          <button class="btn primary" disabled={!status.connected}>
            取り込む
          </button>
        </form>
        <p class="muted">1回の取込で freee API を 10〜25 回呼び出します（数秒〜十数秒）。毎月5日の早朝にも前月分を自動で取り込みます。</p>
        {dev && (
          <form method="post" action="/dev/seed">
            <button class="btn">開発用：デモデータ（2026年8月）を投入</button>
          </form>
        )}
      </section>
      <section>
        <h2>取込済みの月</h2>
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
                <td class="name">{new Date(p.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                <td class="name">{p.upToDate ? '完了' : '集計中'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>操作履歴</h2>
        <ul class="log">
          {logs.map((l) => (
            <li>
              {new Date(l.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} {l.actor} <b>{l.action}</b> <span class="muted">{l.detail_json}</span>
            </li>
          ))}
        </ul>
      </section>
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
      <div class="pagehead">
        <h1>棚卸補正 {monthLabel(r.meta.fy, r.meta.fyStartMonth, r.meta.month)}末</h1>
        <PeriodSelect periods={periods} fy={r.meta.fy} month={r.meta.month} action="/adjust" fys={fys} />
      </div>
      <form method="post" action="/adjust" class="stack wide">
        <input type="hidden" name="fy" value={String(r.meta.fy)} />
        <input type="hidden" name="month" value={String(r.meta.month)} />
        <section>
          <h2>月末棚卸の見積方法</h2>
          <label class="radio">
            <input type="radio" name="method" value="carry_forward" checked={settings.method !== 'manual'} /> <b>据置法（標準）</b>
            ：期首棚卸高（前期末の実地棚卸高）と同額が月末にもあるとみなす
          </label>
          <label class="radio">
            <input type="radio" name="method" value="manual" checked={settings.method === 'manual'} /> <b>実地簡易棚卸</b>
            ：下の表に入力した区分だけ入力値を使い、入力しない区分は据置
          </label>
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
                      <input type="text" name={`unit_${k}`} value={i?.unit ?? unit} size={4} />
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
          <p class="muted">金額が空欄で数量と単価があれば、数量×単価で計算します。すべて空欄にすると入力を削除します。</p>
        </section>
        <section>
          <h2>減価償却費の月割</h2>
          <label class="check">
            <input type="checkbox" name="dep" value="1" checked={settings.depreciationEnabled} /> 月割の見積額を計上する
          </label>
          <label>
            月額（空欄なら前期実績÷12 = {autoMonthlyDep === null ? '前期データなし' : `${yen(autoMonthlyDep)}円`}）
            <input type="number" name="dep_monthly" value={settings.depreciationMonthly ?? ''} />
          </label>
        </section>
        <section>
          <h2>メモ</h2>
          <textarea name="note" rows={3}>
            {settings.note ?? ''}
          </textarea>
        </section>
        <button class="btn primary">保存して再計算</button>
      </form>
      <section>
        <h2>現在の計算結果</h2>
        <InventoryTable r={r} />
        <h3>当期純損益への影響</h3>
        <BridgeTable r={r} />
        <h3>見積方法の比較</h3>
        <SensitivityTable r={r} />
      </section>
    </>
  );
};

const STATUS = { planned: '予定', active: '実施中', done: '完了' } as const;

export const InitiativesPage: FC<{ fy: number; fys: FreeeFiscalYear[]; items: Initiative[]; attachments: Attachment[]; edit: Initiative | null }> = ({ fy, fys, items, attachments, edit }) => {
  const sm = Number(fys.find((f) => f.fy === fy)?.start_date.slice(5, 7) ?? 3);
  const common = attachments.filter((a) => a.initiative_id === null);
  return (
    <>
      <div class="pagehead">
        <h1>当期の施策・添付資料</h1>
        <form method="get" action="/initiatives" class="period">
          <select name="fy" onchange="this.form.submit()">
            {(fys.length ? fys.map((f) => f.fy).reverse() : [fy]).map((y) => (
              <option value={String(y)} selected={y === fy}>
                {fyLabel(y, Number(fys.find((f) => f.fy === y)?.start_date.slice(5, 7) ?? 3))}
              </option>
            ))}
          </select>
        </form>
      </div>
      <p class="muted">{fyLabel(fy, sm)} に新しく始めた施策です。銀行提出用ページに一覧と添付資料名が載ります。</p>
      {items.map((i) => (
        <section class="card">
          <div class="card-head">
            <h2>
              {i.title} <span class={`badge ${i.status}`}>{STATUS[i.status]}</span>
            </h2>
            <div>
              <a class="btn small" href={`/initiatives?fy=${fy}&edit=${i.id}#form`}>
                編集
              </a>
              <form method="post" action={`/initiatives/${i.id}/delete`} class="inline" onsubmit="return confirm('削除しますか？')">
                <input type="hidden" name="fy" value={String(fy)} />
                <button class="btn small danger">削除</button>
              </form>
            </div>
          </div>
          <dl class="kv">
            <dt>開始</dt>
            <dd>{i.started_on ?? '—'}</dd>
            <dt>区分</dt>
            <dd>{i.category ?? '—'}</dd>
            <dt>目的</dt>
            <dd>{i.purpose ?? '—'}</dd>
            <dt>関連科目</dt>
            <dd>{i.related_accounts ?? '—'}</dd>
            <dt>期待効果</dt>
            <dd>{i.expected_effect ?? '—'}</dd>
            <dt>進捗</dt>
            <dd>{i.progress ?? '—'}</dd>
          </dl>
          <AttachmentList items={attachments.filter((a) => a.initiative_id === i.id)} fy={fy} />
          <UploadForm fy={fy} initiativeId={i.id} />
        </section>
      ))}
      <section id="form" class="card">
        <h2>{edit ? '施策を編集' : '施策を追加'}</h2>
        <form method="post" action="/initiatives" class="stack wide">
          <input type="hidden" name="fy" value={String(fy)} />
          {edit && <input type="hidden" name="id" value={String(edit.id)} />}
          <label>
            施策名 <input type="text" name="title" required value={edit?.title ?? ''} />
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
                {(['planned', 'active', 'done'] as const).map((s) => (
                  <option value={s} selected={(edit?.status ?? 'active') === s}>
                    {STATUS[s]}
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
          <label>
            期待効果 <textarea name="expected_effect" rows={2}>{edit?.expected_effect ?? ''}</textarea>
          </label>
          <label>
            進捗・実績 <textarea name="progress" rows={2}>{edit?.progress ?? ''}</textarea>
          </label>
          <button class="btn primary">{edit ? '更新' : '追加'}</button>
        </form>
      </section>
      <section class="card">
        <h2>年度共通の添付資料（事業計画書など）</h2>
        <AttachmentList items={common} fy={fy} />
        <UploadForm fy={fy} initiativeId={null} />
      </section>
    </>
  );
};

const AttachmentList: FC<{ items: Attachment[]; fy: number }> = ({ items, fy }) =>
  items.length ? (
    <ul class="files">
      {items.map((a) => (
        <li>
          <a href={`/files/${a.id}`} target="_blank">
            {a.title}
          </a>{' '}
          <span class="muted">
            {a.filename}（{Math.ceil((a.size ?? 0) / 1024).toLocaleString()} KB）
          </span>
          <form method="post" action={`/attachments/${a.id}/delete`} class="inline" onsubmit="return confirm('添付を削除しますか？')">
            <input type="hidden" name="fy" value={String(fy)} />
            <button class="btn small danger">削除</button>
          </form>
        </li>
      ))}
    </ul>
  ) : (
    <p class="muted">添付なし</p>
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
    <h1>借入金明細</h1>
    <section>
      <h2>freee の借入金残高（最新の取込月）</h2>
      {borrowings ? (
        <table class="fin">
          <thead>
            <tr>
              <th class="name">勘定科目</th>
              <th>当月末</th>
              <th>前期末</th>
            </tr>
          </thead>
          <tbody>
            {borrowings.map((b) => (
              <tr>
                <td class="name">{b.name}</td>
                <Yen v={b.cur} />
                <Yen v={b.prevFyEnd} />
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted">取込済みの月がありません</p>
      )}
    </section>
    <section>
      <h2>借入先ごとの条件</h2>
      <p class="muted">freee は勘定科目単位の残高しか持たないため、借入先・金利・返済額はここに入力します。銀行提出用ページに載ります。</p>
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
              <td class="name">{l.lender}</td>
              <td class="name">{l.account_name ?? ''}</td>
              <Yen v={l.principal} />
              <td class="num">{l.rate === null ? '—' : `${l.rate}%`}</td>
              <td class="name">{l.started_on ?? ''}</td>
              <td class="name">{l.ends_on ?? ''}</td>
              <Yen v={l.monthly_payment} />
              <Yen v={l.balance_override} />
              <td class="name">{l.note ?? ''}</td>
              <td>
                <a class="btn small" href={`/loans?edit=${l.id}#form`}>
                  編集
                </a>
                <form method="post" action={`/loans/${l.id}/delete`} class="inline" onsubmit="return confirm('削除しますか？')">
                  <button class="btn small danger">削除</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
    <section id="form" class="card">
      <h2>{edit ? '借入を編集' : '借入を追加'}</h2>
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
        <button class="btn primary">{edit ? '更新' : '追加'}</button>
      </form>
    </section>
  </>
);

export const HistoryPage: FC<{ items: { id: number; fy: number; month: number; version: number; submitted_to: string | null; submitted_on: string | null; memo: string | null; created_by: string | null; created_at: string }[]; fys: FreeeFiscalYear[] }> = ({ items, fys }) => {
  const sm = (y: number) => Number(fys.find((f) => f.fy === y)?.start_date.slice(5, 7) ?? 3);
  return (
    <>
      <h1>提出履歴</h1>
      <p class="muted">「この内容で確定」した試算表パッケージです。確定後に freee の数値や補正を変えても、ここに保存した版は変わりません。</p>
      <table class="fin">
        <thead>
          <tr>
            <th class="name">対象月</th>
            <th>版</th>
            <th class="name">確定日時</th>
            <th class="name">確定者</th>
            <th class="name">提出先・提出日・メモ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr>
              <td class="name">{monthLabel(p.fy, sm(p.fy), p.month)}末</td>
              <td class="num">第{p.version}版</td>
              <td class="name">{new Date(p.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
              <td class="name">{p.created_by ?? ''}</td>
              <td class="name">
                <form method="post" action={`/packages/${p.id}`} class="upload">
                  <input type="text" name="submitted_to" value={p.submitted_to ?? ''} placeholder="提出先（例：南都銀行 ○○支店）" />
                  <input type="date" name="submitted_on" value={p.submitted_on ?? ''} />
                  <input type="text" name="memo" value={p.memo ?? ''} placeholder="メモ" />
                  <button class="btn small">保存</button>
                </form>
              </td>
              <td>
                <a class="btn small" href={`/print/package/${p.id}`} target="_blank">
                  開く
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};
