export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** claude.ai 版：アーティファクトの db（文書ストア）。あれば D1 の代わりに使う */
  DOCS?: any;
  /** claude.ai 版：アーティファクトの mcp（freee コネクタ呼び出し） */
  FREEE_MCP?: any;
  /** claude.ai 版：アーティファクトの mcp（Shopify コネクタ呼び出し） */
  SHOPIFY_MCP?: any;
  /** claude.ai 版：アーティファクトの assets（添付ファイル） */
  ASSETS_STORE?: any;
  /** claude.ai 版で動いているとき '1'（Cloudflare Access の検証を省く） */
  CLIENT_MODE?: string;
  /** claude.ai 版：クッキーの代わりにお知らせを保持する */
  FLASH?: { ok?: string | null; error?: string | null };
  ASSETS?: Fetcher;
  FREEE_COMPANY_ID: string;
  /** 空なら、アクセスされたアドレスを使う */
  APP_ORIGIN: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_MODE?: string;
  FREEE_CLIENT_ID?: string;
  FREEE_CLIENT_SECRET?: string;
  TOKEN_ENC_KEY?: string;
}

export type AppEnv = { Bindings: Env; Variables: { actor: string } };
