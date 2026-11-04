// 悠三堂 試算表：画面の補助スクリプト（Workers 版・claude.ai 版で共用）
(() => {
// グラフのツールチップ（data-tip を持つ要素にマウスを乗せると表示）
function initGlobal() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'status');
  document.body.appendChild(tip);
  let active = null;
  const place = (e) => {
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  };
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) return;
    active = t;
    tip.innerHTML = t.getAttribute('data-tip');
    tip.classList.add('on');
    t.closest('svg')?.classList.add('hovering');
    t.classList.add('hot');
    place(e);
  });
  document.addEventListener('pointermove', (e) => active && place(e));
  document.addEventListener('pointerout', (e) => {
    if (!active || (e.relatedTarget && active.contains(e.relatedTarget))) return;
    active.closest('svg')?.classList.remove('hovering');
    active.classList.remove('hot');
    active = null;
    tip.classList.remove('on');
  });

  // 期間選択は変更したらすぐ表示（submit イベントを発火させる）
  document.addEventListener('change', (e) => {
    const s = e.target;
    if (s && s.matches && s.matches('select[data-autosubmit]') && s.form) s.form.requestSubmit();
  });

  // 削除などの確認。claude.ai 版では src/client が独自の確認画面を出す
  if (!window.__FINANCE_CLIENT__) {
    document.addEventListener('submit', (e) => {
      const f = e.target;
      if (f && f.dataset && f.dataset.confirm && !window.confirm(f.dataset.confirm)) e.preventDefault();
    }, true);
  }
}


// 目標画面：入力に合わせて前期比と利益の目標をその場で計算する（保存時にサーバーでも計算）
function initTargets(root) {
  const form = root.querySelector('#targets-form');
  if (!form) return;
  const parse = (v) => { const n = Number(String(v).replace(/[,\s円]/g, '')); return v === '' || !Number.isFinite(n) ? null : Math.round(n); };
  const yen = (n) => (n === null ? '—' : (n < 0 ? '▲' : '') + Math.abs(n).toLocaleString('ja-JP'));
  const pct = (cur, base) => { if (cur === null || base === null || base === 0 || (Math.sign(cur) !== Math.sign(base) && cur !== 0)) return '—'; const v = ((cur - base) / Math.abs(base)) * 100; return (v >= 0 ? '+' : '▲') + Math.abs(v).toFixed(1) + '%'; };
  const inputs = [...form.querySelectorAll('input[data-key]')];
  const val = (key) => { const el = inputs.find((i) => i.dataset.key === key); return el ? parse(el.value) : null; };
  const all = (arr) => (arr.some((v) => v === null) ? null : arr.reduce((a, v) => a + v, 0));
  const signed = (n) => (n === null ? '—' : n > 0 ? '+' + yen(n) : yen(n));
  const setYoy = (key, target) => { const td = form.querySelector(`[data-yoy="${CSS.escape(key)}"]`); if (!td) return; const prior = td.dataset.prior === '' ? null : Number(td.dataset.prior); td.textContent = td.dataset.mode === 'diff' ? (target === null || prior === null ? '—' : signed(target - prior)) : pct(target, prior); };
  const recalc = () => {
    const salesVals = inputs.filter((i) => i.dataset.group === 'sales').map((i) => parse(i.value));
    const sales = salesVals.every((v) => v === null) ? null : salesVals.reduce((a, v) => a + (v ?? 0), 0);
    const cogs = val('cogs'), sga = val('sga'), inc = val('nonop_inc'), exp = val('nonop_exp');
    const gross = sales === null || cogs === null ? null : sales - cogs;
    const op = gross === null || sga === null ? null : gross - sga;
    const ord = op === null || inc === null || exp === null ? null : op + inc - exp;
    const derived = { sales, gross, op, ord };
    for (const [k, v] of Object.entries(derived)) { const el = form.querySelector(`[data-derived="${k}"]`); if (el) el.textContent = yen(v); setYoy(k, v); }
    inputs.forEach((i) => setYoy(i.dataset.key, parse(i.value)));
    const sum = document.querySelector('[data-sum="sales"]');
    if (sum) sum.innerHTML = sales === null ? '未設定' : `${yen(sales)}<span class="unit">円</span>`;
  };
  form.addEventListener('input', recalc);
  form.addEventListener('focusout', (e) => { const i = e.target; if (i.dataset && i.dataset.key) { const n = parse(i.value); if (n !== null) i.value = n.toLocaleString('ja-JP'); } });
  form.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.fill === 'yoy') {
      const p = Number(String(document.getElementById('yoy-pct').value).replace('%', ''));
      if (!Number.isFinite(p)) return;
      inputs.filter((i) => i.dataset.group === 'sales' && i.dataset.prior !== '').forEach((i) => { i.value = (Math.round((Number(i.dataset.prior) * p) / 100 / 1000) * 1000).toLocaleString('ja-JP'); });
    } else {
      inputs.filter((i) => i.value === '' && i.dataset.prior !== '').forEach((i) => { i.value = Number(i.dataset.prior).toLocaleString('ja-JP'); });
    }
    recalc();
  }));
}

function initPage(root = document) {
  initTargets(root);
}

window.FinanceUI = { initGlobal, initPage };
if (!window.__FINANCE_CLIENT__) {
  initGlobal();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initPage());
  else initPage();
}
})();
