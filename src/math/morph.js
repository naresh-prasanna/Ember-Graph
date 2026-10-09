export const MK = 300,
  MC = 20;
export function rs(a, N) {
  const n = a.length / 2,
    o = new Float64Array(N * 2);
  if (n < 2) {
    for (let i = 0; i < N; i++) {
      o[2 * i] = a[0];
      o[2 * i + 1] = a[1];
    }
    return o;
  }
  const d = [0];
  for (let i = 1; i < n; i++)
    d.push(d[i - 1] + Math.hypot(a[2 * i] - a[2 * i - 2], a[2 * i + 1] - a[2 * i - 1]));
  const tot = d[n - 1] || 1;
  let j = 1;
  for (let i = 0; i < N; i++) {
    const t = (tot * i) / (N - 1);
    while (j < n - 1 && d[j] < t) j++;
    const f = (t - d[j - 1]) / (d[j] - d[j - 1] || 1);
    o[2 * i] = a[2 * j - 2] + (a[2 * j] - a[2 * j - 2]) * f;
    o[2 * i + 1] = a[2 * j - 1] + (a[2 * j + 1] - a[2 * j - 1]) * f;
  }
  return o;
}
export function cen(a, N) {
  const n = a.length / 2;
  let x = 0,
    y = 0;
  for (let i = 0; i < n; i++) {
    x += a[2 * i];
    y += a[2 * i + 1];
  }
  x /= n;
  y /= n;
  const o = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) {
    o[2 * i] = x;
    o[2 * i + 1] = y;
  }
  return o;
}
/* Piece counts differ (e.g. a circle that grows past the screen edge gets clipped into arcs): start every new point on the nearest point of the old curve, so the old shape stretches out into the new one. */
/* Piece counts differ (e.g. a circle that grows past the screen edge gets clipped into arcs): start every new point on the nearest point of the old curve, so the old shape stretches out into the new one. */
export function nrst(src, b, N) {
  const to = rs(b, N);
  let tot = 0;
  for (const a of src) tot += a.length / 2;
  const st = Math.max(1, Math.ceil(tot / 900)),
    px = [],
    py = [];
  for (const a of src) {
    const n = a.length / 2;
    for (let i = 0; i < n; i += st) {
      px.push(a[2 * i]);
      py.push(a[2 * i + 1]);
    }
    px.push(a[2 * n - 2]);
    py.push(a[2 * n - 1]);
  }
  const cur = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = to[2 * i],
      y = to[2 * i + 1];
    let bd = 1e300,
      bj = 0;
    for (let j = 0; j < px.length; j++) {
      const d = (px[j] - x) * (px[j] - x) + (py[j] - y) * (py[j] - y);
      if (d < bd) {
        bd = d;
        bj = j;
      }
    }
    cur[2 * i] = px[bj];
    cur[2 * i + 1] = py[bj];
  }
  return [cur, to];
}
/* A closed loop whose new shape is clipped by the screen (or lies wholly off it): send every point out along its own ray from the loop's centre to where the new curve crosses that ray, even if that is far off screen, so the loop balloons out intact. If the ray never meets the curve (a=0 style degenerate), the loop collapses into its centre instead. */
/* A closed loop whose new shape is clipped by the screen (or lies wholly off it): send every point out along its own ray from the loop's centre to where the new curve crosses that ray, even if that is far off screen, so the loop balloons out intact. If the ray never meets the curve (a=0 style degenerate), the loop collapses into its centre instead. */
export function closedLoop(a) {
  const n = a.length / 2;
  return n > 3 && Math.hypot(a[0] - a[2 * n - 2], a[1] - a[2 * n - 1]) < 14;
}
