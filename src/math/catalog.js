import { I, complexOp, isComplex } from './complex.js';
import { DIST_NAMES, gamma, makeDist } from './distributions.js';
import { Chi, Ci, Ei, Shi, Si, erf, erfi, fresnelC, fresnelS, li } from './special.js';
import { Color, Matrix, Point, Shape, TTest, Tone, determinant, inverse, rref } from './values.js';

export const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k),
  nullObj = () => Object.create(null);
export const math = nullObj();
for (const kind of DIST_NAMES) math[kind] = (...a) => makeDist(kind, a);
// Calls that are complete with nothing inside: normaldist() is the standard normal.
export const emptyCalls = new Set(['normaldist', 'uniformdist', 'random']);
'sin cos tan asin acos atan atan2 sinh cosh tanh exp sqrt abs floor ceil round sign min max pow cbrt hypot asinh acosh atanh log2'
  .split(' ')
  .forEach(k => (math[k] = Math[k]));
Object.assign(math, {
  ln: Math.log,
  // log(x) is base 10; log(x, b) is base b.
  log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)),
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sec: x => 1 / Math.cos(x),
  csc: x => 1 / Math.sin(x),
  cot: x => 1 / Math.tan(x),
  arcsec: x => Math.acos(1 / x),
  arccsc: x => Math.asin(1 / x),
  // From 0 to π, so the curve is continuous through x = 0.
  arccot: x => Math.PI / 2 - Math.atan(x),
  sech: x => 1 / Math.cosh(x),
  csch: x => 1 / Math.sinh(x),
  coth: x => 1 / Math.tanh(x),
  // An odd root of a negative number is real: nthroot(-8, 3) = -2.
  nthroot: (x, n) => (x < 0 && Math.abs(n % 2) === 1 ? -((-x) ** (1 / n)) : x ** (1 / n)),
  mod: (a, b) => ((a % b) + b) % b,
  piece: (...a) => {
    for (let i = 0; i + 1 < a.length; i += 2) if (a[i]) return a[i + 1];
    return a.length % 2 ? a[a.length - 1] : NaN;
  },
  // Whole numbers multiply out exactly; anything else is Γ(n + 1), so x! graphs as a smooth curve.
  fact: n => {
    if (!Number.isInteger(n)) return gamma(n + 1);
    if (n < 0 || n > 170) return NaN;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  },
  ncr: (n, k) => {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  },
  npr: (n, k) => {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 0; i < k; i++) r *= n - i;
    return r;
  },
  distance: (p, q) => {
    if (p instanceof Point && q instanceof Point) return Math.hypot(q.x - p.x, q.y - p.y);
    if (typeof p === 'number' && typeof q === 'number') return Math.abs(q - p);
    throw Error('distance needs two points, like distance((0, 0), (3, 4))');
  },
  midpoint: (p, q) => {
    if (p instanceof Point && q instanceof Point) return new Point((p.x + q.x) / 2, (p.y + q.y) / 2);
    if (typeof p === 'number' && typeof q === 'number') return (p + q) / 2;
    throw Error('midpoint needs two points, like midpoint((0, 0), (2, 2))');
  },
  // Red, green and blue from 0 to 255.
  rgb: (r, g, b) => ([r, g, b].every(Number.isFinite) ? new Color(r, g, b) : NaN),
  // Hue in degrees, saturation and value from 0 to 1.
  hsv: (h, s, v) => {
    if (![h, s, v].every(Number.isFinite)) return NaN;
    const f = n => {
      const k = (n + (((h % 360) + 360) % 360) / 60) % 6;
      return 255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
    };
    return new Color(f(5), f(3), f(1));
  },
  // A sine wave of this many hertz; gain from 0 to 1.
  tone: (freq, gain = 1) => (Number.isFinite(freq) && Number.isFinite(gain) ? new Tone(freq, gain) : NaN),
  erf,
  erfi,
  Si,
  Ci,
  Ei,
  li,
  Shi,
  Chi,
  fresnelS,
  fresnelC,
  // On real numbers; complex.js has the versions for a + bi.
  re: x => x,
  real: x => x,
  im: x => (Number.isNaN(x) ? NaN : 0),
  imag: x => (Number.isNaN(x) ? NaN : 0),
  conj: x => x,
  arg: x => (x < 0 ? Math.PI : x >= 0 ? 0 : NaN),
});
/* Functions that read a whole list rather than one element at a time; numbers may be mixed in, as in max(L, 0). */
const flat = a => a.flat(),
  total = v => v.reduce((s, x) => (isComplex(s) || isComplex(x) ? complexOp('+', s, x) : s + x), 0),
  sorted = a => flat(a).sort((p, q) => p - q),
  mean = a => {
    const v = flat(a);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
  },
  middle = v => {
    const m = v.length >> 1;
    return !v.length ? NaN : v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  },
  // Sample statistics divide by n − 1; the population versions (varp, stdevp, covp) divide by n.
  variance = (a, p) => {
    const v = flat(a),
      m = mean(v),
      n = v.length - (p ? 0 : 1);
    return n < 1 ? NaN : v.reduce((s, x) => s + (x - m) ** 2, 0) / n;
  },
  covariance = (A, B, p) => {
    if (!Array.isArray(A) || !Array.isArray(B)) return NaN;
    const k = Math.min(A.length, B.length),
      a = A.slice(0, k),
      b = B.slice(0, k),
      ma = mean(a),
      mb = mean(b),
      n = k - (p ? 0 : 1);
    return n < 1 ? NaN : a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / n;
  },
  // Quantiles interpolate between neighbouring sorted values, like Excel's PERCENTILE.INC.
  quantile = (L, p) => {
    const v = sorted([L]);
    if (!v.length || !(p >= 0 && p <= 1)) return NaN;
    const at = (v.length - 1) * p,
      lo = Math.floor(at);
    return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (at - lo);
  },
  // Quartiles follow the TI calculator method: Q1 and Q3 are medians of the halves, leaving out the median.
  quartile = (L, q) => {
    const v = sorted([L]),
      h = v.length >> 1;
    q = Math.round(q);
    if (!v.length || q < 0 || q > 4) return NaN;
    if (q === 0) return v[0];
    if (q === 4) return v.at(-1);
    if (q === 2 || v.length < 2) return middle(v);
    return middle(q === 1 ? v.slice(0, h) : v.slice(v.length - h));
  },
  correlation = (A, B) => {
    if (!Array.isArray(A) || !Array.isArray(B)) return NaN;
    const k = Math.min(A.length, B.length),
      a = A.slice(0, k),
      b = B.slice(0, k);
    return covariance(a, b, true) / Math.sqrt(variance([a], true) * variance([b], true));
  },
  ranks = L => {
    const order = L.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]),
      out = [];
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      for (let q = i; q <= j; q++) out[order[q][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return out;
  },
  overList = f => (L, x) => (Array.isArray(x) ? x.map(y => f(L, y)) : f(L, x)),
  numbers = a => flat(a).filter(v => typeof v === 'number' && Number.isFinite(v)),
  rect = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0],
  short = v => +v.toPrecision(6),
  whole = x => Math.abs(Math.round(x)),
  gcd = (p, q) => {
    while (q) [p, q] = [q, p % q];
    return p;
  };
