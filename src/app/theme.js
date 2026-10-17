import { PAL } from './state.js';

/* Canvas colours for each theme; the CSS tokens live in styles/10-themes.css. Curves keep the colour they
   were given (PAL, or a preset tone) and are drawn in the theme's own palette, so switching theme never
   rewrites a graph. `line` tints the grid and labels, `warm` the axes and construction guides. */
const a = (rgb, x) => `rgba(${rgb},${Math.min(1, +x.toFixed(3))})`;
function canvas(o) {
  const k = o.strength ?? 1,
    { line, warm } = o;
  return {
    blend: 'lighter',
    glow: true,
    width: 0,
    axisWidth: 1,
    pal: null,
    ...o,
    gridMinor: a(line, 0.045 * k),
    gridMajor: a(line, 0.1 * k),
    axis: a(warm, 0.44 * k),
    label: a(line, (o.labelAlpha ?? 0.95) * Math.min(k, 1.6)),
    labelStrong: a(line, 0.9 * Math.min(k, 1.5)),
    guideTick: a(warm, 0.24 * k),
    guideSpoke: a(o.em, 0.16 * k),
    guideLine: a(warm, 0.3 * k),
    guideText: a(warm, 0.53 * Math.min(k, 1.6)),
    guideLabel: a(warm, 0.75),
    guideMuted: a(warm, 0.55 * Math.min(k, 1.6)),
    mesh: a(warm, 0.19 * k),
    meshText: a(warm, 0.7),
    contourText: a(line, 0.45 * Math.min(k, 1.8)),
    contour: a(line, 0.63),
    meshFlat: a(line, 0.5),
    meshFaint: a(line, 0.13 * k),
    boxGrid: a(line, 0.07 * k),
  };
}
export const THEMES = {
  ember: canvas({
    name: 'Ember',
    note: 'Warm glow on charcoal. The original.',
    bg: '#08090a',
    sky: ['rgba(87,46,25,.075)', 'rgba(27,28,29,.03)', 'rgba(0,0,0,.3)'],
    line: '213,207,195',
    warm: '216,189,160',
    em: '255,120,59',
    hot: '#ffe6bd',
    core: '#fff2d9',
    tipBg: '#070707e8',
    tipInk: '#fff1d6',
    shade: { bg: [7, 7, 7], ink: [238, 222, 195], em: [255, 120, 59] },
  }),
  aurora: canvas({
    name: 'Aurora',
    note: 'Cool teal over deep blue-black.',
    bg: '#070a0e',
    sky: ['rgba(20,90,105,.09)', 'rgba(15,25,35,.03)', 'rgba(0,0,0,.3)'],
    line: '196,214,228',
    warm: '150,200,215',
    em: '62,224,200',
    hot: '#d8fff8',
    core: '#effffc',
    tipBg: '#05080ce8',
    tipInk: '#e2f6f8',
    pal: ['#3ee0c8', '#c9d6e0', '#8fa6ba', '#7aa7ff', '#c49bff', '#ffb86b'],
    shade: { bg: [7, 10, 14], ink: [205, 225, 235], em: [62, 224, 200] },
  }),
  phosphor: canvas({
    name: 'Phosphor',
    note: 'Green traces on black, like an oscilloscope.',
    bg: '#050806',
    sky: ['rgba(30,95,40,.08)', 'rgba(10,25,12,.03)', 'rgba(0,0,0,.35)'],
    line: '190,235,196',
    warm: '150,215,160',
    em: '93,255,122',
    hot: '#e6ffe9',
    core: '#f2fff4',
    tipBg: '#030603e8',
    tipInk: '#dcffe1',
    pal: ['#5dff7a', '#d8f5dc', '#86b58e', '#e4ff5d', '#5de8ff', '#ffc65d'],
    shade: { bg: [5, 8, 6], ink: [200, 240, 205], em: [93, 255, 122] },
  }),
  safe: canvas({
    name: 'Color-blind safe',
    note: 'The Okabe–Ito palette: curves stay distinct with any color vision.',
    bg: '#08090a',
    sky: ['rgba(80,60,20,.06)', 'rgba(27,28,29,.03)', 'rgba(0,0,0,.3)'],
    line: '213,210,200',
    warm: '214,196,160',
    em: '230,159,0',
    hot: '#fff1c9',
    core: '#fff6dc',
    tipBg: '#070707e8',
    tipInk: '#fff4d6',
    pal: ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#cc79a7', '#d55e00'],
    shade: { bg: [7, 7, 7], ink: [230, 228, 220], em: [230, 159, 0] },
  }),
  contrast: canvas({
    name: 'High contrast',
    note: 'Pure black, bright solid lines, no glow.',
    bg: '#000000',
    sky: null,
    line: '255,255,255',
    warm: '255,255,255',
    em: '255,212,0',
    strength: 2.4,
    labelAlpha: 0.9,
    glow: false,
    width: 1,
    axisWidth: 1.5,
    hot: '#ffffff',
    core: '#ffffff',
    tipBg: '#000000f2',
    tipInk: '#ffffff',
    pal: ['#ffd400', '#ffffff', '#00e5ff', '#ff6af0', '#7dff4d', '#ff9a1f'],
    shade: { bg: [0, 0, 0], ink: [255, 255, 255], em: [255, 212, 0] },
  }),
  daylight: canvas({
    name: 'Daylight',
    note: 'Dark ink on white, for projectors, bright rooms and print.',
    bg: '#f6f7f9',
    sky: ['rgba(194,65,12,.025)', 'rgba(255,255,255,0)', 'rgba(20,26,34,.05)'],
    line: '20,26,34',
    warm: '30,36,46',
    em: '194,65,12',
    strength: 2.2,
    labelAlpha: 0.72,
    blend: 'source-over',
    glow: false,
    width: 0.5,
    axisWidth: 1.5,
    hot: '#7a2606',
    core: '#ffffff',
    tipBg: '#ffffffee',
    tipInk: '#14181d',
    pal: ['#c2410c', '#1f2937', '#64748b', '#a16207', '#0f766e', '#6d28d9'],
    shade: { bg: [246, 247, 249], ink: [40, 46, 56], em: [194, 65, 12] },
  }),
};
for (const [id, t] of Object.entries(THEMES)) t.id = id;

