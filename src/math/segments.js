/* Point inspection: accurate explicit-curve slope; sampled slope elsewhere. */
export const dseg = (px, py, a, b, c, d) => {
  const dx = c - a,
    dy = d - b,
    l = dx * dx + dy * dy,
    t = l ? Math.max(0, Math.min(1, ((px - a) * dx + (py - b) * dy) / l)) : 0,
    x = a + t * dx,
    y = b + t * dy;
  return [Math.hypot(px - x, py - y), [x, y]];
};
export const ix = (a, b, c, d, e, f, g, h) => {
  const dn = (c - a) * (h - f) - (d - b) * (g - e);
  if (!dn) return null;
  const t = ((e - a) * (h - f) - (f - b) * (g - e)) / dn,
    u = ((e - a) * (d - b) - (f - b) * (c - a)) / dn;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a + t * (c - a), b + t * (d - b)] : null;
};
export const segDist = (px, py, a, b, c, d) => {
  const dx = c - a,
    dy = d - b,
    l = dx * dx + dy * dy,
    t = l ? Math.max(0, Math.min(1, ((px - a) * dx + (py - b) * dy) / l)) : 0;
  return Math.hypot(px - a - t * dx, py - b - t * dy);
};
