export function findKeyPoints(curves, x0, x1, N = 1400) {
  const out = [],
    dx = (x1 - x0) / N,
    fin = Number.isFinite,
    add = (x, y, t, c, id) => {
      if (!fin(x) || !fin(y) || Math.abs(y) > 1e9) return;
      const q = out.find(
        p =>
          p.t === t &&
          Math.abs(p.x - x) < 1e-7 * (1 + Math.abs(x)) &&
          Math.abs(p.y - y) < 1e-7 * (1 + Math.abs(y)),
      );
      if (q) {
        q.id = [].concat(q.id, id);
        return;
      }
      out.push({
        x,
        y,
        t,
        c,
        id,
      });
    };
  const bis = (g, a, b) => {
    let ga = g(a);
    for (let i = 0; i < 55; i++) {
      const m = (a + b) / 2,
        gm = g(m);
      if (!fin(gm)) return NaN;
      if (gm < 0 === ga < 0) {
        a = m;
        ga = gm;
      } else b = m;
    }
    return (a + b) / 2;
  };
  const ys = curves.map(c => {
    const a = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      let v;
      try {
        v = c.f(x0 + i * dx);
      } catch {
        v = NaN;
      }
      a[i] = v;
    }
    return a;
  });
  curves.forEach((c, k) => {
    const f = c.f,
      Y = ys[k],
      sf = x => {
        try {
          return f(x);
        } catch {
          return NaN;
        }
      };
    let sc = 0;
    for (const v of Y) if (fin(v)) sc = Math.max(sc, Math.abs(v));
    sc = Math.min(sc, 1e6) || 1;
    for (let i = 0; i < N; i++) {
      const a = Y[i],
        b = Y[i + 1];
      if (!fin(a) || !fin(b)) continue;
      if (a === 0) add(x0 + i * dx, 0, 'root', c.c, c.id);
      else if (a < 0 !== b < 0 && b !== 0) {
        const x = bis(sf, x0 + i * dx, x0 + (i + 1) * dx);
        if (fin(x) && Math.abs(sf(x)) < 1e-6 * (1 + sc)) add(x, sf(x), 'root', c.c, c.id);
      }
    }
    const h = dx * 0.01,
      g = x => (sf(x + h) - sf(x - h)) / (2 * h);
    for (let i = 1; i < N - 1; i++) {
      if (![Y[i - 1], Y[i], Y[i + 1], Y[i + 2]].every(fin)) continue;
      const d0 = Y[i] - Y[i - 1],
        d1 = Y[i + 1] - Y[i];
      if (d0 !== 0 && d1 !== 0 && d0 < 0 !== d1 < 0) {
        const a = x0 + (i - 1) * dx,
          b = x0 + (i + 1) * dx,
          x = bis(g, a, b);
        if (!fin(x)) continue;
        const y = sf(x);
        if (!fin(y) || !(Math.abs(g(x)) * dx < 1e-3 * (1 + Math.abs(y)))) continue;
        add(x, y, d0 > 0 ? 'maximum' : 'minimum', c.c, c.id);
        if (Math.abs(y) < 1e-9 * (1 + sc)) add(x, 0, 'root', c.c, c.id);
      }
    }
    if (x0 <= 0 && x1 >= 0) {
      const y = sf(0);
      if (fin(y)) add(0, y, 'y-intercept', c.c, c.id);
    }
  });
  for (let a = 0; a < curves.length; a++)
    for (let b = a + 1; b < curves.length; b++) {
      const A = ys[a],
        B = ys[b],
        fa = curves[a].f,
        fb = curves[b].f,
        d = x => {
          try {
            return fa(x) - fb(x);
          } catch {
            return NaN;
          }
        };
      for (let i = 0; i < N; i++) {
        const p = A[i] - B[i],
          q = A[i + 1] - B[i + 1];
        if (!fin(p) || !fin(q)) continue;
        if (p === 0 || p < 0 !== q < 0) {
          const x = p === 0 ? x0 + i * dx : bis(d, x0 + i * dx, x0 + (i + 1) * dx),
            y = fa(x);
          if (fin(x) && fin(y) && Math.abs(d(x)) < 1e-6 * (1 + Math.abs(y)))
            add(x, y, 'intersection', curves[a].c, [curves[a].id, curves[b].id]);
        }
      }
    }
  return out.slice(0, 400);
}

