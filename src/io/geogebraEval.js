/* A small GeoGebra evaluator: enough of its syntax and list/transform commands to re-run constructions
   such as fractals built with Iteration, Zip and Sequence. Values are numbers, booleans, points
   {t:'pt', p:[x,y]}, segments {t:'seg', a, b}, lines {t:'line', a, b}, polygons {t:'poly', p:[...]}
   and arrays for lists. A row stores `geogebra {json}` with the expression and fixed inputs. */

const LIMIT = 70000;
const PREFIX = /^geogebra\s*(?=\{)/;
export const isGeoText = s => PREFIX.test(s.trim());
export const writeGeo = g => 'geogebra ' + JSON.stringify(g);
// The name is written first, so it can be read without parsing a large stored object.
export function geoName(text) {
  const m = text.trim().match(/^geogebra\s*\{\s*"name"\s*:\s*("(?:[^"\\]|\\.)*")/);
  try {
    return m ? String(JSON.parse(m[1])) : '';
  } catch {
    return '';
  }
}

const okValue = (v, depth = 0) =>
  depth < 12 &&
  (typeof v === 'number'
    ? Number.isFinite(v)
    : typeof v === 'boolean' ||
      (Array.isArray(v)
        ? v.length <= LIMIT && v.every(x => okValue(x, depth + 1))
        : !!v &&
          typeof v === 'object' &&
          ['pt', 'seg', 'line', 'poly'].includes(v.t) &&
          [v.p, v.a, v.b].every(q => q === undefined || Array.isArray(q))));
export function readGeo(text) {
  try {
    const g = JSON.parse(text.trim().replace(PREFIX, ''));
    if (typeof g.exp !== 'string' || g.exp.length > 20000) return null;
    const env = Object.create(null);
    for (const [k, v] of Object.entries(g.env || {})) if (okValue(v)) env[k] = v;
    return { name: String(g.name || '').slice(0, 60), exp: g.exp, env };
  } catch {
    return null;
  }
}

const NAME = /^[A-Za-z\u0370-\u03ff][A-Za-z0-9\u0370-\u03ff]*'*(?:_\{[^}]*\}|_[A-Za-z0-9]+)?'*/;
function tokenize(s) {
  const out = [];
  let p = 0;
  while (p < s.length) {
    const c = s[p];
    if (/\s/.test(c)) {
      p++;
      continue;
    }
    const rest = s.slice(p);
    let m;
    if ((m = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/))) out.push({ k: 'num', v: +m[0] });
    else if ((m = rest.match(NAME))) out.push({ k: 'name', v: m[0] });
    else if ((m = rest.match(/^(?:<=|>=|==|!=|[≤≥≠<>[\](){},+\-*/^])/))) out.push({ k: m[0] });
    else throw Error('GeoGebra symbol ' + c + ' is not supported');
    p += m[0].length;
  }
  out.push({ k: 'end' });
  return out;
}

const FUNCS = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sgn: Math.sign,
  sign: Math.sign,
};
const CONSTANTS = { pi: Math.PI, π: Math.PI, e: Math.E, true: true, false: false };
// Commands whose arguments include variable names bound inside an expression.
const BINDERS = {
  zip: a => ({ body: [0], vars: a.filter((_, i) => i % 2 === 1).map((_, i) => 1 + 2 * i) }),
  sequence: a => (a.length >= 4 ? { body: [0], vars: [1] } : null),
  iteration: a => ({ body: [0], vars: a.slice(1, -2).map((_, i) => i + 1) }),
  keepif: a => (a.length === 3 ? { body: [0], vars: [1] } : null),
};

