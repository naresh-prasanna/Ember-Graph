import { Complex, complexNegate, complexOp } from './complex.js';
import { calcFmt } from './format.js';

/* Values beyond numbers and lists, as in Desmos: points, matrices, colours, shapes to draw (polygons and
   statistical plots), tones and t-test results. Each knows how to print itself. */
const num = v => typeof v === 'number';

export class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  toString() {
    return `(${calcFmt(this.x)}, ${calcFmt(this.y)})`;
  }
}

export class Matrix {
  constructor(rows) {
    this.rows = rows;
  }
  get m() {
    return this.rows.length;
  }
  get n() {
    return this.rows[0].length;
  }
  map(f) {
    return new Matrix(this.rows.map(r => r.map(f)));
  }
  times(B) {
    if (this.n !== B.m) throw Error(`A ${this.m}×${this.n} matrix can't multiply a ${B.m}×${B.n} one`);
    return new Matrix(
      this.rows.map(r => B.rows[0].map((_, j) => r.reduce((s, v, k) => s + v * B.rows[k][j], 0))),
    );
  }
  toString() {
    return '[' + this.rows.map(r => '[' + r.map(calcFmt).join(', ') + ']').join(', ') + ']';
  }
}

export class Color {
  constructor(r, g, b) {
    [this.r, this.g, this.b] = [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))));
  }
  get hex() {
    return '#' + [this.r, this.g, this.b].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  // Hue in degrees, saturation and value as 0–100 percentages — for the live readout.
  hsv() {
    const r = this.r / 255,
      g = this.g / 255,
      b = this.b / 255,
      max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [Math.round(h), Math.round(max ? (d / max) * 100 : 0), Math.round(max * 100)];
  }
  toString() {
    const [h, s, v] = this.hsv();
    return `rgb(${this.r}, ${this.g}, ${this.b}) · hsv(${h}°, ${s}%, ${v}%)`;
  }
}

/* Names passed straight into rgb(...) / hsv(...): default slider span when the variable is first created.
   Map values are [min, max, start, step]. */
export function colorSliders(ast, out = new Map()) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.k === 'call' && (ast.n === 'rgb' || ast.n === 'hsv')) {
    const args = ast.a || [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a?.k !== 'name' || out.has(a.n)) continue;
      if (ast.n === 'rgb') out.set(a.n, [0, 255, 0, 1]);
      else if (i === 0) out.set(a.n, [0, 360, 0, 1]);
      else out.set(a.n, [0, 1, 1, 0.01]);
    }
  }
  for (const v of Object.values(ast)) if (v && typeof v === 'object') colorSliders(v, out);
  return out;
}

// Something to draw: outlines and filled regions as flat [x0, y0, x1, y1, …] arrays in graph units, plus dots.
export class Shape {
  constructor(kind, { paths = [], fills = [], points = [], info = '' }) {
    this.kind = kind;
    this.paths = paths;
    this.fills = fills;
    this.points = points;
    this.info = info;
  }
  toString() {
    return this.kind;
  }
}

export class Tone {
  constructor(freq, gain = 1) {
    this.freq = freq;
    this.gain = gain;
  }
  toString() {
    return `tone(${calcFmt(this.freq)}, ${calcFmt(this.gain)})`;
  }
}

export const TEST_PROPS = ['score', 'df', 'p', 'pleft', 'pright'];
// A t-test: the score, its degrees of freedom, and the p-value for each alternative hypothesis.
export class TTest {
  constructor(kind, score, df, cdf) {
    this.kind = kind;
    this.score = score;
    this.df = df;
    this.pleft = cdf(score);
    this.pright = 1 - this.pleft;
    this.p = 2 * Math.min(this.pleft, this.pright);
  }
  toString() {
    return `${this.kind}: t = ${calcFmt(this.score)}`;
  }
}

