import { rebuild, setVar, val } from './model.js';
import { save, saveSoon } from './persistence.js';
import { frameScene } from './scenes.js';
import { S } from './state.js';
import { $, ctx, cv } from '../core/dom.js';
import { clamp, fmt } from '../math/format.js';
import { parts, splitTop } from '../math/parser.js';
import { dseg, ix } from '../math/segments.js';
import { cameraKick, unprojectPoint } from '../render/camera.js';
import { kick } from '../render/renderer.js';

function clk(px, py) {
  const mi = S.marks.findIndex(m => Math.hypot(S.V.cx + m.x * S.V.s - px, S.V.cy - m.y * S.V.s - py) < 10);
  if (mi >= 0) {
    S.marks.splice(mi, 1);
    kick();
    return;
  }
  let best = null,
    dist = 14;
  for (const r of S.rows) {
    if (r.off || r.err || !r.g) continue;
    for (const a of r.g.L)
      for (let i = 0; i + 3 < a.length; i += 2) {
        const d = dseg(px, py, a[i], a[i + 1], a[i + 2], a[i + 3]);
        if (d[0] < dist) {
          dist = d[0];
          best = {
            r,
            a,
            i,
            p: d[1],
          };
        }
      }
  }
  if (!best) return;
  let P = best.p,
    snap = 12;
  const near = [];
  for (const r of S.rows) {
    if (r.off || r.err || !r.g || r === best.r) continue;
    for (const a of r.g.L)
      for (let i = 0; i + 3 < a.length; i += 2) {
        const s = a.slice(i, i + 4);
        if (
          Math.min(s[0], s[2]) <= px + 16 &&
          Math.max(s[0], s[2]) >= px - 16 &&
          Math.min(s[1], s[3]) <= py + 16 &&
          Math.max(s[1], s[3]) >= py - 16
        )
          near.push(s);
      }
  }
  near.push([0, S.V.cy, S.W, S.V.cy], [S.V.cx, 0, S.V.cx, S.H]);
  for (let i = Math.max(0, best.i - 30); i <= Math.min(best.a.length - 4, best.i + 30); i += 2) {
    const a = best.a;
    if (i >= 2 && (a[i + 1] - a[i - 1]) * (a[i + 3] - a[i + 1]) < 0) {
      const d = Math.hypot(a[i] - px, a[i + 1] - py);
      if (d < snap) {
        snap = d;
        P = [a[i], a[i + 1]];
      }
    }
    for (const s of near) {
      const q = ix(a[i], a[i + 1], a[i + 2], a[i + 3], ...s);
      if (q) {
        const d = Math.hypot(q[0] - px, q[1] - py);
        if (d < snap) {
          snap = d;
          P = q;
        }
      }
    }
  }
  const x = (P[0] - S.V.cx) / S.V.s,
    y = (S.V.cy - P[1]) / S.V.s,
    k = best.r.k;
  let ux = best.a[best.i + 2] - best.a[best.i],
    uy = -(best.a[best.i + 3] - best.a[best.i + 1]);
  if (k.type === 'cart' || k.type === 'function') {
    const h = 1e-5 * (1 + Math.abs(x)),
      f = u =>
        val(
          k.c,
          k.type === 'function'
            ? {
                [k.param]: u,
              }
            : {
                x: u,
              },
        );
    try {
      ux = 1;
      uy = (f(x + h) - f(x - h)) / (2 * h);
    } catch {}
  }
  S.marks.push({
    x,
    y,
    ux,
    uy,
    c: best.r.col,
  });
  if (S.marks.length > 8) S.marks.shift();
  kick();
}
export function zoomAt(px, py, f) {
  if (!Number.isFinite(f) || f <= 0) return;
  cameraKick(0, 0, clamp(Math.log(f), -0.4, 0.4));
  if (S.mode3) {
    S.C.s = Math.min(300, Math.max(8, S.C.s * f));
    kick();
    saveSoon();
    return;
  }
  const ns = Math.min(2e5, Math.max(2, S.V.s * f));
  f = ns / S.V.s;
  S.V.cx = px - (px - S.V.cx) * f;
  S.V.cy = py - (py - S.V.cy) * f;
  S.V.s = ns;
  S.dirty = true;
  kick();
  saveSoon();
}
const pointers = new Map();
let gesture = null,
  wheelTimer;
export const rawLocal = e => {
    const b = cv.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  },
  local = e => unprojectPoint(rawLocal(e));