export function parseGeo(source) {
  const t = tokenize(source);
  let i = 0;
  const peek = () => t[i].k,
    take = k => {
      if (t[i].k !== k) throw Error(`GeoGebra expression: expected ${k}`);
      return t[i++];
    };
  const args = close => {
    const a = [];
    if (peek() !== close) {
      a.push(expr());
      while (peek() === ',') {
        i++;
        a.push(expr());
      }
    }
    take(close);
    return a;
  };
  function primary() {
    const tok = t[i++];
    if (tok.k === 'num') return { k: 'num', v: tok.v };
    if (tok.k === 'name') {
      const low = tok.v.toLowerCase();
      if (peek() === '[' || (peek() === '(' && (COMMANDS[low] || FUNCS[low]))) {
        const close = peek() === '[' ? ']' : ')';
        i++;
        return { k: 'call', n: low, a: args(close) };
      }
      return { k: 'name', n: tok.v };
    }
    if (tok.k === '(') {
      const a = expr();
      if (peek() === ',') {
        i++;
        const b = expr();
        take(')');
        return { k: 'pt', a, b };
      }
      take(')');
      return a;
    }
    if (tok.k === '{') return { k: 'list', a: args('}') };
    throw Error('GeoGebra expression is incomplete');
  }
  function power() {
    const base = primary();
    if (peek() === '^') {
      i++;
      return { k: 'bin', op: '^', a: base, b: unary() };
    }
    return base;
  }
  function unary() {
    if (peek() === '-') {
      i++;
      return { k: 'neg', a: unary() };
    }
    if (peek() === '+') i++;
    return power();
  }
  function term() {
    let a = unary();
    for (;;) {
      if (peek() === '*' || peek() === '/') {
        const op = t[i++].k;
        a = { k: 'bin', op, a, b: unary() };
      } else if (peek() === 'name' || peek() === 'num' || peek() === '(')
        a = { k: 'bin', op: '*', a, b: unary() };
      else return a;
    }
  }
  function sum() {
    let a = term();
    while (peek() === '+' || peek() === '-') {
      const op = t[i++].k;
      a = { k: 'bin', op, a, b: term() };
    }
    return a;
  }
  function expr() {
    const a = sum();
    if (['<', '>', '<=', '>=', '==', '!=', '≤', '≥', '≠'].includes(peek())) {
      const op = t[i++].k;
      return { k: 'bin', op, a, b: sum() };
    }
    return a;
  }
  const ast = expr();
  if (peek() !== 'end') throw Error('GeoGebra expression has extra text');
  return ast;
}

// Names the expression reads from outside, skipping constants and names bound by Zip, Sequence and so on.
export function freeNames(ast, bound = new Set(), out = new Set()) {
  if (ast.k === 'name') {
    if (!bound.has(ast.n) && !['pi', 'π', 'true', 'false'].includes(ast.n.toLowerCase())) out.add(ast.n);
  } else if (ast.k === 'call') {
    const b = BINDERS[ast.n]?.(ast.a);
    if (!b) ast.a.forEach(a => freeNames(a, bound, out));
    else {
      const inner = new Set([...bound, ...b.vars.map(j => ast.a[j]?.n).filter(Boolean)]);
      ast.a.forEach((a, j) => {
        if (b.vars.includes(j)) return;
        freeNames(a, b.body.includes(j) ? inner : bound, out);
      });
    }
  } else
    for (const c of [ast.a, ast.b, ...(Array.isArray(ast.a) ? ast.a : [])])
      if (c?.k) freeNames(c, bound, out);
  return out;
}

