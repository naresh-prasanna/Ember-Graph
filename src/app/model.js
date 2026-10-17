import { saveSoon } from './persistence.js';
import { updateStatus } from './scenes.js';
import { PAL, S, reduceMotion } from './state.js';
import { constants, coords, emptyCalls, nullObj, own, reserved } from '../math/catalog.js';
import { complexOp, complexText, imOf, isComplex, reOf } from '../math/complex.js';
import { DIST_NAMES, Dist } from '../math/distributions.js';
import { Color, Matrix, Point, Shape, TTest, Tone, show } from '../math/values.js';
import { ddValue } from '../math/doubleDouble.js';
import { calcFmt, clamp, fmt, toFraction } from '../math/format.js';
import { FRACTALS, parseFractal } from '../math/fractals.js';
import {
  BRANCH,
  compileExpr,
  compileReal,
  definition,
  evaluate,
  listLength,
  parts,
  splitTop,
  stillReal,
  undefinedReason,
} from '../math/parser.js';
import { findRoots, lm, solve, sse } from '../math/regression.js';
import { calculus, hasIndefinite, integralEquation, solveODE } from '../math/symbolic.js';
import { columnName, fitData, isTableText, readTable } from '../math/table.js';
import { evalGeo, freeNames, geoName, geoShapes, isGeoText, parseGeo, readGeo } from '../io/geogebraEval.js';
import { cameraKick } from '../render/camera.js';
import { kick, shatter } from '../render/renderer.js';
import { timing } from '../ui/fps.js';
import { scheduleHistory } from '../ui/history.js';
import {
  decorate,
  fractalControls,
  geoUI,
  regCard,
  showError,
  sliders,
  stepsCard,
  syncBlank,
  syncSliders,
  tableUI,
  valueCard,
} from '../ui/panel.js';
import { syncTones } from './sound.js';

// Names given a value by some row or table column, which compileExpr never splits into products.
let defined = new Set(),
  tableColumns = new Set();

export function makeRow(text = '', options = {}) {
  return {
    id: ++S.uid,
    text,
    col: options.col || PAL[(S.uid - 1) % PAL.length],
    off: !!options.off,
    helper: !!options.helper,
    colVar: options.colVar || null,
    asFrac: !!options.frac,
    prog: reduceMotion ? 1 : 0,
    uses: new Set(),
  };
}
export function val(compiled, scope = {}) {
  const env = S.env;
  if (!env.complex) {
    let fast = compiled.fast;
    if (fast?.cache !== env.cache)
      fast = compiled.fast = { cache: env.cache, by: new Map(), keys: null, f: null };
    const branched = scope[BRANCH] !== undefined;
    // Sampling asks with the same names over and over, so the last ones are checked before building a key.
    let same = !!fast.keys && fast.branched === branched,
      n = 0;
    for (const k in scope) same &&= fast.keys[n++] === k;
    let f = same && n === fast.keys.length ? fast.f : undefined;
    if (f === undefined) {
      const keys = Object.keys(scope),
        sig = keys.join() + (branched ? ';copy' : '');
      f = fast.by.get(sig);
      if (f === undefined) fast.by.set(sig, (f = compileReal(compiled.ast, env, keys, branched)));
      Object.assign(fast, { keys, branched, f });
    }
    if (f && !stillReal(f, env)) {
      fast.by.clear();
      fast.keys = null;
      f = null;
    }
    if (f) return f(scope);
  }
  return evaluate(compiled.ast, scope, env);
}
// A row's value rather than a graph: √(−4) is 2i here, where a curve would just stop.
function valueOf(compiled) {
  S.env.complex = true;
  try {
    return val(compiled);
  } finally {
    S.env.complex = false;
  }
}
// Implicit curves are sampled over the whole screen, so far fewer copies of them can be drawn.
export const maxCopies = type => (type === 'pt' ? 10000 : type === 'imp' || type === 'ineq' ? 20 : 200);
const listItem = x => (typeof x === 'number' ? calcFmt(x) : String(x));
// The first 12 elements; a longer list keeps all of them on the row, for "… N more" to open.
const listFmt = (v, r) => {
  const short =
    '[' + v.slice(0, 12).map(listItem).join(', ') + (v.length > 12 ? `, … ${v.length - 12} more` : '') + ']';
  if (r)
    r.listFull =
      v.length > 12
        ? { short: '= ' + short, full: '= [' + v.map(listItem).join(', ') + ']', n: v.length - 12 }
        : null;
  return short;
};
const CAPPED = 'Drawing the first ';
// The copies a row draws, one per list element; undefined when it uses no list.
// Asked on every redraw, since a slider can change how long a list is.
export function rowCopies(r) {
  const k = r.k;
  if (!k || k.reg || !['cart', 'function', 'cartY', 'par', 'polar', 'pt', 'imp', 'ineq'].includes(k.type))
    return;
  const sizes = [k.c, k.fx, k.fy, k.boundary, k.filter]
    .filter(Boolean)
    .map(c => listLength(c.ast, S.env))
    .filter(n => n !== null);
  const n = sizes.length ? Math.min(...sizes) : undefined,
    cap = maxCopies(k.type);
  if (n > cap) r.info = `${CAPPED}${cap.toLocaleString()} of ${n.toLocaleString()}`;
  else if (r.info?.startsWith(CAPPED)) r.info = '';
  return n;
}
// A definition whose value is a list shows that list under the row.
function listInfo(r) {
  if (r.err || r.k?.type !== 'const' || S.VM[r.k.name]) return;
  try {
    const v = val({ ast: { k: 'name', n: r.k.name } });
    r.value = carded(v) ? v : null;
    if (Array.isArray(v)) r.info = '= ' + listFmt(v, r);
    else if (typeof v === 'object' && v) r.info = valueInfo(v);
  } catch (e) {
    r.err = e.message;
  }
}
// [(1,2),(3,4)] draws points; [1,2,3] and [1...10] are lists of numbers.
function isPointList(t) {
  if (!t.endsWith(']')) return false;
  try {
    const inner = t.slice(1, -1).trim();
    return !inner || splitTop(inner).every(p => pointParts(p));
  } catch {
    return false;
  }
}
function pointParts(s) {
  s = s.trim();
  if (!s.startsWith('(') || !s.endsWith(')')) return null;
  try {
    const q = splitTop(s.slice(1, -1));
    return q.length === 2 ? q : null;
  } catch {
    return null;
  }
}
const X_HEADING = 'The first column needs a plain name such as x1 or x';
function headingError(h, message) {
  if (h.includes('='))
    return `A heading can't define anything. Put ${h} in its own row, then use it here, for example f(x1)`;
  if (/unfinished|missing its closing/.test(message))
    return 'This heading is unfinished. Try a formula such as f(x1) or 2x1 + 4';
  return `This heading isn't a name like y2 or a formula like 2x1 + 4 (${message})`;
}
function parseTable(r, fnNames) {
  const T = readTable(r.text);
  if (!T) throw Error('This table could not be read');
  // A half-typed heading or cell marks just that spot; the rest of the table keeps working.
  const cp = s => {
      try {
        const c = compileExpr(s, fnNames, defined);
        for (const n of c.deps) r.uses.add(n);
        return c;
      } catch (e) {
        return { err: e.message };
      }
    },
    names = T.cols.map(c => columnName(c.h)),
    badX = !names[0] && !!T.cols[0].h.trim();
  names[0] ||= 'x1';
  r.k = {
    type: 'table',
    filter: null,
    table: T,
    x: names[0],
    cols: T.cols.map((c, j) => {
      const h = c.h.trim(),
        formula = j > 0 && !names[j] && h ? cp(h) : null,
        err = formula?.err ? headingError(h, formula.err) : j === 0 && badX ? X_HEADING : '';
      return {
        j,
        name: names[j],
        formula: err ? null : formula,
        err,
        off: !!c.off,
        cells: formula ? [] : c.v.map(s => (s.trim() ? cp(s) : null)),
      };
    }),
  };
  for (const n of [...names, 'x']) if (n) r.uses.delete(n);
}
/* An object imported from GeoGebra keeps its original expression. It reads other GeoGebra objects by
   name, and numbers such as an iteration count from live sliders; anything that could not be brought
   across is stored with it as a fixed value. */
let geoNames = new Set(),
  geoRows = new Map();
