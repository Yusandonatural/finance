// claude.ai 版の型チェック用：DOM の型と Cloudflare Workers の型は同時に読み込めないため、
// サーバー側だけで使う型を最小限に宣言する（実行時には使われない）。
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}
type R2Bucket = any;
type Fetcher = any;
type ScheduledController = any;
type ExecutionContext = any;
