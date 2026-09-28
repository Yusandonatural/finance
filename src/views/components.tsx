import type { FC } from 'hono/jsx';
import { yen, pct, signedYen } from '../lib/format';
import { adjusted } from '../report/lines';
import type { Line, Report } from '../report/types';

export const Yen: FC<{ v: number | null | undefined; signed?: boolean }> = ({ v, signed }) => (
  <td class={`num${v !== null && v !== undefined && v < 0 ? ' neg' : ''}`}>{v === null || v === undefined ? '—' : signed ? signedYen(v) : yen(v)}</td>
);

/** 全列ゼロの明細行は表示しない（合計行は常に表示） */
function visible(l: Line, _compact = false): boolean {
  const vals = [...l.raw, ...l.adj, ...(l.fyEnd ?? []).map((x) => x ?? 0)];
  const nonZero = vals.some((v) => v !== 0);
  if (l.synthetic) return true;
  // 画面では合計行を常に出す。提出用（compact）では全期間ゼロの合計行も省く
  // 全期間ゼロの行は省く（大区分の合計行だけは残す）
  if (l.isTotal) return nonZero || l.level <= 1;
  return nonZero;
}

function rowClass(l: Line): string {
  return [l.isTotal ? 'total' : '', l.synthetic ? 'synthetic' : '', `lv${Math.min(l.level, 5)}`].filter(Boolean).join(' ');
}

/** P/L・製造原価報告書（画面用：freee 値と補正を並記） */
export const FlowTable: FC<{ lines: Line[]; labels: Report['labels']; compact?: boolean }> = ({ lines, labels, compact }) => (
  <table class="fin">
    <thead>
      <tr>
        <th class="name">科目</th>
        {!compact && <th>freee 値</th>}
        {!compact && <th>棚卸等補正</th>}
        <th>{compact ? labels.cur : '当期（補正後）'}</th>
        <th>{compact ? labels.ly : '前期同期'}</th>
        <th>増減額</th>
        <th>増減率</th>
        <th>{compact ? labels.ly2 : '前々期同期'}</th>
      </tr>
    </thead>
    <tbody>
      {lines.filter((l) => visible(l, compact)).map((l) => {
        const a = adjusted(l);
        return (
          <tr class={rowClass(l)}>
            <td class="name">{l.name}</td>
            {!compact && <Yen v={l.synthetic ? null : l.raw[0]} />}
            {!compact && <Yen v={l.adj[0] || null} signed />}
            <Yen v={a[0]} />
            <Yen v={a[1]} />
            <Yen v={a[0] - a[1]} signed />
            <td class="num">{pct(a[0], a[1])}</td>
            <Yen v={a[2]} />
          </tr>
        );
      })}
    </tbody>
  </table>
);

/** 貸借対照表 */
export const BsTable: FC<{ lines: Line[]; labels: Report['labels']; compact?: boolean }> = ({ lines, labels, compact }) => (
  <table class="fin">
    <thead>
      <tr>
        <th class="name">科目</th>
        {!compact && <th>freee 値</th>}
        {!compact && <th>棚卸等補正</th>}
        <th>{labels.bsCur}{compact ? '' : '（補正後）'}</th>
        <th>{labels.prevFyEnd}</th>
        <th>増減（対前期末）</th>
        <th>{labels.prev2FyEnd}</th>
        <th>{labels.bsLy}{compact ? '' : '（補正後）'}</th>
      </tr>
    </thead>
    <tbody>
      {lines.filter((l) => visible(l, compact)).map((l) => {
        const a = adjusted(l);
        const pe = l.fyEnd?.[0] ?? null;
        return (
          <tr class={rowClass(l)}>
            <td class="name">{l.name}</td>
            {!compact && <Yen v={l.synthetic ? null : l.raw[0]} />}
            {!compact && <Yen v={l.adj[0] || null} signed />}
            <Yen v={a[0]} />
            <Yen v={pe} />
            <Yen v={pe === null ? null : a[0] - pe} signed />
            <Yen v={l.fyEnd?.[1] ?? null} />
            <Yen v={a[1]} />
          </tr>
        );
      })}
    </tbody>
  </table>
);

export const BridgeTable: FC<{ r: Report }> = ({ r }) => (
  <table class="fin bridge">
    <tbody>
      <tr>
        <td class="name">freee 上の当期純損益（期末棚卸 0 のまま）</td>
        <Yen v={r.bridge.rawNetIncome} />
      </tr>
      {r.bridge.items.map((i) => (
        <tr>
          <td class="name">　{i.label}</td>
          <Yen v={i.amount} signed />
        </tr>
      ))}
      <tr class="total">
        <td class="name">補正後の当期純損益</td>
        <Yen v={r.bridge.adjustedNetIncome} />
      </tr>
    </tbody>
  </table>
);