/* key points of a parametric curve P(t) = [x, y] (or null where restricted), lo <= t <= hi:
   axis crossings and extremes, each solved in t by bisection. Polar curves pass P(θ) = r(θ)·[cos θ, sin θ]. */
export function findParametricPoints(P, lo, hi, c, id, N = 2400) {
  const out = [],
    fin = Number.isFinite,
    dt = (hi - lo) / N;
  if (!(dt > 0) || !fin(dt)) return out;
  const at = (t, k) => {
      let p;
      try {
        p = P(t);
      } catch {
        return NaN;
      }
      return p ? p[k] : NaN;
    },
    fx = t => at(t, 0),
    fy = t => at(t, 1);
  const add = (t, kind) => {
    let x = fx(t),
      y = fy(t);
    if (!fin(x) || !fin(y) || Math.abs(x) > 1e9 || Math.abs(y) > 1e9) return;
    if (kind === 'root') y = 0;
    if (kind === 'y-intercept') x = 0;
    if (out.some(q => Math.hypot(q.x - x, q.y - y) < 1e-7 * (1 + Math.hypot(x, y)))) return;
    out.push({ x, y, t: kind, c, id });
  };
  const bis = (g, a, b) => {
    let ga = g(a);
    for (let i = 0; i < 55; i++) {
      const m = (a + b) / 2,
        gm = g(m);
      if (!fin(gm)) return NaN;
      if (gm < 0 === ga < 0) {
        a = m;
        ga = gm;
      } else b = m;
    }
    return (a + b) / 2;
  };
  const X = new Float64Array(N + 1),
    Y = new Float64Array(N + 1);
  let scale = 0;
  for (let i = 0; i <= N; i++) {
    X[i] = fx(lo + i * dt);
    Y[i] = fy(lo + i * dt);
    if (fin(X[i]) && fin(Y[i])) scale = Math.max(scale, Math.abs(X[i]), Math.abs(Y[i]));
  }
  scale = Math.min(scale, 1e6) || 1;
  const closed = fin(X[0]) && fin(Y[0]) && Math.hypot(X[0] - X[N], Y[0] - Y[N]) < 1e-9 * (1 + scale);
  // Sign changes of one coordinate: the curve crosses the other axis there. A pole also flips sign, so check the value.
  const crossings = (A, f, kind) => {
    for (let i = 0; i <= N; i++) {
      const a = A[i],
        b = A[i + 1];
      if (a === 0) add(lo + i * dt, kind);
      else if (i < N && fin(a) && fin(b) && b !== 0 && a < 0 !== b < 0) {
        const t = bis(f, lo + i * dt, lo + (i + 1) * dt);
        if (fin(t) && Math.abs(f(t)) < 1e-6 * (1 + scale)) add(t, kind);
      }
    }
  };
  crossings(Y, fy, 'root');
  crossings(X, fx, 'y-intercept');
  // Turning points of one coordinate. On a closed curve the samples wrap, so a turn at t = lo is found too.
  const turns = (A, f, up, down) => {
    const h = dt * 0.01,
      g = t => (f(t + h) - f(t - h)) / (2 * h),
      m = closed ? N : N + 1,
      get = k => A[closed ? ((k % N) + N) % N : k];
    for (let i = closed ? 0 : 1; i < (closed ? m : m - 1); i++) {
      const p = get(i - 1),
        v = get(i),
        n = get(i + 1);
      if (!fin(p) || !fin(v) || !fin(n)) continue;
      const d0 = v - p,
        d1 = n - v;
      if (d0 === 0 || d1 === 0 || d0 < 0 === d1 < 0) continue;
      const t = bis(g, lo + (i - 1) * dt, lo + (i + 1) * dt);
      if (!fin(t)) continue;
      const y = f(t);
      if (!fin(y) || !(Math.abs(g(t)) * dt < 1e-3 * (1 + Math.abs(y)))) continue;
      add(t, d0 > 0 ? up : down);
    }
  };
  turns(Y, fy, 'maximum', 'minimum');
  turns(X, fx, 'rightmost', 'leftmost');
  return out;
}