// Arithmetic on points and matrices; undefined when neither side is one, so plain numbers carry on as before.
export function valueOp(op, a, b) {
  if (a instanceof Complex || b instanceof Complex) {
    if ((num(a) || a instanceof Complex) && (num(b) || b instanceof Complex)) return complexOp(op, a, b);
    throw Error(
      'A complex number is already a point on the plane: combine it with numbers, not points or matrices',
    );
  }
  if (a instanceof Point || b instanceof Point) {
    if (a instanceof Point && b instanceof Point) {
      if (op === '+') return new Point(a.x + b.x, a.y + b.y);
      if (op === '-') return new Point(a.x - b.x, a.y - b.y);
    } else if (op === '*' && num(a)) return new Point(a * b.x, a * b.y);
    else if ((op === '*' || op === '/') && num(b))
      return op === '*' ? new Point(a.x * b, a.y * b) : new Point(a.x / b, a.y / b);
    throw Error(`Points can be added, subtracted and scaled, but not combined with ${op}`);
  }
  if (a instanceof Matrix || b instanceof Matrix) {
    if (a instanceof Matrix && b instanceof Matrix) {
      if (op === '*') return a.times(b);
      if (op === '+' || op === '-') {
        if (a.m !== b.m || a.n !== b.n) throw Error('Only matrices of the same size can be added');
        return new Matrix(
          a.rows.map((r, i) => r.map((v, j) => (op === '+' ? v + b.rows[i][j] : v - b.rows[i][j]))),
        );
      }
    } else if (op === '*' && num(a)) return b.map(v => a * v);
    else if ((op === '*' || op === '/') && num(b)) return a.map(v => (op === '*' ? v * b : v / b));
    else if (op === '^' && num(b)) return matrixPower(a, b);
    throw Error(`Matrices can't be combined with ${op} like this`);
  }
  if (typeof a === 'object' || typeof b === 'object') return NaN;
}
export const negate = v =>
  v instanceof Point
    ? new Point(-v.x, -v.y)
    : v instanceof Matrix
      ? v.map(x => -x)
      : v instanceof Complex
        ? complexNegate(v)
        : undefined;

export function identity(n) {
  return new Matrix(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j))));
}
export function inverse(A) {
  if (A.m !== A.n) throw Error('Only a square matrix has an inverse');
  const n = A.n,
    M = A.rows.map((r, i) => [...r, ...identity(n).rows[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (Math.abs(M[p][i]) < 1e-12) throw Error('This matrix has no inverse: its determinant is 0');
    [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i];
    M[i] = M[i].map(x => x / d);
    for (let k = 0; k < n; k++)
      if (k !== i) {
        const f = M[k][i];
        M[k] = M[k].map((x, j) => x - f * M[i][j]);
      }
  }
  return new Matrix(M.map(r => r.slice(n)));
}
function matrixPower(A, e) {
  if (A.m !== A.n) throw Error('Only a square matrix has powers');
  if (!Number.isInteger(e)) throw Error('A matrix power must be a whole number');
  let base = e < 0 ? inverse(A) : A,
    out = identity(A.n);
  for (let k = Math.abs(e); k > 0; k >>= 1) {
    if (k & 1) out = out.times(base);
    base = base.times(base);
  }
  return out;
}
export function rref(A) {
  const M = A.rows.map(r => [...r]);
  let lead = 0;
  for (let r = 0; r < M.length && lead < M[0].length; r++, lead++) {
    let i = r;
    while (Math.abs(M[i][lead]) < 1e-12) {
      if (++i === M.length) {
        i = r;
        if (++lead === M[0].length)
          return new Matrix(M.map(row => row.map(v => (Math.abs(v) < 1e-12 ? 0 : v))));
      }
    }
    [M[i], M[r]] = [M[r], M[i]];
    const d = M[r][lead];
    M[r] = M[r].map(v => v / d);
    for (let k = 0; k < M.length; k++)
      if (k !== r) {
        const f = M[k][lead];
        M[k] = M[k].map((v, j) => v - f * M[r][j]);
      }
  }
  return new Matrix(M.map(row => row.map(v => (Math.abs(v) < 1e-12 ? 0 : v))));
}
export function determinant(A) {
  if (A.m !== A.n) throw Error('Only a square matrix has a determinant');
  const M = A.rows.map(r => [...r]);
  let d = 1;
  for (let i = 0; i < M.length; i++) {
    let p = i;
    for (let k = i + 1; k < M.length; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (M[p][i] === 0) return 0;
    if (p !== i) {
      [M[i], M[p]] = [M[p], M[i]];
      d = -d;
    }
    d *= M[i][i];
    for (let k = i + 1; k < M.length; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j < M.length; j++) M[k][j] -= f * M[i][j];
    }
  }
  return d;
}
// Every value in a row that can be printed: numbers as calculator answers, the rest as themselves.
export const show = v => (num(v) ? calcFmt(v) : String(v));
