import { math, own } from './catalog.js';
import { evaluate } from './parser.js';
import { antiderivativeSeries } from './series.js';

/* Calculus by hand on the parser's trees: d/dx as a formula, antiderivatives for the common forms, and enough
   simplifying that answers read like a textbook's: 2x rather than 2·x^1·1 + 0. */

const fmt = v => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(10)));
const num = v => (v < 0 ? neg({ k: 'num', v: -v, raw: fmt(-v) }) : { k: 'num', v, raw: fmt(v) }),
  name = n => ({ k: 'name', n }),
  bin = (op, a, b) => ({ k: 'binary', op, a, b }),
  call = (n, ...a) => ({ k: 'call', n, a }),
  neg = a => ({ k: 'unary', op: '-', a }),
  key = e => JSON.stringify(e, (k, v) => (k === 'raw' ? undefined : v));

export function depends(e, v) {
  if (!e || typeof e !== 'object') return false;
  if (e.k === 'name') return e.n === v;
  return Object.values(e).some(x => depends(x, v));
}
const map = (e, f) => ({
  ...e,
  ...(e.a !== undefined && { a: Array.isArray(e.a) ? e.a.map(f) : f(e.a) }),
  ...(e.b !== undefined && { b: f(e.b) }),
});
function subst(e, v, r) {
  if (!e || typeof e !== 'object') return e;
  if (e.k === 'name') return e.n === v ? r : e;
  return map(e, x => subst(x, v, r));
}

/* ----- Exact fractions for coefficients, so x³/3 stays a third ----- */
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
function rat(p, q = 1) {
  if (Number.isInteger(p) && Number.isInteger(q) && q) {
    const g = gcd(p, q) || 1;
    return q < 0 ? { p: -p / g, q: -q / g } : { p: p / g, q: q / g };
  }
  return { p: p / q, q: 1 };
}
const rmul = (a, b) => rat(a.p * b.p, a.q * b.q),
  radd = (a, b) => rat(a.p * b.q + b.p * a.q, a.q * b.q),
  rval = a => a.p / a.q;
// The number an exponent tree stands for, when it is one: 2, −1, 1/2.
function numVal(e) {
  if (e.k === 'num') return rat(e.v);
  if (e.k === 'unary' && e.op === '-') {
    const r = numVal(e.a);
    return r && rat(-r.p, r.q);
  }
  if (e.k === 'binary' && e.op === '/') {
    const a = numVal(e.a),
      b = numVal(e.b);
    return a && b && b.p ? rmul(a, rat(b.q, b.p)) : null;
  }
  return null;
}
const ratNode = r =>
  r.q === 1 ? num(r.p) : r.p < 0 ? neg(bin('/', num(-r.p), num(r.q))) : bin('/', num(r.p), num(r.q));

/* ----- Simplifying: a sum of terms, each a coefficient times powers ----- */
// A product: { c: fraction, f: Map(key → { base, exp }) }.
function product(e) {
  const out = { c: rat(1), f: new Map() },
    put = (base, exp) => {
      const k = key(base),
        had = out.f.get(k);
      out.f.set(k, { base, exp: had ? simplify(bin('+', had.exp, exp)) : exp });
    },
    merge = (p, by = rat(1), inv = false) => {
      out.c = rmul(out.c, powRat(p.c, inv ? rat(-by.p, by.q) : by));
      for (const { base, exp } of p.f.values())
        put(base, simplify(inv ? neg(bin('*', exp, ratNode(by))) : bin('*', exp, ratNode(by))));
    };
  if (e.k === 'num') out.c = rat(e.v);
  else if (e.k === 'unary' && e.op === '-') {
    merge(product(e.a));
    out.c = rmul(out.c, rat(-1));
  } else if (e.k === 'binary' && e.op === '*') (merge(product(e.a)), merge(product(e.b)));
  else if (e.k === 'binary' && e.op === '/') (merge(product(e.a)), merge(product(e.b), rat(1), true));
  else if (e.k === 'binary' && e.op === '^') {
    const n = numVal(e.b),
      b = simplify(e.a),
      p = product(b);
    if (n && n.q === 1) merge(p, n);
    else if (n && p.f.size === 0 && exactPow(p.c, n)) out.c = rmul(out.c, exactPow(p.c, n));
    else put(b, simplify(e.b));
  } else if (e.k === 'call' && e.n === 'sqrt' && e.a.length === 1)
    merge(product(bin('^', e.a[0], bin('/', one, two))));
  else if (e.k === 'call' && e.n === 'exp' && e.a.length === 1) put(name('e'), simplify(e.a[0]));
  else {
    const s =
      e.k === 'call' ? simpleCall(e) : e.k === 'binary' && (e.op === '+' || e.op === '-') ? simplify(e) : e;
    if (s.k !== e.k || (s.k === 'binary' && s.op !== '+' && s.op !== '-')) merge(product(s));
    else put(s, num(1));
  }
  return out;
}
// 4^(1/2) = 2 and (1/8)^(1/3) = 1/2 stay exact; anything else stays a power.
function exactPow(c, n) {
  const p = Math.sign(c.p) * Math.abs(c.p) ** rval(n),
    q = c.q ** rval(n),
    r = x => Math.abs(x - Math.round(x)) < 1e-9;
  return c.p > 0 && r(p) && r(q) ? rat(Math.round(p), Math.round(q)) : null;
}
function powRat(c, n) {
  if (n.q !== 1) return exactPow(c, n) || rat(Math.pow(rval(c), rval(n)));
  const k = Math.abs(n.p),
    r = rat(c.p ** k, c.q ** k);
  return n.p < 0 ? rat(r.q, r.p) : r;
}
function simpleCall(e) {
  const a = e.a.map(simplify),
    [u] = a;
  if (a.length === 1) {
    if (e.n === 'ln' && u.k === 'name' && u.n === 'e') return num(1);
    if ((e.n === 'ln' || e.n === 'log') && u.k === 'num' && u.v === 1) return num(0);
    if (['sin', 'tan', 'sinh', 'tanh', 'arcsin', 'arctan'].includes(e.n) && u.k === 'num' && u.v === 0)
      return num(0);
    if (['cos', 'cosh', 'exp'].includes(e.n) && u.k === 'num' && u.v === 0) return num(1);
    if (e.n === 'abs' && u.k === 'num') return u;
    // Odd and even: sin(−x) = −sin(x), cos(−x) = cos(x).
    if (u.k === 'unary' && u.op === '-') {
      if (['sin', 'tan', 'sinh', 'tanh', 'arcsin', 'arctan'].includes(e.n)) return neg(call(e.n, u.a));
      if (['cos', 'cosh', 'sec', 'abs'].includes(e.n)) return call(e.n, u.a);
    }
  }
  return { ...e, a };
}
// The terms of a sum, like terms collected: { key → { c, f: [{ base, exp }] } }. A number times a sum is
// multiplied out, so 2(x + 1) adds up with the rest.
function terms(e, m = rat(1), out = new Map()) {
  if (e.k === 'binary' && (e.op === '+' || e.op === '-')) {
    terms(e.a, m, out);
    terms(e.b, e.op === '-' ? rmul(m, rat(-1)) : m, out);
  } else if (e.k === 'unary' && e.op === '-') terms(e.a, rmul(m, rat(-1)), out);
  else if (e.k === 'unary' && e.op === '+') terms(e.a, m, out);
  else {
    const p = product(e),
      f = [...p.f.entries()]
        .filter(([, x]) => !(numVal(x.exp)?.p === 0))
        .sort(([a], [b]) => (a < b ? -1 : 1)),
      c = rmul(p.c, m);
    if (f.length === 1 && numVal(f[0][1].exp)?.p === 1 && numVal(f[0][1].exp)?.q === 1) {
      const b = f[0][1].base;
      if (b.k === 'binary' && (b.op === '+' || b.op === '-')) return terms(b, c, out);
    }
    const k = key(f.map(([k2, x]) => [k2, key(x.exp)])),
      had = out.get(k);
    out.set(k, had ? { ...had, c: radd(had.c, c) } : { c, f: f.map(([, x]) => x) });
  }
  return out;
}
const degree = (t, v) => {
  const x = t.f.find(({ base }) => base.k === 'name' && base.n === v),
    n = x && numVal(x.exp);
  return n ? rval(n) : x ? 0.5 : t.f.length ? -0.5 : -1;
};
function power(base, exp) {
  const n = numVal(exp);
  if (n && n.p === n.q) return base;
  if (n && n.p === 1 && n.q === 2) return call('sqrt', base);
  return bin('^', base, exp);
}
// Constants first, then powers of the variable, then everything else: 2a·x²·sin(x), x·eˣ.
const rank = ({ base }) =>
  base.k === 'num'
    ? 0
    : base.k === 'name'
      ? base.n !== mainVar && base.n !== 'e'
        ? 1
        : base.n === mainVar
          ? 2
          : 3
      : 4;
function fromTerm({ c, f }) {
  if (c.p === 0) return num(0);
  const top = [],
    bot = [];
  for (const { base, exp } of [...f].sort((a, b) => rank(a) - rank(b))) {
    const n = numVal(exp);
    if (n && n.p < 0) bot.push(power(base, ratNode(rat(-n.p, n.q))));
    else top.push(power(base, exp));
  }
  const p = Math.abs(c.p);
  if (p !== 1 || !top.length) top.unshift(num(p));
  if (c.q !== 1) bot.unshift(num(c.q));
  const join = xs => xs.reduce((a, b) => bin('*', a, b)),
    out = bot.length ? bin('/', join(top), join(bot)) : join(top);
  return c.p < 0 ? neg(out) : out;
}
let mainVar = 'x';
export function simplify(e) {
  if (!e || typeof e !== 'object') return e;
  if (e.k === 'num') return num(e.v);
  if (e.k === 'name') return e;
  if (e.k === 'call') return e.n === 'sqrt' || e.n === 'exp' ? fromSum(terms(e)) : simpleCall(e);
  if (e.k === 'unary' || (e.k === 'binary' && '+-*/^'.includes(e.op))) return fromSum(terms(e));
  return map(e, simplify);
}
function fromSum(t) {
  const list = [...t.values()]
    .filter(x => x.c.p !== 0)
    .sort((a, b) => degree(b, mainVar) - degree(a, mainVar));
  if (!list.length) return num(0);
  let out = fromTerm(list[0]);
  for (const x of list.slice(1))
    out = x.c.p < 0 ? bin('-', out, fromTerm({ ...x, c: rat(-x.c.p, x.c.q) })) : bin('+', out, fromTerm(x));
  return out;
}

