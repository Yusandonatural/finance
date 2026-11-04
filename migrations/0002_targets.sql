-- 今期の目標（年度ごと）。key は 'sales:<勘定科目ID>' | 'cogs' | 'sga' | 'nonop_inc' | 'nonop_exp'
CREATE TABLE IF NOT EXISTS targets (
  fy INTEGER NOT NULL,
  key TEXT NOT NULL,
  amount INTEGER NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  PRIMARY KEY (fy, key)
);

-- 目標の考え方（銀行への説明用のメモ）
CREATE TABLE IF NOT EXISTS target_notes (
  fy INTEGER PRIMARY KEY,
  note TEXT,
  updated_by TEXT,
  updated_at TEXT
);
