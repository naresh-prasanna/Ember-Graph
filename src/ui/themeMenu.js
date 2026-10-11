import { PAL, S } from '../app/state.js';
import { T, THEMES, setTheme } from '../app/theme.js';
import { $ } from '../core/dom.js';
import { kick } from '../render/renderer.js';
import { decorate } from './panel.js';

export function chooseTheme(id) {
  setTheme(id);
  for (const r of S.rows) decorate(r);
  document.querySelectorAll('#theme-menu [data-theme-id]').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.themeId === T.id));
  });
  S.dirty = true;
  kick();
}
function themeMenu(open, focusToggle = false) {
  const menu = $('#theme-menu');
  if (open === !menu.hidden) return;
  menu.hidden = !open;
  $('#theme').setAttribute('aria-expanded', String(open));
  if (open) (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button')).focus();
  else if (focusToggle) $('#theme').focus();
}
export function initThemes() {
  const menu = $('#theme-menu');
  for (const [id, t] of Object.entries(THEMES)) {
    const b = document.createElement('button'),
      swatch = document.createElement('span'),
      name = document.createElement('strong'),
      note = document.createElement('small');
    b.dataset.themeId = id;
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(id === T.id));
    swatch.className = 'swatch';
    swatch.setAttribute('aria-hidden', 'true');
    swatch.style.setProperty('--sw-bg', t.bg);
    for (const i of [0, 1, 4]) {
      const bar = document.createElement('i');
      bar.style.background = (t.pal || PAL)[i];
      swatch.append(bar);
    }
    name.textContent = t.name;
    note.textContent = t.note;
    b.append(swatch, name, note);
    b.onclick = () => {
      chooseTheme(id);
      themeMenu(false, true);
    };
    menu.append(b);
  }
  $('#theme').onclick = () => themeMenu(menu.hidden);
  menu.onkeydown = e => {
    const items = [...menu.querySelectorAll('button')],
      i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  };
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.theme-pick')) themeMenu(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) {
      e.stopPropagation();
      themeMenu(false, true);
    }
  });
  document.addEventListener('focusin', e => {
    if (!e.target.closest('.theme-pick')) themeMenu(false);
  });
}
