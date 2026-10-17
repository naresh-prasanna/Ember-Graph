/* Shared hover tips: elements with data-tip get a custom popover instead of the browser's title. */
let tip,
  tipEl = null,
  timer = 0,
  warmUntil = 0;

export function setTip(el, text) {
  if (!el) return;
  if (!text) {
    delete el.dataset.tip;
    el.removeAttribute('title');
    if (tipEl === el) hideTip();
    return;
  }
  el.dataset.tip = text;
  el.removeAttribute('title');
}

export function hideTip() {
  clearTimeout(timer);
  if (tipEl) warmUntil = performance.now() + 280;
  tipEl = null;
  if (tip) tip.hidden = true;
}

function place(el) {
  const r = el.getBoundingClientRect(),
    w = tip.offsetWidth,
    h = tip.offsetHeight,
    x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)),
    above = r.top - h - 10 >= 8;
  tip.style.left = x + 'px';
  tip.style.top = (above ? r.top - h - 10 : r.bottom + 10) + 'px';
  tip.style.setProperty('--nub', r.left + r.width / 2 - x + 'px');
  tip.classList.toggle('below', !above);
}

function show(el) {
  clearTimeout(timer);
  const warm = performance.now() < warmUntil,
    open = () => {
      tipEl = el;
      tip.textContent = el.dataset.tip;
      tip.classList.toggle('warm', warm);
      tip.hidden = false;
      place(el);
    };
  if (warm) open();
  else timer = setTimeout(open, 420);
}

function migrate(root = document) {
  root.querySelectorAll?.('[title]')?.forEach(el => {
    // Native color pickers and inputs keep their own chrome; skip empty titles.
    if (el.matches('input[type=color], option')) return;
    const t = el.getAttribute('title');
    if (t) setTip(el, t);
  });
}

export function initTips() {
  tip = document.createElement('div');
  tip.className = 'ui-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  migrate();
  document.addEventListener(
    'pointerover',
    e => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const el = e.target.closest?.('[data-tip]');
      if (!el || el === tipEl) return;
      show(el);
    },
    true,
  );
  document.addEventListener(
    'pointerout',
    e => {
      const el = e.target.closest?.('[data-tip]');
      if (!el || tipEl !== el) return;
      if (e.relatedTarget?.closest?.('[data-tip]') === el) return;
      hideTip();
    },
    true,
  );
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el && (e.target === el || e.target.matches?.(':focus-visible'))) show(el);
  });
  document.addEventListener('focusout', e => {
    if (tipEl && !e.relatedTarget?.closest?.('[data-tip]')) hideTip();
  });
  // Rows and menus are built after init; catch late title= attributes.
  new MutationObserver(muts => {
    for (const m of muts)
      if (m.type === 'attributes' && m.attributeName === 'title' && m.target.getAttribute?.('title'))
        migrate(m.target);
      else if (m.type === 'childList') m.addedNodes.forEach(n => n.nodeType === 1 && migrate(n));
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
}