export const listFns = {
  length: (...a) => flat(a).length,
  count: (...a) => flat(a).length,
  total: (...a) => total(flat(a)),
  mean: (...a) => (flat(a).some(isComplex) ? complexOp('/', total(flat(a)), flat(a).length) : mean(a)),
  median: (...a) => middle(sorted(a)),
  // The most frequent value; ties go to the smallest.
  mode: (...a) => {
    const seen = new Map();
    let best = NaN,
      most = 0;
    for (const x of sorted(a)) {
      const c = (seen.get(x) || 0) + 1;
      seen.set(x, c);
      if (c > most) [best, most] = [x, c];
    }
    return best;
  },
  variance: (...a) => variance(a),
  varp: (...a) => variance(a, true),
  stdev: (...a) => Math.sqrt(variance(a)),
  stddev: (...a) => Math.sqrt(variance(a)),
  stdevp: (...a) => Math.sqrt(variance(a, true)),
  stddevp: (...a) => Math.sqrt(variance(a, true)),
  mad: (...a) => {
    const v = flat(a),
      m = mean(v);
    return v.length ? v.reduce((s, x) => s + Math.abs(x - m), 0) / v.length : NaN;
  },
  quantile: overList(quantile),
  quartile: overList(quartile),
  cov: (A, B) => covariance(A, B),
  covp: (A, B) => covariance(A, B, true),
  corr: (A, B) => correlation(A, B),
  // Spearman's rank correlation: the correlation of the ranks, tied values sharing their average rank.
  spearman: (A, B) => (Array.isArray(A) && Array.isArray(B) ? correlation(ranks(A), ranks(B)) : NaN),
  // The five-number summary: [min, Q1, median, Q3, max].
  stats: L => [0, 1, 2, 3, 4].map(q => quartile(L, q)),
  min: (...a) => (flat(a).length ? Math.min(...flat(a)) : NaN),
  max: (...a) => (flat(a).length ? Math.max(...flat(a)) : NaN),
  sort: (...a) => sorted(a),
  unique: (...a) => [...new Set(flat(a))],
  join: (...a) => flat(a),
  // The list, n times over: repeat([1, 2], 3) is [1, 2, 1, 2, 1, 2].
  repeat: (L, n) => {
    n = Math.round(n);
    const v = [L].flat();
    return n >= 0 && v.length * n <= 10000 ? Array.from({ length: n }, () => v).flat() : NaN;
  },
  gcd: (...a) => (flat(a).length ? flat(a).map(whole).reduce(gcd) : NaN),
  lcm: (...a) =>
    flat(a).length
      ? flat(a)
          .map(whole)
          .reduce((p, q) => (p && q ? (p / gcd(p, q)) * q : 0))
      : NaN,
  // The same values in a random order, fixed for each seed.
  shuffle: (L, seed = 0) => {
    const v = [L].flat(),
      next = seeded(seed);
    for (let i = v.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [v[i], v[j]] = [v[j], v[i]];
    }
    return v;
  },
  ...plots(),
  ...inference(),
  det: M => determinant(matrix(M, 'det')),
  inv: M => inverse(matrix(M, 'inv')),
  transpose: M => new Matrix(matrix(M, 'transpose').rows[0].map((_, j) => M.rows.map(r => r[j]))),
  rref: M => rref(matrix(M, 'rref')),
  trace: M => {
    if (matrix(M, 'trace').m !== M.n) throw Error('Only a square matrix has a trace');
    return M.rows.reduce((s, r, i) => s + r[i], 0);
  },
};
function matrix(M, name) {
  if (!(M instanceof Matrix)) throw Error(`${name} needs a matrix, like [[1, 2], [3, 4]]`);
  return M;
}
function seeded(seed) {
  let s = (Math.round(seed * 1000) ^ 0x2545f491) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// polygon accepts points, a list of points, or a list of x values and a list of y values.
function vertices(args) {
  if (args.length === 2 && args.every(a => Array.isArray(a) && a.every(v => typeof v === 'number')))
    return args[0].slice(0, args[1].length).map((x, i) => new Point(x, args[1][i]));
  return flat(args).map(p => {
    if (!(p instanceof Point)) throw Error('Every corner of a polygon needs an x and a y, like (1, 2)');
    return p;
  });
}
/* Statistical plots and polygons: each returns a Shape for the row to draw. */
function plots() {
  return {
    polygon: (...args) => {
      const v = vertices(args);
      if (v.length < 2 || v.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return NaN;
      const path = [...v, v[0]].flatMap(p => [p.x, p.y]);
      let area = 0,
        perimeter = 0;
      v.forEach((p, i) => {
        const q = v[(i + 1) % v.length];
        area += p.x * q.y - q.x * p.y;
        perimeter += Math.hypot(q.x - p.x, q.y - p.y);
      });
      return new Shape('Polygon', {
        paths: [path],
        fills: [path],
        info: `Polygon: ${v.length} vertices, area ${short(Math.abs(area) / 2)}, perimeter ${short(perimeter)}`,
      });
    },
    // Bars of the given width, lined up with 0: each counts the values from its left edge up to its right.
    histogram: (L, width = 1) => {
      const v = numbers([L]);
      if (!v.length || !(width > 0)) return NaN;
      const bins = new Map();
      for (const x of v) {
        const b = Math.floor(x / width + 1e-9);
        bins.set(b, (bins.get(b) || 0) + 1);
      }
      if (bins.size > 2000) throw Error('That makes too many bars: choose a wider bin width');
      const bars = [...bins].map(([b, c]) => rect(b * width, 0, (b + 1) * width, c));
      return new Shape('Histogram', {
        paths: bars,
        fills: bars,
        info: `Histogram: ${v.length} values in bins ${short(width)} wide`,
      });
    },
    // One dot per value, stacked where values repeat; with a bin width, values share their bin's centre.
    dotplot: (L, width) => {
      const v = numbers([L]);
      if (!v.length || (width !== undefined && !(width > 0))) return NaN;
      const seen = new Map(),
        points = v.map(x => {
          const at = width ? (Math.floor(x / width + 1e-9) + 0.5) * width : x,
            k = (seen.get(at) || 0) + 1;
          seen.set(at, k);
          return [at, k];
        });
      return new Shape('Dot plot', { points, info: `Dot plot: ${v.length} values` });
    },
    // A box from Q1 to Q3 split at the median, whiskers to the furthest values within 1.5 IQR, dots beyond.
    boxplot: (L, offset = 1, height = 1) => {
      const v = numbers([L]).sort((p, q) => p - q);
      if (!v.length || !(height > 0)) return NaN;
      const [q1, med, q3] = [1, 2, 3].map(q => quartile(v, q)),
        fence = 1.5 * (q3 - q1),
        inside = v.filter(x => x >= q1 - fence && x <= q3 + fence),
        [lo, hi] = [inside[0], inside.at(-1)],
        top = offset + height / 2,
        bottom = offset - height / 2,
        cap = height / 4;
      return new Shape('Box plot', {
        paths: [
          rect(q1, bottom, q3, top),
          [med, bottom, med, top],
          [lo, offset, q1, offset],
          [q3, offset, hi, offset],
          [lo, offset - cap, lo, offset + cap],
          [hi, offset - cap, hi, offset + cap],
        ],
        fills: [rect(q1, bottom, q3, top)],
        points: v.filter(x => x < lo || x > hi).map(x => [x, offset]),
        info: `Box plot: min ${short(v[0])}, Q1 ${short(q1)}, median ${short(med)}, Q3 ${short(q3)}, max ${short(v.at(-1))}`,
      });
    },
  };
}
/* t-tests: a one-sample test of a list's mean against μ₀, and Welch's test comparing two lists' means. */
function inference() {
  const tcdf = df => t => makeDist('tdist', [df])?.cdf?.(t) ?? NaN,
    one = (L, mu = 0) => {
      const v = numbers([L]),
        n = v.length;
      if (n < 2) return null;
      return { score: (mean(v) - mu) / Math.sqrt(variance(v) / n), df: n - 1 };
    },
    two = (A, B) => {
      const a = numbers([A]),
        b = numbers([B]);
      if (a.length < 2 || b.length < 2) return null;
      const va = variance(a) / a.length,
        vb = variance(b) / b.length;
      return {
        score: (mean(a) - mean(b)) / Math.sqrt(va + vb),
        df: (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1)),
      };
    },
    test = (kind, r) => (r ? new TTest(kind, r.score, r.df, tcdf(r.df)) : NaN);
  return {
    tscore: (L, mu) => one(L, mu)?.score ?? NaN,
    ittscore: (A, B) => two(A, B)?.score ?? NaN,
    ttest: (L, mu) => test('One-sample t-test', one(L, mu)),
    ittest: (A, B) => test('Two-sample t-test', two(A, B)),
  };
}
// Every short name can also be written out in full.
Object.entries({
  var: 'variance',
  standarddeviation: 'stdev',
  populationstandarddeviation: 'stdevp',
  populationvariance: 'varp',
  covariance: 'cov',
  populationcovariance: 'covp',
  correlation: 'corr',
  meanabsolutedeviation: 'mad',
  average: 'mean',
  minimum: 'min',
  maximum: 'max',
}).forEach(([long, short]) => (listFns[long] = listFns[short]));
Object.assign(math, listFns);
export const constants = {
    pi: Math.PI,
    e: Math.E,
    tau: 2 * Math.PI,
    i: I,
  },
  special = new Set(['deriv', 'integral', 'sum', 'prod']),
  coords = new Set(['x', 'y', 'z', 'r', 't', 'theta']);
export const forbidden = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'window',
  'document',
  'globalThis',
  'eval',
  'Function',
  'this',
  'new',
  'return',
]);
export const reserved = n =>
  own(math, n) || own(constants, n) || special.has(n) || coords.has(n) || forbidden.has(n);
