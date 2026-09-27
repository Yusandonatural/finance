-- 悠三堂 月次試算表アプリ 初期スキーマ
-- 何度流しても壊れないよう IF NOT EXISTS を付けている

CREATE TABLE IF NOT EXISTS fiscal_years (
  fy INTEGER PRIMARY KEY,             -- 期首の年。2026 = 2026-03-01〜2027-02-28
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
);

-- freee レポート応答の生スナップショット
CREATE TABLE IF NOT EXISTS snapshots (
  fy INTEGER NOT NULL,                -- 取得した freee の fiscal_year
  kind TEXT NOT NULL,                 -- pl3 | cr3 | bs3 | pl_fy | cr_fy | bs_fy
  start_month INTEGER NOT NULL,
  end_month INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  up_to_date INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (fy, kind, start_month, end_month)
);

-- 月ごとの補正設定
CREATE TABLE IF NOT EXISTS adjustments (
  fy INTEGER NOT NULL,
  month INTEGER NOT NULL,             -- 対象月（暦月 1〜12）
  method TEXT NOT NULL DEFAULT 'carry_forward',   -- carry_forward（据置法） | manual（実地簡易入力）
  depreciation_enabled INTEGER NOT NULL DEFAULT 0,
  depreciation_monthly INTEGER,       -- NULL なら前期実績÷12 を自動計算
  note TEXT,
  updated_by TEXT,
  updated_at TEXT,
  PRIMARY KEY (fy, month)
);

-- 実地簡易入力（方法A）。金額は数量×単価 または 直接入力
CREATE TABLE IF NOT EXISTS inventory_inputs (
  fy INTEGER NOT NULL,
  month INTEGER NOT NULL,
  category TEXT NOT NULL,             -- product | wip | material | goods
  qty REAL,
  unit TEXT,
  unit_cost INTEGER,
  amount INTEGER NOT NULL,
  note TEXT,
  updated_by TEXT,
  updated_at TEXT,
  PRIMARY KEY (fy, month, category)
);

CREATE TABLE IF NOT EXISTS initiatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fy INTEGER NOT NULL,
  title TEXT NOT NULL,
  started_on TEXT,
  category TEXT,
  purpose TEXT,
  related_accounts TEXT,
  expected_effect TEXT,
  progress TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- planned | active | done
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fy INTEGER NOT NULL,
  initiative_id INTEGER,              -- NULL なら年度共通（事業計画書など）
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT,
  size INTEGER,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lender TEXT NOT NULL,
  account_name TEXT,                  -- freee の勘定科目名（例: 長期借入金）
  principal INTEGER,
  rate REAL,                          -- 年利 %
  started_on TEXT,
  ends_on TEXT,
  monthly_payment INTEGER,
  balance_override INTEGER,           -- 借入先別の残高（freee が科目単位のため手入力）
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 提出パッケージ（確定版）。report_json は確定時点の全帳票データ
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fy INTEGER NOT NULL,
  month INTEGER NOT NULL,
  version INTEGER NOT NULL,
  report_json TEXT NOT NULL,
  submitted_to TEXT,
  submitted_on TEXT,
  memo TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (fy, month, version)
);

-- freee トークン（AES-GCM 暗号化）。version で楽観ロック
CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider TEXT PRIMARY KEY,
  enc_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  detail_json TEXT
);

-- 会社名など小さな設定値
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
