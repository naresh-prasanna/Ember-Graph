import { geo, morphStep, surfaceMesh } from '../app/geometry.js';
import { liveTrace } from '../app/interaction.js';
import { parameter, setVar } from '../app/model.js';
import { S, reduceMotion } from '../app/state.js';
import { T, font, sans, tone } from '../app/theme.js';
import { $, ctx, cv } from '../core/dom.js';
import { revealGeometry } from '../math/contours.js';
import { complexText } from '../math/complex.js';
import { fmt, nice, rgba } from '../math/format.js';
import { camera, cameraStep } from './camera.js';
import { timing } from '../ui/fps.js';
import { drawKeyPoints } from '../ui/keyPoints.js';
import { panelSpan } from '../ui/sidePanel.js';

/* Grid lines sit on whole device pixels: a 0.65 px line at x = 10.3 smears across two pixels at half
   strength, which reads as out of focus. `hairline` sets the width and returns it in device pixels. */
function hairline(w) {
  const n = Math.max(1, Math.round(w * S.dpr));
  ctx.lineWidth = n / S.dpr;
  return n;
}
const snap = (v, n) => (n % 2 ? Math.floor(v * S.dpr) + 0.5 : Math.round(v * S.dpr)) / S.dpr,
  pixel = v => Math.round(v * S.dpr) / S.dpr;
