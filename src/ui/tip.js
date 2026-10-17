/* Shared hover tips: elements with data-tip get a custom popover instead of the browser's title. */
let tip,
  tipEl = null,
  // Element waiting for the delayed show; distinct from tipEl so leave can cancel before open.
  pendingEl = null,
  timer = 0,
  warmUntil = 0;

export function setTip(el, text) {
  if (!el) return;
  if (!text) {
    delete el.dataset.tip;
    el.removeAttribute('title');
    if (tipEl === el || pendingEl === el) hideTip();
    return;
  }
  el.dataset.tip = text;
  el.removeAttribute('title');
}

export function hideTip() {
  clearTimeout(timer);
  timer = 0;
  pendingEl = null;
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

function stillWantsTip(el) {
  if (!el.isConnected || !el.dataset.tip) return false;
  if (el.matches(':hover')) return true;
  const ae = document.activeElement;
  return ae === el || el.contains(ae);
}

function show(el) {
  clearTimeout(timer);
  timer = 0;
  pendingEl = el;
  const warm = performance.now() < warmUntil,
    open = () => {
      timer = 0;
      // Cursor left (or tip text cleared) during the delay — do not pop a stale tip.
      if (pendingEl !== el || !stillWantsTip(el)) {
        pendingEl = null;
        return;
      }
      tipEl = el;
      pendingEl = null;
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
      if (!el) return;
      if (e.relatedTarget?.closest?.('[data-tip]') === el) return;
      // Cancel a pending delayed show, not only an already-visible tip.
      if (tipEl === el || pendingEl === el) hideTip();
    },
    true,
  );
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el && (e.target === el || e.target.matches?.(':focus-visible'))) show(el);
  });
  document.addEventListener('focusout', e => {
    if ((tipEl || pendingEl) && !e.relatedTarget?.closest?.('[data-tip]')) hideTip();
  });
  // Rows and menus are built after init; catch late title= attributes.
  new MutationObserver(muts => {
    for (const m of muts)
      if (m.type === 'attributes' && m.attributeName === 'title' && m.target.getAttribute?.('title'))
        migrate(m.target);
      else if (m.type === 'childList') m.addedNodes.forEach(n => n.nodeType === 1 && migrate(n));
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
}