/* key points of an implicit curve F(x,y)=0: axis intercepts + extremes. paths: world-space flat polylines */
export function findImplicitPoints(F, paths, x0, x1, y0, y1, c, id, N = 900) {
  const out = [],
    fin = Number.isFinite,
    f = (x, y) => {
      try {
        return F(x, y);
      } catch {
        return NaN;
      }
    };
  const add = (x, y, t) => {
    if (fin(x) && fin(y) && !out.some(q => Math.hypot(q.x - x, q.y - y) < 1e-6 * (1 + Math.hypot(x, y))))
      out.push({
        x,
        y,
        t,
        c,
        id,
      });
  };
  const bis = (g, a, b) => {
    let ga = g(a);
    for (let i = 0; i < 55; i++) {
      const m = (a + b) / 2,
        gm = g(m);
      if (!fin(gm)) return NaN;
      if (gm < 0 === ga < 0) {
        a = m;
        ga = gm;
      } else b = m;
    }
    return (a + b) / 2;
  };
  const scan = (g, a, b, cb) => {
    const d = (b - a) / N;
    let pv = g(a);
    for (let i = 0; i < N; i++) {
      const nx = g(a + (i + 1) * d);
      if (fin(pv) && fin(nx) && (pv === 0 || (pv < 0 !== nx < 0 && nx !== 0))) {
        const t = pv === 0 ? a + i * d : bis(g, a + i * d, a + (i + 1) * d);
        if (fin(t)) cb(t);
      }
      pv = nx;
    }
  };
  if (y0 <= 0 && y1 >= 0)
    scan(
      x => f(x, 0),
      x0,
      x1,
      x => add(x, 0, 'root'),
    );
  if (x0 <= 0 && x1 >= 0)
    scan(
      y => f(0, y),
      y0,
      y1,
      y => add(0, y, 'y-intercept'),
    );
  /* extremes: local max/min of y (and x) along each contour, refined by Newton on F=0, dF/dx=0 (or dF/dy=0) */
  const refine = (x, y, wantY) => {
    const h = 1e-3 * (1 + Math.hypot(x, y)) * 1e-1;
    let px = x,
      py = y;
    for (let it = 0; it < 25; it++) {
      const F0 = f(px, py),
        Fx = (f(px + h, py) - f(px - h, py)) / (2 * h),
        Fy = (f(px, py + h) - f(px, py - h)) / (2 * h),
        Fxx = (f(px + h, py) - 2 * F0 + f(px - h, py)) / (h * h),
        Fyy = (f(px, py + h) - 2 * F0 + f(px, py - h)) / (h * h),
        Fxy = (f(px + h, py + h) - f(px + h, py - h) - f(px - h, py + h) + f(px - h, py - h)) / (4 * h * h);
      const a = Fx,
        b = Fy,
        cc = wantY ? Fxx : Fxy,
        d = wantY ? Fxy : Fyy,
        g = wantY ? Fx : Fy,
        det = a * d - b * cc;
      if (!fin(det) || Math.abs(det) < 1e-14) return null;
      const dx = (-F0 * d + b * g) / det,
        dy = (-a * g + cc * F0) / det;
      if (!fin(dx) || !fin(dy)) return null;
      px += dx;
      py += dy;
      if (Math.abs(dx) + Math.abs(dy) < 1e-12) break;
    }
    return [px, py];
  };
  const tol = Math.max(x1 - x0, y1 - y0) / 40;
  for (const P of paths) {
    const n = P.length / 2;
    if (n < 5) continue;
    const closed = Math.hypot(P[0] - P[2 * n - 2], P[1] - P[2 * n - 1]) < 1e-9 * (1 + Math.abs(P[0]));
    const m = closed ? n - 1 : n,
      w = 2;
    for (const axis of [1, 0]) {
      for (let i = closed ? 0 : w; i < (closed ? m : m - w); i++) {
        const at = k => P[2 * (((k % m) + m) % m) + axis],
          v = at(i);
        let isMax = true,
          isMin = true;
        for (let q = 1; q <= w; q++) {
          if (!(v >= at(i - q) && v >= at(i + q))) isMax = false;
          if (!(v <= at(i - q) && v <= at(i + q))) isMin = false;
        }
        if (!(isMax || isMin) || (at(i - w) === v && at(i + w) === v)) continue;
        let X = P[2 * i],
          Y = P[2 * i + 1];
        const r = refine(X, Y, axis === 1);
        if (
          r &&
          Math.hypot(r[0] - X, r[1] - Y) < tol &&
          Math.abs(f(r[0], r[1])) < 1e-6 * (1 + Math.abs(f(X, Y)) + 1)
        ) {
          X = r[0];
          Y = r[1];
        }
        add(X, Y, axis === 1 ? (isMax ? 'maximum' : 'minimum') : isMax ? 'rightmost' : 'leftmost');
      }
    }
  }
  return out;
}
