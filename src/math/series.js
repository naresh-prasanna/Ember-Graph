/* Power series about 0 with exact fractions, for the integrals that have no formula: ∫ tan(x²) dx is
   x³/3 + x⁷/21 + 2x¹¹/165 + …, found by expanding tan(x²) and integrating term by term.
   A series is an array of coefficients [c₀, c₁, …]; its length is how many of them are known. Anything that
   would need an irrational coefficient (sin(1 + x), π·x) or that blows up at 0 (1/x, ln x) gives null. */

const LEN = 24;
const big = n => BigInt(n),
  babs = n => (n < 0n ? -n : n),
  bgcd = (a, b) => {
    a = babs(a);
    b = babs(b);
    while (b) [a, b] = [b, a % b];
    return a;
  };
function R(p, q = 1n) {
  if (q < 0n) [p, q] = [-p, -q];
  const g = bgcd(p, q) || 1n;
  return { p: p / g, q: q / g };
}
const ZERO = R(0n),
  ONE = R(1n),
  add = (a, b) => R(a.p * b.q + b.p * a.q, a.q * b.q),
  mul = (a, b) => R(a.p * b.p, a.q * b.q),
  div = (a, b) => R(a.p * b.q, a.q * b.p),
  neg = a => R(-a.p, a.q),
  isZero = a => a.p === 0n;

// A decimal as typed (0.25) is an exact fraction; anything longer than a float can say is refused.
function exact(v) {
  if (!Number.isFinite(v)) return null;
  if (Number.isInteger(v)) return R(big(v));
  const s = String(v);
  if (/e/i.test(s) || s.length > 15) return null;
  const [i, f] = s.split('.');
  return R(big(i + f), 10n ** big(f.length));
}

const constant = (c, n = LEN) => Array.from({ length: n }, (_, i) => (i ? ZERO : c));
const sAdd = (a, b) => Array.from({ length: Math.min(a.length, b.length) }, (_, i) => add(a[i], b[i]));
const sNeg = a => a.map(neg);
function sMul(a, b) {
  const n = Math.min(a.length, b.length),
    out = Array(n).fill(ZERO);
  for (let i = 0; i < n; i++) {
    if (isZero(a[i])) continue;
    for (let j = 0; i + j < n; j++) if (!isZero(b[j])) out[i + j] = add(out[i + j], mul(a[i], b[j]));
  }
  return out;
}
// a / b; leading zeros of b must be matched by a (sin(x)/x is fine, 1/x is not).
function sDiv(a, b) {
  const k = b.findIndex(c => !isZero(c));
  if (k < 0 || a.slice(0, k).some(c => !isZero(c))) return null;
  const A = a.slice(k),
    B = b.slice(k),
    n = Math.min(A.length, B.length),
    out = [];
  for (let i = 0; i < n; i++) {
    let s = A[i];
    for (let j = 1; j <= i; j++) s = add(s, neg(mul(B[j], out[i - j])));
    out.push(div(s, B[0]));
  }
  return out;
}
// f(g) for g(0) = 0, where f is given by its own coefficients.
function compose(F, g) {
  if (!isZero(g[0])) return null;
  let out = constant(F[0], g.length),
    pow = constant(ONE, g.length);
  for (let k = 1; k < g.length && k < F.length; k++) {
    pow = sMul(pow, g);
    if (!isZero(F[k]))
      out = sAdd(
        out,
        pow.map(c => mul(c, F[k])),
      );
  }
  return out;
}
const fact = n => (n < 2 ? 1n : big(n) * fact(n - 1));
const coeffs = f => Array.from({ length: LEN }, (_, k) => f(k));
const KNOWN = {
  exp: coeffs(k => R(1n, fact(k))),
  sin: coeffs(k => (k % 2 ? R(k % 4 === 1 ? 1n : -1n, fact(k)) : ZERO)),
  cos: coeffs(k => (k % 2 ? ZERO : R(k % 4 === 0 ? 1n : -1n, fact(k)))),
  sinh: coeffs(k => (k % 2 ? R(1n, fact(k)) : ZERO)),
  cosh: coeffs(k => (k % 2 ? ZERO : R(1n, fact(k)))),
  arctan: coeffs(k => (k % 2 ? R(k % 4 === 1 ? 1n : -1n, big(k)) : ZERO)),
  atanh: coeffs(k => (k % 2 ? R(1n, big(k)) : ZERO)),
  // ln(1 + u)
  ln1: coeffs(k => (k ? R(k % 2 ? 1n : -1n, big(k)) : ZERO)),
  // arcsin u = Σ (2n)! / (4ⁿ (n!)² (2n + 1)) u^(2n+1)
  arcsin: coeffs(k => {
    if (k % 2 === 0) return ZERO;
    const n = (k - 1) / 2;
    return R(fact(2 * n), 4n ** big(n) * fact(n) ** 2n * big(k));
  }),
};
KNOWN.asinh = KNOWN.arcsin.map((c, k) => (k % 4 === 3 ? neg(c) : c));
const RATIO = { tan: ['sin', 'cos'], tanh: ['sinh', 'cosh'], cot: ['cos', 'sin'], coth: ['cosh', 'sinh'] },
  RECIP = { sec: 'cos', csc: 'sin', sech: 'cosh', csch: 'sinh' };
