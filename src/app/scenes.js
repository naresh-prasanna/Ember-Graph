import { loadState, saveSoon, state } from './persistence.js';
import { S, reduceMotion } from './state.js';
import { $ } from '../core/dom.js';
import { setTip } from '../ui/tip.js';
import { FRACTALS, curveBounds, curvePoints } from '../math/fractals.js';
import { camera, cameraKick } from '../render/camera.js';
import { kick } from '../render/renderer.js';
import { notice } from '../ui/controls.js';
import { panelWidth, syncInert } from '../ui/sidePanel.js';

const blankInfo = {
  plate: 'BLANK CANVAS',
  title: 'Follow your <em>curiosity.</em>',
  desc: 'Type an equation, or open Presets for a guided study.',
  label: 'Your graph',
};
/* Built-in presets, in menu order. Loading one always gives this original: edits are kept in undo history,
   not in the preset. */
export const scenes = {
  blank: {
    menu: ['Blank canvas', 'An empty graph. Start from nothing.'],
    info: blankInfo,
    r: [{ text: '' }],
  },
  orbit: {
    menu: ['Orbit', 'Polar harmonics. One parameter, endless shapes.'],
    info: {
      plate: 'STUDY 01 / POLAR HARMONICS',
      title: 'Order, <em>in orbit.</em>',
      desc: 'A single parameter. An infinite number of possibilities.',
      label: 'Polar harmonics',
    },
    r: [
      { text: 'a = 2.3', col: '#d9c8ad' },
      { text: '(a*cos(t), a*sin(t))', col: '#a79886' },
      { text: 'r = a + 0.45*cos(5θ)', col: '#ff783b' },
      { text: '(a*cos(pi/4), a*sin(pi/4))', col: '#e4c29a' },
    ],
  },
  waves: {
    menu: ['Interference', 'Two waves meet. Change a and watch them combine.'],
    info: {
      plate: 'STUDY 02 / SUPERPOSITION',
      title: 'When waves <em>meet.</em>',
      desc: 'Two signals. One conversation. Change a, watch them interfere.',
      label: 'Wave interference',
    },
    r: [
      { text: 'a = 1.4', col: '#d9c8ad' },
      { text: 'y = a*sin(x)', col: '#8e8b84' },
      { text: 'y = 0.6*cos(2x)', col: '#b29b81' },
      { text: 'y = a*sin(x)+0.6*cos(2x)', col: '#ff783b' },
    ],
  },
  lissajous: {
    menu: ['Lissajous', 'Two frequencies trace one knot. Whole-number ratios close the loop.'],
    info: {
      plate: 'STUDY 03 / RATIOS',
      title: 'Two rhythms, <em>one figure.</em>',
      desc: 'a and b set the frequencies; p shifts the phase. Simple ratios draw closed figures.',
      label: 'Lissajous figure',
    },
    r: [
      { text: 'a = 3', col: '#d9c8ad' },
      { text: 'b = 2', col: '#a79886' },
      { text: 'p = 1.57', col: '#cf9b73' },
      { text: '(3sin(a*t+p), 3sin(b*t))', col: '#ff783b' },
    ],
    ranges: {
      a: { min: 1, max: 9, step: 1 },
      b: { min: 1, max: 9, step: 1 },
      p: { min: 0, max: 3.14, step: 0 },
    },
  },
  tangent: {
    menu: ['Tangent', 'Slide a point along a curve; the tangent line follows its slope.'],
    info: {
      plate: 'STUDY 04 / RATES OF CHANGE',
      title: 'The slope <em>at a point.</em>',
      desc: "Slide a. The tangent touches f at one point, and f' records its slope everywhere.",
      label: 'Tangent line',
    },
    r: [
      { text: 'f(x) = sin(x) + x/3', col: '#ff783b' },
      { text: "y = f'(x)", col: '#8e8b84' },
      { text: 'a = 1', col: '#d9c8ad' },
      { text: "y = f(a) + f'(a)(x - a)", col: '#e4c29a' },
      { text: '(a, f(a))', col: '#e4c29a' },
    ],
    ranges: { a: { min: -6, max: 6, step: 0 } },
  },
  dragon: {
    menu: ['Dragon', 'Fold a strip of paper n times and open every crease.'],
    info: {
      plate: 'STUDY 05 / PAPER FOLDING',
      title: 'Folded, <em>forever.</em>',
      desc: 'Every fold doubles the creases. Slide n and watch the dragon tile the plane.',
      label: 'Heighway dragon',
    },
    r: [
      { text: 'n = 12', col: '#d9c8ad' },
      { text: 'fractal(dragon, n)', col: '#ff783b' },
    ],
    ranges: { n: { min: 0, max: 16, step: 1 } },
  },
  snowflake: {
    menu: ['Snowflake', 'An infinite coastline around a finite area.'],
    info: {
      plate: 'STUDY 06 / SELF-SIMILARITY',
      title: 'Infinite edge, <em>finite area.</em>',
      desc: 'Each step raises a triangle on every side. The perimeter grows by a third; the area barely moves.',
      label: 'Koch snowflake',
    },
    r: [
      { text: 'n = 4', col: '#d9c8ad' },
      { text: 'fractal(koch, n)', col: '#ff783b' },
    ],
    ranges: { n: { min: 0, max: 7, step: 1 } },
  },
  julia: {
    menu: ['Julia set', 'Drag a complex seed and reshape an infinite boundary.'],
    info: {
      plate: 'STUDY 07 / ESCAPE TIME',
      title: 'Infinity, <em>unfolding.</em>',
      desc: 'a and b are the seed c = a + bi. Each pixel either escapes or stays bounded forever.',
      label: 'Julia set',
    },
    r: [
      { text: 'a = -0.8', col: '#d9c8ad' },
      { text: 'b = 0.156', col: '#a79886' },
      { text: 'fractal(julia, a, b, 280)', col: '#ff783b' },
    ],
    ranges: { a: { min: -1.5, max: 0.6, step: 0 }, b: { min: -1, max: 1, step: 0 } },
  },
  terrain: {
    menu: ['Terrain', 'A 3D surface and its height contours.'],
    info: {
      plate: 'STUDY 08 / SCALAR FIELDS',
      title: 'Beneath the <em>surface.</em>',
      desc: 'Every contour is a constant height. Drag to change your perspective.',
      label: 'Height contours',
    },
    mode3: true,
    r: [
      { text: 'a = 2', col: '#d9c8ad' },
      {
        text: 'z = a*exp(-((x-1)^2+y^2)/8)-1.5*exp(-((x+2)^2+(y+1)^2)/4)+0.3*sin(x+y)',
        col: '#ff783b',
      },
    ],
    c: { y: 0.55, p: 0.7, s: 45 },
  },
};

