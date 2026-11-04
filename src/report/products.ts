/**
 * 売れ筋商品の推移（Shopify の商品別売上を会計年度ごとに集計したもの）。
 * Shopify の純売上は割引・返品を差し引いた税抜の金額で、送料と税は含まない。freee の売上高とは一致しない。
 */

export interface ProductItem {
  title: string;
  sales: number;
  qty: number;
}

/** 1会計年度分の商品別売上 */
export interface ProductYear {
  fy: number;
  /** 集計の始まり・終わり（YYYY-MM-DD）。今期は取込日まで */
  start: string;
  until: string;
  /** その年度が終わっていれば true */
  complete: boolean;
  items: ProductItem[];
  /** 商品に紐づかない売上（下書き注文の手入力の商品など） */
  unlisted: { sales: number; qty: number };
  total: { sales: number; qty: number };
  fetched_at: string;
}

export type ProductMetric = 'sales' | 'qty';
export const TOP_CHOICES = [5, 10, 20] as const;
export function normalizeTop(v: unknown): number {
  const n = Number(v);
  return (TOP_CHOICES as readonly number[]).includes(n) ? n : 10;
}
export function normalizeMetric(v: unknown): ProductMetric {
  return v === 'qty' ? 'qty' : 'sales';
}

/** 一覧で読みやすい短い商品名（【自然栽培】や「農薬肥料不使用」などの定型句を省く） */
export function shortTitle(t: string): string {
  const s = t
    .replace(/【自然栽培】|【お得なティーバッグ】|農薬肥料不使用|自然に還るティーバッグ|送料無料/g, ' ')
    .replace(/[\s　]+/g, ' ')
    .trim();
  return s || t;
}

/** ShopifyQL の応答（columns と rows）を商品別の数字に直す */
export function parseProductRows(payload: unknown): { items: ProductItem[]; unlisted: { sales: number; qty: number } } {
  const p = payload as { columns?: { name: string }[]; rows?: unknown[][] } | null;
  const cols = (p?.columns ?? []).map((c) => c.name);
  const ti = cols.indexOf('product_title');
  const si = cols.indexOf('net_sales');
  const qi = cols.indexOf('quantity_ordered');
  const items: ProductItem[] = [];
  const unlisted = { sales: 0, qty: 0 };
  if (ti < 0 || si < 0) return { items, unlisted };
  for (const r of p?.rows ?? []) {
    const title = String(r[ti] ?? '').trim();
    const sales = Math.round(Number(r[si]) || 0);
    const qty = qi >= 0 ? Math.round(Number(r[qi]) || 0) : 0;
    if (!title) {
      unlisted.sales += sales;
      unlisted.qty += qty;
    } else {
      const same = items.find((x) => x.title === title);
      if (same) {
        same.sales += sales;
        same.qty += qty;
      } else items.push({ title, sales, qty });
    }
  }
  items.sort((a, b) => b.sales - a.sales || b.qty - a.qty);
  return { items, unlisted };
}

export interface TrendCol {
  fy: number;
  complete: boolean;
  /** 今期の途中なら集計の終わり（YYYY-MM-DD） */
  until: string;
}
export interface TrendRow {
  title: string;
  short: string;
  values: number[];
  /** 基準期の構成比（%） */
  share: number | null;
  rank: number;
}
export interface ProductTrend {
  cols: TrendCol[];
  /** 順位を決めた年度（直近の終わった年度） */
  basisFy: number | null;
  rows: TrendRow[];
  other: number[];
  unlisted: number[];
  total: number[];
  metric: ProductMetric;
}

/**
 * 直近 n 期（今期の途中を含む）の上位 top 商品。
 * 順位は直近の終わった年度の売上（または販売数）で決める。
 */
export function productTrend(years: ProductYear[], n: number, top: number, metric: ProductMetric): ProductTrend {
  const withData = years.filter((y) => y.total.sales !== 0 || y.total.qty !== 0).sort((a, b) => a.fy - b.fy);
  const shown = withData.slice(-n);
  const cols: TrendCol[] = shown.map((y) => ({ fy: y.fy, complete: y.complete, until: y.until }));
  const basis = [...shown].reverse().find((y) => y.complete) ?? shown[shown.length - 1];
  const empty: ProductTrend = { cols, basisFy: basis?.fy ?? null, rows: [], other: [], unlisted: [], total: [], metric };
  if (!basis) return empty;
  const val = (it: ProductItem | { sales: number; qty: number }) => (metric === 'qty' ? it.qty : it.sales);
  const ranked = [...basis.items].sort((a, b) => val(b) - val(a)).filter((it) => val(it) > 0).slice(0, top);
  const basisListed = basis.items.reduce((s, it) => s + val(it), 0);
  const rows: TrendRow[] = ranked.map((it, i) => ({
    title: it.title,
    short: shortTitle(it.title),
    values: shown.map((y) => {
      const m = y.items.find((x) => x.title === it.title);
      return m ? val(m) : 0;
    }),
    share: basisListed ? (val(it) / basisListed) * 100 : null,
    rank: i + 1,
  }));
  const listedSum = (y: ProductYear) => y.items.reduce((s, it) => s + val(it), 0);
  const other = shown.map((y, i) => listedSum(y) - rows.reduce((s, r) => s + r.values[i], 0));
  return {
    cols,
    basisFy: basis.fy,
    rows,
    other,
    unlisted: shown.map((y) => val(y.unlisted)),
    total: shown.map((y) => val(y.total)),
    metric,
  };
}