/* ----- Derivatives ----- */
const one = num(1),
  two = num(2),
  sq = u => bin('^', u, two),
  inv = u => bin('/', one, u);
const DERIV = {
  sin: u => call('cos', u),
  cos: u => neg(call('sin', u)),
  tan: u => sq(call('sec', u)),
  sec: u => bin('*', call('sec', u), call('tan', u)),
  csc: u => neg(bin('*', call('csc', u), call('cot', u))),
  cot: u => neg(sq(call('csc', u))),
  exp: u => call('exp', u),
  ln: u => inv(u),
  log: u => inv(bin('*', u, call('ln', num(10)))),
  log2: u => inv(bin('*', u, call('ln', two))),
  sqrt: u => inv(bin('*', two, call('sqrt', u))),
  cbrt: u => inv(bin('*', num(3), sq(call('cbrt', u)))),
  abs: u => bin('/', u, call('abs', u)),
  arcsin: u => inv(call('sqrt', bin('-', one, sq(u)))),
  arccos: u => neg(inv(call('sqrt', bin('-', one, sq(u))))),
  arctan: u => inv(bin('+', one, sq(u))),
  arccot: u => neg(inv(bin('+', one, sq(u)))),
  sinh: u => call('cosh', u),
  cosh: u => call('sinh', u),
  tanh: u => sq(call('sech', u)),
  sech: u => neg(bin('*', call('sech', u), call('tanh', u))),
  csch: u => neg(bin('*', call('csch', u), call('coth', u))),
  coth: u => neg(sq(call('csch', u))),
  asinh: u => inv(call('sqrt', bin('+', sq(u), one))),
  acosh: u => inv(call('sqrt', bin('-', sq(u), one))),
  atanh: u => inv(bin('-', one, sq(u))),
  arcsec: u => inv(bin('*', call('abs', u), call('sqrt', bin('-', sq(u), one)))),
  arccsc: u => neg(inv(bin('*', call('abs', u), call('sqrt', bin('-', sq(u), one))))),
  // Flat between the jumps, so 0 wherever there is a slope at all.
  floor: () => num(0),
  ceil: () => num(0),
  round: () => num(0),
  sign: () => num(0),
  erf: u => bin('*', bin('/', two, call('sqrt', name('pi'))), bin('^', name('e'), neg(sq(u)))),
  erfi: u => bin('*', bin('/', two, call('sqrt', name('pi'))), bin('^', name('e'), sq(u))),
  Si: u => bin('/', call('sin', u), u),
  Ci: u => bin('/', call('cos', u), u),
  Ei: u => bin('/', bin('^', name('e'), u), u),
  li: u => inv(call('ln', u)),
  Shi: u => bin('/', call('sinh', u), u),
  Chi: u => bin('/', call('cosh', u), u),
  fresnelS: u => call('sin', bin('/', bin('*', name('pi'), sq(u)), two)),
  fresnelC: u => call('cos', bin('/', bin('*', name('pi'), sq(u)), two)),
};
DERIV.asin = DERIV.arcsin;
DERIV.acos = DERIV.arccos;
DERIV.atan = DERIV.arctan;
DERIV.asec = DERIV.arcsec;
DERIV.acsc = DERIV.arccsc;
function d(e, v) {
  if (!depends(e, v)) return num(0);
  if (e.k === 'name') return one;
  if (e.k === 'unary') return e.op === '-' ? neg(d(e.a, v)) : d(e.a, v);
  if (e.k === 'binary') {
    const { op, a, b } = e;
    if (op === '+' || op === '-') return bin(op, d(a, v), d(b, v));
    if (op === '*') return bin('+', bin('*', d(a, v), b), bin('*', a, d(b, v)));
    if (op === '/') return bin('/', bin('-', bin('*', d(a, v), b), bin('*', a, d(b, v))), sq(b));
    if (op === '^') {
      if (!depends(b, v)) return bin('*', bin('*', b, bin('^', a, bin('-', b, one))), d(a, v));
      if (!depends(a, v)) return bin('*', bin('*', e, call('ln', a)), d(b, v));
      return bin('*', e, bin('+', bin('*', d(b, v), call('ln', a)), bin('/', bin('*', b, d(a, v)), a)));
    }
  }
  if (e.k === 'call') {
    const [u, w] = e.a;
    if (e.n === 'nthroot' && e.a.length === 2) return d(bin('^', u, inv(w)), v);
    if (e.n === 'log' && e.a.length === 2) return d(bin('/', call('ln', u), call('ln', w)), v);
    if (e.n === 'pow' && e.a.length === 2) return d(bin('^', u, w), v);
    if (e.n === 'hypot' && e.a.length === 2) return d(call('sqrt', bin('+', sq(u), sq(w))), v);
    if (e.n === 'mod' && e.a.length === 2 && !depends(w, v)) return d(u, v);
    // ln|u| has the derivative of ln u wherever it is defined, so u′/u rather than u·u′/|u|².
    if (e.n === 'ln' && e.a.length === 1 && u.k === 'call' && u.n === 'abs' && u.a.length === 1)
      return bin('/', d(u.a[0], v), u.a[0]);
    if (own(DERIV, e.n) && e.a.length === 1) return bin('*', DERIV[e.n](u), d(u, v));
    // Piece by piece, with the same conditions: {x < 0: −x, x²}′ is {x < 0: −1, 2x}.
    if (e.n === 'piece')
      return call('piece', ...e.a.map((x, i) => (i % 2 === 0 && i + 1 < e.a.length ? x : d(x, v))));
    if ((e.n === 'sum' || e.n === 'prod') && e.a.length === 4 && e.a[1].n !== v) {
      const [body, n, lo, hi] = e.a;
      if (!depends(lo, v) && !depends(hi, v)) {
        if (e.n === 'sum') return call('sum', d(body, v), n, lo, hi);
        // (Π fₖ)′ = Π fₖ · Σ fₖ′/fₖ
        return bin('*', e, call('sum', bin('/', d(body, v), body), n, lo, hi));
      }
    }
    if (e.n === 'integral' && e.a.length === 2 && e.a[1].k === 'name' && e.a[1].n === v) return u;
    // The fundamental theorem, and Leibniz's rule when the body moves too: d/dx of ∫ from a(x) to b(x) of
    // f(x, t) dt is f(x, b)·b′ − f(x, a)·a′ + ∫ₐᵇ ∂f/∂x dt.
    if (e.n === 'integral' && e.a.length === 4 && e.a[1].k === 'name' && e.a[1].n !== v) {
      const [body, t, lo, hi] = e.a,
        ends = bin('-', bin('*', subst(body, t.n, hi), d(hi, v)), bin('*', subst(body, t.n, lo), d(lo, v)));
      return depends(body, v) ? bin('+', ends, call('integral', d(body, v), t, lo, hi)) : ends;
    }
    throw Error(`There's no rule for the derivative of ${e.n}( ), so this one is graphed numerically`);
  }
  throw Error('This expression has no derivative formula, so it is graphed numerically');
}

/* ----- Antiderivatives ----- */
const lnAbs = u => call('ln', call('abs', u));
const ANTI = {
  sin: u => neg(call('cos', u)),
  cos: u => call('sin', u),
  tan: u => neg(lnAbs(call('cos', u))),
  sec: u => lnAbs(bin('+', call('sec', u), call('tan', u))),
  csc: u => neg(lnAbs(bin('+', call('csc', u), call('cot', u)))),
  cot: u => lnAbs(call('sin', u)),
  exp: u => bin('^', name('e'), u),
  sinh: u => call('cosh', u),
  cosh: u => call('sinh', u),
  tanh: u => lnAbs(call('cosh', u)),
  ln: u => bin('-', bin('*', u, call('ln', u)), u),
  arctan: u => bin('-', bin('*', u, call('arctan', u)), bin('/', call('ln', bin('+', one, sq(u))), two)),
  abs: u => bin('/', bin('*', u, call('abs', u)), two),
  sign: u => call('abs', u),
};
// What f must be squared to give: ∫sec² = tan, and the half-angle forms of sin² and cos².
const ANTI2 = {
  sec: u => call('tan', u),
  csc: u => neg(call('cot', u)),
  sech: u => call('tanh', u),
  tan: u => bin('-', call('tan', u), u),
  cot: u => neg(bin('+', call('cot', u), u)),
  sin: u => bin('-', bin('/', u, two), bin('/', call('sin', bin('*', two, u)), num(4))),
  cos: u => bin('+', bin('/', u, two), bin('/', call('sin', bin('*', two, u)), num(4))),
};
const indep = (e, v) => !depends(e, v),
  names = (e, out = new Set()) => {
    if (e?.k === 'name') out.add(e.n);
    else if (e && typeof e === 'object') for (const x of Object.values(e)) names(x, out);
    return out;
  },
  freeName = e => [...names(e)].some(n => !['e', 'π', 'pi'].includes(n));

/* ----- Steps: how an answer was found, recorded only while someone asks to see them ----- */
let TRACE = null,
  AVOID = new Set(),
  STEPV = 'x';
// `to` came from ∫ `from` d`v` by `rule`. `why` mixes words and formulas, `chain` is the working shown after
// ∫ from = …, and `kids` are the smaller integrals it needed. `id` names a choice another method can skip.
function step(to, rule, from, more = {}) {
  if (to && TRACE) TRACE.set(to, { rule, from, v: STEPV, ...more });
  return to;
}
// Working that simplifying would undo, like multiplying top and bottom by the same thing.
const asIs = e => ({ k: 'asIs', e }),
  // Maths written inline in a sentence, to be set like the formulas around it.
  M = s => ({ k: 'mtext', s }),
  shown = e => (e?.k === 'asIs' ? e.e : simplify(e)),
  avoided = id => AVOID.has(id),
  I = (f, v) => call('integral', f, name(v)),
  dx = v => [' ', M('d' + v)],
  letU = (U, u, du, v) => ['Let ', U, ' = ', u, ', so ', M('d' + U.n), ' = ', du, dx(v)],
  // `dv` null means dv is just dx.
  partsWhy = (u, dv, du, V, v) => [
    M('∫ u dv = uv − ∫ v du'),
    ', with ',
    M('u'),
    ' = ',
    u,
    ' and ',
    M('dv'),
    ' = ',
    ...(dv ? [dv, dx(v)] : [M('d' + v)]),
    '. Then ',
    M('du'),
    ' = ',
    du,
    dx(v),
    ' and ',
    M('v'),
    ' = ',
    V,
  ];