function parseGeoRow(r) {
  const G = readGeo(r.text);
  if (!G) throw Error('This GeoGebra object could not be read');
  if (r.geoSource !== G.exp) {
    r.geoAst = parseGeo(G.exp);
    r.geoSource = G.exp;
    r.geoKey = null;
  }
  const live = [...freeNames(r.geoAst)].filter(
    n => !(n in G.env) && (geoNames.has(n) || (/^[A-Za-z_]\w*$/.test(n) && !reserved(n))),
  );
  for (const n of live) if (!geoNames.has(n)) r.uses.add(n);
  r.k = { type: 'ggb', filter: null, name: G.name, exp: G.exp, env: G.env, live };
}
function geoEval(r, stack = new Set()) {
  const k = r.k;
  if (stack.has(r)) throw Error('Circular GeoGebra definition: ' + k.name);
  stack.add(r);
  const values = [],
    tokens = [];
  for (const n of k.live) {
    const up = geoRows.get(n);
    if (up && up !== r) {
      geoEval(up, stack);
      values.push(up.geo.error ? undefined : up.geo.raw);
      tokens.push('#' + up.geoVer);
      continue;
    }
    let v;
    try {
      v = evaluate({ k: 'name', n }, {}, S.env);
    } catch {}
    values.push(v);
    tokens.push(v);
  }
  stack.delete(r);
  const key = k.exp + '|' + tokens.join();
  if (r.geoKey !== key) {
    r.geoKey = key;
    r.geoVer = (r.geoVer || 0) + 1;
    try {
      const v = evalGeo(r.geoAst, n => (n in k.env ? k.env[n] : values[k.live.indexOf(n)]));
      r.geo = { ...geoShapes(v), raw: v, count: Array.isArray(v) ? v.length : 1 };
    } catch (e) {
      const broken = k.live.find((n, i) => values[i] === undefined && geoRows.get(n)?.geo?.error);
      r.geo = { error: broken ? `This needs ${broken}, which has a problem` : e.message };
    }
  }
  return r.geo;
}
export function geoValue(r) {
  const g = geoEval(r);
  if (g.error) throw Error(g.error);
  return g;
}
/* Column values, evaluated now so sliders used in cells or header formulas stay live.
   Rows run as long as the longest data column; computed columns follow the x column. */
export function tableValues(r) {
  const k = r.k,
    get = c => {
      try {
        const v = c?.ast && val(c);
        return Number.isFinite(v) ? v : NaN;
      } catch {
        return NaN;
      }
    },
    n = Math.max(0, ...k.cols.filter(c => !c.formula).map(c => c.cells.length)),
    xs = Array.from({ length: n }, (_, i) => get(k.cols[0].cells[i])),
    cols = k.cols.slice(1).map(c => {
      const ys = c.formula
        ? xs.map(x => {
            if (!Number.isFinite(x)) return NaN;
            try {
              const v = val(c.formula, { x, [k.x]: x });
              return Number.isFinite(v) ? v : NaN;
            } catch {
              return NaN;
            }
          })
        : Array.from({ length: n }, (_, i) => get(c.cells[i]));
      return { ...c, ys, col: columnColour(r, c.j) };
    });
  return { xs, cols };
}
export function columnColour(r, j) {
  const i = PAL.indexOf(r.col);
  return j <= 1 || i < 0 ? r.col : PAL[(i + j - 1) % PAL.length];
}
export function tableFit(r) {
  const fit = r.k?.table.fit;
  if (!fit) return null;
  const { xs, cols } = tableValues(r),
    c = cols.find(c => c.j === fit.y) || cols[0];
  if (!c) return null;
  const key = fit.type + '|' + xs.join() + '|' + c.ys.join();
  if (r.fitKey !== key) {
    r.fitKey = key;
    r.fit = { ...fitData(fit.type, xs, c.ys), column: c };
  }
  return r.fit;
}
export function parseRow(r, names, known) {
  if (isTableText(r.text)) return parseTable(r, names);
  if (isGeoText(r.text)) return parseGeoRow(r);
  let { body: t, filter } = parts(r.heldText ?? r.text);
  const d = definition(t);
  if (!t || t.startsWith('"')) return;
  const cp = s => {
    const c = compile(s, names);
    for (const n of c.deps) r.uses.add(n);
    if (c.assumed) r.assumed = true;
    if (c.hint) r.hint = c.hint;
    return c;
  };
  const fractal = parseFractal(t, filter, cp);
  if (fractal) {
    r.k = fractal;
    return;
  }
  let k = {
    type: '',
    filter: filter ? cp(filter) : null,
  };
  if (d) {
    if (d.name === 'i') throw Error('i is the imaginary unit, √(−1); give this value another name, like k');
    if (reserved(d.name)) throw Error('Cannot redefine ' + d.name);
    if (d.param && reserved(d.param) && !coords.has(d.param)) throw Error('Reserved argument name');
    const point = pointParts(d.rhs);
    if (point) {
      // f(t) = (cos t, sin t) draws the curve its input traces; p = (1, 2) is a named point.
      k.fx = cp(point[0]);
      k.fy = cp(point[1]);
      const v = [d.param, 't'].find(n => n && (k.fx.deps.has(n) || k.fy.deps.has(n)));
      k.type = v ? 'par' : 'pt';
      if (v) k.param = v;
      // A named point is also a value other rows can use: distance(A, B), A.x.
      else if (!d.param) {
        k.name = d.name;
        k.c = cp(d.rhs);
      }
      r.k = k;
      return;
    }
    k.type = d.param ? 'function' : 'const';
    k.name = d.name;
    k.param = d.param;
    k.c = cp(d.rhs);
    // On a constant, braces set the slider's range: n = 12 {0 <= n <= 15}.
    if (k.filter && !d.param) {
      [k.range, k.filter] = [k.filter, null];
      if (!k.c.deps.has(d.name)) r.uses.delete(d.name);
    }
    r.k = k;
    return;
  }
  if (t.startsWith('[') && splitTop(t, '~').length === 2) {
    const q = splitTop(t, '~').map(x => x.trim());
    if (!q.every(x => x.startsWith('[') && x.endsWith(']'))) throw Error('Use [list] ~ [list]');
    const ls = q.map(x => splitTop(x.slice(1, -1)).map(cp));
    if (ls[0].length !== ls[1].length) throw Error('Lists must have the same length');
    k.type = 'lreg';
    k.L = ls[0];
    k.R = ls[1];
    r.k = k;
    return;
  }
  if (t.startsWith('[') && isPointList(t)) {
    k.type = 'pts';
    const inner = t.slice(1, -1).trim();
    k.points = inner
      ? splitTop(inner).map(point => {
          if (!point.trim().startsWith('(') || !point.trim().endsWith(')'))
            throw Error('Use points like [(1,2),(3,4)]');
          const q = splitTop(point.trim().slice(1, -1));
          if (q.length !== 2) throw Error('A point needs two coordinates');
          return q.map(cp);
        })
      : [];
  } else if (
    t.startsWith('(') &&
    t.endsWith(')') &&
    (() => {
      try {
        return splitTop(t.slice(1, -1)).length === 2;
      } catch {
        return false;
      }
    })()
  ) {
    const q = splitTop(t.slice(1, -1));
    k.fx = cp(q[0]);
    k.fy = cp(q[1]);
    k.type = k.fx.deps.has('t') || k.fy.deps.has('t') ? 'par' : 'pt';
  } else if (ODE.test(t)) {
    // dy/dx = F(x, y): solved by hand once every row is known, as its family of curves with a constant C.
    const rhs = t.match(ODE)[1];
    k.type = 'imp';
    k.ode = cp(rhs);
    k.c = cp(`y-(${rhs})-C`);
  } else if (t.includes('~')) {
    const q = splitTop(t, '~').map(x => x.trim());
    if (q.length !== 2 || !q[0] || !q[1])
      throw Error('A regression needs one ~ with a side each way, like y₁ ~ m x₁ + b');
    const lhs = q[0] === 'y' ? 'y' : columnName(q[0]);
    // y ~ … fits the points on the graph and a table column fits its table; anything else, like hello ~ 1 or
    // a list ~ a formula in lists, is solved for its unknowns as it stands.
    if (lhs === 'y' || tableColumns.has(lhs)) {
      k.type = 'cart';
      k.reg = true;
      k.lhs = lhs;
      k.c = cp(q[1]);
    } else {
      k.type = 'lreg';
      k.L = [cp(q[0])];
      k.R = [cp(q[1])];
    }
  } else {
    let m = relation(t);
    if (m && !m[3].trim() && m[1].trim()) {
      // `2 + 3 =` and `apples + 10 =` ask for a value. With an unknown on the left, like xy = or a =, the other
      // side is still being typed: the row keeps its last graph until it arrives, rather than reading it as 0.
      const free = [...compile(m[1], names).deps].filter(
        n => !known?.has(n) && !tableColumns.has(n) && (coords.has(n) || !reserved(n)),
      );
      if (m[2] !== '=' || free.length)
        throw Error(`Add the other side of the ${m[2] === '=' ? 'equation' : 'inequality'}`);
      t = m[1].trim();
      m = null;
    }
    if (!m) {
      k.c = cp(t);
      k.bare = k.c;
      // Like Desmos, a bare expression in y alone is x = f(y); one in both x and y is the surface z = f(x, y).
      k.type = k.c.deps.has('y') ? (k.c.deps.has('x') ? 'surf' : 'cartY') : 'cart';
    } else {
      const left = m[1].trim(),
        op = m[2];
      const right = m[3].trim();
      if (!left || !right) throw Error('Complete both sides of the relation');
      if (op !== '=') {
        k.type = 'ineq';
        k.c = cp(t);
        k.boundary = cp(`(${left})-(${right})`);
        k.strict = op === '<' || op === '>';
      } else if (left === 'z') {
        k.type = 'surf';
        k.c = cp(right);
      } else if (left === 'r') {
        k.type = 'polar';
        k.c = cp(right);
      } else if (left === 'y') {
        k.c = cp(right);
        if (['y', 'r', 'theta'].some(n => k.c.deps.has(n))) {
          k.type = 'imp';
          k.c = cp(`y-(${right})`);
        } else k.type = 'cart';
      } else if (left === 'x') {
        k.c = cp(right);
        if (['x', 'r', 'theta'].some(n => k.c.deps.has(n))) {
          k.type = 'imp';
          k.c = cp(`x-(${right})`);
        } else k.type = 'cartY';
      } else {
        k.type = 'imp';
        k.sides = [cp(left), cp(right)];
        // ∫ dy/g(y) = ∫ f(x) dx is a family of curves: antiderivatives leave a constant, written C.
        k.withC = k.sides.some(c => hasIndefinite(c.ast));
        k.c = cp(`(${left})-(${right})${k.withC ? '-C' : ''}`);
      }
    }
  }
  r.k = k;
}
// dy/dx = …, typed as a fraction, as y′ or with the d/dx template.
const ODE =
  /^\s*(?:\(\s*dy\s*\)\s*\/\s*\(\s*dx\s*\)|dy\s*\/\s*dx|y\s*['′]|deriv\(\s*y\s*,\s*x\s*\))\s*=(?!=)\s*(.+)$/;
// The comparison that makes a row an equation or inequality: the first one outside brackets and before any
// `with`, so in y = a·x with a = 2 and [n for n = [1...5]] the later = signs belong to the expression.
function relation(t) {
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0) {
      if (/^with\b/.test(t.slice(i)) && !/\w/.test(t[i - 1] ?? '')) return null;
      const op = t.slice(i).match(/^(?:<=|>=|<|>|=)/)?.[0];
      if (op) return [t, t.slice(0, i), op, t.slice(i + op.length)];
    }
  }
  return null;
}
let lastRows = [];
const drawable = r =>
    !r.off && !r.err && r.k && (!['const', 'surf', 'fractal', 'calc'].includes(r.k.type) || r.k.areaPlot),
  onScreen = r => drawable(r) && (r.g?.L.length || r.g?.pts.length || r.g?.fill),
  typingIn = r => !!r.inp && globalThis.document?.activeElement?.closest?.('.row') === r.inp.closest('.row');
