/**
 * サーバー側で描く小さな SVG グラフ。
 * 色は CSS 変数（--series-cur / --series-prev など）で指定し、ライト・ダークは app.css で切り替える。
 * 配色は dataviz の検証スクリプトで確認済み（light: #237a4f / #d09a45、dark: #1a7a48 / #bf8a2a）。
 * ホバー時の数値は data-tip 属性に入れ、public/app.js がツールチップとして表示する。
 */
import { yen } from '../lib/format';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** 軸目盛り用の短い表記（万円・億円） */
export function compactYen(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '▲' : '';
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(a % 1e8 === 0 ? 0 : 1)}億`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('ja-JP')}万`;
  return `${sign}${a.toLocaleString('ja-JP')}`;
}

function niceStep(range: number, target = 4): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function scaleDomain(values: number[]): { lo: number; hi: number; ticks: number[] } {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const step = niceStep(max - min || 1);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { lo, hi: hi === lo ? lo + step : hi, ticks };
}

/** 上（正）または下（負）の端だけ 4px 角丸にした棒 */
function barPath(x: number, w: number, yZero: number, yVal: number, r = 4): string {
  const h = Math.abs(yVal - yZero);
  const rr = Math.min(r, w / 2, h);
  if (h < 0.5) return '';
  if (yVal < yZero) {
    // 正の値：上端を丸める
    return `M${x},${yZero}V${yVal + rr}Q${x},${yVal} ${x + rr},${yVal}H${x + w - rr}Q${x + w},${yVal} ${x + w},${yVal + rr}V${yZero}Z`;
  }
  return `M${x},${yZero}V${yVal - rr}Q${x},${yVal} ${x + rr},${yVal}H${x + w - rr}Q${x + w},${yVal} ${x + w},${yVal - rr}V${yZero}Z`;
}

export interface GroupedBarInput {
  categories: string[];
  series: { name: string; cls: string; values: (number | null)[] }[];
  /** 数値ラベルを付ける棒（系列 index, カテゴリ index） */
  label?: [number, number];
  height?: number;
  ariaLabel: string;
}