/* How ∫ f(w)ᵖ dw is found for each table entry. Only the ones that undo a basic derivative are quoted; the
   rest are worked out the way they are by hand, from integrals already covered. */
function known(fn, p, w) {
  const u = name(w),
    s = n => call(n, u),
    F = (p === 1 ? ANTI : ANTI2)[fn](u),
    quote = () => ({
      rule: 'Standard integral',
      why: ['The derivative of ', simplify(F), ' is ', power(s(fn), num(p))],
    }),
    by = (x, rule, why) => {
      const keep = AVOID;
      AVOID = new Set();
      try {
        const r = integ(x, w);
        return r && { rule, why, chain: [I(simplify(x), w)], kids: [r] };
      } finally {
        AVOID = keep;
      }
    },
    // ∫ sec: multiply top and bottom by sec + tan, and the top becomes the bottom's derivative (csc likewise).
    clever = (a, b, sign) => {
      const den = bin('+', s(a), s(b)),
        top = bin('+', sq(s(a)), bin('*', s(a), s(b))),
        W = name(w === 'u' ? 'v' : 'u'),
        sub = step(F, 'Substitution', asIs(bin('/', top, den)), {
          v: w,
          why: letU(W, den, simplify(d(den, w)), w),
          chain: [I(sign < 0 ? neg(inv(W)) : inv(W), W.n), sign < 0 ? neg(lnAbs(W)) : lnAbs(W)],
        });
      return {
        rule: 'Multiply by a form of 1',
        why: [
          'Multiply top and bottom by ',
          den,
          '. The new top is ',
          sign < 0 ? 'minus ' : '',
          'the derivative of the bottom',
        ],
        chain: [asIs(I(bin('/', bin('*', s(a), den), den), w)), asIs(I(bin('/', top, den), w))],
        kids: [sub],
      };
    };
  const rewrite = (x, rule, ...why) => by(x, rule, why) || quote();
  if (p === 1) {
    if (fn === 'tan')
      return rewrite(
        bin('/', s('sin'), s('cos')),
        'Write as sine over cosine',
        s('tan'),
        ' = ',
        bin('/', s('sin'), s('cos')),
      );
    if (fn === 'cot')
      return rewrite(
        bin('/', s('cos'), s('sin')),
        'Write as cosine over sine',
        s('cot'),
        ' = ',
        bin('/', s('cos'), s('sin')),
      );
    if (fn === 'tanh')
      return rewrite(
        bin('/', s('sinh'), s('cosh')),
        'Write as sinh over cosh',
        s('tanh'),
        ' = ',
        bin('/', s('sinh'), s('cosh')),
      );
    if (fn === 'sec') return clever('sec', 'tan', 1);
    if (fn === 'csc') return clever('csc', 'cot', -1);
    if (fn === 'ln' || fn === 'arctan') {
      const v = simplify(d(s(fn), w)),
        rest = simplify(bin('*', u, v)),
        r = by(rest, '', []);
      return {
        rule: 'Integration by parts',
        why: partsWhy(s(fn), null, v, u, w),
        chain: [bin('-', bin('*', u, s(fn)), I(rest, w))],
        kids: r ? r.kids : [],
      };
    }
    return quote();
  }
  if (fn === 'tan')
    return rewrite(
      bin('-', sq(s('sec')), one),
      'Pythagorean identity',
      sq(s('tan')),
      ' = ',
      bin('-', sq(s('sec')), one),
    );
  if (fn === 'cot')
    return rewrite(
      bin('-', sq(s('csc')), one),
      'Pythagorean identity',
      sq(s('cot')),
      ' = ',
      bin('-', sq(s('csc')), one),
    );
  const twice = call('cos', bin('*', two, u));
  if (fn === 'sin')
    return rewrite(
      bin('/', bin('-', one, twice), two),
      'Half-angle identity',
      sq(s('sin')),
      ' = ',
      bin('/', bin('-', one, twice), two),
    );
  if (fn === 'cos')
    return rewrite(
      bin('/', bin('+', one, twice), two),
      'Half-angle identity',
      sq(s('cos')),
      ' = ',
      bin('/', bin('+', one, twice), two),
    );
  return quote();
}
/* A substitution, or no substitution at all when u is the variable itself (∫ sin x dx is in the table).
   `F` turns u into the antiderivative of what `inner` is in terms of u; `how(w)` explains ∫ inner(w) dw. */
function substituted(u, v, ratio, inner, F, from, how) {
  const out = bin('*', ratio, F(u));
  if (u.k === 'name' && u.n === v && key(ratio) === key(one)) {
    const h = TRACE && how(v);
    return h ? step(out, h.rule, from, h) : out;
  }
  const id = 'sub:' + key(u);
  if (avoided(id)) return null;
  const U = name(v === 'u' ? 'w' : 'u'),
    h = TRACE && how(U.n),
    kid = h?.chain && step(F(U), h.rule, inner(U), { ...h, v: U.n }),
    scaled = key(ratio) === key(one) ? [] : [bin('*', ratio, I(inner(U), U.n))];
  return step(out, 'Substitution', from, {
    id,
    u,
    U: U.n,
    why: letU(U, u, simplify(d(u, v)), v),
    chain: kid
      ? [I(bin('*', ratio, inner(U)), U.n), ...scaled]
      : [I(bin('*', ratio, inner(U)), U.n), bin('*', ratio, F(U)), out],
    kids: kid ? [kid] : [],
  });
}
// ∫ of a single base^exp; `rest` is what multiplies it, which a substitution must cancel.
function powerAnti(base, exp, v, rest, from) {
  const n = numVal(exp);
  if (indep(exp, v)) {
    const du = simplify(d(base, v)),
      ratio = simplify(bin('/', rest, du));
    if (!indep(ratio, v)) return null;
    if (n && n.p === -n.q)
      return substituted(
        base,
        v,
        ratio,
        u => inv(u),
        lnAbs,
        from,
        w => ({
          rule: 'Reciprocal rule',
          why: ['The derivative of ', lnAbs(name(w)), ' is ', inv(name(w))],
        }),
      );
    const m = simplify(bin('+', exp, one));
    return substituted(
      base,
      v,
      ratio,
      u => bin('^', u, exp),
      u => bin('/', bin('^', u, m), m),
      from,
      () => ({ rule: 'Power rule', why: ['Add one to the power, then divide by the new power'] }),
    );
  }
  if (indep(base, v)) {
    const du = simplify(d(exp, v)),
      ratio = simplify(bin('/', rest, du));
    if (!indep(ratio, v)) return null;
    const e = base.k === 'name' && base.n === 'e',
      lnb = e ? one : call('ln', base);
    return substituted(
      exp,
      v,
      ratio,
      u => bin('^', base, u),
      u => bin('/', bin('^', base, u), lnb),
      from,
      w => ({
        rule: 'Exponential rule',
        why: e
          ? ['The derivative of ', bin('^', base, name(w)), ' is itself']
          : [
              'The derivative of ',
              bin('^', base, name(w)),
              ' is ',
              bin('*', bin('^', base, name(w)), lnb),
              ', so divide by ',
              lnb,
            ],
      }),
    );
  }
  return null;
}
// ∫ f(u)·rest when rest is a constant times u′: F(u) times that constant.
function callAnti(f, exp, v, rest, from) {
  const n = numVal(exp);
  if (f.a.length !== 1 || !n || n.q !== 1 || (n.p !== 1 && n.p !== 2)) return null;
  const table = n.p === 1 ? ANTI : ANTI2;
  if (!own(table, f.n)) return null;
  const [u] = f.a,
    ratio = simplify(bin('/', rest, d(u, v)));
  if (!indep(ratio, v)) return null;
  return substituted(
    u,
    v,
    ratio,
    w => power(call(f.n, w), exp),
    table[f.n],
    from,
    w => known(f.n, n.p, w),
  );
}
const isPoly = (e, v) =>
  e.k === 'num' ||
  e.k === 'name' ||
  (e.k === 'binary' && '+-*'.includes(e.op) && isPoly(e.a, v) && isPoly(e.b, v)) ||
  (e.k === 'binary' &&
    e.op === '^' &&
    indep(e.b, v) &&
    numVal(e.b)?.q === 1 &&
    numVal(e.b).p > 0 &&
    isPoly(e.a, v)) ||
  (e.k === 'unary' && isPoly(e.a, v)) ||
  indep(e, v);
