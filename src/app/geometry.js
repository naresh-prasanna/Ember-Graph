import { fractalParams, geoValue, parameterBounds, tableFit, tableValues, val } from './model.js';
import { S, reduceMotion } from './state.js';
import { measurePaths, stitchContours } from '../math/contours.js';
import { MC, MK, cen, closedLoop, nrst, rs } from '../math/morph.js';
import { renderFractal } from '../render/fractalClient.js';
import { kick } from '../render/renderer.js';
import { showError } from '../ui/panel.js';

function geoRaw(r) {
  const g = (r.g = {
    L: [],
    pts: [],
    fill: null,
    n: 0,
  });
  if (!r.k || r.err || r.off || !S.W || !S.H) return;
  const k = r.k;
  if (k.type === 'fractal') {
    fractalRaster(r);
    return;
  }
  const T = k.type,
    X = p => (p - S.V.cx) / S.V.s,
    Y = p => (S.V.cy - p) / S.V.s;
  const filter = scope => !k.filter || !!val(k.filter, scope),
    screen = (x, y) => [S.V.cx + x * S.V.s, S.V.cy - y * S.V.s],
    valid = p => p && p.every(Number.isFinite) && p.every(v => Math.abs(v) < 1e9);
  function sample(N, get) {
    let cur = [],
      prev = null;
    for (let i = 0; i <= N; i++) {
      let p;
      try {
        p = get(i / N);
      } catch (e) {
        p = null;
        if (!r.runtimeError) r.runtimeError = e.message;
      }
      let cut = !valid(p);
      if (!cut && prev) {
        const dist = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        if (dist > Math.max(S.W, S.H)) cut = true;
        else if (dist > 12) {
          let mid;
          try {
            mid = get((i - 0.5) / N);
          } catch {
            mid = null;
          }
          if (
            !valid(mid) ||
            Math.hypot(mid[0] - (p[0] + prev[0]) / 2, mid[1] - (p[1] + prev[1]) / 2) >
              Math.max(15, dist * 0.45)
          )
            cut = true;
        }
      }
      if (cut) {
        if (cur.length > 3) g.L.push(cur);
        cur = [];
        prev = null;
        if (!valid(p)) continue;
      }
      cur.push(...p);
      prev = p;
    }
    if (cur.length > 3) g.L.push(cur);
  }
  r.runtimeError = '';
  if (T === 'cart' || T === 'function')
    sample(Math.max(2, Math.ceil(S.W)) * (S.fast ? 1 : 4), u => {
      const x = X(u * S.W),
        scope = {
          x,
          ...(k.xKey && { [k.xKey]: x }),
        },
        y = val(
          k.c,
          T === 'function'
            ? {
                [k.param]: x,
              }
            : scope,
        );
      return filter({
        ...scope,
        y,
        ...(T === 'function'
          ? {
              [k.param]: x,
            }
          : {}),
      })
        ? screen(x, y)
        : null;
    });
  else if (T === 'cartY')
    sample(Math.max(2, Math.ceil(S.H)) * (S.fast ? 1 : 4), u => {
      const y = Y(u * S.H),
        x = val(k.c, {
          y,
        });
      return filter({
        x,
        y,
      })
        ? screen(x, y)
        : null;
    });
  else if (T === 'par' || T === 'polar') {
    const param = T === 'par' ? k.param || 't' : 'theta',
      [lo, hi] = parameterBounds(k.filter, param);
    sample(T === 'par' ? 1500 : 1800, u => {
      const t = lo + (hi - lo) * u;
      let x, y, q;
      if (T === 'par') {
        const at = { t, ...(k.param && { [k.param]: t }) };
        x = val(k.fx, at);
        y = val(k.fy, at);
      } else {
        q = val(k.c, {
          theta: t,
        });
        x = q * Math.cos(t);
        y = q * Math.sin(t);
      }
      return filter({
        x,
        y,
        t,
        theta: t,
        r: q,
      })
        ? screen(x, y)
        : null;
    });
  } else if (T === 'ggb') {
    try {
      const { paths, points } = geoValue(r);
      for (const w of paths) {
        const L = new Array(w.length);
        for (let i = 0; i < w.length; i += 2) [L[i], L[i + 1]] = screen(w[i], w[i + 1]);
        if (L.every(Number.isFinite)) g.L.push(L);
      }
      for (const q of points) {
        const p = screen(...q);
        if (valid(p)) g.pts.push({ p });
      }
    } catch (e) {
      r.runtimeError = e.message;
    }
  } else if (T === 'table') {
    try {
      const { xs, cols } = tableValues(r);
      for (const c of cols) {
        if (c.off) continue;
        xs.forEach((x, index) => {
          const p = screen(x, c.ys[index]);
          if (valid(p)) g.pts.push({ p, index, col: c.col });
        });
      }
      const fit = tableFit(r);
      if (fit?.f)
        sample(Math.max(2, Math.ceil(S.W)) * (S.fast ? 1 : 2), u => {
          const x = X(u * S.W);
          return screen(x, fit.f(x));
        });
    } catch (e) {
      r.runtimeError = e.message;
    }
  } else if (T === 'pt' || T === 'pts') {
    const points = T === 'pt' ? [[k.fx, k.fy]] : k.points;
    points.forEach((q, index) => {
      try {
        const x = val(q[0]),
          y = val(q[1]),
          p = screen(x, y);
        if (
          valid(p) &&
          filter({
            x,
            y,
          })
        )
          g.pts.push({
            p,
            index,
          });
      } catch (e) {
        r.runtimeError = e.message;
      }
    });
  } else if (T === 'imp' || T === 'ineq') {
    const step = S.fast ? 9 : 6,
      cols = Math.ceil(S.W / step) + 1,
      rw = Math.ceil(S.H / step) + 1,
      v = new Float64Array(cols * rw),
      boundary = k.boundary || k.c;
    for (let j = 0; j < rw; j++)
      for (let i = 0; i < cols; i++) {
        const scope = {
          x: X(i * step),
          y: Y(j * step),
        };
        try {
          v[j * cols + i] = filter(scope) ? val(boundary, scope) : NaN;
        } catch (e) {
          v[j * cols + i] = NaN;
          r.runtimeError = e.message;
        }
      }
    const cross = (a, b, x1, y1, x2, y2) => {
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 === b < 0) return null;
      const u = a / (a - b),
        x = x1 + (x2 - x1) * u,
        y = y1 + (y2 - y1) * u;
      let z;
      try {
        z = val(boundary, {
          x: X(x),
          y: Y(y),
        });
      } catch {
        return null;
      }
      if (!Number.isFinite(z) || Math.abs(z) > 0.75 * Math.max(Math.abs(a), Math.abs(b)) + 1e-8) return null;
      return [x, y];
    };
    const fill = T === 'ineq' ? new Path2D() : null;
    for (let j = 0; j < rw - 1; j++)
      for (let i = 0; i < cols - 1; i++) {
        const a = v[j * cols + i],
          b = v[j * cols + i + 1],
          c = v[(j + 1) * cols + i + 1],
          d = v[(j + 1) * cols + i],
          x = i * step,
          y = j * step,
          P = [
            cross(a, b, x, y, x + step, y),
            cross(b, c, x + step, y, x + step, y + step),
            cross(d, c, x, y + step, x + step, y + step),
            cross(a, d, x, y, x, y + step),
          ].filter(Boolean);
        if (P.length === 2) g.L.push([...P[0], ...P[1]]);
        else if (P.length === 4) {
          let z;
          try {
            z = val(boundary, {
              x: X(x + step / 2),
              y: Y(y + step / 2),
            });
          } catch {
            z = 0;
          }
          if (a < 0 === z < 0) {
            g.L.push([...P[0], ...P[1]], [...P[2], ...P[3]]);
          } else g.L.push([...P[0], ...P[3]], [...P[1], ...P[2]]);
        }
        if (fill) {
          const scope = {
            x: X(x + step / 2),
            y: Y(y + step / 2),
          };
          try {
            if (filter(scope) && val(k.c, scope)) fill.rect(x, y, step + 0.5, step + 0.5);
          } catch (e) {
            r.runtimeError = e.message;
          }
        }
      }
    g.fill = fill;
  }
  if (T === 'imp' || T === 'ineq') g.L = stitchContours(g.L);
  measurePaths(g);
  g.n = g.L.reduce((s, a) => s + a.length / 2, 0);
  if (r.runtimeError && r.errEl) {
    r.errEl.textContent = r.runtimeError;
    r.errEl.style.color = '';
  } else showError(r);
}