KNOWN.atan = KNOWN.arctan;
KNOWN.asin = KNOWN.arcsin;

// The t-th root of a whole number, when it is one.
function root(n, t) {
  if (n < 0n) return t % 2n ? (r => (r === null ? null : -r))(root(-n, t)) : null;
  let r = big(Math.round(Number(n) ** (1 / Number(t))));
  for (const c of [r - 1n, r, r + 1n]) if (c >= 0n && c ** t === n) return c;
  return null;
}
// a^r for a rational r: whole powers by multiplying, others by Miller's recurrence when a(0)^r is exact.
function sPow(a, r) {
  if (r.q === 1n) {
    if (r.p >= 0n) {
      if (r.p > 60n) return null;
      let out = constant(ONE, a.length);
      for (let i = 0n; i < r.p; i++) out = sMul(out, a);
      return out;
    }
    const p = sPow(a, R(-r.p));
    return p && sDiv(constant(ONE, a.length), p);
  }
  const a0 = a[0];
  if (isZero(a0)) return null;
  const top = root(a0.p, r.q),
    bot = root(a0.q, r.q);
  if (top === null || bot === null) return null;
  const b0 = R(top ** babs(r.p), bot ** babs(r.p)),
    out = [r.p < 0n ? div(ONE, b0) : b0];
  for (let n = 1; n < a.length; n++) {
    let s = ZERO;
    for (let k = 1; k <= n; k++) {
      const w = add(mul(add(r, ONE), R(big(k))), R(big(-n)));
      s = add(s, mul(mul(w, a[k]), out[n - k]));
    }
    out.push(div(s, mul(R(big(n)), a0)));
  }
  return out;
}

const numOf = e =>
  e.k === 'num'
    ? exact(e.v)
    : e.k === 'unary' && e.op === '-'
      ? (x => x && neg(x))(numOf(e.a))
      : e.k === 'binary' && e.op === '/'
        ? (a => (b => (a && b && !isZero(b) ? div(a, b) : null))(numOf(e.b)))(numOf(e.a))
        : null;

export function seriesOf(e, v) {
  if (!e || typeof e !== 'object') return null;
  if (e.k === 'num') return (c => c && constant(c))(exact(e.v));
  if (e.k === 'name') return e.n === v ? constant(ZERO).map((c, i) => (i === 1 ? ONE : c)) : null;
  if (e.k === 'unary') return (a => a && (e.op === '-' ? sNeg(a) : a))(seriesOf(e.a, v));
  if (e.k === 'binary') {
    if (e.op === '^') {
      if (e.a.k === 'name' && e.a.n === 'e') return fn('exp', e.b, v);
      const r = numOf(e.b),
        a = seriesOf(e.a, v);
      return r && a ? sPow(a, r) : null;
    }
    const a = seriesOf(e.a, v),
      b = a && seriesOf(e.b, v);
    if (!b) return null;
    if (e.op === '+') return sAdd(a, b);
    if (e.op === '-') return sAdd(a, sNeg(b));
    if (e.op === '*') return sMul(a, b);
    if (e.op === '/') return sDiv(a, b);
    return null;
  }
  if (e.k === 'call' && e.a.length === 1) return fn(e.n, e.a[0], v);
  return null;
}
function fn(n, arg, v) {
  const g = seriesOf(arg, v);
  if (!g) return null;
  if (n === 'sqrt') return sPow(g, R(1n, 2n));
  if (n === 'cbrt') return sPow(g, R(1n, 3n));
  if (n === 'ln') return isZero(add(g[0], neg(ONE))) ? compose(KNOWN.ln1, sAdd(g, constant(neg(ONE)))) : null;
  if (n in RATIO) {
    const [a, b] = RATIO[n].map(f => compose(KNOWN[f], g));
    return a && b && sDiv(a, b);
  }
  if (n in RECIP) {
    const b = compose(KNOWN[RECIP[n]], g);
    return b && sDiv(constant(ONE, b.length), b);
  }
  return n in KNOWN ? compose(KNOWN[n], g) : null;
}