function expand(e) {
  if (e.k === 'binary' && (e.op === '+' || e.op === '-')) return bin(e.op, expand(e.a), expand(e.b));
  if (e.k === 'unary' && e.op === '-') return neg(expand(e.a));
  const parts = x => {
    const out = [];
    for (const t of terms(x).values()) out.push(fromTerm(t));
    return out;
  };
  if (e.k === 'binary' && e.op === '*') {
    const A = parts(expand(e.a)),
      B = parts(expand(e.b));
    return A.flatMap(a => B.map(b => bin('*', a, b))).reduce((x, y) => bin('+', x, y));
  }
  if (e.k === 'binary' && e.op === '^') {
    const n = numVal(e.b);
    if (n && n.q === 1 && n.p >= 2 && n.p <= 8 && terms(e.a).size > 1) {
      let out = e.a;
      for (let i = 1; i < n.p; i++) out = expand(bin('*', simplify(out), e.a));
      return out;
    }
  }
  if (e.k === 'binary' && e.op === '/') return bin('/', expand(e.a), e.b);
  return e;
}
// sin or cos of u times sin or cos of w, as a sum of single sines and cosines.
function productToSum(A, B) {
  const [u] = A.a,
    [w] = B.a,
    plus = simplify(bin('+', u, w)),
    minus = simplify(bin('-', u, w)),
    half = x => simplify(bin('/', x, two));
  if (A.n === 'sin' && B.n === 'sin') return half(bin('-', call('cos', minus), call('cos', plus)));
  if (A.n === 'cos' && B.n === 'cos') return half(bin('+', call('cos', minus), call('cos', plus)));
  if (A.n === 'sin') return half(bin('+', call('sin', plus), call('sin', minus)));
  return half(bin('-', call('sin', plus), call('sin', minus)));
}
// A sum of terms, each a constant times at most one sin or cos, multiplied by one more sin or cos.
function timesTrig(sum, B) {
  const out = [...terms(simplify(sum)).values()].map(t => {
    const k = t.f.findIndex(
      x => x.base.k === 'call' && ['sin', 'cos'].includes(x.base.n) && numVal(x.exp)?.p === 1,
    );
    if (k < 0) return bin('*', fromTerm(t), B);
    const others = fromTerm({ c: t.c, f: t.f.filter((_, i) => i !== k) });
    return bin('*', others, productToSum(t.f[k].base, B));
  });
  return simplify(out.reduce((a, b) => bin('+', a, b)));
}
function integ(e, v, depth = 0) {
  const outer = STEPV;
  STEPV = v;
  try {
    return integrate(e, v, depth);
  } finally {
    STEPV = outer;
  }
}
function integrate(e, v, depth) {
  if (depth > 8) return null;
  e = simplify(e);
  if (indep(e, v))
    return step(bin('*', e, name(v)), 'Constant rule', e, {
      why: ['A constant integrates to itself times ', name(v)],
    });
  // A rewrite that leads to an easier integral: the answer is the easier one's, with this step on top.
  const via = (x, rule, id, why, from = e) => {
    const r = integ(x, v, depth + 1);
    return r && step({ ...r }, rule, from, { id, why, chain: [I(simplify(x), v)], kids: [r] });
  };
  // Polynomials term by term: (x + 1)² as x² + 2x + 1.
  if (isPoly(e, v) && !avoided('poly')) {
    const x = simplify(expand(e));
    if (key(x) !== key(e)) return via(x, 'Multiply out', 'poly', ['Expand the brackets into separate terms']);
  }
  const T = [...terms(e).values()];
  if (T.length > 1) {
    const parts = T.map(t => integ(fromTerm(t), v, depth + 1));
    if (parts.includes(null)) return null;
    return step(
      parts.reduce((a, b) => bin('+', a, b)),
      'Sum rule',
      e,
      {
        why: ['Integrate each term on its own'],
        chain: [T.map(t => I(fromTerm(t), v)).reduce((a, b) => bin('+', a, b))],
        kids: parts,
      },
    );
  }
  const { c, f } = T[0],
    dep = f.filter(x => !indep(power(x.base, x.exp), v)),
    coef = fromTerm({ c, f: f.filter(x => !dep.includes(x)) }),
    inner = fromTerm({ c: rat(1), f: dep }),
    times = r =>
      r && key(coef) !== key(one)
        ? step(bin('*', coef, r), 'Constant multiple', e, {
            why: freeName(coef)
              ? [
                  coef,
                  ' does not involve ',
                  name(v),
                  ', so it is a constant here and moves outside the integral',
                ]
              : ['Move the constant ', coef, ' outside the integral'],
            chain: [bin('*', coef, I(inner, v))],
            kids: [r],
          })
        : r;
  // One part is a function of u, the others a constant times u′: substitute.
  for (const x of dep) {
    const rest = fromTerm({ c: rat(1), f: dep.filter(y => y !== x) }),
      r =
        (x.base.k === 'call' && callAnti(x.base, x.exp, v, rest, inner)) ||
        powerAnti(x.base, x.exp, v, rest, inner);
    if (r) return times(r);
  }
  const sp = specialAnti(dep, v, inner, depth);
  if (sp) return times(sp);
  // e^(ax)·sin(bx) and e^(ax)·cos(bx) come back to themselves after integrating by parts twice.
  if (dep.length === 2 && !avoided('cyclic')) {
    const ex = dep.find(x => indep(x.base, v) && !indep(x.exp, v)),
      tr = dep.find(x => x.base.k === 'call' && ['sin', 'cos'].includes(x.base.n) && numVal(x.exp)?.p === 1);
    if (ex && tr) {
      const lnb = ex.base.k === 'name' && ex.base.n === 'e' ? one : call('ln', ex.base),
        a = simplify(bin('*', d(ex.exp, v), lnb)),
        [u] = tr.base.a,
        b = simplify(d(u, v));
      if (indep(a, v) && indep(b, v)) {
        const [s, c] = [call('sin', u), call('cos', u)],
          top =
            tr.base.n === 'sin'
              ? bin('-', bin('*', a, s), bin('*', b, c))
              : bin('+', bin('*', a, c), bin('*', b, s));
        return times(
          step(
            bin('/', bin('*', bin('^', ex.base, ex.exp), top), bin('+', sq(a), sq(b))),
            'Parts twice',
            inner,
            {
              id: 'cyclic',
              why: [
                'Integrate by parts twice. The original integral comes back on the right, so move it to the left and divide. Here ',
                M('a'),
                ' = ',
                a,
                ' and ',
                M('b'),
                ' = ',
                b,
              ],
            },
          ),
        );
      }
    }
  }
  // 1/(a + bx²) is an arctangent.
  if (dep.length === 1 && numVal(dep[0].exp)?.p === -1 && numVal(dep[0].exp)?.q === 1) {
    const q = [...terms(simplify(expand(dep[0].base))).values()],
      c2 = q.find(t => degree(t, v) === 2 && t.f.length === 1),
      c0 = q.find(t => t.f.length === 0);
    if (q.length === 2 && c2 && c0 && rval(c2.c) > 0 && rval(c0.c) > 0) {
      const a = rval(c2.c),
        b = rval(c0.c);
      return times(
        step(
          bin(
            '*',
            inv(call('sqrt', num(a * b))),
            call('arctan', bin('*', call('sqrt', ratNode(rat(c2.c.p * c0.c.q, c2.c.q * c0.c.p))), name(v))),
          ),
          'Arctangent form',
          inner,
          { why: ['One over a positive constant plus a square integrates to an arctangent'] },
        ),
      );
    }
  }
  // 1/√(a − bx²) is an arcsine, 1/√(bx² + a) a logarithm.
  if (dep.length === 1 && numVal(dep[0].exp)?.p === -1 && numVal(dep[0].exp)?.q === 2) {
    const q = [...terms(simplify(expand(dep[0].base))).values()],
      c2 = q.find(t => degree(t, v) === 2 && t.f.length === 1),
      c0 = q.find(t => t.f.length === 0);
    if (q.length === 2 && c2 && c0 && rval(c0.c) > 0) {
      const a = rval(c2.c),
        k = inv(call('sqrt', num(Math.abs(a))));
      if (a < 0)
        return times(
          step(
            bin(
              '*',
              k,
              call(
                'arcsin',
                bin('*', call('sqrt', ratNode(rat(-c2.c.p * c0.c.q, c2.c.q * c0.c.p))), name(v)),
              ),
            ),
            'Arcsine form',
            inner,
            { why: ['One over the square root of a constant minus a square integrates to an arcsine'] },
          ),
        );
      return times(
        step(
          bin('*', k, lnAbs(bin('+', name(v), call('sqrt', bin('+', sq(name(v)), num(rval(c0.c) / a)))))),
          'Logarithm form',
          inner,
          {
            why: [
              'One over the square root of a square plus a constant integrates to ',
              M('ln|x + √(x² + c)|'),
            ],
          },
        ),
      );
    }
  }
  // sin(2θ) next to sin θ or cos θ: write it in θ, and a substitution often finishes the job.
  const sinCos = x =>
    x.base.k === 'call' && (x.base.n === 'sin' || x.base.n === 'cos') && x.base.a.length === 1;
  if (!avoided('double'))
    for (const x of dep) {
      if (!sinCos(x) || numVal(x.exp)?.p !== 1 || numVal(x.exp)?.q !== 1) continue;
      const half = simplify(bin('/', x.base.a[0], two)),
        partner = dep.find(y => y !== x && sinCos(y) && key(simplify(y.base.a[0])) === key(half));
      if (!partner) continue;
      const [s, co] = [call('sin', half), call('cos', half)],
        [rep, rule] =
          x.base.n === 'sin'
            ? [bin('*', bin('*', two, s), co), 'sin 2θ = 2 sin θ cos θ']
            : partner.base.n === 'sin'
              ? [bin('-', bin('*', two, sq(co)), one), 'cos 2θ = 2cos²θ − 1']
              : [bin('-', one, bin('*', two, sq(s))), 'cos 2θ = 1 − 2sin²θ'],
        r = via(
          simplify(expand(bin('*', rep, fromTerm({ c: rat(1), f: dep.filter(y => y !== x) })))),
          'Double-angle identity',
          'double',
          ['Use ', M(rule), ', with ', M('θ'), ' = ', half],
          inner,
        );
      if (r) return times(r);
    }
  // Products and powers of sines and cosines of ax + b become sums: sin(x)·sin(2x) = (cos(x) − cos(3x))/2.
  const trig = dep.filter(
    x =>
      sinCos(x) &&
      indep(simplify(d(x.base.a[0], v)), v) &&
      numVal(x.exp)?.q === 1 &&
      numVal(x.exp).p >= 1 &&
      numVal(x.exp).p <= 6,
  );
  if (!avoided('trig') && trig.reduce((s, x) => s + numVal(x.exp).p, 0) >= 2) {
    const [first, ...more] = trig.flatMap(x => Array(numVal(x.exp).p).fill(x.base)),
      sum = more.reduce(timesTrig, first),
      rest = fromTerm({ c: rat(1), f: dep.filter(x => !trig.includes(x)) }),
      names = new Set(trig.map(x => x.base.n)),
      x = simplify(expand(bin('*', rest, sum))),
      r = integ(x, v, depth + 1);
    if (r)
      return times(
        step({ ...r }, 'Product-to-sum', inner, {
          id: 'trig',
          why: [
            'Use ',
            M(
              names.size > 1
                ? 'sin A cos B = ½[sin(A + B) + sin(A − B)]'
                : names.has('sin')
                  ? 'sin A sin B = ½[cos(A − B) − cos(A + B)]'
                  : 'cos A cos B = ½[cos(A − B) + cos(A + B)]',
            ),
            ' to turn the product into a sum',
          ],
          chain: [I(x, v)],
          kids: [r],
        }),
      );
  }
  // By parts, differentiating the polynomial (or the logarithm) until it is gone.
  const PARTS = [
    'ln',
    'log',
    'log2',
    'arctan',
    'arcsin',
    'arccos',
    'arccot',
    'asinh',
    'acosh',
    'atanh',
    'erf',
    'erfi',
    'Si',
    'Ci',
    'Shi',
    'Chi',
    'Ei',
    'li',
  ];
  if (
    !avoided('parts') &&
    (dep.length >= 2 || (dep.length === 1 && dep[0].base.k === 'call' && PARTS.includes(dep[0].base.n)))
  ) {
    const pick =
      dep.find(x => x.base.k === 'call' && PARTS.includes(x.base.n) && isOne(numVal(x.exp))) ||
      dep.find(x => isPoly(power(x.base, x.exp), v));
    if (pick) {
      const u = power(pick.base, pick.exp),
        dv = fromTerm({ c: rat(1), f: dep.filter(y => y !== pick) }),
        V = integ(dv, v, depth + 1);
      if (V) {
        const du = simplify(d(u, v)),
          W = integ(bin('*', du, V), v, depth + 1);
        if (W)
          return times(
            step(bin('-', bin('*', u, V), W), 'Integration by parts', inner, {
              id: 'parts',
              why: partsWhy(u, dv, du, simplify(V), v),
              chain: [bin('-', bin('*', u, simplify(V)), I(simplify(bin('*', simplify(V), du)), v))],
              kids: [V, W],
            }),
          );
      }
    }
  }
  if (!avoided('expand')) {
    const x = expand(e);
    if (key(simplify(x)) !== key(e)) {
      const r = via(x, 'Multiply out', 'expand', ['Expand the product into separate terms']);
      if (r) return r;
    }
  }
  // Last try: tan, sec, csc and cot as sines and cosines, so sec(x)·tan(x) is sin(x)/cos(x)².
  const sc = toSinCos(e);
  if (key(sc) !== key(e))
    return via(sc, 'Sines and cosines', 'sincos', ['Write tan, sec, csc and cot with sin and cos']);
  return null;
}
/* ----- Special functions: what Wolfram answers when no elementary function will do ----- */
// The coefficients of a quadratic in v, as fractions [c₀, c₁, c₂], or null for anything else.
function quadratic(e, v) {
  const c = [rat(0), rat(0), rat(0)];
  for (const t of terms(simplify(expand(e))).values()) {
    let k = 0;
    if (t.f.length) {
      const [x] = t.f,
        n = numVal(x.exp);
      if (t.f.length > 1 || x.base.k !== 'name' || x.base.n !== v || !n || n.q !== 1 || n.p < 1 || n.p > 2)
        return null;
      k = n.p;
    }
    if (!Number.isInteger(t.c.p)) return null;
    c[k] = radd(c[k], t.c);
  }
  return c;
}
const linear = (u, v) => {
    const q = quadratic(u, v);
    return !!q && q[2].p === 0 && q[1].p !== 0;
  },
  isE = b => b.k === 'name' && b.n === 'e',
  isOne = n => n?.p === 1 && n.q === 1,
  rootNode = r => (x => (x ? ratNode(x) : call('sqrt', ratNode(r))))(exactPow(r, rat(1, 2))),
  SPECIAL = {
    erf: ['Error function', 'erf(t) = (2/√π) ∫₀ᵗ e^(−s²) ds'],
    erfi: ['Imaginary error function', 'erfi(t) = (2/√π) ∫₀ᵗ e^(s²) ds'],
    Si: ['Sine integral', 'Si(t) = ∫₀ᵗ sin(s)/s ds'],
    Ci: ['Cosine integral', 'Ci(t), whose derivative is cos(t)/t'],
    Shi: ['Hyperbolic sine integral', 'Shi(t) = ∫₀ᵗ sinh(s)/s ds'],
    Chi: ['Hyperbolic cosine integral', 'Chi(t), whose derivative is cosh(t)/t'],
    Ei: ['Exponential integral', 'Ei(t), whose derivative is eᵗ/t'],
    li: ['Logarithmic integral', 'li(t) = ∫₀ᵗ ds / ln s'],
    fresnel: ['Fresnel integrals', 'S(t) = ∫₀ᵗ sin(πs²/2) ds and C(t) = ∫₀ᵗ cos(πs²/2) ds'],
  },
  OVER = { sin: 'Si', cos: 'Ci', sinh: 'Shi', cosh: 'Chi' };