function grid() {
  const st = nice(100 / S.V.s),
    x0 = -S.V.cx / S.V.s,
    x1 = (S.W - S.V.cx) / S.V.s,
    y1 = S.V.cy / S.V.s,
    y0 = (S.V.cy - S.H) / S.V.s;
  function lines(step, color) {
    ctx.strokeStyle = color;
    const n = hairline(0.65);
    ctx.beginPath();
    for (let i = Math.ceil(x0 / step); i <= Math.floor(x1 / step); i++) {
      const x = snap(S.V.cx + i * step * S.V.s, n);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, S.H);
    }
    for (let i = Math.ceil(y0 / step); i <= Math.floor(y1 / step); i++) {
      const y = snap(S.V.cy - i * step * S.V.s, n);
      ctx.moveTo(0, y);
      ctx.lineTo(S.W, y);
    }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  if ((st * S.V.s) / 5 > 11) lines(st / 5, T.gridMinor);
  lines(st, T.gridMajor);
  ctx.strokeStyle = T.axis;
  const n = hairline(T.axisWidth),
    ax = snap(S.V.cx, n),
    ay = snap(S.V.cy, n);
  ctx.beginPath();
  ctx.moveTo(0, ay);
  ctx.lineTo(S.W, ay);
  ctx.moveTo(ax, 0);
  ctx.lineTo(ax, S.H);
  ctx.stroke();
  ctx.beginPath();
  const ly = pixel(Math.min(Math.max(S.V.cy + 13, 90), S.H - 28)),
    numbers = [];
  for (let i = Math.ceil(x0 / st); i <= Math.floor(x1 / st); i++) {
    const x = snap(S.V.cx + i * st * S.V.s, n);
    ctx.moveTo(x, ay - 4);
    ctx.lineTo(x, ay + 4);
    if (i) numbers.push([fmt(i * st), pixel(x), ly, 'center', 'top']);
  }
  // With a complex number on show the plane is the Argand plane: the vertical axis counts in i.
  const argand = S.rows.some(r => !r.off && !r.err && r.k?.complex),
    tick = v => (!argand ? fmt(v) : fmt(v) === '1' ? 'i' : fmt(v) === '-1' ? '-i' : fmt(v) + 'i'),
    lx = pixel(Math.min(Math.max(S.V.cx - 13, 35), S.W - 15));
  for (let i = Math.ceil(y0 / st); i <= Math.floor(y1 / st); i++) {
    const y = snap(S.V.cy - i * st * S.V.s, n);
    ctx.moveTo(ax - 4, y);
    ctx.lineTo(ax + 4, y);
    if (i) numbers.push([tick(i * st), lx, pixel(y), 'right', 'middle']);
  }
  ctx.stroke();
  // Each number sits in a ring of background, so grid lines stop short of the digits instead of crossing them.
  ctx.font = sans(13, 600);
  ctx.fillStyle = T.label;
  ctx.strokeStyle = T.bg;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  for (const [t, x, y, align, base] of numbers) {
    ctx.textAlign = align;
    ctx.textBaseline = base;
    ctx.strokeText(t, x, y);
    ctx.fillText(t, x, y);
  }
  ctx.lineCap = 'round';
  if (argand) {
    ctx.font = 'italic 12px Georgia, serif';
    ctx.fillStyle = T.labelStrong;
    ctx.textBaseline = 'bottom';
    // Clear of the tool column when the real axis runs behind it.
    const c = ctx.canvas.getBoundingClientRect(),
      t = $('#tools')?.getBoundingClientRect(),
      behind = t && S.V.cy + c.top > t.top - 12 && S.V.cy + c.top < t.bottom + 12,
      rx = behind ? t.left - c.left - 14 : S.W - 24;
    if (S.V.cy > 70 && S.V.cy < S.H - 20) ctx.fillText('Re', rx, S.V.cy - 7);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (S.V.cx > 0 && S.V.cx < S.W - 30) ctx.fillText('Im', S.V.cx + 9, 58);
  }
  if (S.construction && S.activeScene === 'orbit') orbitGuides();
}
function orbitGuides() {
  let circle = null;
  for (const r of S.rows) {
    if (r.off || r.err) continue;
    for (const line of r.g?.L || []) {
      if (line.length < 12 || Math.hypot(line[0] - line.at(-2), line[1] - line.at(-1)) > 0.01) continue;
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (let i = 0; i < line.length; i += 2) {
        minX = Math.min(minX, line[i]);
        maxX = Math.max(maxX, line[i]);
        minY = Math.min(minY, line[i + 1]);
        maxY = Math.max(maxY, line[i + 1]);
      }
      const x = (minX + maxX) / 2,
        y = (minY + maxY) / 2,
        R = (maxX - minX + maxY - minY) / 4;
      if (R < 12 || Math.abs(maxX - minX - maxY + minY) > R * 0.015) continue;
      let valid = true;
      for (let i = 0; i < line.length; i += 10)
        if (Math.abs(Math.hypot(line[i] - x, line[i + 1] - y) - R) > R * 0.01) {
          valid = false;
          break;
        }
      if (valid) {
        circle = {
          x,
          y,
          R,
        };
        break;
      }
    }
    if (circle) break;
  }
  if (!circle) return;
  const { x, y, R } = circle,
    a = R / S.V.s;
  if (R > Math.max(S.W, S.H) * 2) return;
  ctx.save();
  ctx.font = font(9);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.lineWidth = 0.7;
  ctx.fillStyle = T.guideText;
  // Every tick in one stroke and every spoke in another: a stroke apiece cost the GPU more than the curves did.
  const ticks = new Path2D(),
    spokes = new Path2D();
  for (let d = 0; d < 360; d += 5) {
    const t = (d * Math.PI) / 180,
      co = Math.cos(t),
      si = Math.sin(t),
      len = d % 30 === 0 ? 12 : d % 10 === 0 ? 7 : 3;
    ticks.moveTo(x + (R + 9) * co, y - (R + 9) * si);
    ticks.lineTo(x + (R + 9 + len) * co, y - (R + 9 + len) * si);
    if (d % 30 === 0) {
      ctx.fillText(d + '°', x + (R + 36) * co, y - (R + 36) * si);
      spokes.moveTo(x + 20 * co, y - 20 * si);
      spokes.lineTo(x + (R - 8) * co, y - (R - 8) * si);
    }
  }
  ctx.strokeStyle = T.guideTick;
  ctx.stroke(ticks);
  ctx.setLineDash([3, 7]);
  ctx.strokeStyle = T.guideSpoke;
  ctx.stroke(spokes);
  ctx.setLineDash([]);
  const yy = y + R + 64;
  ctx.strokeStyle = T.guideLine;
  ctx.beginPath();
  ctx.moveTo(x - R, y + 10);
  ctx.lineTo(x - R, yy + 7);
  ctx.moveTo(x + R, y + 10);
  ctx.lineTo(x + R, yy + 7);
  ctx.moveTo(x - R, yy);
  ctx.lineTo(x + R, yy);
  ctx.moveTo(x - R + 5, yy - 3);
  ctx.lineTo(x - R, yy);
  ctx.lineTo(x - R + 5, yy + 3);
  ctx.moveTo(x + R - 5, yy - 3);
  ctx.lineTo(x + R, yy);
  ctx.lineTo(x + R - 5, yy + 3);
  ctx.stroke();
  const label = '⌀ ' + fmt(2 * a);
  ctx.fillStyle = T.bg;
  ctx.fillRect(x - 32, yy - 10, 64, 20);
  ctx.fillStyle = T.guideLabel;
  ctx.fillText(label, x, yy);
  ctx.textAlign = 'left';
  ctx.fillStyle = T.guideMuted;
  ctx.fillText('C (' + fmt((x - S.V.cx) / S.V.s) + ', ' + fmt((S.V.cy - y) / S.V.s) + ')', x + 13, y + 22);
  ctx.restore();
}
function atmosphere() {
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, S.W, S.H);
  if (!T.sky) return;
  const x = S.mode3 ? S.W * 0.6 : S.V.cx,
    y = S.mode3 ? S.H * 0.55 : S.V.cy;
  const g = ctx.createRadialGradient(x, y, 10, x, y, Math.max(S.W, S.H) * 0.65);
  g.addColorStop(0, T.sky[0]);
  g.addColorStop(0.55, T.sky[1]);
  g.addColorStop(1, T.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S.W, S.H);
}
// The construction behind a complex sum or product: faint and dashed, so the answer's arrow stays in front.
function drawGuides(paths, col, alpha) {
  ctx.save();
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = rgba(tone(col), 0.42 * alpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const L of paths) {
    ctx.moveTo(L[0], L[1]);
    for (let i = 2; i < L.length; i += 2) ctx.lineTo(L[i], L[i + 1]);
  }
  ctx.stroke();
  ctx.restore();
}
const LINE = 2;
function glow(path, raw, width = LINE) {
  const col = tone(raw);
  width += T.width;
  // A translucent, additive stroke across the screen costs the GPU a couple of milliseconds to rasterize, an
  // opaque one about a third of that, so while the view moves each curve is one plain stroke: forty glowing
  // curves took 300 ms a frame. The glow comes back on the frame after the view settles.
  if (S.fast || !T.glow) {
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.stroke(path);
    return;
  }
  // Strokes rather than shadowBlur, which costs the whole area a path spans on every frame. The glow stays wide
  // and faint: a tight halo hugging the edge reads as the curve being out of focus, not as light.
  ctx.globalCompositeOperation = T.blend;
  ctx.strokeStyle = rgba(col, 0.035);
  ctx.lineWidth = width + 12;
  ctx.stroke(path);
  ctx.strokeStyle = rgba(col, 0.06);
  ctx.lineWidth = width + 5;
  ctx.stroke(path);
  ctx.strokeStyle = col;
  ctx.lineWidth = width;
  ctx.stroke(path);
  ctx.globalCompositeOperation = 'source-over';
}
export function draw(dt) {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  atmosphere();
  ctx.save();
  ctx.transform(...camera.matrix);
  camera.trace = null;
  try {
    return drawScene(dt);
  } finally {
    ctx.restore();
  }
}
let lastView = null;
const SEAL = 1.1,
  onScreen = p => p[0] >= 0 && p[0] <= S.W && p[1] >= 0 && p[1] <= S.H;
