import { normalize } from './catalog.js';
import { lm, solve, sse } from './regression.js';

/* A table row is stored as `table {json}` so it survives history, sharing and reloads unchanged.
   cols[0] is the x column; every other column is either data (a plain name such as y1) or computed
   from a header formula such as x1^2. Cells stay as typed, empty cells included. */
const PREFIX = /^table\s*(?=\{)/;
export const isTableText = s => PREFIX.test(s.trim());
export function readTable(text) {
  try {
    const t = JSON.parse(text.trim().replace(PREFIX, ''));
    if (!Array.isArray(t.cols) || !t.cols.length) return null;
    return {
      cols: t.cols.slice(0, 20).map(c => ({
        h: String(c.h ?? '').slice(0, 200),
        v: Array.isArray(c.v) ? c.v.slice(0, 5000).map(x => String(x ?? '').slice(0, 200)) : [],
        ...(c.off && { off: true }),
      })),
      ...(t.fit?.type && { fit: { type: String(t.fit.type), y: Math.max(1, t.fit.y | 0) } }),
    };
  } catch {
    return null;
  }
}
export const writeTable = t => 'table ' + JSON.stringify(t);
export const emptyTable = () => ({
  cols: [
    { h: 'x1', v: [] },
    { h: 'y1', v: [] },
  ],
});
// A header names a data column when it is a single name such as y, y1, y_2 or y₂.
export function columnName(h) {
  const n = normalize(h.trim()).replace(/_/g, '');
  return /^[A-Za-z][A-Za-z]*\d*$/.test(n) ? n : null;
}

const poly = n => ({
  params: n + 1,
  f: (x, p) => p.reduce((s, c, k) => s + c * x ** (n - k), 0),
  fit(xs, ys) {
    if (xs.length < n + 1) return null;
    const A = Array.from({ length: n + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => xs.reduce((s, x) => s + x ** (2 * n - i - j), 0)),
      ),
      b = Array.from({ length: n + 1 }, (_, i) => xs.reduce((s, x, k) => s + ys[k] * x ** (n - i), 0));
    return solve(A, b);
  },
});
const linearFit = (u, ys) => {
  const p = poly(1).fit(u, ys);
  return p && [p[1], p[0]];
};
const refine = (f, start, xs, ys) => {
  const v = Object.fromEntries(start.map((c, i) => ['p' + i, c])),
    names = start.map((_, i) => 'p' + i);
  try {
    lm(
      names,
      () =>
        ys.map(
          (y, i) =>
            y -
            f(
              xs[i],
              names.map(n => v[n]),
            ),
        ),
      v,
    );
  } catch {
    return start;
  }
  const p = names.map(n => v[n]);
  return p.every(Number.isFinite) ? p : start;
};
export const FITS = {
  linear: { label: 'Linear', ...poly(1), form: 'm·x + b' },
  quadratic: { label: 'Quadratic', ...poly(2) },
  cubic: { label: 'Cubic', ...poly(3) },
  quartic: { label: 'Quartic', ...poly(4) },
  exponential: {
    label: 'Exponential',
    params: 2,
    f: (x, [a, b]) => a * Math.exp(b * x),
    fit(xs, ys) {
      const k = ys.map(y => Math.log(Math.abs(y))),
        q = k.every(Number.isFinite) ? linearFit(xs, k) : null,
        sign = ys.reduce((s, y) => s + y, 0) < 0 ? -1 : 1;
      return refine(this.f, q ? [sign * Math.exp(q[0]), q[1]] : [1, 0.1], xs, ys);
    },
  },
  logarithmic: {
    label: 'Logarithmic',
    params: 2,
    f: (x, [a, b]) => a + b * Math.log(x),
    fit(xs, ys) {
      if (xs.some(x => x <= 0)) return null;
      return linearFit(xs.map(Math.log), ys);
    },
  },
  power: {
    label: 'Power',
    params: 2,
    f: (x, [a, b]) => a * x ** b,
    fit(xs, ys) {
      if (xs.some(x => x <= 0)) return null;
      const q = ys.every(y => y > 0) ? linearFit(xs.map(Math.log), ys.map(Math.log)) : null;
      return refine(this.f, q ? [Math.exp(q[0]), q[1]] : [1, 1], xs, ys);
    },
  },
  logistic: {
    label: 'Logistic',
    params: 3,
    f: (x, [c, a, b]) => c / (1 + a * Math.exp(-b * x)),
    fit(xs, ys) {
      const c = Math.max(...ys) * 1.05 || 1,
        k = ys.map(y => Math.log(c / y - 1)),
        q = k.every(Number.isFinite) ? linearFit(xs, k) : null;
      return refine(this.f, q ? [c, Math.exp(q[0]), -q[1]] : [c, 1, 1], xs, ys);
    },
  },
  sinusoidal: {
    label: 'Sinusoidal',
    params: 4,
    f: (x, [a, b, c, d]) => a * Math.sin(b * x + c) + d,
    fit(xs, ys) {
      if (xs.length < 4) return null;
      const span = Math.max(...xs) - Math.min(...xs) || 1;
      let best = null;
      // Try a ladder of frequencies; at each, a·sin + b·cos + d is linear, so solve it exactly.
      for (let i = 1; i <= 240; i++) {
        const w = (Math.PI * 2 * i) / (span * 8),
          rows = xs.map(x => [Math.sin(w * x), Math.cos(w * x), 1]),
          A = [0, 1, 2].map(r => [0, 1, 2].map(s => rows.reduce((t, q) => t + q[r] * q[s], 0))),
          b = [0, 1, 2].map(r => rows.reduce((t, q, k) => t + q[r] * ys[k], 0)),
          p = solve(A, b);
        if (!p) continue;
        const e = sse(rows.map((q, k) => ys[k] - (p[0] * q[0] + p[1] * q[1] + p[2])));
        if (!best || e < best.e) best = { e, p: [Math.hypot(p[0], p[1]), w, Math.atan2(p[1], p[0]), p[2]] };
      }
      return best && refine(this.f, best.p, xs, ys);
    },
  },
};
export function fitData(type, xs, ys) {
  const M = FITS[type];
  if (!M) return null;
  const pts = xs.map((x, i) => [x, ys[i]]).filter(p => p.every(Number.isFinite)),
    X = pts.map(p => p[0]),
    Y = pts.map(p => p[1]);
  if (X.length < Math.max(2, M.params)) return { error: `Needs at least ${Math.max(2, M.params)} points` };
  const p = M.fit(X, Y);
  if (!p || !p.every(Number.isFinite)) return { error: 'This model does not fit the data' };
  const resid = Y.map((y, i) => y - M.f(X[i], p)),
    mean = Y.reduce((s, y) => s + y, 0) / Y.length,
    total = Y.reduce((s, y) => s + (y - mean) ** 2, 0),
    r2 = total ? 1 - sse(resid) / total : 1;
  return {
    type,
    p,
    f: x => M.f(x, p),
    resid,
    r2,
    r: type === 'linear' ? Math.sign(p[0]) * Math.sqrt(Math.max(0, r2)) : null,
  };
}
const num = v => `(${+v.toPrecision(12)})`;
// The fitted curve as an expression in `x`, for plotting.
export function fitExpression(fit, x = 'x') {
  const p = fit.p.map(num);
  switch (fit.type) {
    case 'exponential':
      return `${p[0]}*exp(${p[1]}*${x})`;
    case 'logarithmic':
      return `${p[0]}+${p[1]}*ln(${x})`;
    case 'power':
      return `${p[0]}*${x}^${p[1]}`;
    case 'logistic':
      return `${p[0]}/(1+${p[1]}*exp(-${p[2]}*${x}))`;
    case 'sinusoidal':
      return `${p[0]}*sin(${p[1]}*${x}+${p[2]})+${p[3]}`;
    default:
      return p.map((c, k) => `${c}*${x}^${p.length - 1 - k}`).join('+');
  }
}
// The fitted equation as readable text, with signs folded into the operators.
export function fitEquation(fit, y, x, show) {
  const p = fit.p,
    c = v => show(Math.abs(v)),
    s = (v, first) => (v < 0 ? (first ? '-' : ' - ') : first ? '' : ' + ');
  switch (fit.type) {
    case 'exponential':
      return `${y} = ${s(p[0], 1)}${c(p[0])}e^(${show(p[1])}${x})`;
    case 'logarithmic':
      return `${y} = ${s(p[0], 1)}${c(p[0])}${s(p[1])}${c(p[1])}ln(${x})`;
    case 'power':
      return `${y} = ${s(p[0], 1)}${c(p[0])}${x}^(${show(p[1])})`;
    case 'logistic':
      return `${y} = ${show(p[0])}/(1 + ${show(p[1])}e^(${show(-p[2])}${x}))`;
    case 'sinusoidal':
      return `${y} = ${s(p[0], 1)}${c(p[0])}sin(${show(p[1])}${x}${s(p[2])}${c(p[2])})${s(p[3])}${c(p[3])}`;
    default: {
      const n = p.length - 1;
      return (
        `${y} = ` +
        p
          .map((v, k) => {
            const e = n - k,
              term = e === 0 ? '' : e === 1 ? x : `${x}^${e}`;
            return s(v, k === 0) + c(v) + term;
          })
          .join('')
      );
    }
  }
}
