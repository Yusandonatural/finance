import type { Col3, InvCat, InvColumn, InvSource, Line, Method } from './types';
import { totalRaw } from './lines';

export const INV_CATS: InvCat[] = ['product', 'wip', 'material', 'goods'];

export const INV_LABEL: Record<InvCat, string> = {
  product: '製品',
  wip: '仕掛品（荒茶など）',
  material: '原材料',
  goods: '商品',
};

/** 期首・期末の棚卸は、製品・商品は P/L、原材料・仕掛品は製造原価報告書に出る */
const OPENING: Record<InvCat, { report: 'pl' | 'cr'; category: string }> = {
  product: { report: 'pl', category: '期首製品棚卸' },
  goods: { report: 'pl', category: '期首商品棚卸' },
  material: { report: 'cr', category: '期首原材料棚卸' },
  wip: { report: 'cr', category: '期首仕掛品棚卸' },
};
const CLOSING: Record<InvCat, { report: 'pl' | 'cr'; category: string }> = {
  product: { report: 'pl', category: '期末製品棚卸' },
  goods: { report: 'pl', category: '期末商品棚卸' },
  material: { report: 'cr', category: '期末原材料棚卸' },
  wip: { report: 'cr', category: '期末仕掛品棚卸' },
};

export type ManualInputs = Partial<Record<InvCat, number>>;

function empty(): Record<InvCat, number> {
  return { product: 0, wip: 0, material: 0, goods: 0 };
}

/**
 * 月末棚卸の見積。列 c = 0:当期, 1:前期同期, 2:前々期同期。
 * - freee に期末棚卸が既に計上されている列（決算月など）は実地棚卸値をそのまま使い、補正しない（actual）
 * - 当期列で method=manual かつ入力がある区分は入力値（manual）
 * - それ以外は期首棚卸高を据え置く（carry_forward = 据置法）
 */
export function estimateInventory(
  pl: Line[],
  cr: Line[],
  method: Method,
  manual: ManualInputs,
): [InvColumn, InvColumn, InvColumn] {
  const cols = [0, 1, 2].map((c) => {
    const opening = empty();
    const closing = empty();
    const adjustment = empty();
    const source = { product: 'carry_forward', wip: 'carry_forward', material: 'carry_forward', goods: 'carry_forward' } as Record<InvCat, InvSource>;
    for (const k of INV_CATS) {
      const o = OPENING[k];
      const cl = CLOSING[k];
      opening[k] = totalRaw(o.report === 'pl' ? pl : cr, o.category)[c];
      const recorded = totalRaw(cl.report === 'pl' ? pl : cr, cl.category)[c];
      if (recorded !== 0) {
        closing[k] = recorded;
        adjustment[k] = 0;
        source[k] = 'actual';
      } else if (c === 0 && method === 'manual' && typeof manual[k] === 'number') {
        closing[k] = manual[k] as number;
        adjustment[k] = manual[k] as number;
        source[k] = 'manual';
      } else {
        closing[k] = opening[k];
        adjustment[k] = opening[k];
        source[k] = 'carry_forward';
      }
    }
    const totalAdjustment = INV_CATS.reduce((s, k) => s + adjustment[k], 0);
    return { opening, closing, adjustment, source, totalAdjustment } satisfies InvColumn;
  });
  return cols as [InvColumn, InvColumn, InvColumn];
}

export function invCol3(inv: [InvColumn, InvColumn, InvColumn], k: InvCat): Col3 {
  return [inv[0].adjustment[k], inv[1].adjustment[k], inv[2].adjustment[k]];
}

export function carryForwardTotal(inv: InvColumn): number {
  return INV_CATS.reduce((s, k) => s + inv.opening[k], 0);
}
