/** 金額表示：3桁区切り、マイナスは ▲ */
export function yen(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const r = Math.round(n);
  const s = Math.abs(r).toLocaleString('ja-JP');
  return r < 0 ? `▲${s}` : s;
}

/** 増減率（%）。基準が 0 または符号が違うときは算出しない */
export function pct(cur: number, base: number | null | undefined): string {
  if (base === null || base === undefined || base === 0) return '—';
  if (Math.sign(cur) !== Math.sign(base) && cur !== 0) return '—';
  const v = ((cur - base) / Math.abs(base)) * 100;
  return `${v >= 0 ? '+' : '▲'}${Math.abs(v).toFixed(1)}%`;
}

export function signedYen(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${yen(n)}` : yen(n);
}