// Preset tones that are not in PAL take the palette slot of the nearest PAL colour.
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)),
  SLOT = new Map(PAL.map((c, i) => [c, i]));
for (const c of ['#e4c29a', '#8e8b84', '#b29b81']) {
  const v = rgb(c);
  let best = 0,
    min = Infinity;
  PAL.forEach((p, i) => {
    const d = rgb(p).reduce((s, x, j) => s + (x - v[j]) ** 2, 0);
    if (i && d < min) [best, min] = [i, d];
  });
  SLOT.set(c, best);
}

// Key-point and HUD labels use the UI sans (tabular digits via CSS where possible; canvas uses the same stack).
export const font = px => `${px}px Inter, 'Segoe UI', system-ui, Arial, sans-serif`,
  sans = (px, weight = 400) => `${weight} ${px}px Inter, 'Segoe UI', system-ui, Arial, sans-serif`;

export let T = THEMES.ember;
let cache = new Map();
/* The colour a curve is drawn in under the current theme. */
export function tone(col) {
  if (!T.pal || typeof col !== 'string') return col;
  let c = cache.get(col);
  if (c === undefined) {
    const i = SLOT.get(col.toLowerCase());
    c = i === undefined ? col : T.pal[i];
    cache.set(col, c);
  }
  return c;
}
const STORE = 'ember-theme';
export function savedTheme() {
  try {
    const id = localStorage.getItem(STORE);
    if (id && Object.hasOwn(THEMES, id)) return id;
  } catch {}
  return matchMedia('(prefers-contrast: more)').matches ? 'contrast' : 'ember';
}
export function setTheme(id, remember = true) {
  if (!Object.hasOwn(THEMES, id)) id = 'ember';
  T = THEMES[id];
  cache = new Map();
  const root = document.documentElement;
  if (id === 'ember') delete root.dataset.theme;
  else root.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', T.bg);
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute('content', id === 'daylight' ? 'light' : 'dark');
  if (remember)
    try {
      localStorage.setItem(STORE, id);
    } catch {}
}