// a(v + h)² + K for av² + bv + c: [a, v + h, K].
function square([c, b, a], v) {
  const h = rmul(b, rat(a.q, 2 * a.p)),
    K = radd(c, rmul(rmul(b, b), rat(-a.q, 4 * a.p)));
  return [a, simplify(bin('+', name(v), ratNode(h))), K];
}
function specialAnti(dep, v, inner, depth) {
  const said = (fn, t) => [
    'No elementary function has this derivative, so the answer is written with the ',
    SPECIAL[fn][0].toLowerCase(),
    ', ',
    M(SPECIAL[fn][1]),
    ...(t && !(t.k === 'name' && t.n === v) ? [', at ', M('t'), ' = ', simplify(t)] : []),
  ];
  const special = (F, fn, t) => step(F, SPECIAL[fn][0], inner, { id: 'special', why: said(fn, t) });
  if (dep.length === 1) {
    const [{ base, exp }] = dep,
      n = numVal(exp);
    // e^(ax² + bx + c): complete the square, then erf (a < 0) or erfi (a > 0).
    if (isE(base)) {
      const q = quadratic(exp, v);
      if (q && q[2].p !== 0) {
        const [a, w, K] = square(q, v),
          k = rootNode(rat(Math.abs(a.p), a.q)),
          fn = a.p < 0 ? 'erf' : 'erfi',
          t = bin('*', k, w),
          F = bin('*', bin('/', call('sqrt', name('pi')), bin('*', two, k)), call(fn, t));
        return special(K.p ? bin('*', bin('^', name('e'), ratNode(K)), F) : F, fn, t);
      }
    }
    // 1/ln(ax + b) is li(ax + b)/a.
    if (n?.p === -1 && n.q === 1 && base.k === 'call' && base.n === 'ln' && linear(base.a[0], v)) {
      const [u] = base.a;
      return special(bin('/', call('li', u), simplify(d(u, v))), 'li', u);
    }
    // sin and cos of a square: the Fresnel integrals, after completing the square.
    if (isOne(n) && base.k === 'call' && (base.n === 'sin' || base.n === 'cos') && base.a.length === 1) {
      const q = quadratic(base.a[0], v);
      if (q && q[2].p !== 0) {
        const [a, w, K] = square(q, v),
          a2 = rat(2 * Math.abs(a.p), a.q),
          scale = call('sqrt', bin('/', name('pi'), ratNode(a2))),
          t = bin('*', call('sqrt', bin('/', ratNode(a2), name('pi'))), w),
          S = bin('*', scale, call('fresnelS', t)),
          C = bin('*', scale, call('fresnelC', t)),
          sinPart = a.p < 0 ? neg(S) : S,
          [cK, sK] = [call('cos', ratNode(K)), call('sin', ratNode(K))],
          F =
            base.n === 'sin'
              ? bin('+', bin('*', sinPart, cK), bin('*', C, sK))
              : bin('-', bin('*', C, cK), bin('*', sinPart, sK));
        return special(F, 'fresnel', t);
      }
    }
    return null;
  }
  if (dep.length !== 2) return null;
  for (const g of dep) {
    const other = dep.find(y => y !== g),
      m = numVal(other.exp);
    // sin(u)/u, cos(u)/u, sinh(u)/u, cosh(u)/u and eᵘ/u for u = ax + b.
    const u =
      g.base.k === 'call' && own(OVER, g.base.n) && g.base.a.length === 1 && isOne(numVal(g.exp))
        ? g.base.a[0]
        : isE(g.base)
          ? g.exp
          : null;
    if (u && linear(u, v) && m && m.q === 1 && m.p <= -1 && m.p >= -6) {
      const ratio = simplify(bin('/', other.base, u));
      if (!indep(ratio, v)) continue;
      const fn = isE(g.base) ? 'Ei' : OVER[g.base.n];
      if (m.p === -1) return special(bin('*', inv(bin('*', ratio, simplify(d(u, v)))), call(fn, u)), fn, u);
      // A higher power below: by parts, integrating the power, until it is one.
      const top = power(g.base, g.exp),
        V = integ(power(other.base, other.exp), v, depth + 1),
        dg = simplify(d(top, v)),
        W = V && integ(simplify(bin('*', V, dg)), v, depth + 1);
      if (W)
        return step(bin('-', bin('*', top, V), W), 'Integration by parts', inner, {
          id: 'parts',
          why: partsWhy(top, power(other.base, other.exp), dg, simplify(V), v),
          chain: [bin('-', bin('*', top, simplify(V)), I(simplify(bin('*', simplify(V), dg)), v))],
          kids: [V, W],
        });
    }
    // xⁿ·e^(ax²): by parts with x·e^(ax²) as the part to integrate, down to e^(ax²) itself.
    if (isE(g.base) && other.base.k === 'name' && other.base.n === v && m && m.q === 1 && m.p >= 2) {
      const q = quadratic(g.exp, v);
      if (!q || q[2].p === 0 || q[1].p || q[0].p) continue;
      const top = power(name(v), num(m.p - 1)),
        V = integ(bin('*', name(v), power(g.base, g.exp)), v, depth + 1),
        dg = simplify(d(top, v)),
        W = V && integ(simplify(bin('*', V, dg)), v, depth + 1);
      if (W)
        return step(bin('-', bin('*', top, V), W), 'Integration by parts', inner, {
          id: 'parts',
          why: partsWhy(top, bin('*', name(v), power(g.base, g.exp)), dg, simplify(V), v),
          chain: [bin('-', bin('*', top, simplify(V)), I(simplify(bin('*', simplify(V), dg)), v))],
          kids: [V, W],
        });
    }
  }
  return null;
}

