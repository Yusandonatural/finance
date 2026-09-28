// グラフのツールチップ（data-tip を持つ要素にマウスを乗せると表示）
(() => {
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

  // 期間選択は変更したらすぐ表示
  document.querySelectorAll('select[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));
})();
