/**
 * claude.ai 版：Shopify コネクタ（run-analytics-query）で ShopifyQL を実行する。
 * Cloudflare Workers 版には Shopify の接続がないので、この機能は claude.ai 版だけで動く。
 */
import type { Env } from '../env';
import { parseProductRows, type ProductItem } from '../report/products';

export class ShopifyError extends Error {}

export async function shopifyQuery(env: Env, query: string): Promise<unknown> {
  if (!env.SHOPIFY_MCP) throw new ShopifyError('Shopify から取り込めるのは claude.ai 版だけです');
  try {
    const r = await env.SHOPIFY_MCP.callTool('Shopify', 'run-analytics-query', { query }, { cache: false });
    const p = r.payload;
    if (!p || typeof p !== 'object') throw new ShopifyError(`Shopify の応答を読み取れませんでした: ${String(p ?? '').slice(0, 200)}`);
    return p;
  } catch (e) {
    if (e instanceof ShopifyError) throw e;
    const code = (e as { code?: string }).code;
    const msg = (e as { message?: string }).message ?? '';
    const text: Record<string, string> = {
      needs_reauth: 'Shopify の接続が切れています。claude.ai の「設定 → コネクタ」で Shopify を接続し直してください',
      server_not_connected: 'Shopify がつながっていません。claude.ai の「設定 → コネクタ」で Shopify を追加してください',
      selection_required: 'Shopify のコネクタが複数あります。表示された画面で使う方を選んでください',
      not_in_manifest: 'この画面での Shopify の利用が許可されていません。アーティファクトの権限メニューから Shopify を許可してください',
      approval_required: 'Shopify の利用を許可してから、もう一度取り込んでください',
      blocked_by_policy: '組織の設定で、この画面から Shopify を使うことが止められています',
      server_unavailable: 'Shopify に一時的につながりません。少し待ってから取り込み直してください',
      tool_error: `Shopify がエラーを返しました: ${msg.slice(0, 200)}`,
    };
    throw new ShopifyError(text[code ?? ''] ?? `Shopify の呼び出しに失敗しました（${code ?? 'unknown'}）: ${msg.slice(0, 200)}`);
  }
}

/** 期間（YYYY-MM-DD、両端を含む）の商品別の純売上と販売数 */
export async function fetchProductSales(env: Env, since: string, until: string): Promise<{ items: ProductItem[]; unlisted: { sales: number; qty: number } }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new ShopifyError('期間の指定が正しくありません');
  const p = await shopifyQuery(env, `FROM sales SHOW net_sales, quantity_ordered GROUP BY product_title SINCE ${since} UNTIL ${until} ORDER BY net_sales DESC LIMIT 1000`);
  return parseProductRows(p);
}
