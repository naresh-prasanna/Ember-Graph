import { saveSoon } from './persistence.js';
import { updateStatus } from './scenes.js';
import { PAL, S, reduceMotion } from './state.js';
import { coords, nullObj, own, reserved } from '../math/catalog.js';
import { ddValue } from '../math/doubleDouble.js';
import { calcFmt, clamp, fmt } from '../math/format.js';
import { FRACTALS, parseFractal } from '../math/fractals.js';
import { compileExpr, definition, evaluate, parts, splitTop } from '../math/parser.js';
import { lm, solve, sse } from '../math/regression.js';
import { columnName, fitData, isTableText, readTable } from '../math/table.js';
import { evalGeo, freeNames, geoName, geoShapes, isGeoText, parseGeo, readGeo } from '../io/geogebraEval.js';
import { cameraKick } from '../render/camera.js';
import { kick } from '../render/renderer.js';
import { scheduleHistory } from '../ui/history.js';
import {
  decorate,
  fractalControls,
  geoUI,
  regCard,
  showError,
  sliders,
  syncBlank,
  syncSliders,
  tableUI,
} from '../ui/panel.js';

// Names given a value by some row or table column, which compileExpr never splits into products.
let defined = new Set();

export function makeRow(text = '', options = {}) {
  return {
    id: ++S.uid,
    text,
    col: options.col || PAL[(S.uid - 1) % PAL.length],
    off: !!options.off,
    helper: !!options.helper,
    prog: reduceMotion ? 1 : 0,
    uses: new Set(),
  };
}
export function val(compiled, scope = {}) {
  return evaluate(compiled.ast, scope, S.env);
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
export function parseRow(r, names) {
  if (isTableText(r.text)) return parseTable(r, names);
  if (isGeoText(r.text)) return parseGeoRow(r);
  let { body: t, filter } = parts(r.text);
  const d = definition(t);
  if (!t || t.startsWith('"')) return;
  const cp = s => {
    const c = compile(s, names);
    for (const n of c.deps) r.uses.add(n);
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
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw Error('Close the point list with ]');
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
  } else if (t.includes('~')) {
    const q = t.split('~'),
      lhs = q.length === 2 && (q[0].trim() === 'y' ? 'y' : columnName(q[0]));
    if (!lhs) throw Error('Use regression like y ~ m*x+b, or y₁ ~ m*x₁+b with a table');
    k.type = 'cart';
    k.reg = true;
    k.lhs = lhs;
    k.c = cp(q[1]);
  } else {
    const m = t.match(/^(.*?)(<=|>=|<|>|=)(.*)$/);
    if (!m) {
      k.type = 'cart';
      k.c = cp(t);
      k.bare = k.c;
    } else {
      const left = m[1].trim(),
        op = m[2];
      let right = m[3].trim();
      if (!left) throw Error('Complete both sides of the relation');
      if (!right) {
        // `apples + 10 =` asks for a value; with x or y in it, the empty side means 0.
        if (op === '=') k.bare = cp(left);
        right = '0';
        t = t.trimEnd() + '0';
      }
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
        k.c = cp(`(${left})-(${right})`);
      }
    }
  }
  r.k = k;
}
export function rebuild({ reset = false } = {}) {
  S.marks = [];
  const names = new Set(),
    byName = new Map(),
    known = new Set(),
    nextGeo = new Set();
  defined = known;
  geoNames = nextGeo;
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
    r.stat = null;
    r.k = null;
    r.uses = new Set();
    if (isTableText(r.text)) {
      for (const c of readTable(r.text)?.cols || []) if (columnName(c.h)) known.add(columnName(c.h));
      continue;
    }
    if (isGeoText(r.text)) {
      const n = geoName(r.text);
      if (n) nextGeo.add(n);
      continue;
    }
    try {
      const d = definition(parts(r.text).body);
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
      if (!r.err) parseRow(r, names);
      if (r.k && ['const', 'function'].includes(r.k.type)) {
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
    if (reset || r.sig !== r.text) {
      // Typing into a table only moves its points; it should not replay the whole reveal.
      if (reset || !(r.k?.type === 'table' && isTableText(r.sig || ''))) {
        r.pw = !reset && r.prog >= 1;
        r.prog = reduceMotion ? 1 : 0;
      }
      r.sig = r.text;
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
  // Identify independent parameters only after every definition is known.
  const nextVM = nullObj();
  for (const r of S.rows) {
    if (!r.k) continue;
    for (const n of r.uses) {
      if (reserved(n) || names.has(n) || byName.has(n) || columns.has(n) || n === r.k.param) continue;
      if (!own(S.vars, n)) S.vars[n] = 1;
      if (!nextVM[n])
        nextVM[n] = {
          own: r.id,
          ...sliderRange(n, S.vars[n]),
          direction: S.VM[n]?.direction || 1,
        };
    }
  }
  for (const r of S.rows) {
    const k = r.k;
    if (k?.type === 'const' && k.c.deps.size === 0) {
      try {
        const v = val(k.c);
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
        r.k.type === 'fractal' || r.k.type === 'const' || r.k.type === 'pt' || r.k.type === 'pts'
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
  // An expression with nothing to plot against, like `apples + 10`, shows its value.
  for (const r of S.rows) {
    const k = r.k;
    if (r.err || !k?.bare || k.filter || k.reg || !coordFree(r.uses)) continue;
    k.type = 'calc';
    k.c = k.bare;
    calcInfo(r);
  }
  fitPass();
  lregPass();
  for (const r of S.rows) {
    showError(r);
    sliders(r);
    fractalControls(r);
    tableUI(r);
    geoUI(r);
    regCard(r);
  }
  if (globalThis.document?.getElementById('rows')?.childElementCount) syncBlank();
  updateStatus();
  S.dirty = true;
  kick();
  saveSoon();
  scheduleHistory();
}
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
function calcInfo(r) {
  try {
    S.env.cache = nullObj();
    r.info = '= ' + calcFmt(ddValue(r.k.c, val));
  } catch (e) {
    r.err = e.message;
  }
}
function rangeFor(v) {
  const R = Math.max(10, 10 ** Math.ceil(Math.log10(Math.abs(v) + 1)));
  return {
    min: -R,
    max: R,
  };
}
function sliderRange(n, v, lo, hi) {
  const R = S.ranges[n];
  if (R) return { min: Math.min(R.min, v), max: Math.max(R.max, v), step: R.step };
  return { ...(lo < hi ? { min: lo, max: hi } : rangeFor(v)), step: 0 };
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
  S.rows.forEach(r => {
    r.mesh = null;
    if (r.k?.type === 'calc' && !r.err) {
      calcInfo(r);
      showError(r);
    }
    if (r.k?.type === 'ggb') {
      try {
        geoEval(r);
      } catch {}
      if (r.cardVer !== r.geoVer) geoUI(r);
    }
    decorate(r);
    if (r.k?.type === 'fractal') {
      r.err = '';
      r.slEl?.querySelector('.fractal-card')?.remove();
      fractalControls(r);
      showError(r);
    }
  });
  syncSliders();
  kick();
  saveSoon();
}
function lregPass() {
  for (const r of S.rows) {
    const k = r.k;
    if (!k || k.type !== 'lreg' || r.err || r.off) continue;
    const ps = [...r.uses].filter(n => own(S.vars, n)),
      orig = ps.map(n => S.vars[n]);
    try {
      const res = () => {
        S.env.cache = nullObj();
        return k.L.map((c, i) => val(c) - val(k.R[i]));
      };
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
      r.stat = {
        params: ps.map(p => [p, S.vars[p]]),
        stats: [['RMSE', Math.sqrt(sse(e) / (e.length || 1))]],
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
function fitPass() {
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
const repairExpression = s => {
  let t = s;
  for (let i = 0; i < 5; i++)
    t = t
      .replace(/\^\(\s*\)/g, '')
      .replace(/\/\(\s*\)/g, '')
      .replace(/[+\-*/^=<>,~]\s*(\)*)$/, '$1')
      .replace(/\(\s*\)$/, '');
  const o = (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
  return o > 0 ? t + ')'.repeat(o) : t;
};
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
  try {
    return compileExpr(source, functionNames, defined);
  } catch (err) {
    if (typeof source === 'string' && document.activeElement?.closest?.('.row')) {
      const f = repairExpression(source);
      if (f !== source && f.trim()) {
        try {
          return compileExpr(f, functionNames, defined);
        } catch {}
      }
    }
    throw err;
  }
}
