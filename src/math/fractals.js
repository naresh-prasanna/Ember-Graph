import { splitTop } from './parser.js';

/* Fractal expressions: finite escape-time approximations, computed in short cancellable slices. */
export const FRACTALS = {
  mandelbrot: {
    title: 'Mandelbrot',
    defaults: ['280'],
    labels: ['Iterations'],
    hint: 'The classic quadratic parameter plane',
    rule: 'zₙ₊₁ = zₙ² + c',
  },
  julia: {
    title: 'Julia',
    defaults: ['-0.8', '0.156', '280'],
    labels: ['Real c', 'Imaginary c', 'Iterations'],
    hint: 'Change a complex seed to reshape the boundary',
    rule: 'zₙ₊₁ = zₙ² + c',
    julia: true,
  },
  burningship: {
    title: 'Burning Ship',
    defaults: ['280'],
    labels: ['Iterations'],
    hint: 'Fold both components before squaring',
    rule: 'zₙ₊₁ = (|Re zₙ| + i|Im zₙ|)² + c',
  },
  tricorn: {
    title: 'Tricorn',
    defaults: ['280'],
    labels: ['Iterations'],
    hint: 'Conjugation creates threefold symmetry',
    rule: 'zₙ₊₁ = conjugate(zₙ)² + c',
  },
  multibrot: {
    title: 'Multibrot',
    defaults: ['3', '280'],
    labels: ['Power', 'Iterations'],
    hint: 'Explore integer powers from 2 to 8',
    rule: 'zₙ₊₁ = zₙᵖ + c',
  },
  multijulia: {
    title: 'Multijulia',
    defaults: ['-0.2', '0.65', '3', '280'],
    labels: ['Real c', 'Imaginary c', 'Power', 'Iterations'],
    hint: 'Higher-power Julia sets with a complex seed',
    rule: 'zₙ₊₁ = zₙᵖ + c',
    julia: true,
  },
  multicorn: {
    title: 'Multicorn',
    defaults: ['4', '280'],
    labels: ['Power', 'Iterations'],
    hint: 'Higher-power conjugate dynamics',
    rule: 'zₙ₊₁ = conjugate(zₙ)ᵖ + c',
  },
};
export const fractalText = family => `fractal(${family}, ${FRACTALS[family].defaults.join(', ')})`;
export function parseFractal(t, filter, cp) {
  const m = t.match(/^fractal\s*\((.*)\)$/i);
  if (!m) return null;
  if (filter) throw Error('Fractals do not support restrictions');
  const a = splitTop(m[1]).map(s => s.trim()),
    family = (a.shift() || 'mandelbrot').toLowerCase().replace(/^['"]|['"]$/g, '');
  const spec = FRACTALS[family];
  if (!spec) throw Error('Unknown fractal family. Type fractal( to browse.');
  if (a.length > spec.defaults.length) throw Error('Use ' + `fractal(${family}, ${spec.labels.join(', ')})`);
  return {
    type: 'fractal',
    family,
    args: spec.defaults.map((v, i) => cp(a[i] || v)),
  };
}
// Integer complex powers preserve the polynomial map without polar branch ambiguities.
export function escapeSample(x, y, p) {
  let zr = p.julia ? x : 0,
    zi = p.julia ? y : 0,
    cr = p.julia ? p.cr : x,
    ci = p.julia ? p.ci : y,
    n = 0;
  const radius = Math.max(2, Math.hypot(cr, ci) + 1),
    radius2 = radius * radius;
  while (zr * zr + zi * zi <= radius2 && n < p.iterations) {
    if (p.family === 'burningship') {
      zr = Math.abs(zr);
      zi = Math.abs(zi);
    }
    if (p.family === 'tricorn' || p.family === 'multicorn') zi = -zi;
    let re = zr,
      im = zi;
    for (let power = 1; power < p.power; power++) {
      const next = re * zr - im * zi;
      im = re * zi + im * zr;
      re = next;
    }
    zr = re + cr;
    zi = im + ci;
    n++;
  }
  if (n === p.iterations) return -1;
  const mag = Math.hypot(zr, zi);
  return Number.isFinite(mag)
    ? Math.max(0.001, n + 1 - Math.log(Math.max(1e-9, Math.log(Math.max(1.00001, mag)))) / Math.log(p.power))
    : n;
}

/* A raster job: { p, view, width, height, w, h }. field holds smooth escape times (-1 = bounded). */
export function sampleFractalRow(job, field, j) {
  const { p, view, width, height, w, h } = job;
  const y = (view.cy - ((j + 0.5) * height) / h) / view.s;
  for (let i = 0; i < w; i++)
    field[j * w + i] = escapeSample((((i + 0.5) * width) / w - view.cx) / view.s, y, p);
}

const EMBER = [255, 120, 59],
  IVORY = [238, 222, 195];
// Contour lines of smooth escape time, every fifth one warmer and brighter.
export function shadeFractalRow(job, field, data, j) {
  const { w, h } = job;
  for (let i = 0; i < w; i++) {
    const index = j * w + i,
      at = index * 4,
      v = field[index];
    if (v < 0) {
      data[at] = 7;
      data[at + 1] = 7;
      data[at + 2] = 7;
      data[at + 3] = 255;
      continue;
    }
    const left = field[j * w + Math.max(0, i - 1)],
      right = field[j * w + Math.min(w - 1, i + 1)],
      up = field[Math.max(0, j - 1) * w + i],
      down = field[Math.min(h - 1, j + 1) * w + i],
      grad = Math.max(0.012, Math.hypot(right - left, down - up) / 2),
      spacing = 1.25,
      distance = Math.abs(v / spacing - Math.round(v / spacing)) * spacing,
      px = distance / grad,
      detail = Math.min(1, 3 / grad),
      line = Math.exp((-px * px) / 0.55) * detail,
      glow = Math.exp((-px * px) / 9) * detail,
      major = Math.round(v / spacing) % 5 === 0,
      fade = Math.min(1, Math.max(0, v / 9)),
      warm = major ? 0.85 : 0.28;
    for (let c = 0; c < 3; c++) {
      const ink = IVORY[c] * (1 - warm) + EMBER[c] * warm;
      data[at + c] = Math.min(255, 7 + fade * (ink * line * (major ? 0.85 : 0.49) + EMBER[c] * glow * 0.085));
    }
    data[at + 3] = 255;
  }
}
