import type { FC } from 'hono/jsx';
import type { Attachment, Initiative, Loan } from '../db';
import { monthLabel } from '../lib/fiscal';
import { yen } from '../lib/format';
import { adjusted, findTotal } from '../report/lines';
import type { Report } from '../report/types';
import { BridgeTable, BsTable, FlowTable, InventoryTable, MonthlyTable, PastFyTable, SensitivityTable, Yen } from './components';

export interface PackageData {
  report: Report;
  initiatives: Initiative[];
  attachments: Attachment[];
  loans: Loan[];
}

const STATUS = { planned: '予定', active: '実施中', done: '完了' } as const;

const Page: FC<{ title: string; no: number; cls?: string; children?: unknown }> = ({ title, no, cls, children }) => (
  <section class={`sheet ${cls ?? ''}`}>
    <h2>
      <span class="no">{no}.</span> {title}
    </h2>
    {children as never}
  </section>
);

export const PrintView: FC<{ data: PackageData; version: number | null; createdAt: string | null }> = ({ data, version, createdAt }) => {
  const r = data.report;
  const m = r.meta;
  const title = `月次試算表 ${monthLabel(m.fy, m.fyStartMonth, m.month)}末`;
  const errors = r.checks.filter((c) => !c.ok && c.severity === 'error');
  const netAssets = findTotal(r.bs, '純資産');
  const officer = r.bs.find((l) => !l.isTotal && l.name.includes('役員借入金'));
  const na = netAssets ? adjusted(netAssets)[0] : null;
  const ol = officer ? adjusted(officer)[0] : null;
  const naPrev = netAssets?.fyEnd?.[0] ?? null;
  const olPrev = officer?.fyEnd?.[0] ?? null;
  const commonAtt = data.attachments.filter((a) => a.initiative_id === null);
  const dateStr = new Date(createdAt ?? r.meta.generatedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' });
  let no = 0;
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <title>{`${m.companyName} ${title}`}</title>
        <link rel="stylesheet" href="/print.css" />
      </head>
      <body>
        <div class="toolbar noprint">
          <button onclick="window.print()">印刷 / PDF に保存</button>
          <span>{version ? `確定版 第${version}版` : '下書き（未確定）'}</span>
          {errors.length > 0 && <span class="err">検算エラーがあります</span>}
        </div>
        {!version && <div class="watermark">下書き</div>}

        <section class="sheet cover">
          <p class="company">{m.companyName}</p>
          <h1>{title}</h1>
          <p class="period">{m.periodLabel}</p>
          <table class="meta">
            <tbody>
              <tr>
                <th>作成日</th>
                <td>{dateStr}</td>
              </tr>
              <tr>
                <th>版</th>
                <td>{version ? `第${version}版` : '下書き'}</td>
              </tr>
              <tr>
                <th>出典</th>
                <td>freee 会計（{m.fetchedAt ? new Date(m.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—'} 取得、集計{m.upToDate ? '完了' : '未完了'}）</td>
              </tr>
              <tr>
                <th>月末棚卸</th>
                <td>{m.method === 'manual' ? '実地簡易棚卸（未入力区分は期首棚卸高を据置）' : '期首棚卸高を据置（据置法）'}</td>
              </tr>
            </tbody>
          </table>
          <h3>作成基準</h3>
          <ol class="notes">
            {r.notes.map((n) => (
              <li>{n}</li>
            ))}
          </ol>
          <h3>目次</h3>
          <ol class="toc">
            <li>損益計算書（累計・3期比較）</li>
            <li>製造原価報告書（累計・3期比較）</li>
            <li>貸借対照表</li>
            <li>月次推移</li>
            <li>月末棚卸の見積と補正</li>
            <li>借入金明細</li>
            <li>当期の施策と添付資料</li>
            <li>過去の決算</li>
          </ol>
        </section>

        <Page title="損益計算書（累計・3期比較）" no={++no}>
          <p class="sub">単位：円　棚卸補正後（作成基準 参照）</p>
          <FlowTable lines={r.pl} labels={r.labels} compact />
        </Page>
        <Page title="製造原価報告書（累計・3期比較）" no={++no}>
          <p class="sub">単位：円　棚卸補正後</p>
          <FlowTable lines={r.cr} labels={r.labels} compact />
        </Page>
        <Page title="貸借対照表" no={++no}>
          <p class="sub">単位：円　当月末は棚卸補正後、前期末・前々期末は決算確定値</p>
          <BsTable lines={r.bs} labels={r.labels} compact />
        </Page>
        <Page title="月次推移" no={++no} cls="landscape">
          <p class="sub">単位：円　棚卸補正は期首月の期首棚卸振替の戻しとして反映</p>
          <MonthlyTable r={r} />
        </Page>
        <Page title="月末棚卸の見積と補正" no={++no}>
          <h3>月末棚卸</h3>
          <InventoryTable r={r} />
          <h3>当期純損益への影響（freee 値からの増減）</h3>
          <BridgeTable r={r} />
          <h3>見積方法による違い（参考）</h3>
          <SensitivityTable r={r} />
        </Page>
        <Page title="借入金明細" no={++no}>
          <h3>勘定科目別残高</h3>
          <table class="fin">
            <thead>
              <tr>
                <th class="name">勘定科目</th>
                <th>{r.labels.bsCur}</th>
                <th>{r.labels.prevFyEnd}</th>
                <th>増減</th>
              </tr>
            </thead>
            <tbody>
              {r.borrowings.map((b) => (
                <tr>
                  <td class="name">{b.name}</td>
                  <Yen v={b.cur} />
                  <Yen v={b.prevFyEnd} />
                  <Yen v={b.prevFyEnd === null ? null : b.cur - b.prevFyEnd} signed />
                </tr>
              ))}
            </tbody>
          </table>
          {data.loans.length > 0 && (
            <>
              <h3>借入先別</h3>
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
                  </tr>
                </thead>
                <tbody>
                  {data.loans.map((l) => (
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {na !== null && ol !== null && (
            <>
              <h3>役員借入金を含めた実質純資産（参考）</h3>
              <table class="fin">
                <thead>
                  <tr>
                    <th class="name"></th>
                    <th>{r.labels.bsCur}</th>
                    <th>{r.labels.prevFyEnd}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="name">純資産</td>
                    <Yen v={na} />
                    <Yen v={naPrev} />
                  </tr>
                  <tr>
                    <td class="name">役員借入金</td>
                    <Yen v={ol} />
                    <Yen v={olPrev} />
                  </tr>
                  <tr class="total">
                    <td class="name">実質純資産</td>
                    <Yen v={na + ol} />
                    <Yen v={naPrev === null || olPrev === null ? null : naPrev + olPrev} />
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </Page>
        <Page title="当期の施策と添付資料" no={++no}>
          {data.initiatives.length === 0 && <p class="sub">登録なし</p>}
          {data.initiatives.map((i, idx) => (
            <div class="initiative">
              <h3>
                {idx + 1}. {i.title}（{STATUS[i.status]}
                {i.started_on ? `・${i.started_on} 開始` : ''}）
              </h3>
              <table class="kv">
                <tbody>
                  {i.category && (
                    <tr>
                      <th>区分</th>
                      <td>{i.category}</td>
                    </tr>
                  )}
                  {i.purpose && (
                    <tr>
                      <th>目的</th>
                      <td>{i.purpose}</td>
                    </tr>
                  )}
                  {i.related_accounts && (
                    <tr>
                      <th>関連科目</th>
                      <td>{i.related_accounts}</td>
                    </tr>
                  )}
                  {i.expected_effect && (
                    <tr>
                      <th>期待効果</th>
                      <td>{i.expected_effect}</td>
                    </tr>
                  )}
                  {i.progress && (
                    <tr>
                      <th>進捗</th>
                      <td>{i.progress}</td>
                    </tr>
                  )}
                  {data.attachments.some((a) => a.initiative_id === i.id) && (
                    <tr>
                      <th>添付</th>
                      <td>
                        {data.attachments
                          .filter((a) => a.initiative_id === i.id)
                          .map((a) => a.title)
                          .join('、')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
          {commonAtt.length > 0 && (
            <>
              <h3>添付資料</h3>
              <ol>
                {commonAtt.map((a) => (
                  <li>
                    {a.title}（{a.filename}）
                  </li>
                ))}
              </ol>
            </>
          )}
          <p class="sub">添付資料は本資料とあわせて別ファイルでお渡しします。</p>
        </Page>
        <Page title="過去の決算" no={++no}>
          <p class="sub">単位：円　決算確定値</p>
          <PastFyTable r={r} />
          <p class="sub">減価償却費（年）：{r.pastFy.map((p) => `${p.fy}年度 ${yen(p.depreciation)}`).join('、')}</p>
        </Page>
      </body>
    </html>
  );
};