const pt = (x, y) => ({ t: 'pt', p: [x, y] });
const coord = v => {
  if (v?.t === 'pt') return v.p;
  throw Error('A point was expected');
};
const num = v => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return +v;
  throw Error('A number was expected');
};
const list = v => {
  if (Array.isArray(v)) return v;
  throw Error('A list was expected');
};
const guard = a => {
  if (a.length > LIMIT)
    throw Error(`This makes more than ${LIMIT.toLocaleString()} objects; use a smaller value`);
  return a;
};
function mapPoints(v, f) {
  if (Array.isArray(v)) return v.map(x => mapPoints(x, f));
  if (typeof v !== 'object' || !v)
    throw Error('Only points, segments, lines and polygons can be transformed');
  if (v.t === 'pt') return { t: 'pt', p: f(v.p) };
  if (v.t === 'seg' || v.t === 'line') return { t: v.t, a: f(v.a), b: f(v.b) };
  return { t: 'poly', p: v.p.map(f) };
}
const rotate = (ang, [cx, cy]) => {
  const c = Math.cos(ang),
    s = Math.sin(ang);
  return ([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
};
const flatten = v => guard(Array.isArray(v) ? v.flatMap(x => (Array.isArray(x) ? flatten(x) : [x])) : [v]);
function inside([x, y], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const vertices = v => (v?.t === 'poly' ? v.p : v?.t === 'seg' ? [v.a, v.b] : list(v).map(coord));

const COMMANDS = {
  segment: (E, [p, q]) => ({ t: 'seg', a: coord(E(p)), b: coord(E(q)) }),
  line: (E, [p, q]) => ({ t: 'line', a: coord(E(p)), b: coord(E(q)) }),
  polygon: (E, a) => ({ t: 'poly', p: a.length === 1 ? list(E(a[0])).map(coord) : a.map(x => coord(E(x))) }),
  point(E, [o, t]) {
    const v = E(o);
    if (t && v?.t === 'seg') {
      const u = num(E(t));
      return pt(v.a[0] + (v.b[0] - v.a[0]) * u, v.a[1] + (v.b[1] - v.a[1]) * u);
    }
    if (v?.t === 'pt') return v;
    throw Error('Point on a path keeps no fixed position');
  },
  midpoint(E, [a, b]) {
    const v = E(a),
      [p, q] = b ? [coord(v), coord(E(b))] : [v.a, v.b];
    return pt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  },
  centroid(E, [a]) {
    const p = vertices(E(a));
    return pt(p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length);
  },
  isinregion: (E, [p, poly]) => inside(coord(E(p)), vertices(E(poly))),
  rotate: (E, [o, ang, c]) => mapPoints(E(o), rotate(num(E(ang)), c ? coord(E(c)) : [0, 0])),
  dilate(E, [o, k, c]) {
    const f = num(E(k)),
      [cx, cy] = c ? coord(E(c)) : [0, 0];
    return mapPoints(E(o), ([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
  },
  translate(E, [o, v]) {
    const [dx, dy] = coord(E(v));
    return mapPoints(E(o), ([x, y]) => [x + dx, y + dy]);
  },
  zip(E, a, scope) {
    const pairs = [];
    for (let j = 1; j + 1 < a.length; j += 2) pairs.push([a[j].n, list(E(a[j + 1]))]);
    const n = Math.min(...pairs.map(p => p[1].length));
    return guard(
      Array.from({ length: n }, (_, i) =>
        E(a[0], bind(scope, Object.fromEntries(pairs.map(([v, l]) => [v, l[i]])))),
      ),
    );
  },
  sequence(E, a, scope) {
    if (a.length === 1)
      return guard(Array.from({ length: Math.max(0, Math.floor(num(E(a[0])))) }, (_, i) => i + 1));
    const from = num(E(a[2])),
      to = num(E(a[3])),
      step = a[4] ? num(E(a[4])) : 1;
    if (!step || (to - from) / step > LIMIT) throw Error('This Sequence is too long');
    const out = [];
    for (let v = from; step > 0 ? v <= to + 1e-9 : v >= to - 1e-9; v += step)
      out.push(E(a[0], bind(scope, { [a[1].n]: v })));
    return out;
  },
  iteration(E, a, scope) {
    const vars = a.slice(1, -2).map(x => x.n),
      starts = list(E(a.at(-2))),
      n = Math.floor(num(E(a.at(-1))));
    if (n > 40) throw Error('Iteration is limited to 40 steps');
    let state = vars.map((_, i) => starts[i]);
    for (let s = 0; s < n; s++) {
      const next = E(a[0], bind(scope, Object.fromEntries(vars.map((v, i) => [v, state[i]]))));
      if (Array.isArray(next)) guard(next);
      state = [next, ...state.slice(0, -1)];
    }
    return state[0];
  },
  keepif: (E, [cond, v, l], scope) => list(E(l)).filter(x => E(cond, bind(scope, { [v.n]: x }))),
  flatten: (E, [l]) => flatten(E(l)),
  length(E, [o]) {
    const v = E(o);
    return v?.t === 'seg' ? Math.hypot(v.b[0] - v.a[0], v.b[1] - v.a[1]) : list(v).length;
  },
  element: (E, [l, n]) => list(E(l))[Math.floor(num(E(n))) - 1],
  first: (E, [l, n]) => (n ? list(E(l)).slice(0, num(E(n))) : list(E(l))[0]),
  last: (E, [l, n]) => (n ? list(E(l)).slice(-num(E(n))) : list(E(l)).at(-1)),
  join: (E, a) => guard((a.length === 1 ? list(E(a[0])) : a.map(x => E(x))).flatMap(list)),
  sum: (E, [l]) => list(E(l)).reduce((s, v) => s + num(v), 0),
  min: (E, a) => Math.min(...(a.length === 1 ? list(E(a[0])) : a.map(x => E(x))).map(num)),
  max: (E, a) => Math.max(...(a.length === 1 ? list(E(a[0])) : a.map(x => E(x))).map(num)),
};
const bind = (scope, vars) => Object.assign(Object.create(scope), vars);

function arith(op, x, y) {
  if (typeof x === 'number' && typeof y === 'number')
    switch (op) {
      case '+':
        return x + y;
      case '-':
        return x - y;
      case '*':
        return x * y;
      case '/':
        return x / y;
      case '^':
        return x ** y;
      case '<':
        return x < y;
      case '>':
        return x > y;
      case '<=':
      case '≤':
        return x <= y;
      case '>=':
      case '≥':
        return x >= y;
      case '==':
        return x === y;
      default:
        return x !== y;
    }
  if (x?.t === 'pt' && y?.t === 'pt' && (op === '+' || op === '-'))
    return pt(x.p[0] + (op === '+' ? y.p[0] : -y.p[0]), x.p[1] + (op === '+' ? y.p[1] : -y.p[1]));
  if (op === '*' && typeof x === 'number' && y?.t === 'pt') return pt(x * y.p[0], x * y.p[1]);
  if ((op === '*' || op === '/') && x?.t === 'pt' && typeof y === 'number')
    return op === '*' ? pt(x.p[0] * y, x.p[1] * y) : pt(x.p[0] / y, x.p[1] / y);
  if (Array.isArray(x) || Array.isArray(y)) {
    const n = Array.isArray(x) ? x.length : y.length;
    return Array.from({ length: n }, (_, i) =>
      arith(op, Array.isArray(x) ? x[i] : x, Array.isArray(y) ? y[i] : y),
    );
  }
  throw Error(`GeoGebra ${op} is not supported for these values`);
}

/* Evaluates a parsed expression. `lookup(name)` supplies outside values, or undefined when it has none. */
export function evalGeo(ast, lookup, scope = Object.create(null)) {
  const E = (node, s = scope) => {
    switch (node.k) {
      case 'num':
        return node.v;
      case 'name': {
        if (node.n in s) return s[node.n];
        const v = lookup(node.n);
        if (v !== undefined) return v;
        const low = node.n.toLowerCase();
        if (low in CONSTANTS) return CONSTANTS[low];
        throw Error(`GeoGebra object ${node.n} is missing`);
      }
      case 'neg': {
        const v = E(node.a, s);
        return typeof v === 'number' ? -v : arith('*', -1, v);
      }
      case 'bin':
        return arith(node.op, E(node.a, s), E(node.b, s));
      case 'pt':
        return pt(num(E(node.a, s)), num(E(node.b, s)));
      case 'list':
        return node.a.map(x => E(x, s));
      case 'call': {
        if (FUNCS[node.n]) return FUNCS[node.n](num(E(node.a[0], s)));
        const c = COMMANDS[node.n];
        if (!c)
          throw Error(`GeoGebra command ${node.n[0].toUpperCase() + node.n.slice(1)} is not supported yet`);
        return c((x, ss = s) => E(x, ss), node.a, s);
      }
    }
    throw Error('Unknown GeoGebra expression');
  };
  return E(ast);
}

/* Joins segments that meet end to end into polylines, so a curve made of thousands of pieces traces
   as one stroke. Returns world-space paths [x0,y0,x1,y1,…] and loose points. */
export function geoShapes(value) {
  const paths = [],
    points = [];
  let cur = null;
  const same = (p, q) =>
    Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) < 1e-9 * (1 + Math.abs(p[0]) + Math.abs(p[1]));
  const end = () => cur && [cur[cur.length - 2], cur[cur.length - 1]];
  const visit = v => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (v?.t === 'seg' || v?.t === 'line') {
      let { a, b } = v;
      if (v.t === 'line') {
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          k = 1e4 / (Math.hypot(dx, dy) || 1);
        [a, b] = [
          [a[0] - dx * k, a[1] - dy * k],
          [a[0] + dx * k, a[1] + dy * k],
        ];
        cur = null;
      }
      const e = end();
      if (e && same(e, a)) cur.push(...b);
      else if (e && same(e, b)) cur.push(...a);
      else paths.push((cur = [...a, ...b]));
    } else if (v?.t === 'poly') {
      paths.push(v.p.concat([v.p[0]]).flat());
      cur = null;
    } else if (v?.t === 'pt') points.push(v.p);
  };
  visit(value);
  return { paths, points };
}