const SIN_COS = {
  tan: u => bin('/', call('sin', u), call('cos', u)),
  cot: u => bin('/', call('cos', u), call('sin', u)),
  sec: u => inv(call('cos', u)),
  csc: u => inv(call('sin', u)),
};
const toSinCos = e =>
  e.k === 'call' && own(SIN_COS, e.n) && e.a.length === 1
    ? SIN_COS[e.n](toSinCos(e.a[0]))
    : simplify(map(e, toSinCos));

/* ----- Rows: d/dx and ∫ … dx as formulas ----- */
function inline(e, env, v, depth = 0) {
  if (depth > 30) throw Error('These functions call each other too deeply to work out by hand');
  if (!e || typeof e !== 'object') return e;
  if (e.k === 'call' && env.fn.has(e.n) && e.a.length === 1) {
    const f = env.fn.get(e.n);
    return inline(subst(f.ast, f.param, inline(e.a[0], env, v, depth + 1)), env, v, depth + 1);
  }
  if (e.k === 'name' && env.def.has(e.n) && e.n !== v) {
    const body = inline(env.def.get(e.n).ast, env, v, depth + 1);
    if (depends(body, v)) return body;
  }
  if (e.k === 'call' && e.n === 'deriv' && e.a.length === 2) {
    const [f, at] = e.a;
    if (f.k === 'name' && (env.fn.has(f.n) || own(DERIV, f.n))) {
      const body = inline(call(f.n, name('_u')), env, v, depth + 1);
      return subst(simplify(d(body, '_u')), '_u', inline(at, env, v, depth + 1));
    }
    if (at.k === 'name') return simplify(d(inline(f, env, at.n, depth + 1), at.n));
  }
  // Inside a larger expression, an integral with no formula is left to be worked out numerically.
  if (e.k === 'call' && e.n === 'integral' && e.a.length === 2 && e.a[1].k === 'name') {
    const t = e.a[1].n,
      f = inline(e.a[0], env, t, depth + 1),
      r = integ(f, t);
    return r ? simplify(r) : { ...e, a: [f, e.a[1]] };
  }
  // ∫ₐᵇ with a bound that moves, like ∫₀ˣ t² dt: F(b) − F(a) when there is a formula, else left to be summed.
  if (e.k === 'call' && e.n === 'integral' && e.a.length === 4 && e.a[1].k === 'name') {
    const t = e.a[1].n,
      F = integ(inline(e.a[0], env, t, depth + 1), t);
    if (!F) return e;
    const [lo, hi] = [e.a[2], e.a[3]].map(x => inline(x, env, v, depth + 1));
    return simplify(bin('-', subst(F, t, hi), subst(F, t, lo)));
  }
  return map(e, x => inline(x, env, v, depth + 1));
}
const hasCall = (e, n) =>
  !!e &&
  typeof e === 'object' &&
  ((e.k === 'call' && e.n === n) || Object.values(e).some(x => hasCall(x, n)));
/* The terms from a series as a sum, lowest power first: x³/3 + x⁷/21, or in powers of (x − 1) about 1.
   Coefficients are fractions [p, q] or, when they couldn't be exact, decimals to six figures. */
// A decimal that is a simple fraction to within rounding, like 0.333333333333 for 1/3, as that fraction.
function fraction(x) {
  let [h0, h1, k0, k1, y] = [0, 1, 1, 0, x];
  for (let i = 0; i < 20; i++) {
    const a = Math.floor(y);
    [h0, h1, k0, k1] = [h1, a * h1 + h0, k1, a * k1 + k0];
    if (k1 > 5000) return null;
    if (Math.abs(h1 / k1 - x) < 1e-11 * Math.max(1, x)) return rat(h1, k1);
    y = 1 / (y - a);
    if (!Number.isFinite(y)) return null;
  }
  return null;
}
function seriesAst(list, v, center = 0) {
  if (!list?.length) return null;
  const base = center ? simplify(bin('-', name(v), num(center))) : name(v),
    sign = c => (Array.isArray(c) ? c[0] : c),
    size = c =>
      Array.isArray(c)
        ? rat(Math.abs(c[0]), c[1])
        : fraction(Math.abs(c)) || rat(+Math.abs(c).toPrecision(4)),
    term = ({ c, k }) => fromTerm({ c: size(c), f: k ? [{ base, exp: num(k) }] : [] });
  return list
    .slice(1)
    .reduce(
      (acc, t) => bin(sign(t.c) < 0 ? '-' : '+', acc, term(t)),
      sign(list[0].c) < 0 ? neg(term(list[0])) : term(list[0]),
    );
}
/* An antiderivative beyond the standard and special functions. It is still exact as the area function
   ∫ₐˣ f(t) dt, and near a it is a power series; a is the first easy point where f is smooth (0, else 1, …).
   { series, center, graph, area }: the series when there is one, else `area` to show; `graph` draws from a. */
function beyond(f, v, env) {
  const s = antiderivativeSeries(f, v, math),
    finite = c => {
      try {
        return Number.isFinite(evaluate(f, { [v]: c }, env));
      } catch {
        return false;
      }
    },
    a = s ? s.center : ([0, 1, -1, 2, 0.5].find(finite) ?? 0),
    // The graph keeps to the area from 0 when it can: numerical areas are steadiest from there.
    from = finite(0) ? 0 : a,
    t = ['t', 's', 'u', 'w'].find(n => n !== v && !names(f).has(n)),
    areaFrom = lo => call('integral', subst(f, v, name(t)), name(t), num(lo), name(v));
  return {
    series: s && seriesAst(s.antiderivative, v, a),
    center: a,
    from,
    graph: from ? areaFrom(from) : null,
    area: s ? null : areaFrom(a),
  };
}
/* The formula for a row that is d/dx of something or an indefinite integral, or null for any other row.
   { ast, indefinite } on success. An integral with no formula in any standard or special function gets
   { series, center, area, graph } from beyond(); ∫₀ˣ with no formula gets its series about 0. */
export function calculus(ast, env) {
  if (ast?.k !== 'call') return null;
  const v = ast.a[1]?.k === 'name' ? ast.a[1].n : null;
  const isD = ast.n === 'deriv' && ast.a.length === 2,
    isI = ast.n === 'integral' && ast.a.length === 2 && v,
    isArea = ast.n === 'integral' && ast.a.length === 4 && v;
  if (!isD && !isI && !isArea) return null;
  if (isArea) {
    mainVar = ['x', 'y'].find(n => depends(ast.a[2], n) || depends(ast.a[3], n)) || 'x';
    const out = simplify(inline(ast, env, mainVar));
    if (!hasCall(out, 'integral')) return { ast: out, indefinite: false };
    // ∫₀ˣ f(t) dt with no formula still has a series: the antiderivative's, which is 0 at 0.
    const [lo, hi] = ast.a.slice(2);
    if (numVal(lo)?.p !== 0 || hi.k !== 'name' || hi.n !== mainVar) return null;
    const s = antiderivativeSeries(simplify(inline(ast.a[0], env, v)), v, math);
    return s?.center === 0
      ? { ast: null, series: seriesAst(s.antiderivative, mainVar), indefinite: false }
      : null;
  }
  mainVar = v || 'x';
  if (isI) {
    const f = simplify(inline(ast.a[0], env, v)),
      F = integ(f, v);
    return F ? { ast: simplify(F), indefinite: true } : { ast: null, ...beyond(f, v, env), indefinite: true };
  }
  return { ast: simplify(inline(ast, env, mainVar)), indefinite: false };
}

/* ----- Differential equations ----- */
const isIndef = e => e?.k === 'call' && e.n === 'integral' && e.a.length === 2 && e.a[1].k === 'name';
export const hasIndefinite = e =>
  !!e && typeof e === 'object' && (isIndef(e) || Object.values(e).some(hasIndefinite));
// Every indefinite integral in e as its antiderivative, or null if one has no formula.
function antiderivatives(e, env) {
  const out = simplify(inline(e, env, 'x'));
  return hasIndefinite(out) ? null : out;
}
const C = name('C');
/* ∫ h(y) dy = ∫ f(x) dx, or any equation with indefinite integrals in it: each side's antiderivative, with the
   one constant they leave on the right. `deq` is the differential equation it solves: dy/dx = f(x)/h(y) when it
   is exactly that separated form, and otherwise −F_x / F_y for the answer F(x, y) = C, by implicit
   differentiation. { ast: L − R − C, left, right, deq, sides }. */
export function integralEquation(left, right, env) {
  if (!hasIndefinite(left) && !hasIndefinite(right)) return null;
  mainVar = 'x';
  const L = antiderivatives(left, env),
    R = antiderivatives(right, env);
  if (!L || !R) return null;
  let deq = null;
  if (isIndef(left) && isIndef(right) && left.a[1].n === 'y' && right.a[1].n === 'x') {
    const h = inline(left.a[0], env, 'y'),
      f = inline(right.a[0], env, 'x');
    if (!depends(h, 'x') && !depends(f, 'y')) deq = simplify(bin('/', f, h));
  }
  if (!deq)
    try {
      const F = bin('-', L, R),
        Fy = simplify(d(F, 'y'));
      if (depends(F, 'y') && !(Fy.k === 'num' && Fy.v === 0))
        deq = simplify(bin('/', neg(simplify(d(F, 'x'))), Fy));
    } catch {
      // Something in it has no derivative rule; the answer stands without its equation.
    }
  return {
    ast: bin('-', bin('-', L, R), C),
    left: L,
    right: bin('+', R, C),
    deq,
    sides: [left, right],
  };
}
/* dy/dx = F(x, y), solved when it is linear, F = a(x)·y + b(x), giving y = e^A (∫ b e^(−A) dx + C) with
   A = ∫ a dx, or separable, F = f(x)·g(y), giving ∫ dy/g(y) = ∫ f(x) dx + C. { ast, explicit, left, right, how }:
   ast is y − (…) for an explicit answer, else L − R − C; left = right is the answer as it reads. */