/* The user's own presets: { id, name, saved, state }, newest last. */
const STORE = 'ember-presets';
function userPresets() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(list)
      ? list.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string')
      : [];
  } catch {
    return [];
  }
}
function storePresets(list) {
  localStorage.setItem(STORE, JSON.stringify(list));
}
const userPreset = id => userPresets().find(p => p.id === id);
const builtIn = id => typeof id === 'string' && Object.hasOwn(scenes, id);
export const knownScene = id => builtIn(id) || !!userPreset(id);
const escapeHtml = s => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function infoFor(id) {
  if (builtIn(id)) return scenes[id].info;
  const p = userPreset(id);
  if (!p) return blankInfo;
  return {
    plate: 'YOUR PRESET',
    title: `${escapeHtml(p.name)}`,
    desc: 'Edit freely. Choosing this preset again brings back the version you saved.',
    label: p.name,
  };
}
function showInfo(info) {
  $('#plate').textContent = info.plate;
  $('#scene-title').innerHTML = info.title;
  $('#scene-desc').textContent = info.desc;
  $('#drawing-label').textContent = info.label;
}

export function updateStatus() {
  const fr = S.rows.find(r => !r.off && (r.k?.type === 'fractal' || r.k?.type === 'lsys'));
  // A fractal added to some other graph gets its own headline; the fractal presets already have one.
  if (fr && !S.mode3 && !['dragon', 'snowflake', 'julia'].includes(S.activeScene)) {
    const curve = fr.k.type === 'lsys';
    showInfo({
      plate: curve ? 'SELF-SIMILAR CURVES / L-SYSTEMS' : 'COMPLEX DYNAMICS / ESCAPE TIME',
      title: curve ? 'One rule, <em>repeated.</em>' : 'Infinity, <em>unfolding.</em>',
      desc: curve
        ? 'Each step rewrites every segment by the same rule. Raise the step count to see the limit.'
        : 'Change the seed. Explore the boundary. Zoom into the detail.',
      label: FRACTALS[fr.k.family].title,
    });
  } else showInfo(infoFor(S.activeScene));
  $('#status').textContent = S.mode3
    ? '3D · drag to orbit · scroll to zoom'
    : S.rows.some(r => r.k?.type === 'surf' && !r.off)
      ? 'Surface ready · select 3D to view'
      : '';
  document.body.classList.toggle('is3d', S.mode3);
  $('#d3').setAttribute('aria-pressed', String(S.mode3));
  $('#projection-label').textContent = S.mode3 ? 'Surface / orthographic' : 'Cartesian / radians';
}
export function sceneLabels() {
  document.querySelectorAll('[data-scene]').forEach(b => {
    b.classList.toggle('active', b.dataset.scene === S.activeScene);
    b.setAttribute('aria-current', String(b.dataset.scene === S.activeScene));
  });
  $('#guides').setAttribute('aria-pressed', String(S.construction));
  updateStatus();
}
const framed = () => S.rows.find(r => (r.k?.type === 'fractal' || r.k?.type === 'lsys') && !r.off);
export function frameScene() {
  if (framed()) {
    frameFractal();
    return;
  }
  const compact = S.W <= 720,
    left = panelWidth(),
    cx = (S.W + left) / 2,
    cy = S.H * (compact ? 0.55 : 0.56),
    roomW = S.W - left - 100;
  S.V = {
    cx,
    cy,
    s: Math.max(20, Math.min(roomW / 9, (S.H - (compact ? 150 : 280)) / 8)),
  };
  if (S.activeScene === 'waves' || S.activeScene === 'tangent')
    S.V.s = Math.max(20, Math.min(roomW / 13, (S.H - 260) / 7));
  S.C = {
    y: 0.55,
    p: 0.7,
    s: Math.max(17, Math.min((S.W - left - (compact ? 40 : 80)) / 17, (S.H - (compact ? 90 : 160)) / 12)),
  };
  S.marks = [];
  S.dirty = true;
  kick();
  saveSoon();
}
export function replay() {
  camera.trace = null;
  cameraKick(10, -12, 0.5);
  S.sparks = [];
  S.rows.forEach(r => (r.prog = reduceMotion ? 1 : 0));
  kick();
}
function chooseScene(id) {
  const user = builtIn(id) ? null : userPreset(id);
  if (!builtIn(id) && !user) return;
  S.drifting = false;
  $('#drift').setAttribute('aria-pressed', 'false');
  const b = scenes[id];
  loadState(
    user ? { ...user.state, scene: id } : { r: b.r, mode3: b.mode3, c: b.c, ranges: b.ranges, scene: id },
  );
  S.activeScene = id;
  sceneLabels();
  // A saved preset keeps its own view; the built-in ones are framed for this screen.
  if (!user) frameScene();
  replay();
  saveSoon();
}
function setPresentation(value) {
  if (S.presentation === value) return;
  S.presentation = value;
  document.body.classList.toggle('present', value);
  syncInert();
  $('#explore').classList.toggle('active', !value);
  $('#present').classList.toggle('active', value);
  $('#explore').setAttribute('aria-pressed', String(!value));
  $('#present').setAttribute('aria-pressed', String(value));
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      frameScene();
      if (value) replay();
    }),
  );
}
// Fits a world-space box into the part of the screen the expression list leaves free.
export function frameBounds(x0, x1, y0, y1) {
  const compact = S.W <= 720 || S.presentation,
    left = panelWidth(),
    roomW = S.W - left - (compact ? 40 : 140),
    roomH = compact ? S.H * 0.42 : S.H - 200,
    s = Math.max(2, Math.min(2e5, roomW / (x1 - x0 || 1), roomH / (y1 - y0 || 1)));
  S.mode3 = false;
  S.V = {
    cx: left + (S.W - left) / 2 - ((x0 + x1) / 2) * s,
    cy: (compact ? S.H * 0.3 : S.H * 0.52) + ((y0 + y1) / 2) * s,
    s,
  };
  S.marks = [];
  S.dirty = true;
  kick();
  saveSoon();
}
// A self-similar curve is framed by the limit it approaches, so changing the step count keeps the view still.
function frameCurve(family) {
  const spec = FRACTALS[family].curve;
  frameBounds(...curveBounds(curvePoints(family, Math.min(spec.max, family === 'koch' ? 5 : 10))));
}
export function frameFractal() {
  const row = framed();
  if (row?.k.type === 'lsys') {
    frameCurve(row.k.family);
    updateStatus();
    return;
  }
  S.mode3 = false;
  const compact = S.W < 721 || S.presentation,
    left = panelWidth(),
    center = (S.W + left) / 2,
    family = row?.k.family,
    s = Math.max(25, Math.min((S.W - left - (compact ? 40 : 100)) / 3.6, (S.H - 170) / 3));
  S.V = {
    cx: center + (family === 'mandelbrot' || family === 'burningship' ? 0.5 * s : 0),
    cy: S.H * 0.55 + (family === 'burningship' ? -0.35 * s : 0),
    s,
  };
  updateStatus();
  S.dirty = true;
  kick();
  saveSoon();
}

