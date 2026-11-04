import type { Env } from '../env';
import { audit, listFiscalYears, listProductYears, saveProductYear } from '../db';
import type { FreeeFiscalYear } from '../freee/types';
import type { ProductYear } from '../report/products';
import { fetchProductSales } from './client';

export interface ProductSyncResult {
  years: number[];
  skipped: number;
  failed: { fy: number; message: string }[];
}

/** 年度の一覧がまだないとき（freee を取り込む前）：3月〜2月の年度を作る */
function fallbackYears(today: string): FreeeFiscalYear[] {
  const y = Number(today.slice(0, 4));
  const cur = Number(today.slice(5, 7)) >= 3 ? y : y - 1;
  return Array.from({ length: 8 }, (_, i) => {
    const fy = cur - 7 + i;
    const leap = (fy + 1) % 4 === 0 && ((fy + 1) % 100 !== 0 || (fy + 1) % 400 === 0);
    return { fy, start_date: `${fy}-03-01`, end_date: `${fy + 1}-02-${leap ? 29 : 28}` };
  });
}

/**
 * Shopify の商品別売上を会計年度ごとに取り込む。
 * 終わった年度は一度取り込めば飛ばし（force で取り直し）、今期は毎回取り直す。
 */
export async function syncProducts(env: Env, opts: { force?: boolean; actor?: string } = {}): Promise<ProductSyncResult> {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  let fys = await listFiscalYears(env);
  if (!fys.length) fys = fallbackYears(today);
  const have = new Map((await listProductYears(env)).map((y) => [y.fy, y]));
  const result: ProductSyncResult = { years: [], skipped: 0, failed: [] };
  const fetchedAt = new Date().toISOString();
  for (const f of fys.filter((x) => x.start_date <= today).sort((a, b) => b.fy - a.fy)) {
    const complete = f.end_date < today;
    const prev = have.get(f.fy);
    if (complete && prev?.complete && !opts.force) {
      result.skipped++;
      continue;
    }
    const until = complete ? f.end_date : today;
    try {
      const { items, unlisted } = await fetchProductSales(env, f.start_date, until);
      const listed = items.reduce((s, it) => ({ sales: s.sales + it.sales, qty: s.qty + it.qty }), { sales: 0, qty: 0 });
      const y: ProductYear = {
        fy: f.fy,
        start: f.start_date,
        until,
        complete,
        items,
        unlisted,
        total: { sales: listed.sales + unlisted.sales, qty: listed.qty + unlisted.qty },
        fetched_at: fetchedAt,
      };
      await saveProductYear(env, y);
      result.years.push(f.fy);
    } catch (err) {
      result.failed.push({ fy: f.fy, message: (err as Error).message.slice(0, 200) });
      // つながっていないなど、全年度で同じ失敗になるものはそこで止める
      if (!/エラーを返しました/.test((err as Error).message)) break;
    }
  }
  await audit(env, opts.actor ?? 'system', 'sync_products', result);
  return result;
}