export function solveODE(F, env) {
  mainVar = 'x';
  const f = simplify(inline(F, env, 'x')),
    y = name('y'),
    dep = (e, n) => depends(e, n);
  if (!dep(f, 'y')) {
    const R = integ(f, 'x'),
      right = R && bin('+', simplify(R), C);
    return R && { ast: bin('-', y, right), explicit: true, left: y, right, how: 'integrate', f };
  }
  let a = null;
  try {
    a = simplify(d(f, 'y'));
  } catch {
    // No derivative rule for something in F, so it isn't recognisably linear in y.
  }
  if (a && !dep(a, 'y')) {
    const b = simplify(bin('-', f, bin('*', a, y))),
      A = !dep(b, 'y') && integ(a, 'x');
    if (A) {
      const eA = bin('^', name('e'), simplify(A)),
        I2 = integ(simplify(bin('*', b, bin('^', name('e'), neg(simplify(A))))), 'x');
      if (I2) {
        // Multiplied out, so eˣ(−xe⁻ˣ − e⁻ˣ + C) reads as −x − 1 + Ceˣ.
        const sol = simplify(expand(bin('*', eA, bin('+', simplify(I2), C))));
        return {
          ast: bin('-', y, sol),
          explicit: true,
          left: y,
          right: sol,
          how: 'linear',
          f,
          parts: { a, b, A: simplify(A), I2: simplify(I2) },
        };
      }
    }
  }
  const T = [...terms(f).values()];
  if (T.length === 1) {
    const [{ c, f: fs }] = T,
      X = fs.filter(z => !dep(power(z.base, z.exp), 'y')),
      Y = fs.filter(z => !X.includes(z));
    if (Y.every(z => !dep(power(z.base, z.exp), 'x'))) {
      const gx = fromTerm({ c, f: X }),
        hy = simplify(inv(fromTerm({ c: rat(1), f: Y }))),
        L = integ(hy, 'y'),
        R = integ(gx, 'x');
      if (L && R) {
        const [l, r] = [simplify(L), simplify(R)];
        return {
          ast: bin('-', bin('-', l, r), C),
          explicit: false,
          left: l,
          right: bin('+', r, C),
          how: 'separable',
          f,
          parts: { gx: simplify(gx), gy: simplify(fromTerm({ c: rat(1), f: Y })), hy },
        };
      }
    }
  }
  return null;
}

/* The working for an integral row, as a list of methods: { name, tree, answer, offset }. A tree node is
   { rule, why, head, chain, to, kids }; `offset` is how far a later answer sits from the first (a constant,
   since both are antiderivatives). With no formula, { series } holds the integrand's series and the result's. */
const METHOD = {
  sub: 'Substitution',
  poly: 'Multiplying out',
  expand: 'Multiplying out',
  trig: 'Product-to-sum',
  double: 'Double-angle identity',
  parts: 'Integration by parts',
  cyclic: 'Parts twice',
  sincos: 'Sines and cosines',
  special: 'Special function',
};
export function integralSteps(ast, env) {
  if (ast?.k !== 'call' || ast.n !== 'integral' || ast.a[1]?.k !== 'name') return null;
  if (ast.a.length !== 2 && ast.a.length !== 4) return null;
  const t = ast.a[1].n,
    definite = ast.a.length === 4;
  mainVar = t;
  const f = simplify(inline(ast.a[0], env, t)),
    twin = [...names(f)].find(n => n !== t && n.toLowerCase() === t.toLowerCase()),
    note = twin && [
      name(twin),
      ' and ',
      name(t),
      ' are different variables, so ',
      name(twin),
      ' is a constant here',
    ],
    tree = r => {
      const s = TRACE.get(r) || { rule: 'Result', from: f },
        head = I(shown(s.from), s.v || t),
        chain = [];
      for (const x of (s.chain || []).map(shown)) if (key(x) !== key(chain.at(-1) || head)) chain.push(x);
      return {
        rule: s.rule,
        id: s.id,
        u: s.u && simplify(s.u),
        U: s.U,
        why: (s.why || []).flat(),
        head,
        chain,
        to: simplify(r),
        kids: (s.kids || []).map(tree),
      };
    },
    run = avoid => {
      TRACE = new WeakMap();
      AVOID = avoid;
      try {
        const r = integ(f, t);
        return r && { tree: tree(r), answer: simplify(r) };
      } finally {
        TRACE = null;
        AVOID = new Set();
      }
    },
    first = run(new Set());
  if (!first) {
    const s = antiderivativeSeries(f, t, math);
    return {
      v: t,
      f,
      note,
      methods: [],
      series: s && {
        center: s.center,
        exact: s.exact,
        integrand: seriesAst(s.integrand, t, s.center),
        antiderivative: seriesAst(s.antiderivative, t, s.center),
      },
    };
  }
  const methods = [first],
    ids = [];
  (function collect(n) {
    if (n.id && !ids.includes(n.id)) ids.push(n.id);
    n.kids.forEach(collect);
  })(first.tree);
  for (const id of ids.slice(0, 6)) {
    if (methods.length >= 3) break;
    const m = run(new Set([id]));
    if (m && !methods.some(x => key(x.answer) === key(m.answer))) methods.push(m);
  }
  for (const m of methods) {
    const lead = (function find(n) {
      return n.id ? n : n.kids.reduce((x, k) => x || find(k), null);
    })(m.tree);
    m.name = METHOD[lead?.id.split(':')[0]] || m.tree.rule;
    // Two substitutions read apart by what they substitute.
    if (lead?.u) m.label = [m.name + ', ', name(lead.U), ' = ', lead.u];
    m.offset = m === first ? 0 : offset(m.answer, first.answer, t, env);
  }
  if (definite) {
    const [lo, hi] = ast.a.slice(2).map(x => simplify(inline(x, env, t)));
    for (const m of methods) {
      const at = b => subst(m.answer, t, b);
      m.tree = {
        rule: 'Evaluate between the bounds',
        why: [
          'With ',
          M('F'),
          ' the antiderivative above, the area is ',
          M('F'),
          ' at the upper bound minus ',
          M('F'),
          ' at the lower bound',
        ],
        kidsFirst: true,
        head: call('integral', f, name(t), lo, hi),
        chain: [bin('-', at(hi), at(lo))],
        to: simplify(bin('-', at(hi), at(lo))),
        kids: [m.tree],
      };
    }
  }
  return { v: t, f, note, methods, definite };
}
/* The working for d/dv of an expression, as a tree in the shape integralSteps gives: each node names the
   rule, writes d/dv f with the rule applied in `chain`, works the smaller derivatives it left in `kids`, and
   fills their answers back in (`after`) before simplifying to `to`. */