/* A keystroke that breaks the row being typed in, like deleting a point's comma, keeps the row's last good
   drawing until it is whole again, so the graph morphs to the edit instead of vanishing and redrawing.
   Leaving the row shows the error for real. */
export function rebuild(options, held) {
  const start = performance.now();
  try {
    return rebuildRows(options, held);
  } finally {
    timing('rebuild', performance.now() - start);
  }
}
function rebuildRows({ reset = false } = {}, held = null) {
  if (!held) for (const r of S.rows) r.heldText = null;
  const before = held || new Map(S.rows.map(r => [r, [r.sig, r.prog, r.pw, r.shown]]));
  const drawn = reset || S.mode3 ? [] : lastRows.filter(onScreen).map(r => [r, r.g, r.shown ?? 1]);
  S.marks = [];
  const names = new Set(),
    byName = new Map(),
    known = new Set(),
    nextGeo = new Set();
  defined = known;
  geoNames = nextGeo;
  tableColumns = new Set();
  S.env = {
    fn: new Map(),
    def: new Map(),
    vars: S.vars,
    cache: nullObj(),
  };
  for (const r of S.rows) {
    r.mesh = null;
    r.err = '';
    r.info = '';
    r.value = null;
    r.assumed = false;
    r.hint = '';
    r.stat = null;
    r.k = null;
    r.uses = new Set();
    if (isTableText(r.text)) {
      for (const c of readTable(r.text)?.cols || [])
        if (columnName(c.h)) {
          known.add(columnName(c.h));
          tableColumns.add(columnName(c.h));
        }
      continue;
    }
    if (isGeoText(r.text)) {
      const n = geoName(r.text);
      if (n) nextGeo.add(n);
      continue;
    }
    try {
      const d = definition(parts(r.heldText ?? r.text).body);
      if (d) {
        if (!byName.has(d.name)) byName.set(d.name, []);
        byName.get(d.name).push(r);
        known.add(d.name);
        if (d.param) names.add(d.name);
      }
    } catch (e) {
      r.err = e.message;
    }
  }
  for (const r of S.rows) {
    try {
      if (!r.err) parseRow(r, names, known);
      if (r.k && (['const', 'function'].includes(r.k.type) || (r.k.type === 'pt' && r.k.name))) {
        const k = r.k;
        if (byName.get(k.name).length > 1) throw Error('Duplicate definition: ' + k.name);
        if (k.type === 'function')
          S.env.fn.set(k.name, {
            ast: k.c.ast,
            param: k.param,
            row: r,
          });
        else
          S.env.def.set(k.name, {
            ast: k.c.ast,
            row: r,
          });
      }
    } catch (e) {
      r.err = e.message;
      r.k = null;
    }
    const text = r.heldText ?? r.text;
    if (reset || r.sig !== text) {
      // Typing into a table only moves its points; it should not replay the whole reveal.
      if (reset || !(r.k?.type === 'table' && isTableText(r.sig || ''))) {
        r.pw = !reset && r.prog >= 1;
        r.prog = reduceMotion ? 1 : 0;
        if (!r.pw) r.shown = r.prog;
      }
      r.sig = text;
    }
  }
  geoRows = new Map();
  for (const r of S.rows)
    if (r.k?.type === 'ggb' && r.k.name && !geoRows.has(r.k.name)) geoRows.set(r.k.name, r);
  const columns = new Set(
    S.rows.flatMap(r => (r.k?.type === 'table' ? r.k.cols.map(c => c.name).filter(Boolean) : [])),
  );
  // `r = 6` next to an expression that uses r reads as a value for r, not as a polar circle.
  const radius = S.rows.filter(
    r => r.k?.type === 'polar' && !r.k.filter && ![...r.k.c.deps].some(n => coords.has(n)),
  );
  if (radius.length === 1 && S.rows.some(r => r.k && r.k.type !== 'polar' && r.uses.has('r'))) {
    const r = radius[0];
    r.k = { type: 'const', name: 'r', c: r.k.c, filter: null };
    S.env.def.set('r', { ast: r.k.c.ast, row: r });
  }
  // z = 3 + 2i names a complex number, as on the Argand plane; z = 3 alone is still the plane in 3D.
  const complexZ = S.rows.filter(r => {
    if (r.k?.type !== 'surf' || r.k.bare || r.k.filter || ['x', 'y'].some(n => r.k.c.deps.has(n)))
      return false;
    try {
      S.env.cache = nullObj();
      return isComplex(valueOf(r.k.c));
    } catch {
      return false;
    }
  });
  if (complexZ.length === 1) {
    const r = complexZ[0];
    r.k = { type: 'const', name: 'z', c: r.k.c, filter: null };
    S.env.def.set('z', { ast: r.k.c.ast, row: r });
  }
  // dy/dx = F is solved before the sliders are made: only a solution has a constant C to slide.
  for (const r of S.rows) {
    r.symEq = null;
    const k = r.k;
    if (r.err || !k?.ode) continue;
    let res = null;
    try {
      res = solveODE(k.ode.ast, S.env);
    } catch {
      // Drawn as a slope field below.
    }
    if (res) {
      if (res.explicit) k.type = 'cart';
      k.c = { ...k.ode, ast: res.explicit ? res.right : res.ast };
      r.symEq = { ...res, deq: k.ode.ast };
    } else {
      k.type = 'field';
      k.c = k.ode;
      if (!k.ode.deps.has('C')) r.uses.delete('C');
      r.info =
        'Slope field: each dash shows the slope dy/dx a solution has there. Separable and linear equations are solved exactly; this one is drawn as its field';
    }
  }
  // Identify independent parameters only after every definition is known.
  const nextVM = nullObj();
  for (const r of S.rows) {
    if (!r.k) continue;
    const sound = soundSliders(r.k.c?.ast || r.k.bare?.ast);
    for (const n of r.uses) {
      if (reserved(n) || names.has(n) || byName.has(n) || columns.has(n) || n === r.k.param) continue;
      // A slider that only sets a tone's pitch or volume starts somewhere you can hear, with a range to match.
      const [lo, hi, start] = (!S.ranges[n] && sound.get(n)) || [];
      if (!own(S.vars, n) || (start && !(S.vars[n] >= lo && S.vars[n] <= hi))) S.vars[n] = start ?? 1;
      if (!nextVM[n])
        nextVM[n] = {
          own: r.id,
          ...sliderRange(n, S.vars[n], lo, hi),
          direction: S.VM[n]?.direction || 1,
        };
    }
  }
  for (const r of S.rows) {
    const k = r.k;
    if (k?.type === 'const' && k.c.deps.size === 0 && !distAst(k.c.ast)) {
      try {
        const v = valueOf(k.c);
        if (Array.isArray(v) || (typeof v === 'object' && v)) continue;
        if (!Number.isFinite(v)) throw Error('Not a finite number');
        const [lo, hi] = k.range ? parameterBounds(k.range, k.name) : [];
        nextVM[k.name] = {
          own: r.id,
          constant: true,
          ...sliderRange(k.name, v, lo, hi),
          direction: S.VM[k.name]?.direction || 1,
        };
      } catch (e) {
        r.err = e.message;
      }
    }
  }
  S.VM = nextVM;
  for (const n of Object.keys(S.vars)) if (!own(S.VM, n) || S.VM[n].constant) delete S.vars[n];
  for (const n of S.playing) if (!S.VM[n]) S.playing.delete(n);
  // Detect dependency cycles without repeatedly sampling the graph.
  function check(n, path = new Set()) {
    if (path.has(n)) throw Error('Circular definition: ' + n);
    const entry = S.env.fn.get(n) || S.env.def.get(n);
    if (!entry) return;
    const next = new Set(path);
    next.add(n);
    for (const dep of entry.row.uses) if (dep !== entry.row.k.param) check(dep, next);
  }
  for (const r of S.rows) {
    try {
      if (!r.k) continue;
      for (const n of r.uses) check(n);
      if (r.k.type === 'const')
        val({
          ast: {
            k: 'name',
            n: r.k.name,
          },
        });
      const allowed = new Set(
        ['fractal', 'lsys', 'const', 'pt', 'pts'].includes(r.k.type)
          ? []
          : r.k.type === 'polar'
            ? ['theta', 'r', 'x', 'y']
            : r.k.type === 'par'
              ? ['t', 'x', 'y']
              : r.k.type === 'function'
                ? [r.k.param, 'x', 'y']
                : r.k.type === 'surf'
                  ? ['x', 'y', 'z']
                  : r.k.type === 'imp' || r.k.type === 'ineq'
                    ? ['x', 'y', 'r', 'theta']
                    : ['x', 'y'],
      );
      for (const n of r.uses)
        if (coords.has(n) && !allowed.has(n) && !S.env.def.has(n))
          throw Error('Variable ' + n + ' is not available in this expression');
    } catch (e) {
      r.err = e.message;
    }
  }
  // A function defined as d/dx or ∫ of something is called through its formula, so f(2) is exact and agrees
  // with the curve, and that has to be known before any row's value is worked out.
  for (const r of S.rows) {
    r.sym = r.series = r.symSrc = r.symArea = null;
    if (!r.err && r.k?.type === 'function') {
      symbolicRow(r);
      const f = S.env.fn.get(r.k.name);
      if (f?.row === r && (r.sym || r.k.c.ast !== f.ast)) S.env.fn.set(r.k.name, { ...f, ast: r.k.c.ast });
    }
  }
  // An expression with nothing to plot against, like `apples + 10`, shows its value.
  for (const r of S.rows) {
    const k = r.k;
    if (!r.err && k && (k.bare || k.type === 'const') && !k.filter && !k.range && coordFree(r.uses)) {
      const src = k.type === 'const' ? { k: 'name', n: k.name } : k.bare.ast;
      const kind = distAst(src);
      if (kind) {
        // A count distribution is drawn as steps one unit wide, so each whole number's probability is a bar.
        const x = { k: 'name', n: 'x' },
          at = ['poissondist', 'binomialdist'].includes(kind) ? { k: 'call', n: 'round', a: [x] } : x;
        k.dist = src;
        k.type = 'cart';
        k.c = { ast: { k: 'method', a: src, n: 'pdf', args: [at] }, deps: new Set(['x']) };
        distInfo(r);
        continue;
      }
      if (shapeOf(r, src)) continue;
    }
    if (!r.err && k?.bare && k.type === 'surf') r.info = 'Surface z = f(x, y), drawn in the 3D view';
    if (!r.err && k?.sides && !k.filter && coordFree(r.uses)) {
      k.type = 'calc';
      k.c = k.sides[0];
      checkInfo(r);
      continue;
    }
    const top = k?.bare?.ast;
    if (!r.err && top?.k === 'call' && own(NEEDS_NUMBERS, top.n) && !coordFree(r.uses)) {
      r.err = NEEDS_NUMBERS[top.n];
      continue;
    }
    if (r.err || !k?.bare || k.filter || k.reg || !coordFree(r.uses)) continue;
    k.type = 'calc';
    k.c = k.bare;
    calcInfo(r);
    shadeIntegral(r);
  }
  for (const r of S.rows) if (r.k?.type !== 'function') symbolicRow(r);
  for (const r of S.rows)
    if (!r.err && !r.info && ['cart', 'function'].includes(r.k?.type) && complexCurve(r))
      r.info = 'Its values are complex, so there is no real curve: graph re(…) or im(…) of it instead';
  for (const r of S.rows) if (!r.err && !r.info && r.k?.type === 'imp' && r.k.sides) r.info = complexSide(r);
  S.rows.forEach(listInfo);
  fitPass();
  lregPass();
  if (!held) {
    const hold = S.rows.filter(r => r.err && r.good && r.good !== r.text && typingIn(r));
    if (hold.length) {
      for (const r of S.rows) if (before.has(r)) [r.sig, r.prog, r.pw, r.shown] = before.get(r);
      for (const r of hold) [r.heldText, r.heldMsg] = [r.good, r.err];
      return rebuild({ reset }, before);
    }
  }
  for (const r of S.rows)
    if (r.heldText && drawable(r)) {
      r.assumed = true;
      r.info = r.heldMsg;
    } else if (drawable(r)) r.good = r.text;
  // A curve that stops being drawn bursts into embers rather than blinking out: its expression broke, emptied,
  // became a plain value (2x → 2), or its row was deleted. Loading a preset replaces every row at once, so
  // only a single deleted row counts; hiding a curve is not a break.
  const oneDeleted = S.rows.length === lastRows.length - 1;
  for (const [r, g, shown] of drawn)
    if (S.rows.includes(r) ? !r.off && !drawable(r) : oneDeleted) shatter(g, r.col, shown);
  lastRows = [...S.rows];
  for (const r of S.rows) {
    if (r.assumed && !r.err && !r.info) r.info = r.hint || 'Unfinished: showing the closest complete graph';
    showError(r);
    sliders(r);
    fractalControls(r);
    tableUI(r);
    geoUI(r);
    regCard(r);
    valueCard(r);
    stepsCard(r);
  }
  applyColors();
  syncTones();
  if (globalThis.document?.getElementById('rows')?.childElementCount) syncBlank();
  updateStatus();
  S.dirty = true;
  kick();
  saveSoon();
  scheduleHistory();
}
// e^(ix): complex wherever it is tried.
function complexCurve(r) {
  S.env.complex = true;
  try {
    S.env.cache = nullObj();
    // Both signs: √(−x) is complex for every positive x but a real curve over the negatives.
    return [0.7, 1.9, -0.6, -1.7].every(x => isComplex(val(r.k.c, { [r.k.param || 'x']: x })));
  } catch {
    return false;
  } finally {
    S.env.complex = false;
  }
}
// x² + y² = 10i has no points at all, real or complex: x² + y² is always real. Say which side leaves the reals
// rather than drawing nothing.
function complexSide(r) {
  S.env.complex = true;
  try {
    S.env.cache = nullObj();
    const at = [
        [0.7, 1.3],
        [-1.9, 0.4],
        [-0.6, -1.7],
        [1.3, -0.8],
      ].map(([x, y]) => ({ x, y })),
      odd = r.k.sides.map(c => at.map(p => isComplex(val(c, p)))),
      i = odd.findIndex((s, j) => s.every(Boolean) && !odd[1 - j].some(Boolean));
    if (i < 0) return null;
    const c = r.k.sides[i],
      side = i ? 'right' : 'left';
    return coordFree(c.deps)
      ? `The ${side} side is ${show(val(c, at[0]))}, not a real number, so no point (x, y) satisfies it. Try |…|, re(…) or im(…) of it`
      : `The ${side} side takes complex values, so there is no real curve to draw. Try |…|, re(…) or im(…) of it`;
  } catch {
    return null;
  } finally {
    S.env.complex = false;
  }
}
// Values that aren't numbers can't be graphed against x, so these say what to give them instead.
const NEEDS_NUMBERS = {
  tone: 'tone takes a number, not x, like tone(440)',
  rgb: 'rgb takes numbers, not x, like rgb(255, 120, 60)',
  hsv: 'hsv takes numbers, not x, like hsv(30, 1, 1)',
};
function coordFree(uses, seen = new Set()) {
  for (const n of uses) {
    if (seen.has(n)) continue;
    seen.add(n);
    const entry = S.env.def.get(n) || S.env.fn.get(n);
    if (!entry) {
      if (coords.has(n)) return false;
      continue;
    }
    const inner = [...entry.row.uses].filter(d => d !== entry.row.k?.param);
    if (!coordFree(inner, seen)) return false;
  }
  return true;
}
// The colour variables defined so far, for the colour menu: [name, Color].
export function colorVariables() {
  const out = [];
  for (const n of S.env.def.keys())
    try {
      S.env.cache = nullObj();
      const v = val({ ast: { k: 'name', n } });
      if (v instanceof Color) out.push([n, v]);
    } catch {}
  return out;
}
// A row coloured by a variable, as in Desmos's custom colours, follows it as sliders move.
function applyColors() {
  for (const r of S.rows) {
    if (!r.colVar) continue;
    try {
      S.env.cache = nullObj();
      const c = val({ ast: { k: 'name', n: r.colVar } });
      if (c instanceof Color && c.hex !== r.col) {
        r.col = c.hex;
        decorate(r);
        S.dirty = true;
      }
    } catch {}
  }
}
// A row whose value is a point, polygon or plot (or a list of them) draws it. A complex number is a point on
// the Argand plane; in a list with one, the real numbers are points on the real axis.
const drawn1 = v => v instanceof Point || v instanceof Shape || isComplex(v),
  drawnValue = v =>
    drawn1(v) ||
    (Array.isArray(v) &&
      v.length > 0 &&
      v.every(x => drawn1(x) || (typeof x === 'number' && v.some(isComplex))));