function closedPath(a) {
  const n = a.length;
  return n > 12 && Math.hypot(a[0] - a[n - 2], a[1] - a[n - 1]) < 18;
}
function toWorld(p) {
  return [(p[0] - S.V.cx) / S.V.s, (S.V.cy - p[1]) / S.V.s];
}
function toScreen(w) {
  return [S.V.cx + w[0] * S.V.s, S.V.cy - w[1] * S.V.s];
}
/* Geometry is resampled whenever the view changes, and curves sampled across the screen gain or lose length.
   Find where the pen's world position lies on the new geometry, as a fraction of its length; when the curve
   passes near that point more than once, prefer the place nearest to where the pen was expected. */
function locate(g, w, expected) {
  const [px, py] = toScreen(w);
  let best = Infinity,
    found = expected,
    base = 0;
  for (let j = 0; j < g.L.length; j++) {
    const a = g.L[j],
      d = g.lengths[j];
    for (let i = 0; i + 3 < a.length; i += 2) {
      const dx = a[i + 2] - a[i],
        dy = a[i + 3] - a[i + 1],
        l = dx * dx + dy * dy,
        t = l ? Math.max(0, Math.min(1, ((px - a[i]) * dx + (py - a[i + 1]) * dy) / l)) : 0,
        frac = (base + d[i / 2] + t * (d[i / 2 + 1] - d[i / 2])) / (g.distance || 1),
        score = Math.hypot(px - a[i] - t * dx, py - a[i + 1] - t * dy) + 30 * Math.abs(frac - expected);
      if (score < best) {
        best = score;
        found = frac;
      }
    }
    base += d[d.length - 1];
  }
  return found;
}
// Keeps the pen on the same point of the curve across view changes, then spreads what is left over the time left.
function revealFraction(r, g) {
  const R = r.reveal;
  if (!R || r.prog < R.p0) {
    r.reveal = null;
    return r.prog;
  }
  if (R.g !== g && R.head && R.view !== r.gv) {
    // R.head was recorded at progress R.hp; anchor there so the progress made since carries over.
    R.s0 = locate(g, R.head, R.s0 + ((R.hp - R.p0) * (1 - R.s0)) / Math.max(1e-6, 1 - R.p0));
    R.p0 = R.hp;
  }
  R.g = g;
  R.view = r.gv;
  return Math.min(1, R.s0 + ((r.prog - R.p0) * (1 - R.s0)) / Math.max(1e-6, 1 - R.p0));
}
function burst(p, col) {
  for (let i = 0; i < 90 && S.sparks.length < 500; i++) {
    const a = Math.random() * Math.PI * 2,
      hot = i % 3 === 0,
      s = (hot ? 150 : 60) + Math.random() * (hot ? 170 : 110);
    S.sparks.push({
      x: p[0],
      y: p[1],
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 45,
      life: 0,
      max: (hot ? 0.7 : 0.45) + Math.random() * 0.8,
      col: hot ? T.hot : col,
      w: hot ? 1.3 : 0.8,
    });
  }
}
/* A curve whose expression breaks flares and burns away: its glow fades within a second while embers
   lift off along its whole length and drift down like the tracing pen's. */
const ashes = [],
  ASH = 0.6;