/* The first few terms of ∫ f dv about 0, as { integrand, antiderivative }: each a list of
   { c: [p, q] as numbers, k: power } for the nonzero terms shown, or null when f has no such series. */
export function integralSeries(f, v, terms = 4) {
  const s = seriesOf(f, v);
  if (!s) return null;
  const F = [ZERO, ...s.map((c, k) => div(c, R(big(k + 1))))].slice(0, s.length),
    pick = list =>
      list
        .map((c, k) => ({ c, k }))
        .filter(t => !isZero(t.c))
        .slice(0, terms)
        .map(({ c, k }) => ({ c: [Number(c.p), Number(c.q)], k })),
    out = { integrand: pick(s), antiderivative: pick(F) };
  const ok = list => list.length && list.every(t => t.c.every(Number.isSafeInteger));
  return ok(out.integrand) && ok(out.antiderivative) ? out : null;
}

/* ----- The same with decimals, about any point ----- */
/* When the coefficients can't be fractions (log base 10 brings in 1/ln 10, sin(1 + x) brings in sin 1) or the
   function blows up at 0, the series is taken about another point in floating point instead: ∫ arctan(log x) dx
   about x = 1. Each function's series comes from its derivative, the way the ones above come from tables. */
const FN = 14;
const shorter = (a, b) => Math.min(a.length, b.length),
  fConst = (c, n = FN) => Array.from({ length: n }, (_, i) => (i ? 0 : c)),
  fAdd = (a, b) => Array.from({ length: shorter(a, b) }, (_, i) => a[i] + b[i]),
  fScale = (a, k) => a.map(x => x * k),
  fDer = a => a.slice(1).map((x, i) => x * (i + 1)),
  fInt = (a, c0 = 0) => [c0, ...a.map((x, i) => x / (i + 1))],
  small = x => Math.abs(x) < 1e-12;
