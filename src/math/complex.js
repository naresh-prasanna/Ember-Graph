import { calcFmt } from './format.js';

/* Complex numbers a + bi, drawn on the Argand plane. A result whose imaginary part vanishes is an ordinary
   number again, so i² = −1 works like any constant. A part below the rounding error of the other counts as 0:
   e^(iπ) comes out as −1, not −1 + 1.2·10⁻¹⁶ i. */
export class Complex {
  constructor(re, im) {
    this.re = re;
    this.im = im;
  }
  toString() {
    return complexText(this.re, this.im);
  }
}
const TINY = 1e-14;
export function cx(re, im) {
  if (Math.abs(im) <= TINY * Math.abs(re)) im = 0;
  else if (Math.abs(re) <= TINY * Math.abs(im)) re = 0;
  return im === 0 ? re : new Complex(re, im);
}
export const isComplex = v => v instanceof Complex;
export const I = new Complex(0, 1);
const parts = v => (v instanceof Complex ? [v.re, v.im] : [v, 0]);
export const reOf = v => parts(v)[0],
  imOf = v => parts(v)[1];

// 3 + 2i, 1 − i, −2i: the coefficient 1 is left out.
export function complexText(re, im, f = calcFmt) {
  if (!im) return f(re);
  const b = f(Math.abs(im)),
    coef = b === '1' ? '' : b,
    sign = im < 0 ? '-' : '+';
  if (f(re) === '0') return (im < 0 ? '-' : '') + coef + 'i';
  return `${f(re)} ${sign} ${coef}i`;
}

const add = ([a, b], [c, d]) => cx(a + c, b + d),
  mul = ([a, b], [c, d]) => cx(a * c - b * d, a * d + b * c);
// Smith's division, which neither overflows nor underflows on the way to a representable answer.
function div([a, b], [c, d]) {
  if (Math.abs(c) >= Math.abs(d)) {
    const r = d / c,
      t = c + d * r;
    return cx((a + b * r) / t, (b - a * r) / t);
  }
  const r = c / d,
    t = c * r + d;
  return cx((a * r + b) / t, (b * r - a) / t);
}
const exp = ([a, b]) => {
    const m = Math.exp(a);
    return cx(m * Math.cos(b), m * Math.sin(b));
  },
  ln = ([a, b]) => cx(Math.log(Math.hypot(a, b)), Math.atan2(b, a));
function pow(z, w) {
  const [a, b] = parts(z),
    [c, d] = parts(w);
  // Whole powers by repeated squaring stay exact: i² is −1 and (1 + i)⁴ is −4.
  if (!d && Number.isInteger(c) && Math.abs(c) <= 1024) {
    let base = [a, b],
      out = [1, 0];
    for (let k = Math.abs(c); k > 0; k >>= 1) {
      if (k & 1) out = parts(mul(out, base));
      base = parts(mul(base, base));
    }
    return c < 0 ? div([1, 0], out) : cx(...out);
  }
  if (!a && !b) return c > 0 ? 0 : NaN;
  return exp(parts(mul(parts(ln([a, b])), [c, d])));
}
function sqrt([a, b]) {
  const r = Math.hypot(a, b),
    re = Math.sqrt((r + a) / 2),
    im = Math.sqrt((r - a) / 2);
  return cx(re, b < 0 ? -im : im);
}
const sin = ([a, b]) => cx(Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)),
  cos = ([a, b]) => cx(Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)),
  sinh = ([a, b]) => cx(Math.sinh(a) * Math.cos(b), Math.cosh(a) * Math.sin(b)),
  cosh = ([a, b]) => cx(Math.cosh(a) * Math.cos(b), Math.sinh(a) * Math.sin(b)),
  ratio = (f, g) => z => div(parts(f(z)), parts(g(z)));

// Arithmetic with at least one complex side.
export function complexOp(op, a, b) {
  const p = parts(a),
    q = parts(b);
  if (op === '+') return add(p, q);
  if (op === '-') return add(p, [-q[0], -q[1]]);
  if (op === '*') return mul(p, q);
  if (op === '/') return div(p, q);
  if (op === '^') return pow(a, b);
  throw Error(`Complex numbers can't be combined with ${op}`);
}
export const complexNegate = z => new Complex(-z.re, -z.im);

/* The functions that accept complex numbers, each on the principal branch. They also take real inputs, so
   √(−4) can be 2i where a value is wanted rather than a graph. */
const unary = f => z => f(parts(z));
export const complexFns = {
  re: z => reOf(z),
  im: z => imOf(z),
  conj: z => cx(reOf(z), -imOf(z)),
  abs: z => Math.hypot(...parts(z)),
  arg: z => Math.atan2(imOf(z), reOf(z)),
  sqrt: unary(sqrt),
  cbrt: z => pow(z, 1 / 3),
  exp: unary(exp),
  ln: unary(ln),
  log: (z, base) => div(parts(ln(parts(z))), base === undefined ? [Math.LN10, 0] : parts(ln(parts(base)))),
  pow,
  sin: unary(sin),
  cos: unary(cos),
  tan: unary(ratio(sin, cos)),
  sec: unary(z => div([1, 0], parts(cos(z)))),
  csc: unary(z => div([1, 0], parts(sin(z)))),
  cot: unary(ratio(cos, sin)),
  sinh: unary(sinh),
  cosh: unary(cosh),
  tanh: unary(ratio(sinh, cosh)),
};
complexFns.real = complexFns.re;
complexFns.imag = complexFns.im;
// Real functions that leave the reals for some real inputs: √(−4) = 2i, ln(−1) = iπ, (−8)^(1/3) = 1 + i√3.
export const PROMOTE = new Set(['sqrt', 'ln', 'log', 'pow']);