function shapeOf(r, src) {
  let v;
  try {
    S.env.cache = nullObj();
    v = valueOf({ ast: src });
  } catch {
    return false;
  }
  if (!drawnValue(v)) return false;
  r.k.src = src;
  r.k.type = 'shape';
  shapeInfo(r, v);
  return true;
}
function shapeInfo(r, v) {
  const all = [v].flat(),
    points = all.every(p => p instanceof Point);
  r.k.complex = all.some(isComplex);
  r.polar = null;
  if (r.k.complex) {
    // A list of them is easier to scan at five figures.
    r.info =
      '= ' +
      (Array.isArray(v)
        ? listFmt(
            v.map(z => (isComplex(z) ? complexText(z.re, z.im, fmt) : z)),
            r,
          )
        : String(v));
    if (!Array.isArray(v)) r.polar = polarText(v, r.k.name);
    return;
  }
  r.info = !all.length
    ? ''
    : all.length === 1
      ? points
        ? 'Point ' + all[0]
        : all[0].info
      : points
        ? `${all.length} points`
        : `${all.length} shapes`;
}
// What a row's value draws, in graph units: outlines, filled regions and dots.
export function shapeValue(r) {
  const out = { paths: [], fills: [], points: [], guides: [] };
  let v;
  try {
    v = valueOf({ ast: r.k.src });
  } catch (e) {
    r.runtimeError = e.message;
    return out;
  }
  const all = [v].flat(),
    arrows = r.k.complex && all.length <= 24;
  for (const s of all)
    if (s instanceof Point) out.points.push([s.x, s.y]);
    else if (s instanceof Shape) {
      out.paths.push(...s.paths);
      out.fills.push(...s.fills);
      out.points.push(...s.points);
    } else if (r.k.complex && (isComplex(s) || typeof s === 'number')) {
      const z = [reOf(s), imOf(s)];
      if (!z.every(Number.isFinite)) continue;
      out.points.push(z);
      if (arrows) out.paths.push(...arrow(z));
    }
  if (r.k.complex && !Array.isArray(v)) out.guides = construction(r.k.src);
  return out;
}
/* The Argand diagram draws a complex number as an arrow from 0. The head is a fixed size on screen; a number
   too close to 0 for one is just its dot. */
