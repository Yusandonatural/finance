import { describe, expect, it } from 'vitest';
import { parseProductRows, productTrend, shortTitle, type ProductYear } from '../src/report/products';

const payload = (rows: [string, string, string][]) => ({
  columns: [{ name: 'product_title' }, { name: 'net_sales' }, { name: 'quantity_ordered' }],
  rows,
});

const year = (fy: number, rows: [string, number, number][], unlisted = 0, complete = true): ProductYear => {
  const items = rows.map(([title, sales, qty]) => ({ title, sales, qty }));
  const listed = items.reduce((s, x) => s + x.sales, 0);
  const qty = items.reduce((s, x) => s + x.qty, 0);
  return { fy, start: `${fy}-03-01`, until: complete ? `${fy + 1}-02-28` : `${fy}-11-04`, complete, items, unlisted: { sales: unlisted, qty: unlisted ? 1 : 0 }, total: { sales: listed + unlisted, qty: qty + (unlisted ? 1 : 0) }, fetched_at: '' };
};

describe('Shopify の商品別売上', () => {
  it('応答を商品別にし、商品名のない売上は分けておく', () => {
    const r = parseProductRows(payload([['A', '300', '3'], ['', '500', '9'], ['B', '900', '1']]));
    expect(r.items.map((x) => x.title)).toEqual(['B', 'A']);
    expect(r.unlisted).toEqual({ sales: 500, qty: 9 });
  });
  it('列がない応答は空として扱う', () => {
    expect(parseProductRows({ columns: [], rows: [] }).items).toEqual([]);
  });
  it('定型句を省いた短い商品名', () => {
    expect(shortTitle('【自然栽培】鳳次郎ほうじ茶ティーバッグ 4g×50P　【お得なティーバッグ】農薬肥料不使用')).toBe('鳳次郎ほうじ茶ティーバッグ 4g×50P');
  });
});

describe('売れ筋の推移', () => {
  const years = [
    year(2023, [['A', 100, 10], ['B', 50, 40], ['C', 10, 1]], 20),
    year(2024, [['A', 120, 12], ['B', 80, 60], ['C', 30, 3], ['D', 5, 1]], 30),
    year(2025, [['B', 90, 70], ['A', 60, 6]], 10, false),
  ];
  it('順位は直近の終わった年度で決め、今期の途中も列に出す', () => {
    const t = productTrend(years, 5, 2, 'sales');
    expect(t.basisFy).toBe(2024);
    expect(t.cols.map((c) => c.fy)).toEqual([2023, 2024, 2025]);
    expect(t.rows.map((r) => r.title)).toEqual(['A', 'B']);
    expect(t.rows[0].values).toEqual([100, 120, 60]);
    expect(t.other).toEqual([10, 35, 0]);
    expect(t.unlisted).toEqual([20, 30, 10]);
    expect(t.total).toEqual([180, 265, 160]);
    expect(t.rows[0].share).toBeCloseTo((120 / 235) * 100);
  });
  it('販売数で並べると順位が変わる', () => {
    const t = productTrend(years, 5, 2, 'qty');
    expect(t.rows.map((r) => r.title)).toEqual(['B', 'A']);
  });
  it('期数で古い年度を落とす', () => {
    expect(productTrend(years, 3, 10, 'sales').cols.length).toBe(3);
    expect(productTrend(years.slice(0, 2), 1, 10, 'sales').cols.map((c) => c.fy)).toEqual([2024]);
  });
  it('データのない年度は列に出さない', () => {
    expect(productTrend([year(2017, []), ...years], 10, 10, 'sales').cols[0].fy).toBe(2023);
  });
});
