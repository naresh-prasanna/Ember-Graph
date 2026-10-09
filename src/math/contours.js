/* Geometry is clipped to the viewport. Restrictions use actual coordinates.
   Midpoint checks reject sampled poles instead of drawing through asymptotes. */
// Join only shared marching-square endpoints: disconnected curves stay separate.
export function stitchContours(segments) {
  const nodes = new Map(),
    edges = [],
    seen = new Set(),
    key = (x, y) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4);
  function node(x, y) {
    const k = key(x, y);
    if (!nodes.has(k))
      nodes.set(k, {
        k,
        p: [x, y],
        edges: [],
      });
    return nodes.get(k);
  }
  for (const a of segments) {
    const u = node(a[0], a[1]),
      v = node(a[2], a[3]);
    if (u === v) continue;
    const id = [u.k, v.k].sort().join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    const e = {
      u,
      v,
      used: false,
    };
    edges.push(e);
    u.edges.push(e);
    v.edges.push(e);
  }
  const paths = [];
  function walk(start, first) {
    const pts = [start.p];
    let n = start,
      e = first;
    while (e && !e.used) {
      e.used = true;
      n = e.u === n ? e.v : e.u;
      pts.push(n.p);
      if (n === start || n.edges.length !== 2) break;
      e = n.edges.find(e => !e.used);
    }
    if (pts.length < 2) return;
    if (n === start && pts.length > 3) {
      pts.pop();
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i],
          b = pts[(i + 1) % pts.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      if (area > 0) pts.reverse();
      let k = 0;
      for (let i = 1; i < pts.length; i++)
        if (pts[i][0] > pts[k][0] || (pts[i][0] === pts[k][0] && pts[i][1] < pts[k][1])) k = i;
      const ordered = pts.slice(k).concat(pts.slice(0, k));
      ordered.push(ordered[0]);
      paths.push(ordered.flat());
    } else paths.push(pts.flat());
  }
  for (const n of nodes.values()) if (n.edges.length !== 2) for (const e of n.edges) if (!e.used) walk(n, e);
  for (const e of edges) if (!e.used) walk(e.u, e);
  return paths.sort((a, b) => b.length - a.length);
}
export function measurePaths(g) {
  g.lengths = g.L.map(a => {
    const d = [0];
    for (let i = 2; i < a.length; i += 2)
      d.push(d[d.length - 1] + Math.hypot(a[i] - a[i - 2], a[i + 1] - a[i - 1]));
    return d;
  });
  g.distance = g.lengths.reduce((sum, d) => sum + d[d.length - 1], 0);
}
// Interpolate the leading point by distance, rather than jumping between samples.
// Interpolate the leading point by distance, rather than jumping between samples.
export function revealGeometry(g, progress) {
  const P = new Path2D(),
    trail = new Path2D();
  let remaining = Math.max(0, Math.min(1, progress)) * g.distance,
    head = null,
    prev = null,
    active = [];
  for (let j = 0; j < g.L.length && remaining > 0; j++) {
    const a = g.L[j],
      d = g.lengths[j],
      total = d[d.length - 1];
    P.moveTo(a[0], a[1]);
    active = [[a[0], a[1]]];
    head = prev = active[0];
    for (let i = 1; i < d.length; i++) {
      const p = [a[i * 2], a[i * 2 + 1]],
        before = [a[i * 2 - 2], a[i * 2 - 1]];
      if (d[i] <= remaining) {
        P.lineTo(...p);
        active.push(p);
        prev = before;
        head = p;
      } else {
        const f = (remaining - d[i - 1]) / (d[i] - d[i - 1] || 1);
        head = [before[0] + (p[0] - before[0]) * f, before[1] + (p[1] - before[1]) * f];
        prev = before;
        P.lineTo(...head);
        active.push(head);
        break;
      }
    }
    remaining -= total;
  }
  if (head) {
    let distance = 0,
      start = active.length - 1;
    while (start > 0 && distance < 45) {
      distance += Math.hypot(
        active[start][0] - active[start - 1][0],
        active[start][1] - active[start - 1][1],
      );
      start--;
    }
    trail.moveTo(...active[start]);
    for (let i = start + 1; i < active.length; i++) trail.lineTo(...active[i]);
  }
  return {
    P,
    trail,
    head,
    prev,
  };
}
