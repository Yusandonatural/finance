/**
 * 「目標の考え方」の文章（貼り付けたままの平文）を、読みやすい組版のための塊に分ける。
 * 見出し・箇条書き・番号付きの項目・表（文書から貼ると1セル1行になったもの）を見分ける。
 */

export type NoteBlock =
  | { type: 'title'; text: string }
  | { type: 'byline'; text: string }
  | { type: 'h'; no: string; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: { label: string | null; text: string }[] }
  | { type: 'ol'; items: { no: string; label: string | null; text: string }[] }
  | { type: 'table'; head: string[]; rows: string[][] };

const BULLET = /^[•・●◦‐\-*]\s*/;
const NUMBERED = /^(\d{1,2})[.．、)）]\s*/;

/** 「見出し：本文」の見出し部分（30字以内）を分ける */
function splitLabel(s: string): { label: string | null; text: string } {
  const m = /^([^:：。]{1,30})[:：]\s*(.+)$/.exec(s);
  return m ? { label: m[1].trim(), text: m[2].trim() } : { label: null, text: s };
}

/** 表のセルらしい短い行（句点で終わらず、箇条書きでも番号付きでもない。途中の句点はよい） */
const isCell = (s: string) => s.length <= 30 && !/[。:：]$/.test(s) && !BULLET.test(s) && !NUMBERED.test(s);

export function parseNote(note: string): NoteBlock[] {
  const lines = note.split(/\r?\n/).map((l) => l.trim());
  const blocks: NoteBlock[] = [];
  let i = 0;
  // 先頭の短い行は表題、そのすぐ後の「代表取締役」「·」「日付」を含む行は署名
  const first = lines.findIndex((l) => l);
  if (first >= 0 && lines[first].length <= 40 && !NUMBERED.test(lines[first]) && !/[。]$/.test(lines[first])) {
    blocks.push({ type: 'title', text: lines[first] });
    i = first + 1;
    const next = lines[i] ?? '';
    if (next && next.length <= 60 && /代表|取締役|·|・|\d{4}年\d{1,2}月\d{1,2}日/.test(next) && !/[。]$/.test(next)) {
      blocks.push({ type: 'byline', text: next });
      i++;
    }
  }
  const push = (b: NoteBlock) => {
    const last = blocks[blocks.length - 1];
    if (b.type === 'ul' && last?.type === 'ul') last.items.push(...b.items);
    else if (b.type === 'ol' && last?.type === 'ol') last.items.push(...b.items);
    else blocks.push(b);
  };
  while (i < lines.length) {
    const l = lines[i];
    if (!l) {
      i++;
      continue;
    }
    // 1セル1行になった表：短い行が6行以上続き、3列（または2列）で割り切れる
    let j = i;
    while (j < lines.length && lines[j] && isCell(lines[j])) j++;
    const run = j - i;
    const cols = run >= 6 && run % 3 === 0 ? 3 : run >= 6 && run % 2 === 0 ? 2 : 0;
    if (cols) {
      const cells = lines.slice(i, j);
      const rows: string[][] = [];
      for (let k = cols; k < cells.length; k += cols) rows.push(cells.slice(k, k + cols));
      blocks.push({ type: 'table', head: cells.slice(0, cols), rows });
      i = j;
      continue;
    }
    const num = NUMBERED.exec(l);
    if (num) {
      const rest = l.slice(num[0].length).trim();
      // 短く句点や「：」のない番号付きの行は章の見出し、それ以外は番号付きの項目
      if (rest.length <= 30 && !/[。:：]/.test(rest)) blocks.push({ type: 'h', no: num[1], text: rest });
      else push({ type: 'ol', items: [{ no: num[1], ...splitLabel(rest) }] });
    } else if (BULLET.test(l)) {
      push({ type: 'ul', items: [splitLabel(l.replace(BULLET, ''))] });
    } else {
      blocks.push({ type: 'p', text: l });
    }
    i++;
  }
  return blocks;
}
