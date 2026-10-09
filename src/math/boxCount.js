/* Box counting: lay a grid of squares of side s over a drawing and count the squares it touches.
   For a fractal the count grows like (1/s)^D as s shrinks, and D is its box-counting dimension. */
const MAX_CELLS = 250000,
  OFFSET = 1048576,
  WIDTH = 2097152;

const key = (i, j) => (i + OFFSET) * WIDTH + (j + OFFSET);

// Walk a segment cell by cell (Amanatides–Woo), so no square it crosses is missed.
function walk(x0, y0, x1, y1, s, add) {
  let i = Math.floor(x0 / s),
    j = Math.floor(y0 / s);
  const i1 = Math.floor(x1 / s),
    j1 = Math.floor(y1 / s),
    dx = x1 - x0,
    dy = y1 - y0,
    si = Math.sign(dx),
    sj = Math.sign(dy),
    stepX = si ? s / Math.abs(dx) : Infinity,
    stepY = sj ? s / Math.abs(dy) : Infinity;
  let tx = si ? (si > 0 ? (i + 1) * s - x0 : x0 - i * s) / Math.abs(dx) : Infinity,
    ty = sj ? (sj > 0 ? (j + 1) * s - y0 : y0 - j * s) / Math.abs(dy) : Infinity,
    left = Math.abs(i1 - i) + Math.abs(j1 - j);
  add(i, j);
  while (left-- > 0) {
    if (tx < ty) {
      i += si;
      tx += stepX;
    } else {
      j += sj;
      ty += stepY;
    }
    add(i, j);
  }
}

/** Squares of side s touched by the paths (flat [x, y, x, y, …] arrays) and points; null if too many. */
export function boxCells(paths, points, s) {
  const seen = new Set(),
    cells = [];
  let full = false;
  const add = (i, j) => {
    const k = key(i, j);
    if (seen.has(k)) return;
    if (seen.size >= MAX_CELLS) {
      full = true;
      return;
    }
    seen.add(k);
    cells.push(i, j);
  };
  for (const w of paths) {
    if (w.length === 2) add(Math.floor(w[0] / s), Math.floor(w[1] / s));
    for (let q = 2; q < w.length && !full; q += 2) walk(w[q - 2], w[q - 1], w[q], w[q + 1], s, add);
  }
  for (const [x, y] of points) add(Math.floor(x / s), Math.floor(y / s));
  return full ? null : Int32Array.from(cells);
}

function extent(paths, points) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const take = (x, y) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const w of paths) for (let q = 0; q < w.length; q += 2) take(w[q], w[q + 1]);
  for (const [x, y] of points) take(x, y);
  return Math.max(x1 - x0, y1 - y0);
}

// Typical segment length: below this the drawing is just straight lines and the count stops being fractal.
function grain(paths) {
  const lengths = [];
  for (const w of paths)
    for (let q = 2; q < w.length && lengths.length < 20000; q += 2)
      lengths.push(Math.hypot(w[q] - w[q - 2], w[q + 1] - w[q - 1]));
  lengths.sort((a, b) => a - b);
  return lengths[lengths.length >> 1] || 0;
}

/** A sensible starting box size: a power of two about a sixteenth of the drawing's width. */
export function defaultBoxSize(paths, points) {
  const e = extent(paths, points);
  return e > 0 && Number.isFinite(e) ? 2 ** Math.round(Math.log2(e / 16)) : 1;
}

/** Count boxes over halving sizes and fit log N against log(1/s); the slope estimates the dimension. */
export function boxDimension(paths, points) {
  const e = extent(paths, points);
  if (!(e > 0) || !Number.isFinite(e)) return null;
  const spacing = points.length ? e / Math.sqrt(points.length) : 0,
    finest = Math.min(Math.max(e / 1024, grain(paths), 2 * spacing), e / 32),
    all = [];
  for (let s = 2 ** Math.floor(Math.log2(e / 4)); s >= finest && all.length < 12; s /= 2) {
    const cells = boxCells(paths, points, s);
    if (!cells) break;
    all.push({ s, n: cells.length / 2 });
  }
  // With only a handful of boxes the edges of the drawing dominate, so those sizes are left out of the fit.
  const many = all.filter(p => p.n >= 32),
    sizes = many.length >= 3 ? many : all;
  if (sizes.length < 3) return { sizes, dim: NaN };
  const X = sizes.map(p => -Math.log2(p.s)),
    Y = sizes.map(p => Math.log2(p.n)),
    mx = X.reduce((a, b) => a + b) / X.length,
    my = Y.reduce((a, b) => a + b) / Y.length;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  X.forEach((x, i) => {
    sxy += (x - mx) * (Y[i] - my);
    sxx += (x - mx) ** 2;
    syy += (Y[i] - my) ** 2;
  });
  return { sizes, dim: sxy / sxx, r2: syy ? (sxy * sxy) / (sxx * syy) : 1 };
}
