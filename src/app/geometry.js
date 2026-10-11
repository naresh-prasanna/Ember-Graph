import {
  curveSteps,
  fractalParams,
  geoValue,
  maxCopies,
  parameterBounds,
  rowCopies,
  shapeValue,
  tableFit,
  tableValues,
  val,
  val as evalRow,
} from './model.js';
import { S, reduceMotion } from './state.js';
import { T } from './theme.js';
import { measurePaths, stitchContours } from '../math/contours.js';
import { curvePoints } from '../math/fractals.js';
import { BRANCH } from '../math/parser.js';
import { MC, MK, cen, closedLoop, nrst, rs } from '../math/morph.js';
import { renderFractal } from '../render/fractalClient.js';
import { kick, shatter } from '../render/renderer.js';
import { showError } from '../ui/panel.js';

function geoRaw(r) {
  const g = (r.g = {
    L: [],
    pts: [],
    fill: null,
    band: null,
    n: 0,
  });
  if (!r.k || r.err || r.off || !S.W || !S.H) return;
  const k = r.k;
  if (k.type === 'fractal') {
    fractalRaster(r);
    return;
  }
  if (k.type === 'lsys') {
    let p;
    try {
      p = curvePoints(k.family, curveSteps(r));
    } catch (e) {
      r.err = e.message;
      showError(r);
      return;
    }
    const L = new Array(p.length),
      { cx, cy, s } = S.V;
    for (let i = 0; i < p.length; i += 2) {
      L[i] = cx + p[i] * s;
      L[i + 1] = cy - p[i + 1] * s;
    }
    g.L.push(L);
    return;
  }
  const T = k.type,
    X = p => (p - S.V.cx) / S.V.s,
    Y = p => (S.V.cy - p) / S.V.s;
  // A row that uses a list draws one copy per element; every evaluation below belongs to the current copy.
  let branch;
  const val = (c, scope = {}) => evalRow(c, branch === undefined ? scope : { ...scope, [BRANCH]: branch });
  const filter = scope => !k.filter || !!val(k.filter, scope),
    screen = (x, y) => [S.V.cx + x * S.V.s, S.V.cy - y * S.V.s],
    valid = p => p && p.every(Number.isFinite) && p.every(v => Math.abs(v) < 1e9);
  /* Even samples in u ∈ [0, 1], plus more wherever the curve is steep, turns sharply or stops, so spikes reach
     off screen and domain edges are met wherever the camera sits. */
  function sample(N, get, graphOfX = false) {
    let cur = [],
      curU = [],
      budget = 4 * N;
    const at = u => {
        try {
          const p = get(u);
          return valid(p) ? p : null;
        } catch (e) {
          if (!r.runtimeError) r.runtimeError = e.message;
          return null;
        }
      },
      gap = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]),
      far = p => p[1] < -50 || p[1] > S.H + 50 || p[0] < -50 || p[0] > S.W + 50,
      end = () => {
        if (cur.length > 3)
          if (!graphOfX) g.L.push(cur);
          else for (const [p, us] of bands(cur, curU)) g.L.push(tips(p, us));
        cur = [];
        curU = [];
      },
      emit = (p, u) => {
        if (!p) return end();
        cur.push(p[0], p[1]);
        curU.push(u);
      };
    /* A spike can stop short of the edge: −ln|cos x| never passes about 37 in floating point. Where the curve
       climbs steeply into a tip from both sides, find the tip exactly; if stepping 1000 times closer keeps it
       climbing (a pole or a logarithm, not a peak), run the spike off screen. */
    function asymptote(ua, ub, dir) {
      const score = u => {
          budget--;
          const p = at(u);
          return p ? dir * p[1] : -Infinity;
        },
        G = 0.6180339887498949;
      let a = ua,
        b = ub,
        c = b - G * (b - a),
        d = a + G * (b - a),
        fc = score(c),
        fd = score(d);
      for (let k = 0; k < 100 && a < c && c < d && d < b; k++)
        if (fc >= fd) {
          b = d;
          d = c;
          fd = fc;
          c = b - G * (b - a);
          fc = score(c);
        } else {
          a = c;
          c = d;
          fc = fd;
          d = a + G * (b - a);
          fd = score(d);
        }
      const u = fc >= fd ? c : d;
      for (const s of [-1, 1]) {
        const [v1, v2, v3] = [1e-6, 1e-9, 1e-12].map(e => score(u + s * e));
        if (v2 - v1 > 2 && v3 - v2 > 0.5 * (v2 - v1)) {
          const p = at(u) || at(u + s * 1e-12);
          return p && { u, x: p[0], y: dir > 0 ? S.H + 60 : -60 };
        }
      }
      return null;
    }
    /* Where y = f(x) swings up and down faster than the line is wide (sin(1/x) near 0), lines can only show
       a tangle: those columns are filled from the lowest to the highest value instead, and the line stops there. */
    function bands(pts, us) {
      const n = us.length,
        col = i => Math.floor(pts[2 * i]),
        turns = new Map(),
        lo = new Map(),
        hi = new Map();
      let dir = 0;
      for (let i = 0; i < n; i++) {
        const c = col(i),
          y = pts[2 * i + 1];
        lo.set(c, Math.min(lo.get(c) ?? Infinity, y));
        hi.set(c, Math.max(hi.get(c) ?? -Infinity, y));
        const dy = i ? y - pts[2 * i - 1] : 0;
        if (Math.abs(dy) < 0.5) continue;
        // Turning far off screen is the jump across an asymptote, not an oscillation.
        const t = pts[2 * i - 1];
        if (dir && Math.sign(dy) !== dir && t > -50 && t < S.H + 50)
          turns.set(col(i - 1), (turns.get(col(i - 1)) || 0) + 1);
        dir = Math.sign(dy);
      }
      const near = c => [-2, -1, 0, 1, 2].reduce((s, d) => s + (turns.get(c + d) || 0), 0),
        dense = new Set([...lo.keys()].filter(c => near(c) >= 3 && hi.get(c) - lo.get(c) > 2));
      if (!dense.size) return [[pts, us]];
      // A sparse column or two between dense ones is the same band.
      for (const c of [...dense])
        if (!dense.has(c + 1) && (dense.has(c + 2) || dense.has(c + 3))) dense.add(c + 1).add(c + 2);
      const out = [];
      let p = [],
        q = [];
      const flush = () => {
        if (p.length > 3) out.push([p, q]);
        p = [];
        q = [];
      };
      for (let i = 0; i < n; i++) {
        if (dense.has(col(i))) flush();
        else {
          p.push(pts[2 * i], pts[2 * i + 1]);
          q.push(us[i]);
        }
      }
      flush();
      // The samples so far can miss the peaks; a few more across each column find how far it reaches.
      const K = S.fast ? 8 : 24,
        clamp = y => Math.max(-50, Math.min(S.H + 50, y)),
        cols = [...dense].sort((a, b) => a - b);
      for (const c of cols) {
        let a = lo.get(c) ?? Infinity,
          b = hi.get(c) ?? -Infinity;
        for (let k = 0; k < K; k++) {
          const s = at((c + (k + 0.5) / K) / S.W);
          if (s) [a, b] = [Math.min(a, s[1]), Math.max(b, s[1])];
        }
        lo.set(c, clamp(a));
        hi.set(c, clamp(b));
      }
      // Neighbouring columns swing just as far, so each edge takes the furthest of three; ragged edges are missed peaks.
      const reach = (m, f) =>
          new Map(cols.map(c => [c, f(...[c - 1, c, c + 1].filter(d => dense.has(d)).map(d => m.get(d)))])),
        top = reach(lo, Math.min),
        bottom = reach(hi, Math.max);
      g.band ||= new Path2D();
      for (let i = 0; i < cols.length;) {
        let j = i;
        while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++;
        const run = cols.slice(i, j + 1);
        g.band.moveTo(run[0], top.get(run[0]));
        for (const c of run) {
          g.band.lineTo(c, top.get(c));
          g.band.lineTo(c + 1, top.get(c));
        }
        for (const c of run.reverse()) {
          g.band.lineTo(c + 1, bottom.get(c));
          g.band.lineTo(c, bottom.get(c));
        }
        g.band.closePath();
        i = j + 1;
      }
      return out;
    }
    function tips(pts, us) {
      const out = [];
      let last = -1;
      for (let i = 0; i < us.length; i++) {
        const xl = pts[2 * i - 2],
          yl = pts[2 * i - 1],
          x = pts[2 * i],
          y = pts[2 * i + 1],
          xr = pts[2 * i + 2],
          yr = pts[2 * i + 3],
          dl = y - yl,
          dr = y - yr,
          dir =
            i > 0 &&
            i < us.length - 1 &&
            budget > 0 &&
            us[i] - last > 1e-5 &&
            dl &&
            dr &&
            dl < 0 === dr < 0 &&
            Math.abs(dl) > 4 * Math.abs(x - xl) &&
            Math.abs(dr) > 4 * Math.abs(xr - x) &&
            !far([x, y])
              ? Math.sign(dl)
              : 0,
          a = dir && asymptote(us[i - 1], us[i + 1], dir);
        if (dir) last = us[i];
        if (a && a.u < us[i]) out.push(a.x, a.y);
        out.push(x, y);
        if (a && a.u >= us[i]) out.push(a.x, a.y);
      }
      return out;
    }
    // The points strictly between u0 and u1, or a break where the curve jumps.
    function fill(u0, p0, u1, p1, depth) {
      // Both off the same edge: nothing to see between them. Off opposite edges, either the curve crosses the
      // screen or it jumps (tan at π/2), so keep halving.
      if (
        (!p0 || far(p0)) &&
        (!p1 || far(p1)) &&
        !(p0 && p1 && (p0[1] < 0 !== p1[1] < 0 || p0[0] < 0 !== p1[0] < 0))
      )
        return;
      const m = (u0 + u1) / 2;
      if (budget-- <= 0) {
        if (!p0 || !p1 || gap(p0, p1) > Math.max(S.W, S.H)) emit(null);
        return;
      }
      if (depth > 52 || m <= u0 || m >= u1) {
        if (!p0 || !p1 || gap(p0, p1) > 12) emit(null);
        return;
      }
      const pm = at(m);
      // Turning back within a quarter pixel is detail no line can show; bands() fills that column instead.
      if (graphOfX && p0 && p1 && pm && (u1 - u0) * S.W < 0.25 && (pm[1] - p0[1]) * (pm[1] - p1[1]) > 1) {
        emit(pm, m);
        return;
      }
      if (
        p0 &&
        p1 &&
        pm &&
        gap(p0, p1) <= 12 &&
        Math.hypot(pm[0] - (p0[0] + p1[0]) / 2, pm[1] - (p0[1] + p1[1]) / 2) <= 1
      ) {
        emit(pm, m);
        return;
      }
      fill(u0, p0, m, pm, depth + 1);
      emit(pm, m);
      fill(m, pm, u1, p1, depth + 1);
    }
    const ps = [at(0)],
      steep = i => i >= 0 && i < N && ps[i] && ps[i + 1] && gap(ps[i], ps[i + 1]) > 12;
    for (let i = 0; i <= N; i++) {
      if (i < N) ps[i + 1] = at((i + 1) / N);
      if (i > 0 && (!ps[i - 1] !== !ps[i] || steep(i - 2) || steep(i - 1) || steep(i)))
        fill((i - 1) / N, ps[i - 1], i / N, ps[i], 0);
      emit(ps[i], i / N);
    }
    end();
  }
  r.runtimeError = '';
  const listed = rowCopies(r),
    copies = Math.min(listed ?? 1, maxCopies(T)),
    // Many copies share one redraw's time, so each is sampled more coarsely.
    samples = n => Math.max(160, Math.ceil(n / Math.sqrt(copies)));
  for (let b = 0; b < copies; b++) {
    branch = listed === undefined ? undefined : b;
    drawCopy();
  }
  function drawCopy() {
    if (T === 'cart' || T === 'function' || (T === 'lreg' && k.c))
      sample(
        samples(Math.max(2, Math.ceil(S.W)) * (S.fast ? 1 : 4)),
        u => {
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
        },
        true,
      );
    else if (T === 'cartY')
      sample(samples(Math.max(2, Math.ceil(S.H)) * (S.fast ? 1 : 4)), u => {
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
      sample(samples(T === 'par' ? 1500 : 1800), u => {
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
    } else if (T === 'field') {
      // A slope field for dy/dx = F(x, y): a dash on a grid fixed to the plane, tilted to F there.
      const gap = 38 / S.V.s,
        half = 8,
        x0 = Math.ceil(X(0) / gap) * gap,
        y0 = Math.floor(S.V.cy / S.V.s / gap) * gap;
      for (let y = y0; S.V.cy - y * S.V.s < S.H; y -= gap)
        for (let x = x0; S.V.cx + x * S.V.s < S.W; x += gap) {
          let m;
          try {
            m = val(k.c, { x, y });
          } catch {
            continue;
          }
          if (typeof m !== 'number' || !Number.isFinite(m)) continue;
          const a = Math.atan(m),
            [px, py] = screen(x, y),
            [dx, dy] = [half * Math.cos(a), -half * Math.sin(a)];
          g.L.push([px - dx, py - dy, px + dx, py + dy]);
        }
    } else if (T === 'shape') {
      const { paths, fills, points, guides } = shapeValue(r),
        toScreen = w => {
          const L = new Array(w.length);
          for (let i = 0; i < w.length; i += 2) [L[i], L[i + 1]] = screen(w[i], w[i + 1]);
          return L.every(Number.isFinite) ? L : null;
        };
      for (const w of paths) {
        const L = toScreen(w);
        if (L) g.L.push(L);
      }
      g.guides = guides.map(toScreen).filter(Boolean);
      for (const w of fills) {
        const L = toScreen(w);
        if (!L) continue;
        g.fill ||= new Path2D();
        g.fill.moveTo(L[0], L[1]);
        for (let i = 2; i < L.length; i += 2) g.fill.lineTo(L[i], L[i + 1]);
        g.fill.closePath();
      }
      points.forEach(([x, y], index) => {
        const p = screen(x, y);
        if (valid(p)) g.pts.push({ p, index });
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
              ...(branch !== undefined && { copy: branch }),
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
        if (!Number.isFinite(z) || Math.abs(z) > 0.75 * Math.max(Math.abs(a), Math.abs(b)) + 1e-8)
          return null;
        return [x, y];
      };
      const fill = T === 'ineq' ? (g.fill ||= new Path2D()) : null;
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
    }
  }
  if (T === 'imp' || T === 'ineq') g.L = stitchContours(g.L);
  measurePaths(g);
  g.n = g.L.reduce((s, a) => s + a.length / 2, 0);
  // Only when the message changes: the row's text is retypeset on every redraw otherwise, which stalls panning.
  if (r.runtimeError === r.errShown) return;
  if (r.runtimeError && r.errEl) {
    r.errEl.textContent = r.runtimeError;
    r.errEl.style.color = '';
  } else showError(r);
  r.errShown = r.runtimeError;
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
/* Douglas–Peucker: keep only the points more than `tol` px off the line through the kept points around them.
   Sampling takes 4 points a pixel to find the curve; drawing that many costs far more than the picture needs. */
function thin(a, tol = 0.25) {
  const n = a.length >> 1;
  if (n < 3) return a;
  const keep = new Uint8Array(n),
    stack = [0, n - 1],
    t2 = tol * tol;
  keep[0] = keep[n - 1] = 1;
  while (stack.length) {
    const j = stack.pop(),
      i = stack.pop(),
      x0 = a[2 * i],
      y0 = a[2 * i + 1],
      dx = a[2 * j] - x0,
      dy = a[2 * j + 1] - y0,
      L2 = dx * dx + dy * dy;
    let worst = 0,
      at = -1;
    for (let k = i + 1; k < j; k++) {
      const px = a[2 * k] - x0,
        py = a[2 * k + 1] - y0,
        // Squared distance to the line, or to the point when the ends meet (a closed loop).
        d2 = L2 > 1e-12 ? (px * dy - py * dx) ** 2 / L2 : px * px + py * py;
      if (d2 > worst) {
        worst = d2;
        at = k;
      }
    }
    if (worst > t2) {
      keep[at] = 1;
      stack.push(i, at, at, j);
    }
  }
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(a[2 * k], a[2 * k + 1]);
  return out;
}
const THIN = new Set(['cart', 'cartY', 'function', 'par', 'polar', 'lreg', 'lsys']);
export function geo(r) {
  const old = r.g,
    ov = r.gv,
    pm = r.m,
    pw = r.pw;
  r.pw = false;
  geoRaw(r);
  const g = r.g;
  // The springs pair vertices one to one, so they work on the full samples; everything else gets the thinned ones.
  g.full = g.L;
  if (THIN.has(r.k?.type) && !r.err) {
    g.L = g.L.map(a => thin(a));
    measurePaths(g);
  }
  r.gv = [S.V.cx, S.V.cy, S.V.s, S.W, S.H, S.fast ? 1 : 0];
  r.m = null;
  // A valid expression can still stop drawing anything, like y = √(−x² − 1), or a slider moving a curve out of
  // the real numbers. With the view unchanged that is the curve breaking, so it bursts. Implicit curves shrink
  // into their centres instead, and broken rows have already burst in rebuild.
  const blank = q => !q.L.some(a => a.length >= 4) && !q.pts.length && !q.band;
  if (
    old &&
    ov &&
    !ov.some((v, i) => v !== r.gv[i]) &&
    !r.err &&
    !r.off &&
    r.k &&
    !['imp', 'ineq', 'const', 'calc', 'surf', 'fractal'].includes(r.k.type) &&
    !blank(old) &&
    blank(g)
  )
    shatter(old, r.col, r.shown ?? 1);
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
    nl = g.full,
    src = pm ? pm.cur : old.full || old.L,
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
        } else if (imp || pm || r.k.type === 'shape') {
          const N = pm ? a.length / 2 : Math.min(1500, Math.max(48, Math.max(a.length, b.length) >> 1));
          m.cur.push(pm ? a : rs(a, N));
          m.to.push(rs(b, N));
          m.vel.push(pm ? pm.vel[j] : new Float64Array(N * 2));
        } else ok = false;
      }
  }
  const op = pm && pm.pp ? pm.pp.map(q => q.cur) : old.pts.map(q => q.p);
  if (g.pts.length || op.length) {
    // A polygon gaining or losing a vertex still springs its outline; only the vertex dots jump.
    if (g.pts.length !== op.length) ok &&= r.k.type === 'shape' && m.cur.length > 0;
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
    key = JSON.stringify([p, S.V, S.W, S.H, w, h, r.col, T.id]);
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
    shade: T.shade,
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
