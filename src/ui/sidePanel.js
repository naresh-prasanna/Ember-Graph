/* The docked expression list: drag its edge to resize, hide it to give the graph the whole screen.
   It slides over the graph like a drawer; the graph itself never moves, so nothing has to redraw. */
import { S } from '../app/state.js';
import { $ } from '../core/dom.js';

const KEY = 'ember-panel',
  MIN = 280,
  maxWidth = () => Math.min(640, Math.round(innerWidth * 0.6));

let pref = { w: 0, hidden: false },
  dragging = null;
try {
  pref = { ...pref, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch {
  /* Unreadable preferences fall back to the defaults. */
}
const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(pref));
    } catch {
      /* Private mode: the layout just isn't remembered. */
    }
  },
  docked = () => innerWidth > 720 && !S.presentation,
  aside = () => $('aside');

// How much of the graph's left side the list covers, for framing a drawing in the free space.
export const panelWidth = () => (docked() && !pref.hidden ? aside().offsetWidth : 0);
// The 3D view stays put when the list hides, so it is centred as if the list were open.
export const panelSpan = () => (docked() ? aside().offsetWidth : 0);

function setWidth(w) {
  pref.w = w ? Math.round(Math.max(MIN, Math.min(maxWidth(), w))) : 0;
  if (pref.w) document.documentElement.style.setProperty('--panel-w', pref.w + 'px');
  else document.documentElement.style.removeProperty('--panel-w');
}
function setHidden(hidden) {
  if (pref.hidden === hidden) return;
  pref.hidden = hidden;
  save();
  document.body.classList.toggle('panel-hidden', hidden);
  syncInert();
  $('#show-panel').tabIndex = hidden ? 0 : -1;
  if (aside().contains(document.activeElement) || document.activeElement === $('#show-panel'))
    (hidden ? $('#show-panel') : $('#hide-panel')).focus({ preventScroll: true });
}
export function syncInert() {
  aside().inert = S.presentation || (pref.hidden && innerWidth > 720);
}

export function initSidePanel() {
  if (pref.w) setWidth(pref.w);
  document.body.classList.toggle('panel-hidden', pref.hidden);
  $('#show-panel').tabIndex = pref.hidden ? 0 : -1;
  syncInert();
  $('#hide-panel').onclick = () => setHidden(true);
  $('#show-panel').onclick = () => setHidden(false);
  window.addEventListener('resize', () => {
    syncInert();
    if (pref.w > maxWidth()) setWidth(pref.w);
  });

  const grip = $('.panel-resize');
  grip.onpointerdown = e => {
    if (e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    dragging = { x: e.clientX, w: aside().offsetWidth };
    document.body.classList.add('panel-resizing');
  };
  grip.onpointermove = e => {
    if (dragging) setWidth(dragging.w + e.clientX - dragging.x);
  };
  grip.onpointerup = grip.onpointercancel = () => {
    if (!dragging) return;
    dragging = null;
    document.body.classList.remove('panel-resizing');
    save();
  };
  grip.ondblclick = () => {
    setWidth(0);
    save();
  };
}