/** 月別の比較棒グラフ（当期・前期） */
export function groupedBars(input: GroupedBarInput): string {
  const W = 520;
  const H = input.height ?? 230;
  const m = { t: 24, r: 6, b: 28, l: 50 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const all = input.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const { lo, hi, ticks } = scaleDomain(all);
  const y = (v: number) => m.t + ((hi - v) / (hi - lo)) * ih;
  const n = input.categories.length;
  const band = iw / Math.max(n, 1);
  const k = input.series.length;
  const barW = Math.min(22, (band * 0.62 - 2 * (k - 1)) / k);
  const groupW = barW * k + 2 * (k - 1);
  const parts: string[] = [];
  parts.push(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(input.ariaLabel)}" preserveAspectRatio="xMidYMid meet">`);
  for (const t of ticks) {
    const yy = y(t);
    parts.push(`<line class="${t === 0 ? 'axis-zero' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`);
    parts.push(`<text class="tick" x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${esc(compactYen(t))}</text>`);
  }
  input.categories.forEach((cat, i) => {
    const gx = m.l + band * i + (band - groupW) / 2;
    input.series.forEach((s, si) => {
      const v = s.values[i];
      if (v === null || v === undefined) return;
      const d = barPath(gx + si * (barW + 2), barW, y(0), y(v));
      if (d) parts.push(`<path class="bar ${s.cls}" d="${d}"/>`);
      if (input.label && input.label[0] === si && input.label[1] === i) {
        const ly = v >= 0 ? y(v) - 6 : y(v) + 14;
        parts.push(`<text class="dlabel" x="${gx + si * (barW + 2) + barW / 2}" y="${ly}" text-anchor="middle">${esc(compactYen(v))}</text>`);
      }
    });
    parts.push(`<text class="tick" x="${m.l + band * i + band / 2}" y="${H - 8}" text-anchor="middle">${esc(cat)}</text>`);
    const tip = [`<b>${esc(cat)}</b>`, ...input.series.map((s) => `<span class="sw ${s.cls}"></span>${esc(s.name)} <b>${esc(yen(s.values[i]))}</b>`)].join('<br>');
    parts.push(`<rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" data-tip="${esc(tip)}"/>`);
  });
  parts.push('</svg>');
  return parts.join('');
}

export interface WaterfallStep {
  label: string;
  value: number;
  kind: 'total' | 'delta';
}

/** 当期純損益のブリッジ（滝グラフ） */
export function waterfall(steps: WaterfallStep[], ariaLabel: string): string {
  const W = 520;
  const H = 250;
  const m = { t: 26, r: 6, b: 44, l: 50 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  let run = 0;
  const bars = steps.map((s) => {
    if (s.kind === 'total') {
      run = s.value;
      return { ...s, from: 0, to: s.value };
    }
    const from = run;
    run += s.value;
    return { ...s, from, to: run };
  });
  const { lo, hi, ticks } = scaleDomain(bars.flatMap((b) => [b.from, b.to]));
  const y = (v: number) => m.t + ((hi - v) / (hi - lo)) * ih;
  const band = iw / steps.length;
  const bw = Math.min(46, band * 0.56);
  const parts: string[] = [`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}" preserveAspectRatio="xMidYMid meet">`];
  for (const t of ticks) {
    const yy = y(t);
    parts.push(`<line class="${t === 0 ? 'axis-zero' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`);
    parts.push(`<text class="tick" x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${esc(compactYen(t))}</text>`);
  }
  bars.forEach((b, i) => {
    const x = m.l + band * i + (band - bw) / 2;
    const top = y(Math.max(b.from, b.to));
    const bot = y(Math.min(b.from, b.to));
    const cls = b.kind === 'total' ? (i === 0 ? 'wf-start' : 'wf-end') : b.value >= 0 ? 'wf-up' : 'wf-down';
    parts.push(`<rect class="bar ${cls}" x="${x}" y="${top}" width="${bw}" height="${Math.max(bot - top, 1)}" rx="3"/>`);
    if (i < bars.length - 1) {
      const yy = y(b.to);
      parts.push(`<line class="wf-link" x1="${x + bw}" x2="${m.l + band * (i + 1) + (band - bw) / 2}" y1="${yy}" y2="${yy}"/>`);
    }
    const labelV = b.kind === 'total' ? yen(b.value) : `${b.value >= 0 ? '+' : ''}${yen(b.value)}`;
    const ly = b.to >= b.from ? top - 7 : bot + 14;
    parts.push(`<text class="dlabel" x="${x + bw / 2}" y="${ly}" text-anchor="middle">${esc(compactYen(b.value).replace(/^(?!▲)/, b.kind === 'delta' ? '+' : ''))}</text>`);
    const words = b.label.split('\n');
    words.forEach((w, wi) => parts.push(`<text class="tick" x="${m.l + band * i + band / 2}" y="${H - 26 + wi * 15}" text-anchor="middle">${esc(w)}</text>`));
    parts.push(`<rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" data-tip="${esc(`<b>${b.label.replace('\n', '')}</b><br>${labelV}`)}"/>`);
  });
  parts.push('</svg>');
  return parts.join('');
}

/** KPI タイル用の折れ線（最新点のみ強調） */
export function sparkline(values: (number | null)[], ariaLabel: string): string {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return '';
  const W = 120;
  const H = 34;
  const min = Math.min(...pts.map((p) => p[1]));
  const max = Math.max(...pts.map((p) => p[1]));
  const x = (i: number) => 3 + (i / (values.length - 1)) * (W - 6);
  const y = (v: number) => 4 + ((max - v) / (max - min || 1)) * (H - 8);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  const zero = min < 0 && max > 0 ? `<line class="spark-zero" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">${zero}<path d="${d}"/><circle cx="${x(last[0])}" cy="${y(last[1])}" r="3.2"/></svg>`;
}