function presetButton(id, [title, detail]) {
  const b = document.createElement('button');
  b.dataset.scene = id;
  const strong = document.createElement('strong'),
    small = document.createElement('small');
  strong.textContent = title;
  small.textContent = detail;
  b.append(strong, small);
  return b;
}
function renderPresets() {
  const menu = $('#presets-menu');
  menu.replaceChildren();
  for (const [id, s] of Object.entries(scenes)) menu.append(presetButton(id, s.menu));
  const mine = userPresets();
  if (mine.length) {
    const head = document.createElement('div');
    head.className = 'presets-head';
    head.textContent = 'Your presets';
    menu.append(head);
  }
  for (const p of mine) {
    const item = document.createElement('div'),
      del = document.createElement('button');
    item.className = 'user-preset';
    del.className = 'preset-delete';
    del.dataset.delete = p.id;
    del.setAttribute('aria-label', `Delete preset ${p.name}`);
    setTip(del, 'Delete preset');
    del.textContent = '×';
    item.append(presetButton(p.id, [p.name, `Saved ${new Date(p.saved).toLocaleDateString()}`]), del);
    menu.append(item);
  }
  const form = document.createElement('form'),
    input = document.createElement('input'),
    save = document.createElement('button');
  form.className = 'preset-save';
  input.placeholder = 'Name this graph';
  input.maxLength = 40;
  input.setAttribute('aria-label', 'New preset name');
  save.textContent = 'Save as preset';
  form.append(input, save);
  form.onsubmit = e => {
    e.preventDefault();
    savePreset(input.value);
  };
  menu.append(form);
  sceneLabels();
}
function savePreset(raw) {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40) || 'Untitled graph',
    list = userPresets(),
    id = 'u' + Date.now().toString(36);
  if (list.length >= 30) {
    notice('You have 30 presets. Delete one to save another.');
    return;
  }
  S.activeScene = id;
  list.push({ id, name, saved: Date.now(), state: state() });
  try {
    storePresets(list);
  } catch {
    notice('Not enough browser storage to save this preset.');
    return;
  }
  renderPresets();
  saveSoon();
  notice(`Saved “${name}”. Choosing it later brings back this version.`);
  presetsMenu(false, true);
}
function deletePreset(id) {
  const p = userPreset(id);
  if (!p) return;
  storePresets(userPresets().filter(q => q.id !== id));
  if (S.activeScene === id) S.activeScene = null;
  renderPresets();
  saveSoon();
  notice(`Deleted “${p.name}”.`);
  ($('#presets-menu').querySelector('button') || $('#presets')).focus();
}

