/* Damped least squares, with finite input checks and parameter rollback. */
export function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    if (!Number.isFinite(A[i][i]) || Math.abs(A[i][i]) < 1e-15) return null;
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let t = b[i];
    for (let j = i + 1; j < n; j++) t -= A[i][j] * x[j];
    x[i] = t / A[i][i];
  }
  return x.every(Number.isFinite) ? x : null;
}
export const sse = a => a.reduce((s, v) => s + v * v, 0);
// Every real root of f(x) = 0 on [lo, hi]: sign changes and touches that land on zero.
export function findRoots(f, lo = -50, hi = 50, n = 1000) {
  const fin = Number.isFinite,
    dx = (hi - lo) / n,
    ys = Array.from({ length: n + 1 }, (_, i) => {
      try {
        return f(lo + i * dx);
      } catch {
        return NaN;
      }
    });
  let sc = 1;
  for (const v of ys) if (fin(v)) sc = Math.max(sc, Math.abs(v));
  sc = Math.min(sc, 1e6) || 1;
  const tol = 1e-8 * (1 + sc),
    bis = (a, b) => {
      let fa;
      try {
        fa = f(a);
      } catch {
        return NaN;
      }
      for (let i = 0; i < 60; i++) {
        const m = (a + b) / 2;
        let fm;
        try {
          fm = f(m);
        } catch {
          return NaN;
        }
        if (!fin(fm)) return NaN;
        if (fa < 0 === fm < 0) {
          a = m;
          fa = fm;
        } else b = m;
        if (Math.abs(b - a) < 1e-12 * (1 + Math.abs(m))) return m;
      }
      return (a + b) / 2;
    },
    roots = [];
  for (let i = 0; i < n; i++) {
    const a = ys[i],
      b = ys[i + 1],
      x0 = lo + i * dx;
    if (!fin(a)) continue;
    if (Math.abs(a) <= tol) roots.push(x0);
    else if (fin(b) && a < 0 !== b < 0 && Math.abs(b) > tol) {
      const x = bis(x0, x0 + dx);
      if (fin(x) && Math.abs(f(x)) <= 1e-6 * (1 + sc)) roots.push(x);
    }
  }
  // A double root like (a − 2)² doesn't change sign; catch a touch that sits on zero.
  for (let i = 1; i < n; i++) {
    const y = ys[i];
    if (!fin(y) || Math.abs(y) > tol) continue;
    if (Math.abs(y) <= Math.abs(ys[i - 1] || Infinity) && Math.abs(y) <= Math.abs(ys[i + 1] || Infinity))
      roots.push(lo + i * dx);
  }
  roots.sort((a, b) => a - b);
  const out = [];
  for (const x of roots) if (!out.length || Math.abs(x - out.at(-1)) > 1e-6 * (1 + Math.abs(x))) out.push(x);
  return out;
}
export function lm(ps, res, vars) {
  const dot = (u, v) => u.reduce((t, x, k) => t + x * v[k], 0);
  let lam = 1e-3,
    e0 = sse(res());
  if (!Number.isFinite(e0)) throw Error('Model is undefined at a data point');
  for (let it = 0; it < 100; it++) {
    const rs = res(),
      J = ps.map(n => {
        const v = vars[n],
          h = 1e-6 * (1 + Math.abs(v));
        vars[n] = v + h;
        let q;
        try {
          q = res();
        } finally {
          vars[n] = v;
        }
        return q.map((z, i) => (rs[i] - z) / h);
      });
    // Rank-deficient fits (more unknowns than equations): keep later, dependent parameters at their start value.
    const act = [],
      basis = [];
    J.forEach((c, i) => {
      let v = [...c];
      for (const q of basis) {
        const d = dot(v, q);
        v = v.map((x, k) => x - d * q[k]);
      }
      const nv = Math.hypot(...v),
        nc = Math.hypot(...c);
      if (nc > 1e-12 && nv > 1e-6 * nc) {
        basis.push(v.map(x => x / nv));
        act.push(i);
      }
    });
    if (!act.length) break;
    const A = act.map(i => act.map(j => dot(J[i], J[j]) + (i === j ? lam : 0))),
      b = act.map(i => dot(J[i], rs)),
      d = solve(A, b);
    if (!d) break;
    const old = ps.map(n => vars[n]);
    act.forEach((i, a) => (vars[ps[i]] += d[a]));
    const e1 = sse(res());
    if (e1 < e0) {
      const imp = e0 - e1;
      e0 = e1;
      lam = Math.max(lam / 3, 1e-10);
      if (imp < 1e-14) break;
    } else {
      ps.forEach((n, i) => (vars[n] = old[i]));
      lam *= 10;
      if (lam > 1e10) break;
    }
  }
  return e0;
}
