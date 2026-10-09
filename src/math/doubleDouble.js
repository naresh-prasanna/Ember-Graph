import { math, own } from './catalog.js';

/* Double-double arithmetic (~32 digits) for calculator rows: literals are read exactly from their decimal text. */
const NODD = Symbol('nodd'),
  qs = (a, b) => {
    const s = a + b;
    return [s, b - (s - a)];
  },
  ts = (a, b) => {
    const s = a + b,
      v = s - a;
    return [s, a - (s - v) + (b - v)];
  },
  sp = a => {
    const t = 134217729 * a,
      h = t - (t - a);
    return [h, a - h];
  },
  tp = (a, b) => {
    const p = a * b,
      [ah, al] = sp(a),
      [bh, bl] = sp(b);
    return [p, ah * bh - p + ah * bl + al * bh + al * bl];
  };
const dAdd = (a, b) => {
    let [s, e] = ts(a[0], b[0]);
    const [t, f] = ts(a[1], b[1]);
    e += t;
    [s, e] = qs(s, e);
    e += f;
    return qs(s, e);
  },
  dNeg = a => [-a[0], -a[1]],
  dSub = (a, b) => dAdd(a, dNeg(b)),
  dMul = (a, b) => {
    let [p, e] = tp(a[0], b[0]);
    e += a[0] * b[1] + a[1] * b[0];
    return qs(p, e);
  };
const dDiv = (a, b) => {
    const q1 = a[0] / b[0];
    let r = dSub(a, dMul(b, [q1, 0]));
    const q2 = r[0] / b[0];
    r = dSub(r, dMul(b, [q2, 0]));
    return dAdd(qs(q1, q2), [r[0] / b[0], 0]);
  },
  dSqrt = a => {
    if (a[0] <= 0) return [a[0] < 0 ? NaN : 0, 0];
    const x = 1 / Math.sqrt(a[0]),
      ax = a[0] * x;
    return dAdd([ax, 0], [dSub(a, dMul([ax, 0], [ax, 0]))[0] * x * 0.5, 0]);
  },
  dFloor = a => {
    const f = Math.floor(a[0]);
    return f === a[0] ? qs(f, Math.floor(a[1])) : [f, 0];
  };
function dPow(a, n) {
  let r = [1, 0],
    b = a,
    m = Math.abs(n);
  while (m) {
    if (m & 1) r = dMul(r, b);
    b = dMul(b, b);
    m = Math.floor(m / 2);
  }
  return n < 0 ? dDiv([1, 0], r) : r;
}
function dLit(raw) {
  const m = raw.match(/^(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/);
  if (!m) throw NODD;
  const ex = (m[3] ? +m[3] : 0) - m[2].length;
  if (Math.abs(ex) > 300) throw NODD;
  const mk = b => {
      const h = Number(b);
      if (!Number.isFinite(h)) throw NODD;
      return qs(h, Number(b - BigInt(h)));
    },
    big = mk(BigInt(m[1] + m[2] || '0')),
    pw = mk(10n ** BigInt(Math.abs(ex)));
  return ex >= 0 ? dMul(big, pw) : dDiv(big, pw);
}
const DPI = [3.141592653589793, 1.2246467991473532e-16],
  DE = [2.718281828459045, 1.4456468917292502e-16];
function ddEval(n, st) {
  const r = ddNode(n, st);
  st.s = Math.max(st.s, Math.abs(r[0]));
  return r;
}
function ddNode(n, st) {
  const E = x => ddEval(x, st);
  switch (n.k) {
    case 'num':
      return dLit(n.raw);
    case 'name':
      if (n.n === 'pi') return DPI;
      if (n.n === 'e') return DE;
      if (n.n === 'tau') return dMul(DPI, [2, 0]);
      throw NODD;
    case 'unary':
      if (n.op === '-') return dNeg(E(n.a));
      if (n.op === '+') return E(n.a);
      throw NODD;
    case 'binary': {
      const a = E(n.a),
        b = E(n.b);
      switch (n.op) {
        case '+':
          return dAdd(a, b);
        case '-':
          return dSub(a, b);
        case '*':
          return dMul(a, b);
        case '/':
          return dDiv(a, b);
        case '^':
          if (b[1] === 0 && Number.isInteger(b[0]) && Math.abs(b[0]) <= 4096) return dPow(a, b[0]);
          st.fz = true;
          return [Math.pow(a[0], b[0]), 0];
      }
      throw NODD;
    }
    case 'call': {
      if (!own(math, n.n)) throw NODD;
      const a = n.a.map(E);
      switch (n.n) {
        case 'abs':
          return a[0][0] < 0 ? dNeg(a[0]) : a[0];
        case 'sqrt':
          return dSqrt(a[0]);
        case 'floor':
          return dFloor(a[0]);
        case 'ceil':
          return dNeg(dFloor(dNeg(a[0])));
        case 'round':
          return dFloor(dAdd(a[0], [0.5, 0]));
        case 'min':
          return a.reduce((x, y) => (y[0] < x[0] || (y[0] === x[0] && y[1] < x[1]) ? y : x));
        case 'max':
          return a.reduce((x, y) => (y[0] > x[0] || (y[0] === x[0] && y[1] > x[1]) ? y : x));
      }
      st.fz = true;
      return [math[n.n](...a.map(x => x[0])), 0];
    }
  }
  throw NODD;
}
export function ddValue(c, fallback) {
  const st = {
    s: 0,
    fz: false,
  };
  try {
    const r = ddEval(c.ast, st);
    let v = r[0] + r[1];
    if (Math.abs(v) < (st.fz ? 1e-15 : 1e-29) * st.s) v = 0;
    return v;
  } catch {
    return fallback(c);
  }
}
