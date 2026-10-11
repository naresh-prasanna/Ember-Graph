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
  /* Self-similar curves: a turtle walks an L-system string. F-like letters step forward, + turns left and − right.
     Ends pins the first and last points so a changing step count folds the curve in place; closed curves fit
     a box instead. Max keeps a single row under about 120 000 segments. */
  dragon: {
    title: 'Heighway dragon',
    defaults: ['12'],
    labels: ['Folds'],
    hint: 'Fold a strip of paper in half again and again, then open every fold to a right angle',
    rule: 'F → F+G, G → F−G, 90°',
    curve: {
      axiom: 'F',
      rules: { F: 'F+G', G: 'F-G' },
      angle: 90,
      draw: 'FG',
      max: 16,
      ends: [-1.5, 1.5, -0.4],
    },
  },
  levy: {
    title: 'Lévy C curve',
    defaults: ['12'],
    labels: ['Steps'],
    hint: 'Replace every segment with the two short sides of a right isosceles triangle',
    rule: 'F → +F−−F+, 45°',
    curve: { axiom: 'F', rules: { F: '+F--F+' }, angle: 45, draw: 'F', max: 16, ends: [-1.5, 1.5, -0.6] },
  },
  koch: {
    title: 'Koch snowflake',
    defaults: ['4'],
    labels: ['Steps'],
    hint: 'Raise a triangle on the middle third of every side: a finite area inside an infinite perimeter',
    rule: 'F → F+F−−F+F, 60°',
    curve: { axiom: 'F--F--F', rules: { F: 'F+F--F+F' }, angle: 60, draw: 'F', max: 7 },
  },
  arrowhead: {
    title: 'Sierpiński arrowhead',
    defaults: ['7'],
    labels: ['Steps'],
    hint: 'One unbroken path that converges on the Sierpiński triangle',
    rule: 'A → B−A−B, B → A+B+A, 60°',
    curve: {
      axiom: 'A',
      rules: { A: 'B-A-B', B: 'A+B+A' },
      angle: 60,
      draw: 'AB',
      max: 10,
      ends: [-2, 2, -1.6],
    },
  },
  hilbert: {
    title: 'Hilbert curve',
    defaults: ['5'],
    labels: ['Steps'],
    hint: 'A path through every cell of a grid that keeps neighbours close: in the limit it fills the square',
    rule: 'A → +BF−AFA−FB+, B → −AF+BFB+FA−, 90°',
    curve: {
      axiom: 'A',
      rules: { A: '+BF-AFA-FB+', B: '-AF+BFB+FA-' },
      angle: 90,
      draw: 'F',
      max: 8,
      ends: [-1.8, 1.8, -1.8],
    },
  },
  gosper: {
    title: 'Gosper flowsnake',
    defaults: ['4'],
    labels: ['Steps'],
    hint: 'Seven copies of itself tile a hexagonal island with a fractal coast',
    rule: 'A → A−B−−B+A++AA+B−, 60°',
    curve: {
      axiom: 'A',
      rules: { A: 'A-B--B+A++AA+B-', B: '+A-BB--B-A++A+B' },
      angle: 60,
      draw: 'AB',
      max: 6,
      ends: [-1.6, 1.6, 0],
    },
  },
};
export const fractalText = family => `fractal(${family}, ${FRACTALS[family].defaults.join(', ')})`;
const curves = new Map();
/* World coordinates of a self-similar curve after n rewriting steps, as [x0, y0, x1, y1, …]. */
export function curvePoints(family, n) {
  const key = family + n;
  if (curves.has(key)) return curves.get(key);
  const c = FRACTALS[family].curve;
  let s = c.axiom;
  for (let i = 0; i < n; i++) {
    let next = '';
    for (const ch of s) next += c.rules[ch] ?? ch;
    s = next;
  }
  const turns = Math.round(360 / c.angle),
    cos = Array.from({ length: turns }, (_, i) => Math.cos((2 * Math.PI * i) / turns)),
    sin = Array.from({ length: turns }, (_, i) => Math.sin((2 * Math.PI * i) / turns));
  let steps = 0;
  for (const ch of s) if (c.draw.includes(ch)) steps++;
  const p = new Float64Array(2 * steps + 2);
  let x = 0,
    y = 0,
    d = 0,
    at = 2;
  for (const ch of s) {
    if (ch === '+') d = (d + 1) % turns;
    else if (ch === '-') d = (d + turns - 1) % turns;
    else if (c.draw.includes(ch)) {
      x += cos[d];
      y += sin[d];
      p[at++] = x;
      p[at++] = y;
    }
  }
  if (c.ends) {
    // A similarity that sends the first point to (x0, h) and the last to (x1, h), with the bulk of the
    // curve above that line.
    const [x0, x1, h] = c.ends,
      ex = p[p.length - 2],
      ey = p[p.length - 1],
      L2 = ex * ex + ey * ey || 1,
      a = ((x1 - x0) * ex) / L2,
      b = (-(x1 - x0) * ey) / L2;
    let lift = 0;
    for (let i = 0; i < p.length; i += 2) {
      const u = a * p[i] - b * p[i + 1],
        v = b * p[i] + a * p[i + 1];
      p[i] = x0 + u;
      p[i + 1] = v;
      lift += v;
    }
    const flip = lift < 0 ? -1 : 1;
    for (let i = 1; i < p.length; i += 2) p[i] = h + flip * p[i];
  } else {
    const [x0, x1, y0, y1] = curveBounds(p),
      k = 4 / Math.max(x1 - x0, y1 - y0),
      mx = (x0 + x1) / 2,
      my = (y0 + y1) / 2;
    for (let i = 0; i < p.length; i += 2) {
      p[i] = (p[i] - mx) * k;
      p[i + 1] = (p[i + 1] - my) * k;
    }
  }
  if (curves.size > 24) curves.delete(curves.keys().next().value);
  curves.set(key, p);
  return p;
}
export function curveBounds(p) {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]);
    x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]);
    y1 = Math.max(y1, p[i + 1]);
  }
  return [x0, x1, y0, y1];
}
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
    type: spec.curve ? 'lsys' : 'fractal',
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

const SHADE = { bg: [7, 7, 7], ink: [238, 222, 195], em: [255, 120, 59] };
// Contour lines of smooth escape time, every fifth one in the accent colour. job.shade holds the theme's
// background, line and accent colours; lines blend from the background, so light themes darken instead.
export function shadeFractalRow(job, field, data, j) {
  const { w, h } = job,
    { bg, ink, em } = job.shade || SHADE;
  for (let i = 0; i < w; i++) {
    const index = j * w + i,
      at = index * 4,
      v = field[index];
    if (v < 0) {
      data[at] = bg[0];
      data[at + 1] = bg[1];
      data[at + 2] = bg[2];
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
      const tone = ink[c] * (1 - warm) + em[c] * warm;
      data[at + c] =
        bg[c] + fade * ((tone - bg[c]) * line * (major ? 0.85 : 0.49) + (em[c] - bg[c]) * glow * 0.085);
    }
    data[at + 3] = 255;
  }
}
