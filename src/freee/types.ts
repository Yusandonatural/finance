/** freee 会計 API 試算表（trial_*）の行。3期比較と単年度で持つ項目が違う */
export interface FreeeRow {
  account_item_id?: number;
  account_item_name?: string;
  account_category_name?: string;
  total_line?: boolean;
  hierarchy_level: number;
  parent_account_category_name?: string;
  closing_balance: number;
  last_year_closing_balance?: number;
  two_years_before_closing_balance?: number;
  opening_balance?: number;
  debit_amount?: number;
  credit_amount?: number;
}

/** 本アプリ内で扱う正規化済みレポート */
export interface FreeeReport {
  up_to_date: boolean;
  balances: FreeeRow[];
}

export interface FreeeFiscalYear {
  fy: number;
  start_date: string;
  end_date: string;
}