function arrow([x, y]) {
  const len = Math.hypot(x, y) * S.V.s;
  if (len < 3) return [];
  const shaft = [0, 0, x, y];
  if (len < 16) return [shaft];
  const a = Math.atan2(y, x),
    h = 9 / S.V.s,
    wing = s => [x - h * Math.cos(a + s * 0.42), y - h * Math.sin(a + s * 0.42)];
  return [shaft, [...wing(1), x, y, ...wing(-1)]];
}
/* How a sum, difference, product or quotient of named numbers was made, drawn faintly behind its answer:
   z + w completes the parallelogram on z and w, z − w is the arrow from w to z, and z·w turns z through
   arg w (z / w back through it). The same goes for a row naming one, like u = z·w. */
function construction(src) {
  let e = src;
  if (e.k === 'name' && S.env.def.has(e.n)) e = S.env.def.get(e.n).ast;
  const named = n =>
      !!n &&
      typeof n === 'object' &&
      ((n.k === 'name' && !own(constants, n.n)) || Object.values(n).some(named)),
    num = n => {
      const v = valueOf({ ast: n });
      return typeof v === 'number' || isComplex(v) ? [reOf(v), imOf(v)] : null;
    },
    ray = ([x, y]) => [0, 0, x, y];
  try {
    if (e.k === 'call' && e.n === 'conj' && e.a.length === 1 && named(e.a[0])) {
      const z = num(e.a[0]);
      return z ? [ray(z), [z[0], z[1], z[0], -z[1]]] : [];
    }
    if (e.k !== 'binary' || !'+-*/'.includes(e.op) || !(named(e.a) || named(e.b))) return [];
    const a = num(e.a),
      b = num(e.b);
    if (!a || !b) return [];
    if (e.op === '+') {
      const s = [a[0] + b[0], a[1] + b[1]];
      return [ray(a), ray(b), [...a, ...s], [...b, ...s]];
    }
    if (e.op === '-') return [ray(a), ray(b), [...b, ...a]];
    // The turn: an arc from z's direction through arg w, close to 0 so it reads as an angle.
    const from = Math.atan2(a[1], a[0]),
      turn = Math.atan2(b[1], b[0]) * (e.op === '*' ? 1 : -1),
      size = Math.hypot(...a),
      reach = Math.min(size, e.op === '*' ? size * Math.hypot(...b) : size / Math.hypot(...b)),
      R = clamp(0.45 * reach * S.V.s, 36, 90) / S.V.s,
      arc = [];
    if (Math.abs(turn) > 1e-9)
      for (let j = 0; j <= 32; j++) {
        const t = from + (turn * j) / 32;
        arc.push(R * Math.cos(t), R * Math.sin(t));
      }
    return [ray(a), ray(b), ...(arc.length ? [arc] : [])];
  } catch {
    return [];
  }
}
function polarText(z, n) {
  const r = fmt(Math.hypot(z.re, z.im)),
    a = Math.atan2(z.im, z.re),
    angle = `${fmt(a)} rad (${fmt((a * 180) / Math.PI)}°)`;
  return n ? `|${n}| = ${r}, arg ${n} = ${angle}` : `modulus ${r}, argument ${angle}`;
}
// normaldist(…), or a name defined as one: a row holding it draws the density. Gives the distribution's name.
function distAst(n, seen = new Set()) {
  if (n.k === 'call') return DIST_NAMES.includes(n.n) && n.n;
  if (n.k !== 'name' || seen.has(n.n) || !S.env.def.has(n.n)) return false;
  seen.add(n.n);
  return distAst(S.env.def.get(n.n).ast, seen);
}
function distInfo(r) {
  try {
    S.env.cache = nullObj();
    const v = val({ ast: r.k.dist }),
      all = [v].flat();
    r.info = all.every(d => d instanceof Dist)
      ? all.length === 1
        ? all[0].describe()
        : `${all.length} ${all[0].k.name.toLowerCase()} distributions`
      : 'Undefined' + why({ ast: r.k.dist });
  } catch (e) {
    r.err = e.message;
  }
}
const why = c => {
  const reason = undefinedReason(c.ast, {}, S.env);
  return reason ? ': ' + reason : '';
};
// Values that aren't numbers describe themselves; matrices, colours, tests and tones also get a card.
const carded = v =>
  [v].flat().some(x => x instanceof Matrix || x instanceof Color || x instanceof Tone || x instanceof TTest);