function dTree(e, v) {
  const to = simplify(d(e, v)),
    head = call('deriv', e, name(v)),
    node = (rule, why, more = {}) => ({
      rule,
      why: why.flat(),
      head,
      chain: [],
      after: [],
      to,
      kids: [],
      ...more,
    }),
    // T writes the rule's result with g(u) for d/dv u; constants and v itself are filled in on the spot.
    apply = (rule, why, T) => {
      const kids = [],
        seen = new Map(),
        trivial = k => (!depends(k, v) ? num(0) : k.k === 'name' ? one : null),
        sub = k => {
          const id = key(k);
          if (!seen.has(id)) {
            seen.set(id, dTree(k, v));
            kids.push(seen.get(id));
          }
          return seen.get(id).to;
        },
        line = T(k => trivial(k) ?? call('deriv', k, name(v))),
        filled = T(k => trivial(k) ?? sub(k));
      return node(rule, why, { chain: [line], kids, after: kids.length ? [filled] : [] });
    },
    x = name(v);
  if (!depends(e, v)) return node('Constant', ['A constant does not change, so its derivative is 0']);
  if (e.k === 'name')
    return node('Power rule', [x, ' is ', bin('^', x, one), ', so its derivative is ', one]);
  if (e.k === 'unary' && e.op === '-')
    return apply('Constant multiple', ['The minus sign stays outside'], g => neg(g(e.a)));
  if (e.k === 'binary' && (e.op === '+' || e.op === '-')) {
    const parts = [];
    (function flat(t, s) {
      if (t.k === 'binary' && (t.op === '+' || t.op === '-')) {
        flat(t.a, s);
        flat(t.b, t.op === '-' ? -s : s);
      } else if (t.k === 'unary' && t.op === '-') flat(t.a, -s);
      else parts.push([s, t]);
    })(e, 1);
    const live = parts.filter(([, t]) => depends(t, v)),
      still = live.length < parts.length;
    return apply(
      'Sum rule',
      ['Differentiate term by term', still ? '. A constant term has derivative 0, so it drops out' : ''],
      g =>
        live
          .slice(1)
          .reduce(
            (acc, [s, t]) => bin(s < 0 ? '-' : '+', acc, g(t)),
            live[0][0] < 0 ? neg(g(live[0][1])) : g(live[0][1]),
          ),
    );
  }
  if (e.k === 'binary' && e.op === '*') {
    const fs = [];
    (function flat(t) {
      if (t.k === 'binary' && t.op === '*') {
        flat(t.a);
        flat(t.b);
      } else fs.push(t);
    })(e);
    const cs = fs.filter(t => !depends(t, v)),
      ds = fs.filter(t => depends(t, v)),
      c = cs.length ? cs.reduce((a, b) => bin('*', a, b)) : null,
      times = t => (c ? bin('*', c, t) : t);
    if (ds.length === 1)
      return apply('Constant multiple', ['The constant ', c, ' stays in front'], g => bin('*', c, g(ds[0])));
    const u = ds[0],
      w = ds.slice(1).reduce((a, b) => bin('*', a, b));
    return apply(
      'Product rule',
      [
        M('(uv)′ = u′v + uv′'),
        ', with ',
        M('u'),
        ' = ',
        u,
        ' and ',
        M('v'),
        ' = ',
        w,
        c ? ['. The constant ', c, ' stays in front'] : [],
      ],
      g => times(bin('+', bin('*', g(u), w), bin('*', u, g(w)))),
    );
  }
  if (e.k === 'binary' && e.op === '/') {
    const { a, b } = e;
    if (!depends(b, v))
      return apply('Constant multiple', ['Dividing by ', b, ' is a constant multiple'], g =>
        bin('/', g(a), b),
      );
    if (!depends(a, v))
      return apply(
        'Reciprocal rule',
        ['The derivative of ', M('1/u'), ' is ', M('−u′/u²'), ', with ', M('u'), ' = ', b],
        g => neg(bin('/', bin('*', a, g(b)), sq(b))),
      );
    return apply(
      'Quotient rule',
      [M('(u/v)′ = (u′v − uv′)/v²'), ', with ', M('u'), ' = ', a, ' and ', M('v'), ' = ', b],
      g => bin('/', bin('-', bin('*', g(a), b), bin('*', a, g(b))), sq(b)),
    );
  }
  if (e.k === 'binary' && e.op === '^') {
    const { a, b } = e,
      down = bin('*', b, bin('^', a, simplify(bin('-', b, one))));
    if (!depends(b, v)) {
      if (a.k === 'name')
        return node('Power rule', ['Bring the power ', b, ' down and lower it by one'], { chain: [down] });
      return apply(
        'Chain rule',
        ['Power rule on the outside, then multiply by the derivative of the inside, ', a],
        g => bin('*', down, g(a)),
      );
    }
    if (!depends(a, v)) {
      const isE = a.k === 'name' && a.n === 'e',
        outer = isE ? e : bin('*', e, call('ln', a)),
        why = isE
          ? [e, ' is its own derivative']
          : [
              'The derivative of ',
              bin('^', a, name('u')),
              ' is ',
              bin('*', bin('^', a, name('u')), call('ln', a)),
            ];
      if (b.k === 'name') return node('Exponential rule', why, { chain: [outer] });
      return apply('Chain rule', [...why, ', times the derivative of the exponent, ', b], g =>
        bin('*', outer, g(b)),
      );
    }
    const r = bin('^', name('e'), bin('*', b, call('ln', a)));
    return apply('Logarithmic differentiation', ['Both the base and the power vary, so write it as ', r], g =>
      g(r),
    );
  }
  if (e.k === 'call') {
    const [u, w] = e.a,
      rewrite = r => apply('Rewrite', ['Write it as ', r], g => g(r));
    if (e.n === 'nthroot' && e.a.length === 2) return rewrite(bin('^', u, inv(w)));
    if (e.n === 'log' && e.a.length === 2) return rewrite(bin('/', call('ln', u), call('ln', w)));
    if (e.n === 'pow' && e.a.length === 2) return rewrite(bin('^', u, w));
    if (e.n === 'hypot' && e.a.length === 2) return rewrite(call('sqrt', bin('+', sq(u), sq(w))));
    if (e.a.length === 1) {
      const absLn = e.n === 'ln' && u.k === 'call' && u.n === 'abs' && u.a.length === 1,
        inner = absLn ? u.a[0] : u,
        outer = absLn ? inv(inner) : own(DERIV, e.n) ? DERIV[e.n](inner) : null;
      if (outer) {
        if (inner.k === 'name')
          return node('Standard derivative', ['The derivative of ', e, ' is ', outer], { chain: [] });
        return apply(
          'Chain rule',
          [
            'Differentiate the outside as if ',
            inner,
            ' were a single variable, giving ',
            outer,
            ', then multiply by the derivative of the inside',
          ],
          g => bin('*', outer, g(inner)),
        );
      }
    }
  }
  return node('Result', []);
}
export function derivativeSteps(ast, env) {
  if (ast?.k !== 'call' || ast.n !== 'deriv' || ast.a.length !== 2 || ast.a[1]?.k !== 'name') return null;
  const v = ast.a[1].n;
  let [f] = ast.a;
  mainVar = v;
  // f′(x) for a defined function, or sin′(x).
  if (f.k === 'name' && (env.fn.has(f.n) || own(DERIV, f.n))) f = call(f.n, name(v));
  const inner = f.k === 'call' && f.n === 'deriv' ? derivativeSteps(f, env) : null;
  f = simplify(inline(f, env, v));
  let tree = dTree(f, v);
  // d/dx of d/dx: the first derivative's working, then this one's.
  if (inner)
    tree = {
      rule: 'Differentiate again',
      why: ['The first derivative, differentiated once more'],
      head: call('deriv', call('deriv', inner.f, name(v)), name(v)),
      chain: [],
      to: tree.to,
      kids: [inner.methods[0].tree, tree],
      kidsFirst: true,
    };
  return { v, f, note: null, methods: [{ tree, answer: tree.to }], definite: false };
}
// F − G when it is the same everywhere (two antiderivatives of one function differ by a constant).
function offset(F, G, t, env) {
  const diffs = [0.31, 0.67, 1.13, 1.71].map(
    x => evaluate(F, { [t]: x }, env) - evaluate(G, { [t]: x }, env),
  );
  if (!diffs.every(Number.isFinite)) return undefined;
  const spread = Math.max(...diffs) - Math.min(...diffs);
  return spread < 1e-8 * (1 + Math.abs(diffs[0])) ? diffs[0] : undefined;
}
/* The working for a differential equation row, as steps { rule, why, eqs, kids, after }: equations before the
   smaller workings in `kids` (the integrals it needed, each as integralSteps shows it) and `after` them.
   `sol` is solveODE's answer with `deq` its equation, or integralEquation's with `sides`. */
const eq = (a, b) => ({ k: 'cmp', a: [a, b], ops: ['=='] }),
  DYDX = bin('/', name('dy'), name('dx'));
function working(f, v, env) {
  try {
    return integralSteps(I(f, v), env)?.methods[0]?.tree || null;
  } catch {
    return null;
  }
}
// p − q, written p + |q| when q is negative.
const less = (p, q) => (q.k === 'unary' && q.op === '-' ? bin('+', p, q.a) : bin('-', p, q));
export function odeSteps(sol, env) {
  const y = name('y'),
    x = name('x'),
    plusC = r => bin('+', r, C);
  if (sol.sides) {
    const [left, right] = sol.sides,
      found = [];
    (function walk(e) {
      if (!e || typeof e !== 'object') return;
      if (isIndef(e)) found.push(e);
      else Object.values(e).forEach(walk);
    })({ left, right });
    const steps = [
      {
        rule: 'Integrate each side',
        why: [
          'Each indefinite integral becomes an antiderivative. Their constants of integration combine into one, ',
          M('C'),
          ', written on the right',
        ],
        eqs: [eq(left, right)],
        kids: found.map(e => working(simplify(inline(e.a[0], env, e.a[1].n)), e.a[1].n, env)).filter(Boolean),
        after: [eq(sol.left, sol.right)],
      },
    ];
    if (sol.deq)
      steps.push({
        rule: 'The differential equation',
        why: [
          'Differentiate both sides with respect to ',
          M('x'),
          ', treating ',
          M('y'),
          ' as a function of ',
          M('x'),
          ', and solve for ',
          M('dy/dx'),
          '. Every curve of the family solves it, whatever ',
          M('C'),
          ' is',
        ],
        eqs: [eq(DYDX, sol.deq)],
      });
    return { question: eq(left, right), answer: eq(sol.left, sol.right), steps };
  }
  const f = sol.f,
    start = eq(DYDX, f),
    answer = eq(sol.left, sol.right);
  if (sol.how === 'integrate')
    return {
      question: start,
      answer,
      steps: [
        {
          rule: 'Integrate both sides',
          why: [
            'The right side has no ',
            M('y'),
            ' in it, so ',
            M('y'),
            ' is an antiderivative of it, plus a constant ',
            M('C'),
          ],
          eqs: [start, eq(y, I(f, 'x'))],
          kids: [working(f, 'x', env)].filter(Boolean),
          after: [answer],
        },
      ],
    };
  if (sol.how === 'separable') {
    const { gx, gy, hy } = sol.parts;
    return {
      question: start,
      answer,
      steps: [
        {
          rule: 'Separate the variables',
          why: [
            'The right side is ',
            gx,
            ' times ',
            gy,
            '. Divide both sides by ',
            gy,
            ' and integrate with respect to ',
            M('x'),
            ': ',
            M('dy/dx'),
            ' times ',
            M('dx'),
            ' is ',
            M('dy'),
            ', so each side holds one variable',
          ],
          eqs: [start, eq(I(hy, 'y'), I(gx, 'x'))],
        },
        {
          rule: 'Integrate each side',
          why: ['The two constants of integration combine into one, ', M('C')],
          kids: [working(hy, 'y', env), working(gx, 'x', env)].filter(Boolean),
          after: [answer],
        },
      ],
    };
  }
  const { a, b, A, I2 } = sol.parts,
    mu = name('μ'),
    muVal = simplify(bin('^', name('e'), neg(A))),
    ay = simplify(bin('*', a, y)),
    mub = simplify(bin('*', muVal, b));
  return {
    question: start,
    answer,
    steps: [
      {
        rule: 'Standard form',
        why: [
          'The right side is ',
          ay,
          ' plus a part with no ',
          M('y'),
          ', so the equation is linear. Bring the ',
          M('y'),
          ' term to the left',
        ],
        eqs: [start, eq(less(DYDX, ay), b)],
      },
      {
        rule: 'Integrating factor',
        why: [
          'Multiplying both sides by ',
          M('μ'),
          ', e to the minus the integral of the coefficient of ',
          M('y'),
          ', turns the left side into the derivative of one product, ',
          M('μy'),
        ],
        eqs: [eq(mu, bin('^', name('e'), neg(I(a, 'x'))))],
        kids: [working(a, 'x', env)].filter(Boolean),
        after: [eq(mu, muVal)],
      },
      {
        rule: 'Multiply by the integrating factor',
        why: [
          'By the product rule the left side is now the derivative of ',
          M('μy'),
          ', since the derivative of ',
          M('μ'),
          ' is ',
          M('μ'),
          ' times ',
          simplify(neg(a)),
        ],
        eqs: [eq(call('deriv', simplify(bin('*', muVal, y)), x), mub)],
      },
      {
        rule: 'Integrate both sides',
        why: [
          'Integrating undoes the derivative on the left, and leaves a constant ',
          M('C'),
          ' on the right',
        ],
        eqs: [eq(simplify(bin('*', muVal, y)), I(mub, 'x'))],
        kids: [working(mub, 'x', env)].filter(Boolean),
        after: [eq(simplify(bin('*', muVal, y)), plusC(I2))],
      },
      {
        rule: 'Undo the factor',
        why: ['Multiply both sides by ', simplify(bin('^', name('e'), A)), ' and multiply out'],
        eqs: [eq(y, bin('*', simplify(bin('^', name('e'), A)), plusC(I2))), answer],
      },
    ],
  };
}
export { d as derivative, integ as antiderivative };