export const SYM = {
  pi: 'π',
  theta: 'θ',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  lambda: 'λ',
  sigma: 'σ',
  phi: 'φ',
  omega: 'ω',
  tau: 'τ',
  sqrt: '√',
};
// π, θ and the other symbols are names of their own: 2πr is 2·π·r and iθ is i·θ, not one long name once spelled.
const SYMBOL_EDGE = /(?<=[A-Za-zπθταβγδλσφω])(?=[πθταβγδλσφω])|(?<=[πθταβγδλσφω])(?=[A-Za-z])/g;
export const normalize = s =>
  s
    .replace(SYMBOL_EDGE, '*')
    .replace(/π/g, 'pi')
    .replace(/θ/g, 'theta')
    .replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080))
    .replace(/τ/g, 'tau')
    .replace(/α/g, 'alpha')
    .replace(/β/g, 'beta')
    .replace(/γ/g, 'gamma')
    .replace(/δ/g, 'delta')
    .replace(/λ/g, 'lambda')
    .replace(/σ/g, 'sigma')
    .replace(/φ/g, 'phi')
    .replace(/ω/g, 'omega')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt')
    .replace(/[−–]/g, '-')
    .replace(/×|·/g, '*')
    .replace(/÷/g, '/')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/\*\*/g, '^');