function presetsMenu(open, focusToggle = false) {
  const menu = $('#presets-menu');
  if (open === !menu.hidden) return;
  menu.hidden = !open;
  $('#presets').setAttribute('aria-expanded', String(open));
  if (open) (menu.querySelector('[data-scene].active') || menu.querySelector('button')).focus();
  else if (focusToggle) $('#presets').focus();
}
export function initScenes() {
  renderPresets();
  $('#presets-menu').addEventListener('click', e => {
    const del = e.target.closest('[data-delete]');
    if (del) {
      deletePreset(del.dataset.delete);
      return;
    }
    const b = e.target.closest('[data-scene]');
    if (!b) return;
    presetsMenu(false);
    chooseScene(b.dataset.scene);
  });
  $('#presets').onclick = () => presetsMenu($('#presets-menu').hidden);
  $('#presets-menu').onkeydown = e => {
    if (e.target.matches('input')) return;
    const items = [...$('#presets-menu').querySelectorAll('button, input')],
      i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  };
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.presets')) presetsMenu(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#presets-menu').hidden) {
      e.stopPropagation();
      presetsMenu(false, true);
    }
  });
  document.addEventListener('focusin', e => {
    if (!e.target.closest('.presets')) presetsMenu(false);
  });
  $('#explore').onclick = () => setPresentation(false);
  $('#present').onclick = () => setPresentation(true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.presentation && !document.querySelector('dialog[open]'))
      setPresentation(false);
  });
}