/* Living geometry: when a parameter or equation changes, the drawn curve springs to its new shape instead of being redrawn.
   Each vertex is a damped spring (~11% overshoot, then settles), so a circle balloons past its new size and eases back. */
/* Living geometry: when a parameter or equation changes, the drawn curve springs to its new shape instead of being redrawn.
   Each vertex is a damped spring (~11% overshoot, then settles), so a circle balloons past its new size and eases back. */
const MORPH = !reduceMotion;
function rayLoop(r, cur, ctr) {
  const N = cur.length / 2,
    bd = r.k.boundary || r.k.c;
  let cx = 0,
    cy = 0;
  if (ctr) {
    cx = ctr[0];
    cy = ctr[1];
  } else {
    for (let i = 0; i < N; i++) {
      cx += cur[2 * i];
      cy += cur[2 * i + 1];
    }
    cx /= N;
    cy /= N;
  }
  const f = (x, y) => {
    try {
      const z = val(bd, {
        x: (x - S.V.cx) / S.V.s,
        y: (S.V.cy - y) / S.V.s,
      });
      return Number.isFinite(z) ? z : NaN;
    } catch {
      return NaN;
    }
  };
  const to = new Float64Array(N * 2),
    ok = new Uint8Array(N),
    f0 = f(cx, cy);
  let hit = 0;
  for (let i = 0; i < N; i++) {
    const dx = cur[2 * i] - cx,
      dy = cur[2 * i + 1] - cy,
      d = Math.hypot(dx, dy);
    if (d < 1e-6 || !Number.isFinite(f0) || f0 === 0) continue;
    const ux = dx / d,
      uy = dy / d;
    let t0 = 0,
      fa = f0,
      tb = 0.5;
    for (let k = 0; k < 64; k++) {
      const fb = f(cx + ux * tb, cy + uy * tb);
      if (Number.isFinite(fb)) {
        if (fb < 0 !== fa < 0) {
          let lo = t0,
            hi = tb;
          for (let q = 0; q < 28; q++) {
            const mid = (lo + hi) / 2,
              fm = f(cx + ux * mid, cy + uy * mid);
            if (Number.isFinite(fm) && fm < 0 === fa < 0) lo = mid;
            else hi = mid;
          }
          const t = (lo + hi) / 2;
          to[2 * i] = cx + ux * t;
          to[2 * i + 1] = cy + uy * t;
          ok[i] = 1;
          hit++;
          break;
        }
        t0 = tb;
        fa = fb;
      }
      tb *= 1.35;
    }
  }
  for (let i = 0; i < N; i++) {
    if (hit === 0) {
      to[2 * i] = cx;
      to[2 * i + 1] = cy;
    } else if (!ok[i]) {
      to[2 * i] = cur[2 * i];
      to[2 * i + 1] = cur[2 * i + 1];
    }
  }
  return to;
}
export function geo(r) {
  const old = r.g,
    ov = r.gv,
    pm = r.m,
    pw = r.pw;
  r.pw = false;
  geoRaw(r);
  const g = r.g;
  r.gv = [S.V.cx, S.V.cy, S.V.s, S.W, S.H, S.fast ? 1 : 0];
  r.m = null;
  if (
    !MORPH ||
    S.mode3 ||
    (typeof S.drag !== 'undefined' && S.drag) ||
    !old ||
    !ov ||
    ov.some((v, i) => v !== r.gv[i]) ||
    (r.prog < 1 && !pw) ||
    !r.k ||
    r.k.type === 'fractal' ||
    r.err
  )
    return;
  const imp = r.k.type === 'imp' || r.k.type === 'ineq',
    nl = g.L,
    src = pm ? pm.cur : old.L,
    m = {
      cur: [],
      vel: [],
      to: [],
      pp: null,
    };
  let ok = true;
  if (imp && src.length && nl.length !== src.length && (src.every(closedLoop) || nl.length === 0)) {
    /* loops balloon about their own centre; clipped arcs that leave the screen entirely balloon about their common centre */
    let ctr = null;
    if (!src.every(closedLoop)) {
      let x = 0,
        y = 0,
        n = 0;
      for (const a of src)
        for (let i = 0; i < a.length; i += 2) {
          x += a[i];
          y += a[i + 1];
          n++;
        }
      ctr = [x / n, y / n];
    }
    for (let j = 0; j < src.length; j++) {
      const a = src[j],
        N = pm ? a.length / 2 : Math.min(600, Math.max(48, a.length >> 1)),
        c = pm ? a : rs(a, N);
      m.cur.push(c);
      m.to.push(rayLoop(r, c, ctr));
      m.vel.push(pm ? pm.vel[j] : new Float64Array(N * 2));
    }
  } else if (imp && (nl.length === 0) !== (src.length === 0)) {
    /* the curve shrinks to nothing (or grows from nothing), e.g. x^2+y^2=a^2 at a=0: every loop collapses into its own centre */
    if (nl.length === 0) {
      for (let j = 0; j < src.length; j++) {
        const a = src[j],
          N = pm ? a.length / 2 : Math.min(1500, Math.max(48, a.length >> 1));
        m.cur.push(pm ? a : rs(a, N));
        m.to.push(cen(a, N));
        m.vel.push(pm ? pm.vel[j] : new Float64Array(N * 2));
      }
    } else {
      for (const b of nl) {
        const N = Math.min(1500, Math.max(48, b.length >> 1));
        m.cur.push(cen(b, N));
        m.to.push(rs(b, N));
        m.vel.push(new Float64Array(N * 2));
      }
    }
  } else if (imp && nl.length && src.length && nl.length !== src.length) {
    for (const b of nl) {
      const N = Math.min(600, Math.max(48, b.length >> 1)),
        [c, t] = nrst(src, b, N);
      m.cur.push(c);
      m.to.push(t);
      m.vel.push(new Float64Array(N * 2));
    }
  } else if (nl.length || src.length) {
    if (nl.length !== src.length) ok = false;
    else
      for (let j = 0; j < nl.length && ok; j++) {
        const a = src[j],
          b = nl[j];
        if (a.length === b.length) {
          m.cur.push(pm ? a : Float64Array.from(a));
          m.to.push(Float64Array.from(b));
          m.vel.push(pm ? pm.vel[j] : new Float64Array(a.length));
        } else if (imp || pm) {
          const N = pm ? a.length / 2 : Math.min(1500, Math.max(48, Math.max(a.length, b.length) >> 1));
          m.cur.push(pm ? a : rs(a, N));
          m.to.push(rs(b, N));
          m.vel.push(pm ? pm.vel[j] : new Float64Array(N * 2));
        } else ok = false;
      }
  }
  const op = pm && pm.pp ? pm.pp.map(q => q.cur) : old.pts.map(q => q.p);
  if (g.pts.length || op.length) {
    if (g.pts.length !== op.length) ok = false;
    else
      m.pp = g.pts.map((q, i) => ({
        cur: [...op[i]],
        vel: pm && pm.pp ? pm.pp[i].vel : [0, 0],
        to: [...q.p],
      }));
  }
  if (!ok || (!m.cur.length && !m.pp)) return;
  m.raw = g.L;
  m.rawP = g.pts.map(q => q.p);
  g.L = m.cur;
  g.pts.forEach((q, i) => {
    if (m.pp) q.p = m.pp[i].cur;
  });
  measurePaths(g);
  r.m = m;
  if (pw) r.prog = 1;
}
export function morphStep(dt) {
  let busy = false;
  for (const r of S.rows) {
    const m = r.m;
    if (!m) continue;
    const n = Math.max(1, Math.ceil(dt / 0.008)),
      h = dt / n;
    let e = 0;
    for (let s = 0; s < n; s++) {
      for (let j = 0; j < m.cur.length; j++) {
        const c = m.cur[j],
          v = m.vel[j],
          t = m.to[j];
        for (let i = 0; i < c.length; i++) {
          v[i] += (-MK * (c[i] - t[i]) - MC * v[i]) * h;
          c[i] += v[i] * h;
        }
      }
      if (m.pp)
        for (const q of m.pp)
          for (let a = 0; a < 2; a++) {
            q.vel[a] += (-MK * (q.cur[a] - q.to[a]) - MC * q.vel[a]) * h;
            q.cur[a] += q.vel[a] * h;
          }
    }
    for (let j = 0; j < m.cur.length; j++) {
      const c = m.cur[j],
        v = m.vel[j],
        t = m.to[j];
      for (let i = 0; i < c.length; i++) e = Math.max(e, Math.abs(c[i] - t[i]), Math.abs(v[i]) * 0.05);
    }
    if (m.pp)
      for (const q of m.pp)
        for (let a = 0; a < 2; a++) e = Math.max(e, Math.abs(q.cur[a] - q.to[a]), Math.abs(q.vel[a]) * 0.05);
    if (e < 0.03) {
      r.g.L = m.raw;
      r.g.pts.forEach((q, i) => {
        if (m.pp) q.p = m.rawP[i];
      });
      measurePaths(r.g);
      r.m = null;
    } else {
      measurePaths(r.g);
      busy = true;
    }
  }
  return busy;
}
export function surfaceMesh(r) {
  const N = 85,
    R = 6,
    points = [];
  for (let j = 0; j <= N; j++) {
    const line = [];
    for (let i = 0; i <= N; i++) {
      const x = -R + (2 * R * i) / N,
        y = -R + (2 * R * j) / N;
      let z;
      try {
        z = val(r.k.c, {
          x,
          y,
        });
        if (
          r.k.filter &&
          !val(r.k.filter, {
            x,
            y,
            z,
          })
        )
          z = NaN;
      } catch {
        z = NaN;
      }
      line.push([x, y, z]);
    }
    points.push(line);
  }
  const contours = [],
    cross = (a, b, h) => {
      if (!Number.isFinite(a[2]) || !Number.isFinite(b[2]) || a[2] < h === b[2] < h) return null;
      const t = (h - a[2]) / (b[2] - a[2]);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, h];
    };
  const heights = points
      .flat()
      .map(p => p[2])
      .filter(z => Number.isFinite(z) && Math.abs(z) <= 9),
    min = Math.min(...heights),
    max = Math.max(...heights),
    span = max - min;
  for (let li = 0; li <= 72 && span > 1e-8; li++) {
    const level = min + (span * li) / 72;
    const segments = [];
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const a = points[j][i],
          b = points[j][i + 1],
          c = points[j + 1][i + 1],
          d = points[j + 1][i];
        const q = [cross(a, b, level), cross(b, c, level), cross(c, d, level), cross(d, a, level)].filter(
          Boolean,
        );
        if (q.length >= 2) segments.push([q[0], q[1]]);
        if (q.length === 4) segments.push([q[2], q[3]]);
      }
    if (segments.length)
      contours.push({
        level,
        segments,
      });
  }
  return {
    points,
    contours,
    N,
    flat: span < 1e-8,
  };
}
function fractalRaster(r) {
  let p;
  try {
    p = fractalParams(r);
  } catch (e) {
    r.err = e.message;
    showError(r);
    return;
  }
  const scale = S.fast ? 3 : Math.max(1, Math.sqrt((S.W * S.H) / 1000000)),
    w = Math.ceil(S.W / scale),
    h = Math.ceil(S.H / scale),
    key = JSON.stringify([p, S.V, S.W, S.H, w, h, r.col]);
  if (r.fractalKey === key) return;
  r.fractalKey = key;
  const view = {
      ...S.V,
    },
    width = S.W,
    height = S.H;
  r.fractalPending = true;
  renderFractal(r.id, {
    p,
    view,
    width,
    height,
    w,
    h,
  }).then(image => {
    if (!image || r.fractalKey !== key) return;
    if (!S.rows.includes(r) || r.off || r.err || r.k?.type !== 'fractal') {
      r.fractalKey = null;
      r.fractalPending = false;
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').putImageData(image, 0, 0);
    r.fractal = {
      canvas,
      view,
      width,
      height,
    };
    r.fractalPending = false;
    kick();
  });
}