// What will actually come out of the speakers, and why when it's nothing.
function toneInfo(t) {
  const hz = show(t.freq) + ' Hz';
  if (!(t.freq >= 20 && t.freq <= 20000)) return `${hz} is outside hearing (20 to 20000 Hz)`;
  if (!(t.gain > 0)) return `${hz}, silent at volume 0`;
  const note = noteName(t.freq);
  return `${hz}${note} at volume ${show(Math.min(t.gain, 1))}`;
}
// The nearest piano note, when the frequency is close to one: 440 Hz is A4.
function noteName(f) {
  const n = 12 * Math.log2(f / 440) + 57,
    k = Math.round(n);
  if (Math.abs(n - k) > 0.1) return '';
  return ` (${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((k % 12) + 12) % 12]}${Math.floor(k / 12)})`;
}
function valueInfo(v) {
  if (v instanceof Matrix) return `${v.m}×${v.n} matrix`;
  if (v instanceof Color) return 'Color ' + v;
  if (v instanceof TTest) return v.kind;
  if (v instanceof Tone) return toneInfo(v);
  if (v instanceof Dist) return v.describe();
  return '= ' + String(v);
}
// d/dx x² and ∫ x² dx are worked out by hand too, so the row can say = 2x, the way 10 + 5 says = 15.
function symbolicRow(r) {
  r.sym = r.series = r.symSrc = r.symArea = null;
  const k = r.k;
  if (k?.ode) return;
  if (!r.err && k?.withC) {
    try {
      const res = integralEquation(k.sides[0].ast, k.sides[1].ast, S.env);
      if (res) {
        k.c = { ...k.c, ast: res.ast };
        r.symEq = res;
      }
    } catch {
      // Left to be drawn numerically.
    }
    return;
  }
  if (r.err || !k || !['cart', 'cartY', 'function'].includes(k.type) || k.reg || k.dist) return;
  const src = k.c?.ast;
  try {
    const res = calculus(src, S.env);
    if (res) {
      [r.symSrc, r.series, r.symIndef] = [src, res.series || null, res.indefinite];
      [r.seriesAt, r.graphFrom, r.symArea] = [res.center || 0, res.from || 0, res.area || null];
      // The curve is drawn from the formula: exact, and far cheaper than integrating at every point.
      // With none, it is the area from a point where the integrand is defined.
      if (res.ast || res.graph) k.c = { ...k.c, ast: res.ast || res.graph };
      if (res.ast) r.sym = res.ast;
    }
  } catch (e) {
    if (!r.info) r.info = e.message;
  }
}
function calcInfo(r) {
  try {
    S.env.cache = nullObj();
    const v = ddValue(r.k.c, val);
    r.value = carded(v) ? v : null;
    r.info = Array.isArray(v)
      ? '= ' + listFmt(v, r)
      : typeof v === 'object' && v
        ? valueInfo(v)
        : Number.isNaN(v)
          ? 'Undefined' + why(r.k.c)
          : '= ' + calcFmt(v);
    const frac = typeof v === 'number' ? toFraction(v) : null;
    r.frac = frac && { n: frac[0], d: frac[1], info: r.info };
  } catch (e) {
    r.err = e.message;
  }
}
// ∫ₐᵇ f(x) dx is a number, and also the shaded area under y = f(x) from a to b.
function shadeIntegral(r) {
  r.k.areaPlot = null;
  const ast = r.k.bare?.ast;
  if (r.err || !ast || ast.k !== 'call' || ast.n !== 'integral' || ast.a.length !== 4) return;
  if (ast.a[1].k !== 'name') return;
  let lo, hi;
  try {
    lo = valueOf({ ast: ast.a[2] });
    hi = valueOf({ ast: ast.a[3] });
  } catch {
    return;
  }
  if (
    typeof lo !== 'number' ||
    typeof hi !== 'number' ||
    !Number.isFinite(lo) ||
    !Number.isFinite(hi) ||
    lo === hi
  )
    return;
  r.k.areaPlot = {
    f: { ast: ast.a[0] },
    v: ast.a[1].n,
    a: { ast: ast.a[2] },
    b: { ast: ast.a[3] },
  };
}
// An equation with no x or y on either side, like 2 + 2 = 4, is checked rather than drawn.
function checkInfo(r) {
  try {
    S.env.cache = nullObj();
    const [a, b] = r.k.sides.map(c => valueOf(c));
    if ([a, b].some(Array.isArray)) throw Error('Compare numbers, not lists');
    const bad = r.k.sides.find((c, i) => Number.isNaN([a, b][i])),
      size = v => Math.hypot(reOf(v), imOf(v)),
      gap = size(isComplex(a) || isComplex(b) ? complexOp('-', a, b) : a - b);
    r.info = bad
      ? 'Undefined' + why(bad)
      : gap <= 1e-9 * Math.max(1, size(a), size(b))
        ? 'True'
        : `False: ${show(a)} ≠ ${show(b)}`;
  } catch (e) {
    r.err = e.message;
  }
}
// Names given straight to tone( ): the frequency's slider runs over hearing, the gain's from 0 to 1.
function soundSliders(ast, out = new Map()) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.k === 'call' && ast.n === 'tone') {
    if (ast.a[0]?.k === 'name') out.set(ast.a[0].n, [20, 2000, 440]);
    if (ast.a[1]?.k === 'name') out.set(ast.a[1].n, [0, 1, 0.5]);
  }
  for (const v of Object.values(ast)) if (v && typeof v === 'object') soundSliders(v, out);
  return out;
}
function rangeFor(v) {
  const R = Math.max(10, 10 ** Math.ceil(Math.log10(Math.abs(v) + 1)));
  return {
    min: -R,
    max: R,
  };
}
// As in Desmos, a slider moves in tidy steps unless told otherwise: 0.1 across −10…10, scaling with the range.
// A step of 0 chosen by the user means as fine as the slider can go.
export const defaultStep = (min, max) => 10 ** (Math.floor(Math.log10(max - min)) - 2);
function sliderRange(n, v, lo, hi) {
  const R = S.ranges[n],
    span = R
      ? { min: Math.min(R.min, v), max: Math.max(R.max, v) }
      : lo < hi
        ? { min: lo, max: hi }
        : rangeFor(v);
  return { ...span, step: R?.step ?? defaultStep(span.min, span.max) };
}
export function snapValue(m, v) {
  const q = m.step > 0 ? m.step : 10 ** Math.floor(Math.log10((m.max - m.min) / 1000));
  const base = m.step > 0 ? m.min : 0;
  return +(base + Math.round((v - base) / q) * q).toPrecision(12);
}
export function parameter(n) {
  return S.VM[n]?.constant
    ? val({
        ast: {
          k: 'name',
          n,
        },
      })
    : S.vars[n];
}
export function setVar(n, v) {
  const m = S.VM[n];
  if (!m || !Number.isFinite(v)) return;
  v = snapValue(m, v);
  if (document.activeElement?.matches('input[type=range]')) {
    let old;
    try {
      old = parameter(n);
    } catch {}
    if (Number.isFinite(old)) cameraKick(0, clamp((v - old) * 4, -7, 7));
  }
  if (m.constant) {
    const r = S.rows.find(r => r.id === m.own);
    if (!r) return;
    const range = r.text.match(/\{[^{}]*\}\s*$/)?.[0];
    r.text = `${n} = ${v}` + (range ? ' ' + range.trim() : '');
    r.sig = r.text;
    r.inp.value = r.text;
    r.k.c = compile(String(v));
    S.env.def.set(n, {
      ast: r.k.c.ast,
      row: r,
    });
  } else S.vars[n] = v;
  S.env.cache = nullObj();
  S.marks = [];
  S.dirty = true;
  // A regression solves for its unknowns given everything else, so it re-solves as any other slider moves.
  const fits = S.rows.filter(r => !r.err && (r.k?.reg || r.k?.type === 'lreg'));
  if (fits.length) {
    fitPass(n);
    lregPass(n);
    for (const r of fits) {
      sliders(r);
      regCard(r);
    }
  }
  S.rows.forEach(r => {
    r.mesh = null;
    if (r.k?.type === 'calc' && !r.err) {
      (r.k.sides ? checkInfo : calcInfo)(r);
      showError(r);
    }
    if (r.k?.dist && !r.err) {
      distInfo(r);
      showError(r);
    }
    if (r.k?.type === 'shape' && !r.err) {
      try {
        shapeInfo(r, val({ ast: r.k.src }));
      } catch {}
      showError(r);
    }
    if (r.k?.type === 'const' && !r.err && !S.VM[r.k.name]) {
      listInfo(r);
      showError(r);
    }
    if (r.k?.type === 'calc' || r.k?.type === 'const') valueCard(r);
    if (r.k?.type === 'ggb') {
      try {
        geoEval(r);
      } catch {}
      if (r.cardVer !== r.geoVer) geoUI(r);
    }
    decorate(r);
    if (r.k?.type === 'fractal' || r.k?.type === 'lsys') {
      r.err = '';
      r.slEl?.querySelector('.fractal-card')?.remove();
      fractalControls(r);
      showError(r);
    }
  });
  applyColors();
  syncTones();
  syncSliders();
  kick();
  saveSoon();
}
// held: a slider being dragged; a fit that would solve for it is left as it is rather than fight the drag.
function lregPass(held) {
  for (const r of S.rows) {
    const k = r.k;
    if (!k || k.type !== 'lreg' || r.err || r.off) continue;
    const ps = [...r.uses].filter(n => own(S.vars, n)),
      orig = ps.map(n => S.vars[n]);
    if (ps.includes(held)) continue;
    try {
      // Either side may be a list; a number is matched against every element of the other side.
      const pairs = () => {
          S.env.cache = nullObj();
          return k.L.flatMap((c, i) => {
            const a = val(c),
              b = val(k.R[i]);
            if (!Array.isArray(a) && !Array.isArray(b)) return [[a, b]];
            const n = Math.min(...[a, b].filter(Array.isArray).map(v => v.length));
            return Array.from({ length: n }, (_, j) => [
              Array.isArray(a) ? a[j] : a,
              Array.isArray(b) ? b[j] : b,
            ]);
          });
        },
        res = () => pairs().map(([a, b]) => a - b);
      // One unknown and one equation, like a² + 5a + 6 ~ 0: find every real root, not just one fit.
      if (ps.length === 1 && pairs().length === 1) {
        const p = ps[0],
          guess = Number.isFinite(S.vars[p]) ? S.vars[p] : 0,
          f = x => {
            S.vars[p] = x;
            S.env.cache = nullObj();
            return val(k.L[0]) - val(k.R[0]);
          },
          lo = S.VM[p] ? S.VM[p].min : -50,
          hi = S.VM[p] ? S.VM[p].max : 50;
        let roots = findRoots(f, lo, hi);
        if (!roots.length && (lo !== -50 || hi !== 50)) roots = findRoots(f);
        if (roots.length) {
          const pick = roots.reduce((b, x) => (Math.abs(x - guess) < Math.abs(b - guess) ? x : b));
          S.vars[p] = pick;
          r.stat = {
            params: roots.map(x => [p, x]),
            stats: [['RMSE', 0]],
            resid: [0],
            solutions: true,
          };
          r.info = '';
          Object.assign(S.VM[p], sliderRange(p, pick));
          S.env.cache = nullObj();
          continue;
        }
        S.vars[p] = guess;
      }
      if (ps.length) {
        ps.forEach(p => (S.vars[p] = 1));
        lm(ps, res, S.vars);
      }
      const e = res();
      r.info =
        'RMSE = ' +
        fmt(Math.sqrt(sse(e) / (e.length || 1))) +
        ' · e = [' +
        e.map(fmt).join(', ') +
        ']' +
        (ps.length
          ? ' · ' +
            ps
              .map(
                p =>
                  p.replace(
                    /^([A-Za-z])(\d+)$/,
                    (m, a, d) => a + [...d].map(c => String.fromCharCode(0x2080 + +c)).join(''),
                  ) +
                  ' = ' +
                  fmt(S.vars[p]),
              )
              .join(', ')
          : '');
      if (e.some(v => !Number.isFinite(v))) throw Error('The model is undefined for some of the data');
      // An exact fit leaves rounding dust like 1.6e-13, which reads as 0.
      const scale = Math.max(1, ...pairs().flat().map(Math.abs));
      e.forEach((v, i) => Math.abs(v) < 1e-9 * scale && (e[i] = 0));
      // y₁ ~ m x₁ + b also draws its model, with the one list on the right read as x.
      const isList = n => {
          try {
            return Array.isArray(val({ ast: { k: 'name', n } }));
          } catch {
            return false;
          }
        },
        inputs = [...k.R[0].deps].filter(n => S.env.def.has(n) && isList(n));
      [k.c, k.xKey] =
        k.L.length === 1 &&
        k.L[0].ast.k === 'name' &&
        isList(k.L[0].ast.n) &&
        inputs.length === 1 &&
        !k.R[0].deps.has('x')
          ? [k.R[0], inputs[0]]
          : [null, null];
      const ys = pairs().map(p => p[0]),
        mean = ys.reduce((s, y) => s + y, 0) / ys.length,
        total = ys.reduce((s, y) => s + (y - mean) ** 2, 0);
      r.stat = {
        params: ps.map(p => [p, S.vars[p]]),
        stats: [
          ...(e.length > 1 && total > 0 ? [['R²', 1 - sse(e) / total]] : []),
          ['RMSE', Math.sqrt(sse(e) / (e.length || 1))],
        ],
        resid: e,
      };
      r.info = '';
      for (const p of ps) Object.assign(S.VM[p], sliderRange(p, S.vars[p]));
    } catch (x) {
      ps.forEach((p, i) => (S.vars[p] = orig[i]));
      r.info = 'Fit failed: ' + x.message;
    }
    S.env.cache = nullObj();
  }
}
function fitPass(held) {
  const DATA = S.rows
    .filter(r => !r.off && !r.err && r.k?.type === 'pts')
    .flatMap(r =>
      r.k.points.map(p => {
        try {
          return p.map(c => val(c));
        } catch {
          return [NaN, NaN];
        }
      }),
    )
    .filter(p => p.every(Number.isFinite));
  const tables = S.rows
      .filter(r => !r.err && r.k?.type === 'table')
      .map(r => ({ k: r.k, ...tableValues(r) })),
    pairs = (t, c) => t.xs.map((x, i) => [x, c.ys[i]]).filter(p => p.every(Number.isFinite));
  for (const t of tables)
    if (t.cols[0] && !S.rows.find(r => r.k === t.k).off) DATA.push(...pairs(t, t.cols[0]));
  for (const r of S.rows) {
    if (!r.k?.reg || r.err || r.off) continue;
    let D = DATA;
    r.k.xKey = null;
    if (r.k.lhs !== 'y') {
      const t = tables.find(t => t.cols.some(c => c.name === r.k.lhs));
      if (!t) {
        r.info = 'No table has a column named ' + r.k.lhs;
        continue;
      }
      D = pairs(
        t,
        t.cols.find(c => c.name === r.k.lhs),
      );
      r.k.xKey = t.k.x;
    }
    const ps = [...r.uses].filter(n => own(S.vars, n));
    if (ps.includes(held)) continue;
    if (!ps.length) {
      r.info = 'Use free parameters such as m and b';
      continue;
    }
    if (D.length < ps.length) {
      r.info = 'Add at least ' + ps.length + ' data points';
      continue;
    }
    const original = ps.map(n => S.vars[n]);
    try {
      const res = () => {
          S.env.cache = nullObj();
          return D.map(
            ([x, y]) =>
              y -
              val(r.k.c, {
                x,
                ...(r.k.xKey && { [r.k.xKey]: x }),
              }),
          );
        },
        sse = a => a.reduce((s, v) => s + v * v, 0);
      let lam = 1e-3,
        e0 = sse(res());
      if (!Number.isFinite(e0)) throw Error('Model is undefined at a data point');
      for (let it = 0; it < 60; it++) {
        const rs = res(),
          J = ps.map(n => {
            const v = S.vars[n],
              h = 1e-6 * (1 + Math.abs(v));
            S.vars[n] = v + h;
            let q;
            try {
              q = res();
            } finally {
              S.vars[n] = v;
            }
            return q.map((z, i) => (rs[i] - z) / h);
          }),
          A = ps.map((_, i) =>
            ps.map((_, j) => J[i].reduce((t, v, k) => t + v * J[j][k], 0) + (i === j ? lam : 0)),
          ),
          b = ps.map((_, i) => J[i].reduce((t, v, k) => t + v * rs[k], 0)),
          delta = solve(A, b);
        if (!delta) break;
        const old = ps.map(n => S.vars[n]);
        ps.forEach((n, i) => (S.vars[n] += delta[i]));
        const e1 = sse(res());
        if (e1 < e0) {
          const improvement = e0 - e1;
          e0 = e1;
          lam = Math.max(lam / 3, 1e-10);
          if (improvement < 1e-12) break;
        } else {
          ps.forEach((n, i) => (S.vars[n] = old[i]));
          lam *= 10;
          if (lam > 1e10) break;
        }
      }
      const mean = D.reduce((s, p) => s + p[1], 0) / D.length,
        total = D.reduce((s, p) => s + (p[1] - mean) ** 2, 0);
      r.stat = {
        params: ps.map(n => [n, S.vars[n]]),
        stats: [
          ['R²', total ? 1 - e0 / total : NaN],
          ['RMSE', Math.sqrt(e0 / D.length)],
        ],
        resid: res(),
      };
      r.info = '';
      for (const n of ps) Object.assign(S.VM[n], sliderRange(n, S.vars[n]));
    } catch (e) {
      ps.forEach((n, i) => (S.vars[n] = original[i]));
      r.info = 'Fit failed: ' + e.message;
    }
    S.env.cache = nullObj();
  }
}