/* d/dx(…), ∫ … dx, ∫_a^b … dx and Σ_(n=1)^(10) … as people write them in text, rewritten to the
   deriv(…, x), integral(…) and sum(…) the editor saves, so pasted, shared and typed text read the same as the
   editor. A body without brackets runs on to the next =, comma, brace or closing bracket, as it does in the
   editor. */
const STOP = /[=<>,;{}\])≤≥≠]/;
function group(s, i) {
  const open = s[i];
  if (open !== '(' && open !== '{') return null;
  const close = open === '(' ? ')' : '}';
  for (let j = i + 1, depth = 1; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close && !--depth) return [s.slice(i + 1, j), j + 1];
  }
  return null;
}
// What d/dx or Σ applies to: a bracket, or everything up to a stop.
function body(s, i) {
  while (s[i] === ' ') i++;
  if (s[i] === '(') {
    const g = group(s, i);
    if (g) return g;
  }
  let j = i;
  for (let depth = 0; j < s.length; j++) {
    if ('([{'.includes(s[j])) depth++;
    else if (depth && ')]}'.includes(s[j])) depth--;
    else if (!depth && (STOP.test(s[j]) || /^ (with|for|and|or)\b/.test(s.slice(j)))) break;
  }
  return j > i ? [s.slice(i, j).trim(), j] : null;
}
// A bound after _ or ^: {…}, (…), or one number or name.
function bound(s, i, mark) {
  if (s[i] !== mark) return null;
  const g = group(s, i + 1);
  if (g) return g;
  const m = s.slice(i + 1).match(mark === '_' ? /^[^\s^]+/ : /^-?[A-Za-z0-9.πθ∞]+/);
  return m ? [m[0], i + 1 + m[0].length] : null;
}
// |x| as abs(x). A bar opens unless it follows something it can close, so ||x| − 1| nests.
function bars(s) {
  let out = '',
    open = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '|') {
      out += s[i];
      continue;
    }
    const before = out.trimEnd().at(-1) || '';
    if (open && /[\w.)\]}!′'πθ]/.test(before) && !out.trimEnd().endsWith('abs(')) {
      out += ')';
      open--;
    } else {
      out += 'abs(';
      open++;
    }
  }
  return open ? s : out;
}
export function textNotation(s) {
  if (s.includes('|')) s = bars(s);
  // == is how programmers ask whether two sides are equal; a row's = already does.
  if (s.includes('==')) s = s.replace(/==/g, '=');
  if (!/d\/d|[∫Σ∏]/.test(s)) return s;
  let out = '',
    i = 0;
  const word = c => /[\w.]/.test(c || '');
  while (i < s.length) {
    const rest = s.slice(i);
    const dm = !word(s[i - 1]) && rest.match(/^d\/d([A-Za-zθ])(?![A-Za-z0-9_])/);
    if (dm) {
      const b = body(s, i + dm[0].length);
      if (b) {
        out += `deriv(${textNotation(b[0])},${dm[1]})`;
        i = b[1];
        continue;
      }
    }
    if (s[i] === '∫') {
      let j = i + 1;
      const lo = bound(s, j, '_');
      if (lo) j = lo[1];
      const hi = lo && bound(s, j, '^');
      if (hi) j = hi[1];
      // The differential: d and one letter, standing alone, before any stop at this depth.
      let k = j,
        found = null;
      for (let depth = 0; k < s.length; k++) {
        if ('([{'.includes(s[k])) depth++;
        else if (depth && ')]}'.includes(s[k])) depth--;
        else if (!depth && STOP.test(s[k])) break;
        else if (
          !depth &&
          k > j &&
          s[k] === 'd' &&
          /[A-Za-zθ]/.test(s[k + 1] || '') &&
          !word(s[k + 2]) &&
          !/[A-Za-z]/.test(s[k - 1])
        ) {
          found = k;
          break;
        }
      }
      if (found !== null) {
        const f = textNotation(s.slice(j, found).trim()),
          v = s[found + 1];
        out += hi
          ? `integral(${f},${v},${textNotation(lo[0])},${textNotation(hi[0])})`
          : `integral(${f},${v})`;
        i = found + 2;
        continue;
      }
    }
    if (s[i] === 'Σ' || s[i] === '∏') {
      const lo = bound(s, i + 1, '_'),
        eq = lo && lo[0].indexOf('='),
        hi = lo && eq > 0 && bound(s, lo[1], '^'),
        b = hi && body(s, hi[1]);
      if (b) {
        out += `${s[i] === 'Σ' ? 'sum' : 'prod'}(${textNotation(b[0])},${lo[0].slice(0, eq).trim()},${textNotation(
          lo[0].slice(eq + 1),
        )},${textNotation(hi[0])})`;
        i = b[1];
        continue;
      }
    }
    out += s[i++];
  }
  return out;
}

/* Pratt parser: exponentiation is right associative; -x^2 means -(x^2).
   Implicit multiplication binds like *, and chained comparisons are pairwise. */
