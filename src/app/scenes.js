import { loadState, saveSoon, state } from './persistence.js';
import { S, reduceMotion, sceneMemory } from './state.js';
import { $ } from '../core/dom.js';
import { FRACTALS } from '../math/fractals.js';
import { camera, cameraKick } from '../render/camera.js';
import { kick } from '../render/renderer.js';
import { panelWidth, syncInert } from '../ui/sidePanel.js';

export function updateStatus() {
  const fr = S.rows.find(r => !r.off && r.k?.type === 'fractal');
  if (fr && !S.mode3) {
    $('#plate').textContent = 'COMPLEX DYNAMICS / ESCAPE TIME';
    $('#scene-title').innerHTML = 'Infinity, <em>unfolding.</em>';
    $('#scene-desc').textContent = 'Change the seed. Explore the boundary. Zoom into the detail.';
    $('#drawing-label').textContent = FRACTALS[fr.k.family].title;
  } else if (sceneInfo[S.activeScene]) {
    const info = sceneInfo[S.activeScene];
    $('#plate').textContent = info.plate;
    $('#scene-title').innerHTML = info.title;
    $('#scene-desc').textContent = info.desc;
    $('#drawing-label').textContent = info.label;
  }
  $('#status').textContent = S.mode3
    ? '3D · drag to orbit · scroll to zoom'
    : S.rows.some(r => r.k?.type === 'surf' && !r.off)
      ? 'Surface ready · select 3D to view'
      : '';
  document.body.classList.toggle('is3d', S.mode3);
  $('#d3').setAttribute('aria-pressed', String(S.mode3));
  $('#projection-label').textContent = S.mode3 ? 'Surface / orthographic' : 'Cartesian / radians';
}
const sceneInfo = {
  orbit: {
    plate: 'STUDY 01 / POLAR HARMONICS',
    title: 'Order, <em>in orbit.</em>',
    desc: 'A single parameter. An infinite number of possibilities.',
    label: 'Polar harmonics',
  },
  waves: {
    plate: 'STUDY 02 / SUPERPOSITION',
    title: 'When waves <em>meet.</em>',
    desc: 'Two signals. One conversation. Change a, watch them interfere.',
    label: 'Wave interference',
  },
  terrain: {
    plate: 'STUDY 03 / SCALAR FIELDS',
    title: 'Beneath the <em>surface.</em>',
    desc: 'Every contour is a constant height. Drag to change your perspective.',
    label: 'Height contours',
  },
};
export const scenes = {
  orbit: {
    r: [
      {
        text: 'a = 2.3',
        col: '#d9c8ad',
      },
      {
        text: '(a*cos(t), a*sin(t))',
        col: '#a79886',
      },
      {
        text: 'r = a + 0.45*cos(5θ)',
        col: '#ff783b',
      },
      {
        text: '(a*cos(pi/4), a*sin(pi/4))',
        col: '#e4c29a',
      },
    ],
  },
  waves: {
    r: [
      {
        text: 'a = 1.4',
        col: '#d9c8ad',
      },
      {
        text: 'y = a*sin(x)',
        col: '#8e8b84',
      },
      {
        text: 'y = 0.6*cos(2x)',
        col: '#b29b81',
      },
      {
        text: 'y = a*sin(x)+0.6*cos(2x)',
        col: '#ff783b',
      },
    ],
  },
  terrain: {
    mode3: true,
    r: [
      {
        text: 'a = 2',
        col: '#d9c8ad',
      },
      {
        text: 'z = a*exp(-((x-1)^2+y^2)/8)-1.5*exp(-((x+2)^2+(y+1)^2)/4)+0.3*sin(x+y)',
        col: '#ff783b',
      },
    ],
    c: {
      y: 0.55,
      p: 0.7,
      s: 45,
    },
  },
};
export function sceneLabels() {
  const info = sceneInfo[S.activeScene];
  if (!info) return;
  $('#plate').textContent = info.plate;
  $('#scene-title').innerHTML = info.title;
  $('#scene-desc').textContent = info.desc;
  $('#drawing-label').textContent = info.label;
  document.querySelectorAll('[data-scene]').forEach(b => {
    b.classList.toggle('active', b.dataset.scene === S.activeScene);
    b.setAttribute('aria-pressed', String(b.dataset.scene === S.activeScene));
  });
  $('#guides').setAttribute('aria-pressed', String(S.construction));
  updateStatus();
}
export function frameScene() {
  if (S.rows.some(r => r.k?.type === 'fractal' && !r.off)) {
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
  if (S.activeScene === 'waves') S.V.s = Math.max(20, Math.min(roomW / 13, (S.H - 260) / 7));
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
function chooseScene(name) {
  if (!scenes[name] || name === S.activeScene) return;
  sceneMemory.set(S.activeScene, state());
  S.activeScene = name;
  S.drifting = false;
  $('#drift').setAttribute('aria-pressed', 'false');
  if (sceneMemory.has(name)) loadState(sceneMemory.get(name));
  else {
    loadState({
      ...scenes[name],
      scene: name,
    });
    frameScene();
  }
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
export function frameFractal() {
  S.mode3 = false;
  const compact = S.W < 721 || S.presentation,
    left = panelWidth(),
    center = (S.W + left) / 2,
    family = S.rows.find(r => r.k?.type === 'fractal' && !r.off)?.k.family,
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

function presetsMenu(open, focusToggle = false) {
  const menu = $('#presets-menu');
  if (open === !menu.hidden) return;
  menu.hidden = !open;
  $('#presets').setAttribute('aria-expanded', String(open));
  if (open) (menu.querySelector('.active') || menu.querySelector('button')).focus();
  else if (focusToggle) $('#presets').focus();
}
export function initScenes() {
  document.querySelectorAll('[data-scene]').forEach(
    b =>
      (b.onclick = () => {
        presetsMenu(false);
        chooseScene(b.dataset.scene);
      }),
  );
  $('#presets').onclick = () => presetsMenu($('#presets-menu').hidden);
  $('#presets-menu').onkeydown = e => {
    const items = [...$('#presets-menu').querySelectorAll('button')],
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
  /* Fractal expressions: finite escape-time approximations, computed in short cancellable slices. */
}
