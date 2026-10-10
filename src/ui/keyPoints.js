import { local } from '../app/interaction.js';
import { parameterBounds, rowCopies, val } from '../app/model.js';
import { BRANCH } from '../math/parser.js';
import { S } from '../app/state.js';
import { $, ctx, cv } from '../core/dom.js';
import { fmt } from '../math/format.js';
import { findImplicitPoints, findKeyPoints, findParametricPoints } from '../math/keyPoints.js';
import { segDist } from '../math/segments.js';
import { halo, kick } from '../render/renderer.js';

let kpShow = true,
  kpPts = [],
  kpLastKey = '',
  kpLastAt = 0,
  kpHover = null,
  kpWait = 0,
  kpHoverRow = null;
function keyPointCurves() {
  return S.rows
    .filter(r => !r.off && !r.err && r.k && (r.k.type === 'cart' || r.k.type === 'function') && !r.k.reg)
    .flatMap(r => {
      const k = r.k,
        fn = k.type === 'function',
        n = rowCopies(r);
      return Array.from({ length: n === undefined ? 1 : Math.min(n, 20) }, (_, b) => {
        const branch = n === undefined ? {} : { [BRANCH]: b };
        return {
          id: r.id,
          c: r.col,
          f: x => {
            const y = val(k.c, fn ? { [k.param]: x, ...branch } : { x, ...branch });
            if (k.filter && !val(k.filter, { x, y, ...branch })) return NaN;
            return y;
          },
        };
      });
    });
}
function refreshKeyPoints() {
  const key =
    S.rows.map(r => r.text + (r.off ? 1 : 0) + (r.err ? 1 : 0)).join('|') +
    JSON.stringify(S.vars) +
    [S.V.cx, S.V.cy, S.V.s, S.W].join();
  if (key === kpLastKey) return;
  const now = performance.now();
  if (S.fast || now - kpLastAt < 120) {
    clearTimeout(kpWait);
    kpWait = setTimeout(kick, 140);
    return;
  }
  kpLastKey = key;
  kpLastAt = now;
  try {
    kpPts = findKeyPoints(keyPointCurves(), -S.V.cx / S.V.s, (S.W - S.V.cx) / S.V.s);
  } catch {
    kpPts = [];
  }
  try {
    const x0 = -S.V.cx / S.V.s,
      x1 = (S.W - S.V.cx) / S.V.s,
      y1 = S.V.cy / S.V.s,
      y0 = (S.V.cy - S.H) / S.V.s;
    for (const r of S.rows) {
      if (
        r.off ||
        r.err ||
        !r.k ||
        !r.g ||
        (r.k.type !== 'imp' && r.k.type !== 'cartY') ||
        rowCopies(r) !== undefined
      )
        continue;
      const k = r.k,
        F =
          k.type === 'imp'
            ? (x, y) =>
                val(k.c, {
                  x,
                  y,
                })
            : (x, y) =>
                x -
                val(k.c, {
                  y,
                });
      const paths = r.g.L.map(a => {
        const o = new Float64Array(a.length);
        for (let i = 0; i < a.length; i += 2) {
          o[i] = (a[i] - S.V.cx) / S.V.s;
          o[i + 1] = (S.V.cy - a[i + 1]) / S.V.s;
        }
        return o;
      });
      kpPts.push(...findImplicitPoints(F, paths, x0, x1, y0, y1, r.col, r.id));
    }
  } catch {}
  for (const r of S.rows) {
    if (
      r.off ||
      r.err ||
      !r.k ||
      !r.g ||
      (r.k.type !== 'par' && r.k.type !== 'polar') ||
      rowCopies(r) !== undefined
    )
      continue;
    try {
      const k = r.k,
        polar = k.type === 'polar',
        [lo, hi] = parameterBounds(k.filter, polar ? 'theta' : k.param || 't');
      const at = t => {
        let x, y, q;
        if (polar) {
          q = val(k.c, { theta: t });
          x = q * Math.cos(t);
          y = q * Math.sin(t);
        } else {
          const s = { t, ...(k.param && { [k.param]: t }) };
          x = val(k.fx, s);
          y = val(k.fy, s);
        }
        return !k.filter || val(k.filter, { x, y, t, theta: t, r: q }) ? [x, y] : null;
      };
      kpPts.push(...findParametricPoints(at, lo, hi, r.col, r.id));
    } catch {}
  }
}
// The key points last found on one row, for a trace to snap to.
export const keyPointsOf = id => (kpShow ? kpPts.filter(p => [].concat(p.id).includes(id)) : []);
const kpX = p => S.V.cx + p.x * S.V.s,
  kpY = p => S.V.cy - p.y * S.V.s;
function visibleKeyPoints() {
  const id = kpHoverRow;
  return id == null ? [] : kpPts.filter(p => [].concat(p.id).includes(id));
}
export function drawKeyPoints() {
  if (!kpShow || S.mode3 || kpHoverRow == null) return;
  refreshKeyPoints();
  ctx.save();
  ctx.setLineDash([]);
  for (const p of visibleKeyPoints()) {
    const x = kpX(p),
      y = kpY(p);
    if (x < -8 || y < -8 || x > S.W + 8 || y > S.H + 8) continue;
    ctx.beginPath();
    ctx.arc(x, y, p === kpHover ? 4.6 : 2.8, 0, 7);
    ctx.globalAlpha = p === kpHover ? 1 : 0.85;
    ctx.fillStyle = p.t === 'intersection' ? '#fff1d6' : p.c;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#0b0b0c';
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (kpHover) {
    const p = kpHover,
      x = kpX(p),
      y = kpY(p);
    halo([x, y], p.c, 14, 0.6);
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const t = `${p.t} (${fmt(p.x)}, ${fmt(p.y)})`,
      w = ctx.measureText(t).width,
      lx = Math.max(4, Math.min(x + 10, S.W - w - 14)),
      ly = Math.max(14, y - 19);
    ctx.fillStyle = '#070707e8';
    ctx.fillRect(lx - 4, ly - 10, w + 8, 20);
    ctx.fillStyle = '#fff1d6';
    ctx.fillText(t, lx, ly);
  }
  ctx.restore();
}
function nearKeyPoint(e) {
  if (!kpShow || S.mode3) return;
  const [px, py] = local(e);
  let best = null,
    d = 13;
  for (const p of visibleKeyPoints()) {
    const q = Math.hypot(kpX(p) - px, kpY(p) - py);
    if (q < d) {
      d = q;
      best = p;
    }
  }
  let hr = best ? kpHoverRow : null;
  if (!best) {
    let dd = 9;
    for (const r of S.rows) {
      if (r.off || r.err || !r.g) continue;
      for (const a of r.g.L)
        for (let i = 0; i + 3 < a.length; i += 2) {
          const q = segDist(px, py, a[i], a[i + 1], a[i + 2], a[i + 3]);
          if (q < dd) {
            dd = q;
            hr = r.id;
          }
        }
    }
  }
  if (hr !== kpHoverRow || best !== kpHover) {
    kpHoverRow = hr;
    kpHover = best;
    kick();
  }
}
export function initKeyPoints() {
  const kp = $('#keypoints');
  kp.onclick = () => {
    kpShow = !kpShow;
    kp.setAttribute('aria-pressed', String(kpShow));
    kpHover = null;
    kick();
  };
  kp.setAttribute('aria-pressed', 'true');
  cv.addEventListener('pointermove', nearKeyPoint);
  cv.addEventListener('pointerdown', nearKeyPoint);
  cv.addEventListener('pointerleave', () => {
    kpHover = null;
    kpHoverRow = null;
    kick();
  });
}