export const InventoryTable: FC<{ r: Report }> = ({ r }) => {
  const cats = ['product', 'wip', 'material', 'goods'] as const;
  const label = { product: '製品', wip: '仕掛品（荒茶など）', material: '原材料', goods: '商品' };
  const src = { carry_forward: '据置', manual: '実地簡易', actual: '実地（決算）' };
  const cur = r.inventory[0];
  return (
    <table class="fin">
      <thead>
        <tr>
          <th class="name">区分</th>
          <th>期首棚卸高</th>
          <th>月末棚卸（使用値）</th>
          <th>根拠</th>
          <th>前期同期 月末</th>
          <th>前々期同期 月末</th>
        </tr>
      </thead>
      <tbody>
        {cats
          .filter((k) => cur.opening[k] || cur.closing[k] || r.inventory[1].closing[k] || r.inventory[2].closing[k])
          .map((k) => (
            <tr>
              <td class="name">{label[k]}</td>
              <Yen v={cur.opening[k]} />
              <Yen v={cur.closing[k]} />
              <td>{src[cur.source[k]]}</td>
              <Yen v={r.inventory[1].closing[k]} />
              <Yen v={r.inventory[2].closing[k]} />
            </tr>
          ))}
        <tr class="total">
          <td class="name">合計</td>
          <Yen v={cats.reduce((a, k) => a + cur.opening[k], 0)} />
          <Yen v={cats.reduce((a, k) => a + cur.closing[k], 0)} />
          <td></td>
          <Yen v={cats.reduce((a, k) => a + r.inventory[1].closing[k], 0)} />
          <Yen v={cats.reduce((a, k) => a + r.inventory[2].closing[k], 0)} />
        </tr>
      </tbody>
    </table>
  );
};

export const MonthlyTable: FC<{ r: Report }> = ({ r }) => (
  <table class="fin monthly">
    <thead>
      <tr>
        <th class="name">項目</th>
        <th class="name">期</th>
        {r.monthly.months.map((m) => (
          <th>{m.label}</th>
        ))}
        <th>累計</th>
      </tr>
    </thead>
    <tbody>
      {r.monthly.series.map((s) =>
        (['当期', '前期', '前々期'] as const).map((p, c) => (
          <tr class={c === 0 ? 'first' : 'sub'}>
            <td class="name">{c === 0 ? s.name : ''}</td>
            <td class="name">{p}</td>
            {s.values.map((v) => (
              <Yen v={v ? v[c] : null} />
            ))}
            <Yen v={s.values.reduce((a, v) => a + (v ? v[c] : 0), 0)} />
          </tr>
        )),
      )}
    </tbody>
  </table>
);

export const PastFyTable: FC<{ r: Report }> = ({ r }) => (
  <table class="fin">
    <thead>
      <tr>
        <th class="name">決算期</th>
        <th>売上高</th>
        <th>売上総利益</th>
        <th>営業利益</th>
        <th>経常利益</th>
        <th>当期純利益</th>
        <th>純資産</th>
        <th>棚卸資産</th>
        <th>借入金</th>
        <th>役員借入金</th>
      </tr>
    </thead>
    <tbody>
      {r.pastFy.map((p) => (
        <tr>
          <td class="name">{p.label}</td>
          <Yen v={p.sales} />
          <Yen v={p.grossProfit} />
          <Yen v={p.operatingIncome} />
          <Yen v={p.ordinaryIncome} />
          <Yen v={p.netIncome} />
          <Yen v={p.netAssets} />
          <Yen v={p.inventory} />
          <Yen v={p.borrowings} />
          <Yen v={p.officerLoans} />
        </tr>
      ))}
    </tbody>
  </table>
);

export const SensitivityTable: FC<{ r: Report }> = ({ r }) => (
  <table class="fin">
    <thead>
      <tr>
        <th class="name">見積方法</th>
        <th>月末棚卸 合計</th>
        <th>当期純損益</th>
        <th class="name">備考</th>
      </tr>
    </thead>
    <tbody>
      {r.sensitivity.map((s) => (
        <tr class={s.adopted ? 'total' : ''}>
          <td class="name">
            {s.label}
            {s.adopted ? '（採用）' : ''}
          </td>
          <Yen v={s.inventory} />
          <Yen v={s.netIncome} />
          <td class="name note">{s.note}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const Checks: FC<{ r: Report }> = ({ r }) => (
  <ul class="checks">
    {r.checks.map((c) => (
      <li class={c.ok ? 'ok' : c.severity} title={c.detail}>
        <span class="mark">{c.ok ? '✓' : c.severity === 'error' ? '✕' : '!'}</span>
        <b>{c.label}</b>
        {!c.ok && <span class="muted">{c.detail}</span>}
      </li>
    ))}
  </ul>
);