// The part of a curve the pen has drawn so far: the first `f` of its length.
function drawnPart(g, f) {
  if (f >= 1 || !g.lengths) return g.L;
  let left = f * g.distance;
  const out = [];
  for (let j = 0; j < g.L.length && left > 0; j++) {
    const a = g.L[j],
      d = g.lengths[j];
    if (d.at(-1) <= left) {
      out.push(a);
      left -= d.at(-1);
      continue;
    }
    let i = 1;
    while (d[i] <= left) i++;
    const t = (left - d[i - 1]) / (d[i] - d[i - 1] || 1),
      part = Array.from(a.subarray ? a.subarray(0, i * 2) : a.slice(0, i * 2));
    part.push(a[i * 2 - 2] + (a[i * 2] - a[i * 2 - 2]) * t, a[i * 2 - 1] + (a[i * 2 + 1] - a[i * 2 - 1]) * t);
    out.push(part);
    break;
  }
  return out;
}
// `shown` is how much of the curve was on screen: a curve still being traced only burns what it has drawn.
export function shatter(g, col, shown = 1) {
  if (reduceMotion || S.mode3 || !g || !(shown > 0)) return;
  const path = new Path2D(),
    seeds = [],
    L = drawnPart(g, shown);
  let length = 0;
  for (const a of L) {
    if (a.length < 4) continue;
    path.moveTo(a[0], a[1]);
    for (let i = 2; i < a.length; i += 2) {
      path.lineTo(a[i], a[i + 1]);
      length += Math.hypot(a[i] - a[i - 2], a[i + 1] - a[i - 1]);
    }
  }
  const gap = Math.max(5, length / 650);
  for (const a of L) {
    let carry = Math.random() * gap;
    for (let i = 2; i < a.length; i += 2) {
      const x0 = a[i - 2],
        y0 = a[i - 1],
        d = Math.hypot(a[i] - x0, a[i + 1] - y0);
      for (; carry < d; carry += gap) {
        const x = x0 + ((a[i] - x0) * carry) / d,
          y = y0 + ((a[i + 1] - y0) * carry) / d;
        if (onScreen([x, y])) seeds.push([x, y]);
      }
      carry -= d;
    }
  }
  if (shown >= 1) for (const { p } of g.pts) for (let i = 0; i < 12; i++) seeds.push(p);
  if (!seeds.length) return;
  ashes.push({ path, col, t: 0, view: { ...S.V } });
  for (const [x, y] of seeds.slice(0, 900)) {
    const hot = Math.random() < 0.25,
      a = Math.random() * Math.PI * 2,
      s = (hot ? 40 : 15) + Math.random() * (hot ? 90 : 45);
    S.sparks.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 40 - Math.random() * 50,
      life: 0,
      max: 0.7 + Math.random() * (hot ? 1.1 : 0.8),
      col: hot ? T.hot : col,
      w: hot ? 1.1 : 0.75,
    });
  }
  kick();
}
function drawAshes(dt) {
  for (let i = ashes.length - 1; i >= 0; i--) {
    const a = ashes[i];
    a.t += dt;
    if (a.t >= ASH) {
      ashes.splice(i, 1);
      continue;
    }
    const f = S.V.s / a.view.s,
      left = 1 - a.t / ASH;
    ctx.save();
    ctx.translate(S.V.cx - a.view.cx * f, S.V.cy - a.view.cy * f);
    ctx.scale(f, f);
    ctx.globalAlpha = left * left;
    glow(a.path, a.col, LINE / f);
    // The first instant runs white-hot, as if the curve caught fire.
    ctx.globalCompositeOperation = T.blend;
    ctx.globalAlpha = Math.max(0, 1 - a.t / 0.18) * 0.7;
    ctx.strokeStyle = T.hot;
    ctx.lineWidth = 1.8 / f;
    ctx.stroke(a.path);
    ctx.restore();
  }
  return ashes.length > 0;
}
/* The pen reaches the end. Its glow stays where it stopped and dies out instead of vanishing. When the end
   meets the start, the join throws one big spark: a flash and a ring of embers that fall like the trail's. */