function hitPoint(p) {
  for (const r of S.rows) {
    if (r.off || r.err || !r.g) continue;
    if (!['pt', 'pts'].includes(r.k?.type)) continue;
    for (const q of r.g.pts)
      if (Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < 16)
        return {
          r,
          index: q.index,
        };
  }
  return null;
}
function dragPoint(target, x, y) {
  const r = target.r,
    k = r.k,
    q = k.type === 'pt' ? [k.fx, k.fy] : k.points[target.index],
    ns = q.map(c => (c.ast.k === 'name' ? c.ast.n : null));
  x = +x.toFixed(4);
  y = +y.toFixed(4);
  if (ns[0] && ns[1] && ns[0] !== ns[1] && S.VM[ns[0]] && S.VM[ns[1]]) {
    setVar(ns[0], x);
    setVar(ns[1], y);
  } else {
    if (k.type === 'pt') r.text = `(${x}, ${y})`;
    else {
      const texts = splitTop(parts(r.text).body.slice(1, -1));
      texts[target.index] = `(${x}, ${y})`;
      r.text = '[' + texts.join(',') + ']';
    }
    r.inp.value = r.text;
    rebuild();
    r.prog = 1;
  }
}
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  if (
    e.type === 'pointerup' &&
    pointers.size === 1 &&
    gesture?.moved < 5 &&
    !gesture.multi &&
    !S.drag &&
    !S.mode3
  )
    clk(...local(e));
  pointers.delete(e.pointerId);
  S.drag = null;
  if (!pointers.size) {
    S.fast = false;
    gesture = null;
    cv.style.cursor = 'grab';
    S.dirty = true;
    kick();
    saveSoon();
  }
}

export function initInteraction() {
  cv.onpointerdown = e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = local(e);
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, rawLocal(e));
    if (pointers.size === 1) {
      gesture = {
        start: p,
        moved: 0,
        multi: false,
      };
      S.drag = S.mode3 ? null : hitPoint(p);
    } else {
      gesture.multi = true;
      S.drag = null;
    }
    S.fast = true;
    cv.style.cursor = 'grabbing';
  };
  cv.onpointermove = e => {
    const n = local(e),
      wx = (n[0] - S.V.cx) / S.V.s,
      wy = (S.V.cy - n[1]) / S.V.s;
    $('#co').textContent = S.mode3 ? '' : `(${fmt(wx)}, ${fmt(wy)})`;
    const raw = pointers.get(e.pointerId);
    if (!raw) return;
    const p = unprojectPoint(raw);
    if (!S.drag) cameraKick(n[0] - p[0], n[1] - p[1]);
    gesture.moved += Math.hypot(n[0] - p[0], n[1] - p[1]);
    if (pointers.size === 2) {
      const a = [...pointers.values()].map(unprojectPoint);
      pointers.set(e.pointerId, rawLocal(e));
      const b = [...pointers.values()].map(unprojectPoint),
        distance = v => Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]),
        middle = v => [(v[0][0] + v[1][0]) / 2, (v[0][1] + v[1][1]) / 2],
        m0 = middle(a),
        m1 = middle(b),
        d = distance(a);
      if (d > 1) zoomAt(...m0, distance(b) / d);
      if (!S.mode3) {
        S.V.cx += m1[0] - m0[0];
        S.V.cy += m1[1] - m0[1];
      }
    } else if (pointers.size === 1) {
      if (S.drag) dragPoint(S.drag, wx, wy);
      else if (S.mode3) {
        S.C.y += (n[0] - p[0]) * 0.01;
        S.C.p = Math.min(1.5, Math.max(0.05, S.C.p - (n[1] - p[1]) * 0.01));
      } else {
        S.V.cx += n[0] - p[0];
        S.V.cy += n[1] - p[1];
      }
    }
    pointers.set(e.pointerId, rawLocal(e));
    S.dirty = true;
    kick();
    saveSoon();
  };
  cv.onpointerup = cv.onpointercancel = cv.onlostpointercapture = endPointer;
  cv.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      S.fast = true;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? S.H : 1;
      zoomAt(...local(e), Math.exp(Math.max(-2, Math.min(2, -e.deltaY * unit * 0.0015))));
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        S.fast = false;
        S.dirty = true;
        kick();
      }, 150);
    },
    {
      passive: false,
    },
  );
  new ResizeObserver(() => {
    const first = !S.W || !S.H,
      b = cv.getBoundingClientRect();
    S.V.cx += (b.width - S.W) / 2;
    S.V.cy += (b.height - S.H) / 2;
    S.W = b.width;
    S.H = b.height;
    S.dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(S.W * S.dpr);
    cv.height = Math.round(S.H * S.dpr);
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    if (first && !S.restored) frameScene();
    S.dirty = true;
    kick();
  }).observe(cv);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
    else {
      S.lastT = performance.now();
      kick();
    }
  });
  window.addEventListener('pagehide', save);
}