/* Geometry is clipped to the viewport. Restrictions use actual coordinates.
   Midpoint checks reject sampled poles instead of drawing through asymptotes. */

// Join only shared marching-square endpoints: disconnected curves stay separate.
export function parameterBounds(comp, param) {
  let lo = 0,
    hi = 2 * Math.PI;
  if (!comp) return [lo, hi];
  let lower = -Infinity,
    upper = Infinity;
  function visit(n) {
    if (n.k === 'binary' && n.op === '&&') {
      visit(n.a);
      visit(n.b);
    }
    if (n.k !== 'cmp') return;
    for (let i = 0; i < n.ops.length; i++) {
      let a = n.a[i],
        b = n.a[i + 1],
        op = n.ops[i];
      if (b.k === 'name' && b.n === param) {
        [a, b] = [b, a];
        op =
          {
            '<': '>',
            '<=': '>=',
            '>': '<',
            '>=': '<=',
          }[op] || op;
      }
      if (a.k !== 'name' || a.n !== param) continue;
      try {
        const v = evaluate(b, {}, S.env);
        if (!Number.isFinite(v)) continue;
        if (op === '>' || op === '>=') lower = Math.max(lower, v);
        if (op === '<' || op === '<=') upper = Math.min(upper, v);
      } catch {}
    }
  }
  visit(comp.ast);
  if (Number.isFinite(lower)) lo = lower;
  if (Number.isFinite(upper)) hi = upper;
  if (hi < lo) return [lo, lo];
  return [lo, hi];
}