function fMul(a, b) {
  const n = shorter(a, b),
    out = Array(n).fill(0);
  for (let i = 0; i < n; i++) if (a[i]) for (let j = 0; i + j < n; j++) out[i + j] += a[i] * b[j];
  return out;
}
function fDiv(a, b) {
  let k = 0;
  while (k < b.length && small(b[k])) k++;
  if (k === b.length || a.slice(0, k).some(x => !small(x))) return null;
  const A = a.slice(k),
    B = b.slice(k),
    out = [];
  for (let i = 0; i < shorter(A, B); i++) {
    let s = A[i];
    for (let j = 1; j <= i; j++) s -= B[j] * out[i - j];
    out.push(s / B[0]);
  }
  return out;
}
// e^g, from (e^g)′ = g′·e^g.
function fExp(g) {
  const b = [Math.exp(g[0])];
  for (let n = 1; n < g.length; n++) {
    let s = 0;
    for (let k = 1; k <= n; k++) s += k * g[k] * b[n - k];
    b.push(s / n);
  }
  return b;
}
// sin g and cos g together (sinh and cosh with `hyper`), from s′ = g′c and c′ = ∓g′s.
function fSinCos(g, hyper) {
  const s = [hyper ? Math.sinh(g[0]) : Math.sin(g[0])],
    c = [hyper ? Math.cosh(g[0]) : Math.cos(g[0])];
  for (let n = 1; n < g.length; n++) {
    let ss = 0,
      cc = 0;
    for (let k = 1; k <= n; k++) {
      ss += k * g[k] * c[n - k];
      cc += k * g[k] * s[n - k];
    }
    s.push(ss / n);
    c.push(((hyper ? 1 : -1) * cc) / n);
  }
  return [s, c];
}
// g^r by Miller's recurrence; a negative g only for whole powers and odd roots.
function fPow(g, r, oddRoot = false) {
  if (Number.isInteger(r) && r >= 0 && r <= 60) {
    let out = fConst(1, g.length);
    for (let i = 0; i < r; i++) out = fMul(out, g);
    return out;
  }
  if (Number.isInteger(r) && r < 0) {
    const p = fPow(g, -r);
    return p && fDiv(fConst(1, g.length), p);
  }
  const g0 = g[0];
  if (small(g0) || (g0 < 0 && !oddRoot)) return null;
  const b = [g0 < 0 ? -((-g0) ** r) : g0 ** r];
  for (let n = 1; n < g.length; n++) {
    let s = 0;
    for (let k = 1; k <= n; k++) s += (k * r - (n - k)) * g[k] * b[n - k];
    b.push(s / (n * g0));
  }
  return b;
}
// F(g) = F(g₀) + ∫ F′(g)·g′, for the functions known by their derivative.
const viaDerivative = (g, F0, dF) => (dF ? fInt(fMul(dF, fDer(g)).slice(0, g.length - 1), F0) : null);
const ROOT_PI = Math.sqrt(Math.PI);
function fCall(n, args, v, a, env) {
  if (n === 'log' && args.length === 2) {
    const [x, b] = args.map(e => fSeries(e, v, a, env));
    const lx = x && fCall('ln', [args[0]], v, a, env),
      lb = b && fCall('ln', [args[1]], v, a, env);
    return lx && lb && fDiv(lx, lb);
  }
  if ((n === 'nthroot' || n === 'pow') && args.length === 2) {
    const g = fSeries(args[0], v, a, env),
      k = fSeries(args[1], v, a, env);
    if (!g || !k || k.slice(1).some(x => !small(x))) return null;
    if (n === 'pow') return fPow(g, k[0]);
    return fPow(g, 1 / k[0], Math.abs(k[0] % 2) === 1);
  }
  if (args.length !== 1) return null;
  const g = fSeries(args[0], v, a, env);
  if (!g) return null;
  const g0 = g[0],
    one = fConst(1, g.length),
    sq = fMul(g, g),
    [s, c] = fSinCos(g, false),
    [sh, ch] = fSinCos(g, true);
  switch (n) {
    case 'exp':
      return fExp(g);
    case 'ln':
      return g0 > 0 && !small(g0) ? viaDerivative(g, Math.log(g0), fDiv(one, g)) : null;
    case 'log':
      return (l => l && fScale(l, 1 / Math.LN10))(fCall('ln', args, v, a, env));
    case 'log2':
      return (l => l && fScale(l, 1 / Math.LN2))(fCall('ln', args, v, a, env));
    case 'sqrt':
      return fPow(g, 1 / 2);
    case 'cbrt':
      return fPow(g, 1 / 3, true);
    case 'abs':
      return small(g0) ? null : fScale(g, Math.sign(g0));
    case 'sin':
      return s;
    case 'cos':
      return c;
    case 'tan':
      return fDiv(s, c);
    case 'cot':
      return fDiv(c, s);
    case 'sec':
      return fDiv(one, c);
    case 'csc':
      return fDiv(one, s);
    case 'sinh':
      return sh;
    case 'cosh':
      return ch;
    case 'tanh':
      return fDiv(sh, ch);
    case 'coth':
      return fDiv(ch, sh);
    case 'sech':
      return fDiv(one, ch);
    case 'csch':
      return fDiv(one, sh);
    case 'arctan':
    case 'atan':
      return viaDerivative(g, Math.atan(g0), fDiv(one, fAdd(one, sq)));
    case 'arccot':
      return viaDerivative(g, Math.PI / 2 - Math.atan(g0), fScale(fDiv(one, fAdd(one, sq)), -1));
    case 'arcsin':
    case 'asin':
      return Math.abs(g0) < 1
        ? viaDerivative(g, Math.asin(g0), fPow(fAdd(one, fScale(sq, -1)), -1 / 2))
        : null;
    case 'arccos':
    case 'acos':
      return Math.abs(g0) < 1
        ? viaDerivative(g, Math.acos(g0), fScale(fPow(fAdd(one, fScale(sq, -1)), -1 / 2) || [], -1))
        : null;
    case 'asinh':
      return viaDerivative(g, Math.asinh(g0), fPow(fAdd(one, sq), -1 / 2));
    case 'acosh':
      return g0 > 1 ? viaDerivative(g, Math.acosh(g0), fPow(fAdd(sq, fScale(one, -1)), -1 / 2)) : null;
    case 'atanh':
      return Math.abs(g0) < 1 ? viaDerivative(g, Math.atanh(g0), fDiv(one, fAdd(one, fScale(sq, -1)))) : null;
    case 'erf':
      return viaDerivative(g, env.math.erf(g0), fScale(fExp(fScale(sq, -1)), 2 / ROOT_PI));
    case 'erfi':
      return viaDerivative(g, env.math.erfi(g0), fScale(fExp(sq), 2 / ROOT_PI));
    case 'Si':
    case 'Shi':
    case 'Ci':
    case 'Chi':
      if ((n === 'Ci' || n === 'Chi') && small(g0)) return null;
      return viaDerivative(g, env.math[n](g0), fDiv({ Si: s, Ci: c, Shi: sh, Chi: ch }[n], g));
    case 'Ei':
      return small(g0) ? null : viaDerivative(g, env.math.Ei(g0), fDiv(fExp(g), g));
  }
  return null;
}
const CONSTANT_NAMES = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
function fSeries(e, v, a, env) {
  if (!e || typeof e !== 'object') return null;
  if (e.k === 'num') return fConst(e.v);
  if (e.k === 'name')
    return e.n === v
      ? fConst(a).map((c, i) => (i === 1 ? 1 : c))
      : e.n in CONSTANT_NAMES
        ? fConst(CONSTANT_NAMES[e.n])
        : null;
  if (e.k === 'unary') return (x => x && (e.op === '-' ? fScale(x, -1) : x))(fSeries(e.a, v, a, env));
  if (e.k === 'binary') {
    const x = fSeries(e.a, v, a, env),
      y = x && fSeries(e.b, v, a, env);
    if (!y) return null;
    if (e.op === '+') return fAdd(x, y);
    if (e.op === '-') return fAdd(x, fScale(y, -1));
    if (e.op === '*') return fMul(x, y);
    if (e.op === '/') return fDiv(x, y);
    if (e.op === '^') {
      const constPow = y.slice(1).every(small);
      if (constPow) return fPow(x, y[0]);
      // b^h = e^(h ln b), and g^h the same with ln g.
      const l = fCall('ln', [e.a], v, a, env);
      return l && fExp(fMul(y, l));
    }
    return null;
  }
  if (e.k === 'call') return fCall(e.n, e.a, v, a, env);
  return null;
}
const CENTERS = [0, 1, -1, 2, 0.5, -2, 3, -0.5];
const shift = (e, v, a) =>
  !e || typeof e !== 'object'
    ? e
    : e.k === 'name' && e.n === v
      ? { k: 'binary', op: '+', a: { k: 'num', v: a }, b: { k: 'name', n: v } }
      : Object.fromEntries(
          Object.entries(e).map(([key, x]) => [
            key,
            Array.isArray(x) ? x.map(y => shift(y, v, a)) : shift(x, v, a),
          ]),
        );
/* ∫ f dv as a series about the first point it has one: { center, exact, integrand, antiderivative }, with
   the same lists as integralSeries but in powers of (v − center), and decimal coefficients when not exact.
   The antiderivative is the one that is 0 at the center. Null when f has a series nowhere nearby. */
export function antiderivativeSeries(f, v, math, terms = 4) {
  for (const a of CENTERS) {
    const exact = integralSeries(a ? shift(f, v, a) : f, v, terms);
    if (exact) return { center: a, exact: true, ...exact };
    const s = fSeries(f, v, a, { math });
    if (!s || !s.length || !s.every(Number.isFinite)) continue;
    const F = fInt(s).slice(0, s.length),
      scale = Math.max(...s.map(Math.abs), 1e-300),
      pick = list =>
        list
          .map((c, k) => ({ c, k }))
          .filter(t => Math.abs(t.c) > 1e-13 * scale)
          .slice(0, Math.min(terms, 3)),
      out = { integrand: pick(s), antiderivative: pick(F) };
    if (out.antiderivative.length) return { center: a, exact: false, ...out };
  }
  return null;
}
