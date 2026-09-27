/** 会計期間まわりのユーティリティ。fy は期首の年（2026 = 2026/3〜2027/2） */

export function fiscalMonths(startMonth: number): number[] {
  return Array.from({ length: 12 }, (_, i) => ((startMonth - 1 + i) % 12) + 1);
}

/** 期首月を 1 とした月の位置（3月始まりなら 3→1, 8→6, 2→12） */
export function monthIndex(startMonth: number, month: number): number {
  return ((month - startMonth + 12) % 12) + 1;
}

/** 期首から対象月までの暦月一覧 */
export function monthsUpTo(startMonth: number, month: number): number[] {
  return fiscalMonths(startMonth).slice(0, monthIndex(startMonth, month));
}

export function calendarYear(fy: number, startMonth: number, month: number): number {
  return month >= startMonth ? fy : fy + 1;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function monthEndDate(fy: number, startMonth: number, month: number): string {
  const y = calendarYear(fy, startMonth, month);
  const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
  return `${y}-${pad(month)}-${pad(last)}`;
}

export function monthStartDate(fy: number, startMonth: number): string {
  return `${fy}-${pad(startMonth)}-01`;
}

export function monthLabel(fy: number, startMonth: number, month: number): string {
  return `${calendarYear(fy, startMonth, month)}年${month}月`;
}

export function fyLabel(fy: number, startMonth: number): string {
  const endMonth = ((startMonth + 10) % 12) + 1;
  return `${fy}年度（${fy}年${startMonth}月〜${calendarYear(fy, startMonth, endMonth)}年${endMonth}月）`;
}

/** 期末月（3月始まりなら 2） */
export function lastMonth(startMonth: number): number {
  return ((startMonth + 10) % 12) + 1;
}

/** 基準日（JST）時点で「締まっている最新月」＝前月。その月が属する fy を返す */
export function previousClosedMonth(now: Date, startMonth: number): { fy: number; month: number } {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  let y = jst.getUTCFullYear();
  let m = jst.getUTCMonth(); // 0-based の今月 = 1-based の前月
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  const fy = m >= startMonth ? y : y - 1;
  return { fy, month: m };
}