/* Rendering retains the original ember trails and additive glow. */
export function fractalParams(r) {
  const a = r.k.args.map(c => val(c)),
    spec = FRACTALS[r.k.family];
  if (!a.every(Number.isFinite)) throw Error('Fractal parameters must be finite');
  const iterations = a.at(-1),
    power = spec.labels.includes('Power') ? a[spec.labels.indexOf('Power')] : 2;
  if (iterations < 16 || iterations > 1200 || !Number.isInteger(iterations))
    throw Error('Iterations must be an integer from 16 to 1200');
  if (!Number.isInteger(power) || power < 2 || power > 8) throw Error('Power must be an integer from 2 to 8');
  return {
    family: r.k.family,
    julia: !!spec.julia,
    cr: spec.julia ? a[0] : 0,
    ci: spec.julia ? a[1] : 0,
    power,
    iterations,
  };
}
export function curveSteps(r) {
  const spec = FRACTALS[r.k.family],
    v = val(r.k.args[0]),
    n = Math.round(v);
  if (!(Math.abs(v - n) < 1e-9) || n < 0 || n > spec.curve.max)
    throw Error(`${spec.labels[0]} must be a whole number from 0 to ${spec.curve.max}`);
  return n;
}
/* While an expression is being typed, a half-finished one is drawn as the closest complete one: a trailing
   operator is dropped (2x + reads as 2x, x^ as x), an empty input or coordinate counts as 0, and open
   brackets close. The graph holds still or morphs instead of vanishing on every keystroke. */
const fillCalls = s => s.replace(/\b([a-zA-Z]\w*)\(\s*\)/g, (m, n) => (emptyCalls.has(n) ? m : n + '(0)'));
const repairExpression = s => {
  let t = s;
  for (let i = 0; i < 5; i++)
    t = t
      .replace(/\^\(\s*\)/g, '')
      .replace(/\/\(\s*\)/g, '')
      // A point being edited: (−, 4) and (, 4) are (0, 4), (3, ) is (3, 0), and a cleared one is left out.
      .replace(/[+\-−*/·^]\s*(?=[,)\]])/g, '')
      .replace(/,\s*\(\s*\)(?=\s*[,)\]])/g, '')
      .replace(/(?<![\w)\]])\(\s*,/g, '(0,')
      .replace(/(?<![\w)\]])\(([^(),]*),\s*\)/g, '($1,0)')
      .replace(/[+\-*/^=<>,~.]\s*([)\]]*)$/, '$1')
      .replace(/(?<![\w)\]])\(\s*\)$/, '')
      .replace(/\(\s*,/g, '(0,')
      .replace(/,\s*(?=[,)])/g, ',0');
  const open = [];
  for (const c of t) {
    if (c === '(' || c === '[') open.push(c === '(' ? ')' : ']');
    else if ((c === ')' || c === ']') && open.at(-1) === c) open.pop();
  }
  return fillCalls(t + open.reverse().join('')).trim() || '0';
};
const editing = () => !!globalThis.document?.activeElement?.closest?.('.row');
// Empty slots left by the editor, like x/() or 2^(), never mean anything; read them as absent.
const dropEmpty = s => {
  for (let i = 0; i < 5; i++) {
    const t = s.replace(/(?:\/|\^|\b(?:sqrt|abs))\(\s*\)/g, '').replace(/(?<![\w)])\(\s*\)/g, '');
    if (t === s) break;
    s = t;
  }
  return s;
};
export function compile(source, functionNames) {
  if (typeof source === 'string' && source.includes('()')) source = dropEmpty(source);
  if (typeof source === 'string' && editing() && fillCalls(source) !== source)
    return { ...compile(fillCalls(source), functionNames), assumed: true };
  try {
    return compileExpr(source, functionNames, defined);
  } catch (err) {
    if (typeof source === 'string' && editing()) {
      const f = repairExpression(source);
      if (f !== source) {
        try {
          // "Add the upper bound" still says what is missing while the graph stands in with 0.
          const hint = /^Add /.test(err.message) ? err.message : '';
          return { ...compileExpr(f, functionNames, defined), assumed: true, hint };
        } catch {}
      }
    }
    throw err;
  }
}