function sealCurve(r, head, closed) {
  r.seal = { t: 0, head: toWorld(head), closed };
  if (closed) burst(head, r.col);
}
function drawSeal(r, dt) {
  const s = r.seal,
    p = toScreen(s.head);
  s.t += dt;
  if (s.t >= SEAL) {
    r.seal = null;
    return;
  }
  if (!onScreen(p)) return;
  const ember = (1 - Math.min(1, s.t / 0.55)) ** 2;
  if (ember > 0) traceHead(p, r.col, ember);
  if (s.closed) {
    const flash = Math.exp(-s.t * 9);
    ctx.save();
    ctx.globalCompositeOperation = T.blend;
    halo(p, r.col, 46, flash);
    ctx.restore();
  }
}
// Box count overlay: the squares the drawing touches, plus the grid they belong to.
function drawBoxes({ cells, s }, raw) {
  const col = tone(raw);
  const px = s * S.V.s;
  if (px < 1.5) return;
  let i0 = Infinity,
    i1 = -Infinity,
    j0 = Infinity,
    j1 = -Infinity;
  ctx.beginPath();
  for (let q = 0; q < cells.length; q += 2) {
    const i = cells[q],
      j = cells[q + 1],
      x = S.V.cx + i * px,
      y = S.V.cy - (j + 1) * px;
    if (i < i0) i0 = i;
    if (i > i1) i1 = i;
    if (j < j0) j0 = j;
    if (j > j1) j1 = j;
    if (x > S.W || y > S.H || x + px < 0 || y + px < 0) continue;
    ctx.rect(x, y, px, px);
  }
  ctx.fillStyle = rgba(col, 0.16);
  ctx.fill();
  if (px >= 5) {
    ctx.strokeStyle = rgba(col, 0.42);
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  if (px < 7 || !cells.length) return;
  ctx.beginPath();
  for (let i = i0 - 1; i <= i1 + 2; i++) {
    ctx.moveTo(S.V.cx + i * px, S.V.cy - (j1 + 2) * px);
    ctx.lineTo(S.V.cx + i * px, S.V.cy - (j0 - 1) * px);
  }
  for (let j = j0 - 1; j <= j1 + 2; j++) {
    ctx.moveTo(S.V.cx + (i0 - 1) * px, S.V.cy - j * px);
    ctx.lineTo(S.V.cx + (i1 + 2) * px, S.V.cy - j * px);
  }
  ctx.strokeStyle = T.boxGrid;
  ctx.lineWidth = 0.6;
  ctx.stroke();
}
// The matrix carrying a row's samples from the view they were taken in to the current one, if that differs.
function shift(r) {
  const v = r.gv;
  if (!v || (v[0] === S.V.cx && v[1] === S.V.cy && v[2] === S.V.s)) return null;
  const f = S.V.s / v[2];
  return new DOMMatrix([f, 0, 0, f, S.V.cx - v[0] * f, S.V.cy - v[1] * f]);
}
function moved(path, m) {
  if (!m) return path;
  const q = new Path2D();
  q.addPath(path, m);
  return q;
}
/* Forty glowing curves take the GPU a few hundred milliseconds to draw. While none of them is moving, the
   background, grid and curves are kept from the last frame, and only what moves over them (a trace, marks,
   sparks) is drawn again. */
const still = { key: null, c: null },
  ids = new WeakMap();
let lastId = 0;
const idOf = o => (o ? (ids.get(o) ?? (ids.set(o, ++lastId), lastId)) : 0),
  drawn = r => !r.off && !r.err && r.k && r.g && !['const', 'surf', 'fractal'].includes(r.k.type);
function stillKey() {
  let key = [
    S.W,
    S.H,
    cv.width,
    cv.height,
    S.V.cx,
    S.V.cy,
    S.V.s,
    ...camera.matrix,
    S.fast,
    S.construction,
    S.activeScene,
    T.id,
  ].join();
  for (const r of S.rows) {
    key += `|${r.id},${r.off},${!!r.err},${r.col},${idOf(r.k)},${idOf(r.g)},${idOf(r.fractal)},${idOf(r.box?.on && r.box.cells)}`;
    if (drawn(r) && (r.prog < 1 || r.m || r.seal)) return null;
  }
  return key;
}
function keepStill(key) {
  const c = (still.c ||= document.createElement('canvas'));
  if (c.width !== cv.width || c.height !== cv.height) {
    c.width = cv.width;
    c.height = cv.height;
  }
  const x = c.getContext('2d');
  x.globalCompositeOperation = 'copy';
  x.drawImage(cv, 0, 0);
  still.key = key;
}
function drawScene(dt) {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = ctx.lineJoin = 'round';
  if (S.mode3) return draw3(dt);
  let busy = false;
  const key = stillKey();
  if (key !== null && key === still.key) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(still.c, 0, 0);
    ctx.restore();
  } else drawRows();
  function drawRows() {
    drawFractals();
    grid();
    for (const r of S.rows) {
      if (!drawn(r)) continue;
      const g = r.g,
        tracing = r.prog < 1;
      if (tracing) {
        if (!r.reveal || r.prog === 0) r.reveal = { p0: r.prog, s0: r.prog, hp: r.prog, g, view: r.gv };
        r.prog = Math.min(1, r.prog + dt / (S.presentation ? 4 : 2.8));
        busy = true;
        r.seal = null;
      }
      const shown = tracing ? revealFraction(r, g) : 1,
        col = tone(r.col);
      r.shown = shown;
      const m = shift(r),
        at = p => (m ? [p[0] * m.a + m.e, p[1] * m.d + m.f] : p);
      if (g.fill && r.k.type === 'shape') {
        // A shape's fill moves with its springing outline rather than jumping to where it will end up.
        let F = g.fill;
        if (r.m) {
          F = new Path2D();
          for (const L of g.L) {
            F.moveTo(L[0], L[1]);
            for (let i = 2; i < L.length; i += 2) F.lineTo(L[i], L[i + 1]);
            F.closePath();
          }
        }
        ctx.fillStyle = rgba(col, 0.16 * r.prog);
        ctx.fill(moved(F, m));
      } else if (g.fill) {
        ctx.fillStyle = rgba(col, 0.055 * r.prog * (r.m ? 0.35 : 1));
        ctx.fill(moved(g.fill, m));
      }
      if (g.band) {
        ctx.fillStyle = rgba(col, 0.8 * r.prog);
        ctx.fill(moved(g.band, m));
      }
      let { P, trail, head, prev } = revealGeometry(g, shown);
      P = moved(P, m);
      if (tracing && r.reveal && head) {
        r.reveal.head = toWorld(head);
        r.reveal.hp = r.prog;
      }
      if (tracing && r.prog === 1) {
        r.reveal = null;
        if (head && !reduceMotion && onScreen(head)) sealCurve(r, head, closedPath(g.L[g.L.length - 1]));
      }
      if (r.prog < 1 && head && (!camera.trace || r.col === '#ff783b')) camera.trace = head;
      if (r.box?.on && r.box.cells) drawBoxes(r.box, r.col);
      if (g.guides?.length)
        drawGuides(
          m ? g.guides.map(L => L.map((v, i) => (i % 2 ? v * m.d + m.f : v * m.a + m.e))) : g.guides,
          r.col,
          r.prog,
        );
      if (r.k.strict) ctx.setLineDash([2, 4]);
      // A slope field sits behind the curves it describes.
      if (r.k.type === 'field') ctx.globalAlpha = 0.45;
      glow(P, r.col);
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      if (r.seal) {
        drawSeal(r, dt);
        busy = true;
      }
      if (r.prog < 1) {
        ctx.strokeStyle = T.hot;
        ctx.lineWidth = 1.25;
        ctx.stroke(trail);
      }
      for (const { p: q, col: own } of g.pts) {
        const p = at(q),
          dot = own ? tone(own) : col;
        halo(p, dot, 8, r.prog);
        ctx.globalAlpha = r.prog;
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(...p, r.k.type === 'table' ? 3 : 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (r.prog < 1 && head && onScreen(head)) {
        traceHead(head, r.col);
        if (!reduceMotion) {
          const angle = Math.atan2(head[1] - prev[1], head[0] - prev[0]);
          for (let i = 0; i < Math.ceil(dt * 75) && S.sparks.length < 500; i++) {
            const a = angle + Math.PI + (Math.random() - 0.5) * 2.6,
              s = 20 + Math.random() * 95;
            S.sparks.push({
              x: head[0],
              y: head[1],
              vx: Math.cos(a) * s,
              vy: Math.sin(a) * s - 30,
              life: 0,
              max: 0.3 + Math.random() * 0.6,
              col: r.col,
            });
          }
        }
      }
    }
    if (key !== null) keepStill(key);
  }
  if (drawAshes(dt)) busy = true;
  if (lastView && (lastView.cx !== S.V.cx || lastView.cy !== S.V.cy || lastView.s !== S.V.s)) {
    const f = S.V.s / lastView.s;
    for (const s of S.sparks) {
      s.x = S.V.cx + (s.x - lastView.cx) * f;
      s.y = S.V.cy + (s.y - lastView.cy) * f;
      s.vx *= f;
      s.vy *= f;
    }
  }
  lastView = { ...S.V };
  ctx.globalCompositeOperation = T.blend;
  for (let i = S.sparks.length - 1; i >= 0; i--) {
    const s = S.sparks[i];
    s.life += dt;
    if (s.life >= s.max) {
      S.sparks.splice(i, 1);
      continue;
    }
    const x = s.x,
      y = s.y;
    s.vy += 70 * dt;
    s.vx *= 1 - 1.5 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    ctx.strokeStyle = rgba(tone(s.col), 1 - s.life / s.max);
    ctx.lineWidth = s.w || 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  drawMarks();
  drawKeyPoints();
  drawTrace();
  return busy;
}
export function halo(p, raw, r, alpha) {
  const col = tone(raw),
    q = ctx.createRadialGradient(...p, 0, ...p, r);
  q.addColorStop(0, T.core);
  q.addColorStop(0.12, col);
  q.addColorStop(0.35, rgba(col, 0.24));
  q.addColorStop(1, rgba(col, 0));
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = q;
  ctx.beginPath();
  ctx.arc(...p, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}
function traceHead(p, raw, alpha = 1) {
  const col = tone(raw);
  ctx.save();
  ctx.globalCompositeOperation = T.blend;
  const g = ctx.createRadialGradient(...p, 0, ...p, 110);
  g.addColorStop(0, rgba(col, 0.15));
  g.addColorStop(0.3, rgba(col, 0.035));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.globalAlpha = alpha;
  ctx.fillRect(p[0] - 110, p[1] - 110, 220, 220);
  halo(p, col, 22, alpha);
  ctx.globalAlpha = alpha;
  ctx.translate(...p);
  ctx.rotate(Math.PI / 4);
  ctx.lineWidth = 0.65;
  const q = ctx.createLinearGradient(-22, 0, 22, 0);
  q.addColorStop(0, rgba(col, 0));
  q.addColorStop(0.5, T.core);
  q.addColorStop(1, rgba(col, 0));
  ctx.strokeStyle = q;
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.lineTo(22, 0);
  ctx.stroke();
  ctx.rotate(Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.lineTo(14, 0);
  ctx.stroke();
  ctx.fillStyle = T.core;
  ctx.beginPath();
  ctx.arc(0, 0, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function draw3(dt) {
  const ca = Math.cos(S.C.y),
    sa = Math.sin(S.C.y),
    cp = Math.cos(S.C.p),
    sp = Math.sin(S.C.p),
    center = (S.W + panelSpan()) / 2,
    project = (x, y, z) => {
      const X = x * ca - y * sa,
        Y = x * sa + y * ca;
      return [center + X * S.C.s, S.H * 0.57 - (z * cp + Y * sp) * S.C.s];
    };
  ctx.font = font(9);
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = T.mesh;
  ctx.fillStyle = T.meshText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  if (S.construction) {
    for (let i = -6; i <= 6; i++) {
      const a = project(i, -6, -2),
        b = project(i, 6, -2),
        c = project(-6, i, -2),
        d = project(6, i, -2);
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.moveTo(...c);
      ctx.lineTo(...d);
      ctx.stroke();
    }
    for (const [x, y, z, n] of [
      [6, 0, 0, 'x'],
      [0, 6, 0, 'y'],
      [0, 0, 4, 'z'],
    ]) {
      const a = project(0, 0, 0),
        b = project(x, y, z);
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.stroke();
      ctx.fillText(n, b[0] + 8, b[1]);
    }
  }
  let busy = false;
  for (const r of S.rows) {
    if (r.off || r.err || r.k?.type !== 'surf') continue;
    if (!r.mesh) r.mesh = surfaceMesh(r);
    if (r.prog < 1) {
      r.prog = Math.min(1, r.prog + dt / (S.presentation ? 4 : 2.8));
      busy = true;
    }
    const mesh = r.mesh;
    const P = new Path2D(),
      limit = Math.ceil(mesh.contours.length * r.prog);
    for (let n = 0; n < limit; n++) {
      const c = mesh.contours[n];
      for (const [a, b] of c.segments) {
        P.moveTo(...project(...a));
        P.lineTo(...project(...b));
      }
      if (n % 15 === 0 && S.construction && c.segments.length) {
        const a = project(...c.segments[Math.floor(c.segments.length * 0.55)][0]);
        ctx.fillStyle = T.contourText;
        ctx.fillText(fmt(c.level), a[0] + 4, a[1] - 5);
      }
    }
    ctx.strokeStyle = T.contour;
    ctx.lineWidth = 0.7;
    ctx.stroke(P);
    const M = new Path2D();
    for (let j = 0; j <= mesh.N * r.prog; j += 7) {
      let prev = null;
      for (const v of mesh.points[j]) {
        if (!Number.isFinite(v[2]) || Math.abs(v[2]) > 9) {
          prev = null;
          continue;
        }
        const q = project(...v);
        if (prev) {
          M.moveTo(...prev);
          M.lineTo(...q);
        }
        prev = q;
      }
    }
    if (mesh.flat)
      for (let i = 0; i <= mesh.N; i += 7) {
        let prev = null;
        for (let j = 0; j <= mesh.N; j++) {
          const v = mesh.points[j][i];
          if (!Number.isFinite(v[2])) {
            prev = null;
            continue;
          }
          const q = project(...v);
          if (prev) {
            M.moveTo(...prev);
            M.lineTo(...q);
          }
          prev = q;
        }
      }
    ctx.strokeStyle = mesh.flat ? T.meshFlat : T.meshFaint;
    ctx.lineWidth = 0.5;
    ctx.stroke(M);
    const ridge = new Path2D();
    let prev = null;
    for (const v of mesh.points[Math.floor(mesh.N / 2)].slice(0, Math.ceil((mesh.N + 1) * r.prog))) {
      if (!Number.isFinite(v[2]) || Math.abs(v[2]) > 9) {
        prev = null;
        continue;
      }
      const q = project(...v);
      if (prev) {
        ridge.moveTo(...prev);
        ridge.lineTo(...q);
      }
      prev = q;
    }
    glow(ridge, r.col);
    if (r.prog < 1 && prev) traceHead(prev, r.col);
  }
  return busy;
}
/* Resampling forty rows takes a few hundred milliseconds. While the view moves, rows take turns at a few
   milliseconds of it per frame, and the rest are drawn from their last samples carried to the new view. */
const BUDGET = 6;
let turn = 0;
const movable = r =>
  r.g &&
  r.gv &&
  r.gv[3] === S.W &&
  r.gv[4] === S.H &&
  !r.m &&
  !(r.prog < 1) &&
  !['fractal', 'surf'].includes(r.k?.type);
function refresh(start) {
  const n = S.rows.length;
  let fresh = 0,
    left = 0;
  for (let i = 0; i < n; i++) {
    const j = (turn + i) % n,
      r = S.rows[j];
    if (S.fast && movable(r)) {
      if (fresh && performance.now() - start > BUDGET) {
        if (!left++) turn = j;
        continue;
      }
      fresh++;
    }
    geo(r);
  }
  S.dirty = left > 0;
}
let scaleText = '';
function tick(t) {
  const dt = Math.min((t - S.lastT) / 1000, 0.25);
  S.lastT = t;
  try {
    for (const n of S.playing) {
      const m = S.VM[n];
      if (!m) {
        S.playing.delete(n);
        continue;
      }
      // m.t keeps the unrounded position so stepped sliders still advance between steps.
      const now = parameter(n);
      if (!(Math.abs((m.t ?? NaN) - now) <= (m.step || 0) + (m.max - m.min) / 500)) m.t = now;
      let v = m.t + (((m.max - m.min) * dt) / 5) * m.direction;
      if (v >= m.max) {
        v = m.max;
        m.direction = -1;
      }
      if (v <= m.min) {
        v = m.min;
        m.direction = 1;
      }
      m.t = v;
      setVar(n, v);
    }
    if (S.dirty) {
      const start = performance.now();
      if (S.mode3) S.dirty = false;
      else refresh(start);
      timing('curves', performance.now() - start);
    }
    if (S.drifting && S.mode3 && !reduceMotion) S.C.y += dt * 0.085;
    const cameraBusy = cameraStep(dt),
      morphBusy = morphStep(dt);
    const start = performance.now(),
      busy = draw(dt);
    timing('draw', performance.now() - start);
    const scale = S.mode3 ? '−6 ≤ x,y ≤ 6' : '1 unit : ' + fmt(S.V.s) + ' px';
    if (scale !== scaleText) {
      scaleText = scale;
      $('#scale-label').textContent = scale;
    }
    if (
      cameraBusy ||
      morphBusy ||
      busy ||
      (!S.mode3 && S.sparks.length) ||
      S.playing.size ||
      S.dirty ||
      (S.drifting && S.mode3 && !reduceMotion)
    )
      requestAnimationFrame(tick);
    else S.on = false;
  } catch (e) {
    S.on = false;
    $('#status').textContent = 'Could not render: ' + e.message;
  }
}
export function kick() {
  if (!S.on) {
    S.on = true;
    S.lastT = performance.now();
    requestAnimationFrame(tick);
  }
}

/* Point inspection: accurate explicit-curve slope; sampled slope elsewhere. */
function drawMarks() {
  ctx.font = font(11);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const m of S.marks) {
    const x = S.V.cx + m.x * S.V.s,
      y = S.V.cy - m.y * S.V.s,
      l = Math.hypot(m.ux, m.uy) || 1,
      ux = (m.ux / l) * 85,
      uy = (-m.uy / l) * 85;
    if (Number.isFinite(l)) {
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = rgba(tone(m.c), 0.6);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - ux, y - uy);
      ctx.lineTo(x + ux, y + uy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    halo([x, y], m.c, 12, 1);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    const slope = m.uy / m.ux,
      label = `(${fmt(m.x)}, ${fmt(m.y)}) · slope ${fmt(slope)}`,
      w = ctx.measureText(label).width,
      lx = Math.max(4, Math.min(x + 10, S.W - w - 14)),
      ly = Math.max(14, y - 19);
    ctx.fillStyle = T.tipBg;
    ctx.fillRect(lx - 4, ly - 10, w + 8, 20);
    ctx.fillStyle = T.tipInk;
    ctx.fillText(label, lx, ly);
  }
}
// The point being traced, drawn over key points so its label is never hidden under theirs.
function drawTrace() {
  const t = liveTrace();
  if (!t) return;
  const x = S.V.cx + t.x * S.V.s,
    y = S.V.cy - t.y * S.V.s,
    label =
      (t.key ? t.key + ' ' : '') +
      (t.r.k?.complex ? complexText(t.x, t.y, fmt) : `(${fmt(t.x)}, ${fmt(t.y)})`);
  halo([x, y], t.r.col, 16, 1);
  ctx.fillStyle = tone(t.r.col);
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.font = font(12);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(label).width,
    lx = Math.max(4, Math.min(x + 12, S.W - w - 14)),
    ly = y - 22 < 14 ? y + 22 : y - 22;
  ctx.fillStyle = T.tipBg;
  ctx.fillRect(lx - 6, ly - 12, w + 12, 24);
  ctx.strokeStyle = rgba(tone(t.r.col), 0.55);
  ctx.lineWidth = 1;
  ctx.strokeRect(lx - 6, ly - 12, w + 12, 24);
  ctx.fillStyle = T.tipInk;
  ctx.fillText(label, lx, ly);
}

/* UI and state. All imported state is validated before mutation. */
function drawFractals() {
  for (const r of S.rows) {
    if (r.off || r.err || r.k?.type !== 'fractal' || !r.fractal) continue;
    const f = r.fractal,
      factor = S.V.s / f.view.s;
    ctx.drawImage(
      f.canvas,
      S.V.cx - f.view.cx * factor,
      S.V.cy - f.view.cy * factor,
      f.width * factor,
      f.height * factor,
    );
  }
}

/* Context-aware expression completions: local math catalog, no network requests. */
