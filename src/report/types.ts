export type Col3 = [number, number, number];

/** 帳票の1行。adjusted = raw + adj */
export interface Line {
  key: string;
  name: string;
  category: string;
  level: number;
  isTotal: boolean;
  synthetic?: boolean;
  raw: Col3;
  adj: Col3;
  /** B/S のみ：前期末・前々期末（決算確定値）。null は該当行なし */
  fyEnd?: [number | null, number | null];
}

export type InvCat = 'product' | 'wip' | 'material' | 'goods';
export type InvSource = 'carry_forward' | 'manual' | 'actual';
export type Method = 'carry_forward' | 'manual';

export interface InvColumn {
  opening: Record<InvCat, number>;
  /** 期末（月末）棚卸として使う金額 */
  closing: Record<InvCat, number>;
  /** freee 値に加算した補正額（actual のときは 0） */
  adjustment: Record<InvCat, number>;
  source: Record<InvCat, InvSource>;
  totalAdjustment: number;
}

export interface Check {
  key: string;
  label: string;
  ok: boolean;
  severity: 'error' | 'warn';
  detail: string;
}

export interface MonthlySeries {
  key: string;
  name: string;
  /** 月ごとの [当期, 前期, 前々期]（補正後） */
  values: (Col3 | null)[];
}

export interface PastFy {
  fy: number;
  label: string;
  sales: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  ordinaryIncome: number | null;
  netIncome: number | null;
  netAssets: number | null;
  inventory: number | null;
  borrowings: number | null;
  officerLoans: number | null;
  depreciation: number | null;
}

export interface Report {
  meta: {
    fy: number;
    month: number;
    fyStartMonth: number;
    periodStart: string;
    periodEnd: string;
    periodLabel: string;
    monthsElapsed: number;
    method: Method;
    depreciationEnabled: boolean;
    upToDate: boolean;
    generatedAt: string;
    fetchedAt: string | null;
    companyName: string;
  };
  labels: {
    cur: string;
    ly: string;
    ly2: string;
    bsCur: string;
    bsLy: string;
    bsLy2: string;
    prevFyEnd: string;
    prev2FyEnd: string;
  };
  inventory: [InvColumn, InvColumn, InvColumn];
  depreciation: Col3;
  pl: Line[];
  cr: Line[];
  bs: Line[];
  bridge: { rawNetIncome: number; items: { label: string; amount: number }[]; adjustedNetIncome: number };
  sensitivity: { key: string; label: string; inventory: number; netIncome: number; adopted: boolean; note: string }[];
  monthly: { months: { month: number; label: string }[]; series: MonthlySeries[] };
  pastFy: PastFy[];
  borrowings: { name: string; cur: number; prevFyEnd: number | null }[];
  checks: Check[];
  notes: string[];
}
