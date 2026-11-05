/**
 * 提出用ページ（印刷用 HTML）を、そのままのレイアウトで PDF にする（claude.ai 版）。
 * claude.ai の画面では印刷ダイアログを開けないので、
 *   1. 見えない枠の中で Paged.js が A4 のページに割り付け（印刷と同じ @page の指定を使う）
 *   2. 各ページを html2canvas で画像にし
 *   3. jsPDF で1ページずつ PDF にまとめる。
 * 文字は画像になる（PDF 上で文字の選択・検索はできない）。
 */
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
// Paged.js は見えない枠の中で動かすので、文字列として持っておく
import pagedSrc from '../../node_modules/pagedjs/dist/paged.polyfill.min.js' with { type: 'text' };

/** 印刷のときだけ効く指定（@media print）を、PDF 用に常に効かせる */
const PDF_CSS = `
.noprint { display: none !important; }
body { background: #fff !important; }
.sheet { margin: 0 !important; width: auto !important; min-height: 0 !important; padding: 0 !important; box-shadow: none !important; }
.sheet.landscape { width: auto !important; min-height: 0 !important; }
.cover { height: 265mm; }
.watermark { display: none; }
/* 横向きのページ（月次推移）。Paged.js 0.4 は名前付きページの大きさを変えないので、ここで A4 横にする */
.pagedjs_page.pagedjs_named_page.pagedjs_wide_page {
  --pagedjs-width: 297mm; --pagedjs-height: 210mm;
  --pagedjs-width-right: 297mm; --pagedjs-height-right: 210mm;
  --pagedjs-width-left: 297mm; --pagedjs-height-left: 210mm;
  --pagedjs-pagebox-width: 297mm; --pagedjs-pagebox-height: 210mm;
}
.pagedjs_page .pdf-watermark { position: absolute; top: 42%; left: 0; right: 0; text-align: center; font-family: 'Noto Serif JP', serif; font-size: 96pt; color: rgba(0, 0, 0, 0.05); transform: rotate(-18deg); pointer-events: none; z-index: 0; }
`;

const PX_TO_MM = 25.4 / 96;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function htmlToPdf(html: string, progress: (msg: string) => void): Promise<Uint8Array> {
  const draft = /class="watermark"/.test(html);
  const safe = (js: string) => js.replace(/<\/script/gi, '<\\/script');
  const head = `<style>${PDF_CSS}</style><script>window.PagedConfig = { auto: false };</script><script>${safe(pagedSrc)}</script>`;
  // 置き換え文字列の $ を特別扱いさせないよう、関数で渡す
  const doc = html.includes('</head>') ? html.replace('</head>', () => `${head}</head>`) : head + html;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // 見えない場所に置く（display:none だと割り付けも画像化もできない）
  frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:1300px;height:1800px;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(frame);
  try {
    progress('PDF のページを割り付けています…');
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('PDF の準備に時間がかかりすぎました。もう一度お試しください')), 30000);
      frame.onload = () => {
        clearTimeout(t);
        resolve();
      };
      frame.srcdoc = doc;
    });
    const win = frame.contentWindow as (Window & { PagedPolyfill?: { preview: () => Promise<unknown> } }) | null;
    const fdoc = frame.contentDocument;
    if (!win || !fdoc || !win.PagedPolyfill) throw new Error('PDF を作る準備ができませんでした');
    // 文字の形がそろってから割り付ける（途中で変わるとページ送りがずれる）
    await Promise.race([fdoc.fonts.ready, wait(8000)]);
    await win.PagedPolyfill.preview();
    await Promise.race([fdoc.fonts.ready, wait(3000)]);

    const pages = [...fdoc.querySelectorAll<HTMLElement>('.pagedjs_page')];
    if (!pages.length) throw new Error('PDF のページを作れませんでした');
    if (draft) {
      // 下書きの透かしは各ページに置く（固定配置のままでは1ページ目にしか出ない）
      pages.forEach((p, i) => {
        if (i === 0) return; // 表紙には出さない（印刷と同じ）
        const w = fdoc.createElement('div');
        w.className = 'pdf-watermark';
        w.textContent = '下書き';
        p.querySelector('.pagedjs_sheet')?.appendChild(w);
      });
    }

    let pdf: jsPDF | null = null;
    for (let i = 0; i < pages.length; i++) {
      progress(`PDF を作っています（${i + 1} / ${pages.length} ページ）…`);
      const p = pages[i];
      const wMm = p.offsetWidth * PX_TO_MM;
      const hMm = p.offsetHeight * PX_TO_MM;
      const canvas = await html2canvas(p, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: 1300 });
      const img = canvas.toDataURL('image/jpeg', 0.9);
      const orientation = wMm > hMm ? 'landscape' : 'portrait';
      if (!pdf) pdf = new jsPDF({ unit: 'mm', format: [wMm, hMm], orientation, compress: true });
      else pdf.addPage([wMm, hMm], orientation);
      pdf.addImage(img, 'JPEG', 0, 0, wMm, hMm, undefined, 'FAST');
      // 画面が固まらないように、1ページごとに少し休む
      await wait(0);
    }
    return new Uint8Array(pdf!.output('arraybuffer'));
  } finally {
    frame.remove();
  }
}
