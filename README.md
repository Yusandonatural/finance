# finance — 悠三堂 銀行提出用 月次試算表アプリ

freee 会計のデータから、**月末棚卸を据置法で補正した**銀行提出用の月次試算表パッケージ（B/S・P/L・製造原価報告書の3期比較、月次推移、借入金明細、当期施策、添付資料）を作る社内アプリ。
公開先は `https://finance.yusando.com`（Cloudflare Access で保護）。

| ドキュメント | 内容 |
|---|---|
| [docs/00_request.md](docs/00_request.md) | 依頼内容の整理 |
| [docs/01_design.md](docs/01_design.md) | 設計図（棚卸補正ロジック、データ、画面、帳票） |
| [docs/02_project_plan.md](docs/02_project_plan.md) | 制作予定書 |
| [docs/03_handover.md](docs/03_handover.md) | 引き継ぎ書（現在地・決定事項・次の手順） |

## 構成

- Cloudflare Workers（Hono + JSX のサーバー描画、TypeScript）
- D1 `finance-db`：freee 応答のスナップショット、補正設定、施策、借入金、確定版
- R2 `finance-files`：添付資料
- Cron：毎月5日 06:00 JST に前月分を自動取込
- 認証：Cloudflare Access（アプリ側でも JWT を検証。未設定の本番は全リクエスト 403）

```
src/
  index.tsx          ルーティング・Cron
  report/            帳票組立と棚卸補正（純粋関数。テスト対象の中心）
  freee/             OAuth・API クライアント
  auth/access.ts     Cloudflare Access の JWT 検証、同一オリジン確認
  db.ts / sync.ts    D1 アクセス、freee 取込
  views/             画面と印刷用ページ
  demo/fixtures.ts   freee 実データ（2026年8月）のフィクスチャ
migrations/          D1 スキーマ
public/              CSS、robots.txt（全拒否）
test/                vitest
```

## ローカル開発

```bash
npm install
cp .dev.vars.example .dev.vars        # DEV_MODE=1（Access 検証を省略）
npm run db:migrate:local
npm run dev                           # http://127.0.0.1:8787
```

freee と接続しなくても、取込画面の「開発用：デモデータ（2026年8月）を投入」で実データの帳票を確認できる。

```bash
npm run check                         # 型チェック + テスト
```

## 初回セットアップ（本番）

作成済み: D1 `finance-db`（スキーマ適用済み）、R2 `finance-files`。

### 1. freee 自社アプリを登録

1. freee アプリストアの開発者ページ（https://app.secure.freee.co.jp/developers/applications）で「新規作成」
2. アプリタイプ：Web アプリ（自社用）
3. コールバック URL：`https://finance.yusando.com/auth/freee/callback`
4. 権限：会計の「事業所」「試算表・レポート」を **参照のみ**
5. 表示される Client ID と Client Secret を控える

### 2. Secrets を登録

```bash
npx wrangler login
npx wrangler secret put FREEE_CLIENT_ID
npx wrangler secret put FREEE_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put TOKEN_ENC_KEY
```

### 3. 公開ドメインと Cloudflare Access

**A. yusando.com の DNS が Cloudflare にある場合（推奨）**

1. `npx wrangler deploy` で `finance.yusando.com` がカスタムドメインとして割り当たる
2. Cloudflare Zero Trust → Access → Applications → Add（Self-hosted）
   - ドメイン：`finance.yusando.com`
   - ポリシー：Allow ／ Emails ending in `@yusando.com`（税理士は個別メールを追加）
3. 作成したアプリケーションの「Application Audience (AUD) Tag」と、チームドメイン（`<team>.cloudflareaccess.com`）を `wrangler.toml` の `ACCESS_AUD` と `ACCESS_TEAM_DOMAIN` に入れて再デプロイ

**B. DNS が Route 53 のままの場合**

Workers のカスタムドメインは Cloudflare 上のゾーンが必要なため、workers.dev で公開する。

1. `wrangler.toml` で `workers_dev = true` にし、`routes` の行を削除、`APP_ORIGIN` を `https://finance.<アカウント>.workers.dev` に変更
2. freee アプリのコールバック URL も同じドメインに変更
3. Cloudflare ダッシュボード → Workers → finance → Settings → Domains & Routes → workers.dev の「Cloudflare Access」を有効化し、上と同じポリシーを設定
4. AUD とチームドメインを `wrangler.toml` に入れて再デプロイ

### 4. デプロイと初回取込

```bash
npm run db:migrate:remote   # 適用済みでも安全（IF NOT EXISTS）
npm run deploy
```

1. 公開 URL を開き、Google（@yusando.com）でログイン
2. 「取込」→「freee と接続」→ 株式会社 悠三堂 を選んで許可
3. 年度と月を選んで「取り込む」
4. 「試算表」で内容と検算を確認 →「銀行提出用ページを開く」→ ブラウザの印刷から PDF 保存

## 毎月の使い方

1. 毎月5日に前月分が自動で取り込まれる（手動でも取込可）
2. 必要なら「棚卸補正」で実地簡易棚卸の数量・単価を入力（入力しなければ据置法）
3. 「施策・添付」に当期の施策と事業計画書を登録
4. 「試算表」→「この内容で確定」で版を保存 →「提出履歴」から PDF 化し、提出先を記録

## 計測・検索について

社内専用の財務アプリのため、Google Analytics・広告タグは入れていない。全ページ `noindex,nofollow`、`robots.txt` は全拒否。
