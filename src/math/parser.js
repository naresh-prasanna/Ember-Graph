import {
  constants,
  coords,
  emptyCalls,
  forbidden,
  listFns,
  math,
  normalize,
  nullObj,
  own,
  special,
  textNotation,
} from './catalog.js';
import { PROMOTE, complexFns, complexOp, cx, imOf, isComplex, reOf } from './complex.js';
import { Dist, distStat, METHODS } from './distributions.js';
import { calcFmt } from './format.js';
import { Matrix, Point, TEST_PROPS, TTest, negate, valueOp } from './values.js';

const KEYWORDS = { with: 'with', for: 'for', and: '&&', or: '||' };
// What can follow a dot: D.cdf(1), p.x, ttest(L).p.
const PROPS = new Set([...METHODS, 'x', 'y', ...TEST_PROPS]);
export const keywords = new Set(Object.keys(KEYWORDS));

// What an empty box stands for, by its position in the call the editor saves.
const MISSING = {
  integral: ['Add what to integrate', 'Add the variable', 'Add the lower bound', 'Add the upper bound'],
  sum: ['Add what to sum', 'Add the counter', 'Add where n starts', 'Add where n ends'],
  prod: ['Add what to multiply', 'Add the counter', 'Add where n starts', 'Add where n ends'],
  nthroot: ['Add the number under the root', 'Add the root’s index'],
  deriv: ['Add what to differentiate', 'Add the variable'],
  tone: ['Add a frequency', 'Add a volume, or remove the comma'],
};
const uses = (node, name) =>
  !!node &&
  typeof node === 'object' &&
  ((node.k === 'name' && node.n === name) || Object.values(node).some(v => uses(v, name)));
/* ∫ₐᵇ f: five-point Gauss–Legendre on panels a quarter wide. Exact for polynomials up to degree 9 and
   never evaluates at the ends, where 1/√x and friends blow up. A graph asks for one integral per point drawn,
   so the number of evaluations is kept small. */
const GX = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664],
  GW = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891],
  // A three-point rule on the outer and middle nodes, exact to degree 3: a free second opinion on each panel.
  G3 = [2 - 2 / (3 * GX[3] ** 2), 0, 0, 1 / (3 * GX[3] ** 2), 1 / (3 * GX[3] ** 2)];
/* One panel. Where the two rules disagree it is halved. Across a jump or a singularity like 1/√x the
   disagreement shrinks as the halves narrow; across a pole like 1/(x − a) it never does, and there is no area. */
function panel(f, a, b, depth, first, left) {
  const h = (b - a) / 2,
    c = a + h;
  let s5 = 0,
    s3 = 0,
    l1 = 0;
  for (let j = 0; j < 5; j++) {
    const y = f(c + GX[j] * h);
    s5 += GW[j] * y;
    s3 += G3[j] * y;
    l1 += GW[j] * Math.abs(y);
  }
  const err = Math.abs(s5 - s3) * Math.abs(h);
  left.n -= 5;
  if (!Number.isFinite(s5)) return NaN;
  // The three-point rule is far less exact, so a small disagreement still means the five-point sum is good.
  if (!(err <= 1e-3 * l1 * Math.abs(h) + 1e-13) && left.n > 0) {
    first ??= err;
    if (depth >= 30) {
      if (err < 0.1 * first) return s5 * h;
      left.fail ??= c;
      return NaN;
    }
    return panel(f, a, c, depth + 1, first, left) + panel(f, c, b, depth + 1, first, left);
  }
  return s5 * h;
}
/* `out.fail`, when the integral runs into a pole, is about where the pole is. */
function quad(f, a, b, least = 4, out) {
  if (a === b) return 0;
  const m = Math.min(48, Math.max(least, Math.ceil(4 * Math.abs(b - a)))),
    h = (b - a) / m,
    left = { n: 3000 };
  let s = 0;
  for (let i = 0; i < m && !Number.isNaN(s); i++)
    s += panel(f, a + i * h, a + (i + 1) * h, 0, undefined, left);
  if (out) out.fail = left.fail;
  return s;
}
const namesOf = new WeakMap(),
  runs = new WeakMap();
function namesIn(node) {
  let s = namesOf.get(node);
  if (!s) {
    s = new Set();
    const walk = n => {
      if (!n || typeof n !== 'object') return;
      if (n.k === 'name') s.add(n.n);
      Object.values(n).forEach(walk);
    };
    walk(node);
    namesOf.set(node, s);
  }
  return s;
}
/* ∫ from lo to b for the integral `node`. A graph asks for one b after another along the curve, so when nothing
   but b has changed (same sliders, same list element, an integrand free of the other coordinates) the area
   carries on from the last b asked for: each point drawn costs one short step instead of a whole integral. */
function area(node, f, lo, b, scope, nm, env) {
  const names = namesIn(node.a[0]),
    branch = scope[BRANCH];
  if (Object.keys(scope).some(k => k !== nm && names.has(k))) return quad(f, lo, b);
  const run = runs.get(node),
    same = run && run.cache === env.cache && run.branch === branch && run.lo === lo,
    // Past a pole the area is undefined for good, on that side of lo: ∫₀ˣ tan(t²) dt stops at ±√(π/2).
    dead = same ? run.dead : {},
    side = Math.sign(b - lo);
  if (side && dead[side] !== undefined && Math.abs(b - lo) >= Math.abs(dead[side] - lo)) return NaN;
  const out = {};
  let F;
  if (same && Number.isFinite(run.F) && Math.abs(b - run.b) < Math.abs(b - lo))
    F = run.F + quad(f, run.b, b, 1, out);
  else F = quad(f, lo, b, 4, out);
  if (Number.isNaN(F) && side && out.fail !== undefined) dead[side] = out.fail;
  runs.set(node, { cache: env.cache, branch, lo, b, F, dead });
  return F;
}

const SYMBOL_NAME = /^(?:pi|tau|theta|alpha|beta|gamma|delta|lambda|sigma|phi|omega)$/;
function withUnit(n, known) {
  const symbol = p => SYMBOL_NAME.test(p) || known(p);
  if (/^[a-zA-Z]{2}$/.test(n) && n.includes('i')) return [...n];
  if (n[0] === 'i' && symbol(n.slice(1))) return ['i', n.slice(1)];
  if (n.at(-1) === 'i' && symbol(n.slice(0, -1))) return [n.slice(0, -1), 'i'];
  return null;
}
/* Pratt parser: exponentiation is right associative; -x^2 means -(x^2).
   Implicit multiplication binds like *, and chained comparisons are pairwise. */
export function compileExpr(source, functionNames = new Set(), defined = new Set()) {
  const s = normalize(source),
    tokens = [];
  let p = 0;
  if (s.length > 2000) throw Error('Expression is too long (maximum 2,000 characters)');
  while (p < s.length) {
    if (/\s/.test(s[p])) {
      p++;
      continue;
    }
    const tail = s.slice(p);
    let m;
    if ((m = tail.match(/^(?:\d+(?:\.(?!\.)\d*)?|\.\d+)(?:[eE][+-]?\d+)?/))) {
      tokens.push({
        k: 'num',
        v: Number(m[0]),
        raw: m[0],
      });
      p += m[0].length;
    } else if ((m = tail.match(/^[a-zA-Z_][a-zA-Z_0-9]*/))) {
      if (forbidden.has(m[0])) throw Error('Reserved name: ' + m[0]);
      // Words with a meaning of their own: a x with a = 2, [n² for n = [1...5]], x > 0 and y > 0.
      if (own(KEYWORDS, m[0])) {
        tokens.push({ k: KEYWORDS[m[0]] });
        p += m[0].length;
        continue;
      }
      // As in Desmos, mx or ax1 written without a space is m·x or a·x1, unless the name is defined.
      const merged =
        !defined.has(m[0]) &&
        !functionNames.has(m[0]) &&
        !own(math, m[0]) &&
        !own(constants, m[0]) &&
        !special.has(m[0]) &&
        m[0].match(/^([a-zA-Z]{1,2})([xyt]\d*)$/);
      // pix is π·x, but abx is a·b·x.
      const known = n => own(constants, n) || defined.has(n),
        callable = n => own(math, n) || special.has(n) || functionNames.has(n);
      let names = merged ? [...(known(merged[1]) ? [merged[1]] : merged[1]), merged[2]] : [m[0]];
      // xsin(x) is x·sin(x) and 2πrcos(t) is 2π·r·cos(t): letters run into a function's name before its (.
      if (!merged && tail[m[0].length] === '(' && !callable(m[0]) && !known(m[0]))
        for (let j = 1; j < m[0].length; j++) {
          const pre = m[0].slice(0, j),
            fn = m[0].slice(j);
          if (callable(fn) && /^[a-zA-Z]+$/.test(pre)) {
            names = [...(known(pre) ? [pre] : pre), fn];
            break;
          }
        }
      // As in Desmos, bi is b·i and itheta is i·θ: the imaginary unit runs into the name beside it.
      if (names.length === 1 && !known(m[0]) && !callable(m[0]) && !special.has(m[0]))
        names = withUnit(m[0], known) || names;
      for (const v of names)
        tokens.push({
          k: 'id',
          v,
        });
      p += m[0].length;
    } else if ((m = tail.match(/^(?:<=|>=|!=|==|&&|\|\||\.\.\.|…|\.(?=[a-zA-Z])|[+\-*/%^(),<>!'[\]=])/))) {
      tokens.push({
        k: m[0] === '…' ? '...' : m[0],
      });
      p += m[0].length;
    } else if (s[p] === '.') throw Error('After a dot comes a property, as in normaldist().cdf(1) or p.x');
    else throw Error('Unsupported character: ' + s[p]);
  }
  tokens.push({
    k: 'end',
  });
  let i = 0,
    depth = 0;
  const deps = new Set(),
    bound = [];
  const peek = () => tokens[i].k,
    unexpected = k =>
      k === ','
        ? 'A comma can only separate the two coordinates of a point, like (x, y), the items of a list, or the inputs of a function'
        : k === ')' || k === ']'
          ? `There is a ${k} without a matching ${k === ')' ? '(' : '['}`
          : k === '...'
            ? 'Use ... inside a list, like [1...10]'
            : k === 'end'
              ? 'The expression is unfinished'
              : 'Unexpected ' + k,
    take = k => {
      if (peek() !== k)
        throw Error(
          (k === ')' || k === ']') && peek() !== ','
            ? `A ${k === ')' ? '(' : '['} is missing its closing ${k}`
            : unexpected(peek()),
        );
      return tokens[i++];
    };
  // After the opening [: a list [a, b, c], or a range [a...b] / [a, b ... c] whose step is b − a. As in Desmos,
  // more terms may lead in, [2, 4, 6, 8, ... 100], as long as they go up in equal steps.
  function list(index = false) {
    const items = [];
    let end = null;
    if (peek() !== ']')
      while (true) {
        if (peek() === '...') {
          i++;
          if (peek() === ',') i++;
          if (!items.length) throw Error('Write a range like [1...10], or [0, 0.5 ... 3] to choose the step');
          if (peek() === ']') throw Error('Add where the range ends, like [1, 2, 3 ... 10]');
          end = expr();
          break;
        }
        items.push(expr());
        // [n² for n = [1...5]] builds a list from every value of n.
        if (peek() === 'for' && items.length === 1) {
          i++;
          const binds = bindings('for');
          take(']');
          return { k: 'comp', a: items[0], binds };
        }
        if (peek() === ',') i++;
        else if (peek() !== '...') break;
      }
    take(']');
    if (end) return { k: 'range', a: items[0], s: items[1] || null, more: items.slice(2), b: end };
    // [[1, 2], [3, 4]] is a matrix, one inner list per row.
    if (!index && items.length && items.every(x => x.k === 'list')) {
      if (items.some(x => x.a.length !== items[0].a.length || !x.a.length))
        throw Error('Every row of a matrix needs the same number of entries');
      return { k: 'matrix', a: items.map(x => x.a) };
    }
    return { k: 'list', a: items };
  }
  // a = 1, b = 2 after `with` or `for`. The names are local, so they never become sliders.
  function bindings(word) {
    const out = [];
    do {
      const t = tokens[i++];
      if (t.k !== 'id' || peek() !== '=')
        throw Error(
          `After ${word}, name a variable and its value, like ${word} a = ${word === 'for' ? '[1...5]' : '2'}`,
        );
      i++;
      out.push([t.v, expr(6)]);
    } while (peek() === ',' && tokens[i + 1].k === 'id' && tokens[i + 2].k === '=' && ++i);
    bound.push(...out.map(b => b[0]));
    return out;
  }
  function expr(min = 0) {
    if (++depth > 80) throw Error('Expression is nested too deeply');
    let node,
      t = tokens[i++];
    if (t.k === 'num')
      node = {
        k: 'num',
        v: t.v,
        raw: t.raw,
      };
    else if (t.k === 'id') {
      deps.add(t.v);
      node = {
        k: 'name',
        n: t.v,
      };
      let prime = false;
      if (peek() === "'") {
        i++;
        prime = true;
      }
      // f(x), g(x) and h(x) are functions by convention; if there is no such function yet, that is the
      // mistake to point out, rather than reading f·(x) and offering f a slider.
      const unknownFn = /^[fgh]$/.test(t.v) && peek() === '(' && !functionNames.has(t.v) && !defined.has(t.v);
      if (unknownFn) deps.delete(t.v);
      if (
        prime ||
        (peek() === '(' && (own(math, t.v) || special.has(t.v) || functionNames.has(t.v) || unknownFn))
      ) {
        take('(');
        const args = [];
        if (peek() !== ')') {
          do {
            if (peek() === ')' || peek() === ',')
              throw Error(MISSING[t.v]?.[args.length] || `${t.v}( ) has an empty spot after a comma`);
            args.push(expr());
            if (peek() !== ',') break;
            i++;
          } while (true);
        }
        take(')');
        if (!prime && !args.length && !emptyCalls.has(t.v)) throw Error(`Put a value inside ${t.v}( )`);
        node = {
          k: 'call',
          n: prime ? 'deriv' : t.v,
          a: prime
            ? [
                {
                  k: 'name',
                  n: t.v,
                },
                ...args,
              ]
            : args,
        };
        // The counter of a sum, or the variable of an integral, belongs to it, unless a bound uses it too.
        if (
          ['sum', 'prod', 'integral'].includes(t.v) &&
          args.length === 4 &&
          args[1].k === 'name' &&
          !uses(args[2], args[1].n) &&
          !uses(args[3], args[1].n)
        )
          deps.delete(args[1].n);
      }
    } else if (t.k === '(') {
      if (peek() === ')') throw Error('Put something inside the brackets');
      if (peek() === ',') throw Error('Add the x-coordinate');
      node = expr();
      // (x, y) is a point.
      if (peek() === ',') {
        i++;
        if (peek() === ')') throw Error('Add the y-coordinate');
        node = { k: 'point', a: [node, expr()] };
      }
      take(')');
    } else if (t.k === '[') node = list();
    else if (t.k === '+' || t.k === '-' || t.k === '!')
      node = {
        k: 'unary',
        op: t.k,
        a: expr(25),
      };
    else throw Error(unexpected(t.k));
    // L[2], L[2...4] and L[L > 0] index a list; after a plain number, 2[1, 2] multiplies.
    // D.cdf(1) asks a distribution a question.
    while (true) {
      if (
        peek() === '[' &&
        (t.k === '(' || ['name', 'list', 'range', 'index', 'call', 'method'].includes(node.k))
      ) {
        i++;
        node = { k: 'index', a: node, i: list(true) };
      } else if (peek() === '.' && tokens[i + 1].k === 'id') {
        const n = tokens[i + 1].v,
          args = [];
        if (!PROPS.has(n))
          throw Error(`There is no .${n}: distributions have .pdf, .cdf and .random, and points .x and .y`);
        i += 2;
        if (peek() === '(') {
          i++;
          if (peek() !== ')')
            do {
              args.push(expr());
              if (peek() !== ',') break;
              i++;
            } while (true);
          take(')');
        }
        node = { k: 'method', a: node, n, args };
      } else break;
    }
    // n! is a factorial; it holds tighter than ^, so 2^3! is 2⁶.
    while (peek() === '!') {
      i++;
      node = { k: 'call', n: 'fact', a: [node], postfix: true };
    }
    while (true) {
      let op = peek(),
        implicit = op === 'num' || op === 'id' || op === '(' || op === '[',
        bp = implicit
          ? 20
          : {
              '||': 2,
              '&&': 3,
              '<': 5,
              '>': 5,
              '<=': 5,
              '>=': 5,
              '==': 5,
              '!=': 5,
              '+': 10,
              '-': 10,
              '*': 20,
              '/': 20,
              '%': 20,
              '^': 30,
            }[op];
      if (bp === undefined || bp < min) break;
      if (bp === 5) {
        const a = [node],
          ops = [];
        while (['<', '>', '<=', '>=', '==', '!='].includes(peek())) {
          ops.push(tokens[i++].k);
          a.push(expr(6));
        }
        node = {
          k: 'cmp',
          a,
          ops,
        };
        continue;
      }
      if (implicit) op = '*';
      else i++;
      const rhs = expr(op === '^' ? bp : bp + 1);
      node = {
        k: 'binary',
        op,
        a: node,
        b: rhs,
      };
    }
    depth--;
    return node;
  }
  if (!source.trim()) throw Error('Empty expression');
  let ast = expr();
  // a·x² with a = 3: the body evaluated with those values.
  while (peek() === 'with') {
    i++;
    ast = { k: 'with', a: ast, binds: bindings('with') };
  }
  if (peek() !== 'end') throw Error(unexpected(peek()));
  for (const n of bound) deps.delete(n);
  return {
    ast,
    deps,
  };
}
const compare = (a, op, b) =>
  op === '<'
    ? a < b
    : op === '>'
      ? a > b
      : op === '<='
        ? a <= b
        : op === '>='
          ? a >= b
          : op === '=='
            ? a === b
            : a !== b;
// Complex numbers have no order, only equality.
function complexCompare(v, ops) {
  return ops.every((op, i) => {
    if (op !== '==' && op !== '!=')
      throw Error('Complex numbers have no order: compare abs(z) or re(z) instead');
    return (complexOp('-', v[i], v[i + 1]) === 0) === (op === '==');
  });
}
// A function given a complex number uses its complex version. Where a value is wanted rather than a graph,
// √(−4) leaves the reals for 2i instead of being undefined.
function mathCall(n, args, env) {
  if (args.some(isComplex)) {
    if (!own(complexFns, n)) throw Error(`${n} doesn't take complex numbers`);
    return complexFns[n](...args);
  }
  const v = math[n](...args);
  return Number.isNaN(v) && env.complex && PROMOTE.has(n) && args.every(Number.isFinite)
    ? complexFns[n](...args)
    : v;
}
/* Lists: a value is a number or an array of numbers. Arithmetic and ordinary functions work element by
   element, stopping at the shorter list. A row that uses a list is drawn once per element; the copy being
   drawn sits in the scope under BRANCH, and every list met while evaluating it gives up that one element.
   Summaries (total, mean, …) and indexing read whole lists, so they evaluate their inputs without BRANCH. */
export const BRANCH = Symbol('branch');
const MAX_LIST = 10000,
  each = (vals, f) => {
    const n = Math.min(...vals.filter(Array.isArray).map(v => v.length));
    return Array.from({ length: n }, (_, j) => f(...vals.map(v => (Array.isArray(v) ? v[j] : v))));
  },
  finite = (v, what) => {
    if (Array.isArray(v)) throw Error(`${what} needs a number here, not a list`);
    return v;
  },
  element = (L, j) => {
    j = Math.round(j);
    return j >= 1 && j <= L.length ? L[j - 1] : NaN;
  };
export function evaluate(
  node,
  scope,
  env,
  stack = new Set(),
  budget = {
    n: 20000,
  },
) {
  if (--budget.n < 0) throw Error('Calculation is too complex');
  const ev = a => evaluate(a, scope, env, stack, budget),
    branch = scope[BRANCH],
    pick = v => (branch === undefined || !Array.isArray(v) ? v : (v[branch] ?? NaN)),
    whole = a =>
      evaluate(a, branch === undefined ? scope : { ...scope, [BRANCH]: undefined }, env, stack, budget);
  switch (node.k) {
    case 'num':
      return node.v;
    case 'name': {
      const n = node.n;
      if (own(scope, n)) return pick(scope[n]);
      if (own(constants, n)) return constants[n];
      if (own(math, n)) return math[n];
      if (env.fn.has(n)) return u => callUser(n, u, env, stack, budget, branch);
      if (own(env.cache, n)) return pick(env.cache[n]);
      if (env.def.has(n)) {
        if (stack.has(n)) throw Error('Circular definition: ' + n);
        const st = new Set(stack);
        st.add(n);
        // A definition is a value, not a graph, so z = √(−4) is 2i.
        const was = env.complex;
        env.complex = true;
        let v;
        try {
          v = evaluate(env.def.get(n).ast, nullObj(), env, st, budget);
        } finally {
          env.complex = was;
        }
        if (!Number.isFinite(v) && (typeof v !== 'object' || v === null)) {
          const why = Number.isNaN(v) && undefinedReason(env.def.get(n).ast, nullObj(), env);
          throw Error(why ? `${n} is undefined: ${why}` : n + ' is not a finite number');
        }
        env.cache[n] = v;
        return pick(v);
      }
      if (own(env.vars, n)) return env.vars[n];
      // In an x–y equation, r and θ are the polar coordinates of the point.
      if (own(scope, 'x') && own(scope, 'y')) {
        if (n === 'r') return Math.hypot(scope.x, scope.y);
        if (n === 'theta') return Math.atan2(scope.y, scope.x);
      }
      throw Error('Undefined variable: ' + n);
    }
    case 'list': {
      const item = x => {
        const v = whole(x);
        if (Array.isArray(v)) throw Error("A list can't contain lists");
        return v;
      };
      if (branch !== undefined) return branch < node.a.length ? item(node.a[branch]) : NaN;
      return node.a.map(item);
    }
    case 'range': {
      const a = finite(whole(node.a), 'A range'),
        b = finite(whole(node.b), 'A range'),
        step = node.s ? finite(whole(node.s), 'A range') - a : b >= a ? 1 : -1;
      if (![a, b, step].every(Number.isFinite)) throw Error('A range needs finite numbers');
      if (step === 0 || (b - a) / step < 0) throw Error('This range never reaches its end');
      (node.more || []).forEach((e, j) => {
        const v = finite(whole(e), 'A range'),
          want = +(a + (j + 2) * step).toPrecision(15);
        if (!(Math.abs(v - want) <= 1e-9 * Math.max(1, Math.abs(v))))
          throw Error(
            `A range goes up in equal steps of ${calcFmt(step)}, so ${calcFmt(want)} comes next, not ${calcFmt(v)}`,
          );
      });
      const n = Math.floor((b - a) / step + 1e-9) + 1;
      if (n > MAX_LIST) throw Error('A list can have at most 10,000 elements');
      const at = j => +(a + j * step).toPrecision(15);
      if (branch !== undefined) return branch < n ? at(branch) : NaN;
      return Array.from({ length: n }, (_, j) => at(j));
    }
    case 'index': {
      const L = whole(node.a);
      if (!Array.isArray(L)) throw Error('Only a list can be indexed, like L[2]');
      const at = node.i.k === 'list' && node.i.a.length === 1 ? whole(node.i.a[0]) : whole(node.i);
      if (!Array.isArray(at)) return element(L, at);
      // L[L > 0] keeps the elements whose condition holds.
      return pick(
        at.some(v => typeof v === 'boolean') ? L.filter((_, j) => at[j]) : at.map(j => element(L, j)),
      );
    }
    case 'unary': {
      const a = ev(node.a),
        f = v =>
          node.op === '-' ? (negate(v) ?? -v) : node.op === '+' ? (typeof v === 'object' ? v : +v) : !v;
      return Array.isArray(a) ? a.map(f) : f(a);
    }
    case 'point': {
      const [x, y] = node.a.map(ev),
        f = (x, y) => {
          if (typeof x !== 'number' || typeof y !== 'number') throw Error('A point needs two numbers');
          return new Point(x, y);
        };
      return Array.isArray(x) || Array.isArray(y) ? each([x, y], f) : f(x, y);
    }
    case 'matrix':
      return new Matrix(
        node.a.map(row =>
          row.map(e => {
            const v = whole(e);
            if (typeof v !== 'number') throw Error('A matrix holds numbers');
            return v;
          }),
        ),
      );
    case 'with': {
      const inner = { ...scope };
      for (const [n, e] of node.binds) inner[n] = evaluate(e, scope, env, stack, budget);
      return evaluate(node.a, inner, env, stack, budget);
    }
    // Every combination of the values, the first name changing slowest: [(i, j) for i = [1, 2], j = [1, 2]].
    case 'comp': {
      let combos = [{ ...scope, [BRANCH]: undefined }];
      for (const [n, e] of node.binds) {
        const vals = [whole(e)].flat();
        combos = combos.flatMap(sc => vals.map(v => ({ ...sc, [n]: v })));
        if (combos.length > MAX_LIST) throw Error('A list can have at most 10,000 elements');
      }
      const out = combos.map(sc => {
        const v = evaluate(node.a, sc, env, stack, budget);
        if (Array.isArray(v)) throw Error("A list can't contain lists");
        return v;
      });
      return pick(out);
    }
    case 'binary': {
      const a = ev(node.a);
      if (node.op === '&&') return a && ev(node.b);
      if (node.op === '||') return a || ev(node.b);
      const b = ev(node.b),
        f = (a, b) => {
          const v = valueOp(node.op, a, b);
          if (v !== undefined) return v;
          switch (node.op) {
            case '+':
              return a + b;
            case '-':
              return a - b;
            case '*':
              return a * b;
            case '/':
              return a / b;
            case '%':
              return a % b;
            case '^': {
              const v = a ** b;
              return Number.isNaN(v) && env.complex && a < 0 ? complexOp('^', a, b) : v;
            }
          }
        };
      return Array.isArray(a) || Array.isArray(b) ? each([a, b], f) : f(a, b);
    }
    case 'cmp': {
      const vals = node.a.map(ev),
        chain = (...v) => {
          if (v.some(isComplex)) return complexCompare(v, node.ops);
          for (let i = 0; i < node.ops.length; i++) if (!compare(v[i], node.ops[i], v[i + 1])) return false;
          return true;
        };
      return vals.some(Array.isArray) ? each(vals, chain) : chain(...vals);
    }
    case 'method': {
      const D = ev(node.a),
        args = node.args.map(ev);
      // Properties without inputs: p.x, ttest(L).p.
      if (!METHODS.has(node.n)) {
        if (args.length) throw Error(`.${node.n} takes no inputs`);
        const prop = v => {
          if (Number.isNaN(v)) return NaN;
          if ((node.n === 'x' || node.n === 'y') && v instanceof Point) return v[node.n];
          if (v instanceof TTest && node.n !== 'x' && node.n !== 'y') return v[node.n];
          throw Error(
            node.n === 'x' || node.n === 'y'
              ? `.${node.n} belongs to a point`
              : `.${node.n} belongs to a t-test`,
          );
        };
        return Array.isArray(D) ? D.map(prop) : prop(D);
      }
      const ask = d => {
        if (!(d instanceof Dist))
          throw Error(`.${node.n}( ) belongs to a distribution, as in normaldist(0, 1).${node.n}(…)`);
        return d;
      };
      if (node.n === 'random') {
        if (args.some(Array.isArray)) throw Error('random takes a count and a seed, not lists');
        return Number.isNaN(D) ? NaN : pick(ask(D).random(...args));
      }
      const arity = node.n === 'pdf' ? [1] : [1, 2];
      if (!arity.includes(args.length))
        throw Error(node.n === 'pdf' ? '.pdf(x) takes one value' : 'Use .cdf(x), or .cdf(a, b) for a range');
      const f = (d, ...a) => (Number.isNaN(d) ? NaN : ask(d)[node.n](...a));
      return Array.isArray(D) || args.some(Array.isArray) ? each([D, ...args], f) : f(D, ...args);
    }
    case 'call': {
      if (node.n === 'sum' || node.n === 'prod') {
        if (node.a.length !== 4 || node.a[1].k !== 'name') throw Error(node.n + '(expression, n, from, to)');
        const nm = node.a[1].n,
          a = Math.round(ev(node.a[2])),
          b = Math.round(ev(node.a[3]));
        if (b - a > 1e5) throw Error('Range too large');
        let acc = node.n === 'sum' ? 0 : 1,
          size = 0;
        for (let i = a; i <= b; i++) {
          const v = evaluate(
            node.a[0],
            {
              ...scope,
              [nm]: i,
            },
            env,
            stack,
            budget,
          );
          acc = valueOp(node.n === 'sum' ? '+' : '*', acc, v) ?? (node.n === 'sum' ? acc + v : acc * v);
          if (node.n === 'sum' && (typeof v === 'number' || isComplex(v)))
            size += Math.hypot(reOf(v), imOf(v));
        }
        // The fifth roots of unity add up to 0: what rounding leaves of a cancelled part is not a value.
        if (size && Number.isFinite(size) && (typeof acc === 'number' || isComplex(acc))) {
          const snap = p => (Math.abs(p) < 1e-13 * size ? 0 : p);
          acc = cx(snap(reOf(acc)), snap(imOf(acc)));
        }
        return acc;
      }
      // ∫ₐᵇ body dx and d/dx body: the body is worked out with the variable moved, in one reused scope.
      let inner = null;
      const at = (nm, v) => {
        inner ||= { ...scope };
        inner[nm] = v;
        return evaluate(node.a[0], inner, env, stack, budget);
      };
      if (node.n === 'integral' && node.a.length === 4) {
        if (node.a[1].k !== 'name') throw Error('After the expression comes its variable: ∫ … dx');
        const nm = node.a[1].n,
          a = ev(node.a[2]),
          b = ev(node.a[3]);
        if (Array.isArray(a) || Array.isArray(b)) throw Error('Integral bounds must be numbers');
        if (isComplex(a) || isComplex(b))
          throw Error('An integral runs along the real line here, so its bounds have to be real numbers');
        if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
        return area(node, v => at(nm, v), a, b, scope, nm, env);
      }
      // ∫ body dx with no bounds: the antiderivative that is 0 at 0, i.e. the area from 0 to x.
      if (node.n === 'integral' && node.a.length === 2 && node.a[1].k === 'name') {
        const nm = node.a[1].n,
          b = ev(node.a[1]);
        if (Array.isArray(b)) throw Error('The variable of an integral must be a number');
        if (!Number.isFinite(b)) return NaN;
        return area(node, v => (r => (typeof r === 'function' ? r(v) : r))(at(nm, v)), 0, b, scope, nm, env);
      }
      if (
        node.n === 'deriv' &&
        node.a.length === 2 &&
        node.a[1].k === 'name' &&
        !(node.a[0].k === 'name' && typeof ev(node.a[0]) === 'function')
      ) {
        const nm = node.a[1].n,
          a = ev(node.a[1]),
          h = 1e-5 * (1 + Math.abs(a));
        return (at(nm, a + h) - at(nm, a - h)) / (2 * h);
      }
      if (node.n === 'deriv' || node.n === 'integral') {
        const arity = node.n === 'deriv' ? 2 : 3;
        if (node.a.length !== arity) throw Error(node.n + ' needs ' + arity + ' arguments');
        const f = ev(node.a[0]);
        if (typeof f !== 'function') throw Error('Use a function name, e.g. ' + node.n + '(f,...)');
        const a = ev(node.a[1]);
        if (node.n === 'deriv') {
          const h = 1e-5 * (1 + Math.abs(a));
          return (f(a + h) - f(a - h)) / (2 * h);
        }
        const b = ev(node.a[2]);
        return Number.isFinite(a) && Number.isFinite(b) ? quad(f, a, b) : NaN;
      }
      if (own(listFns, node.n)) {
        const args = node.a.map(whole);
        if (args[0] instanceof Dist) return pick(distStat(node.n, args[0], args.slice(1)));
        if (args.some(a => a instanceof Dist)) throw Error(`${node.n} takes the distribution first`);
        return pick(listFns[node.n](...args));
      }
      if (own(math, node.n)) {
        const args = node.a.map(ev);
        return args.some(Array.isArray)
          ? each(args, (...a) => mathCall(node.n, a, env))
          : mathCall(node.n, args, env);
      }
      if (stack.has(node.n)) throw Error('Circular function: ' + node.n);
      const fn = env.fn.get(node.n);
      if (!fn) throw Error(`${node.n} isn't defined. Add a row like ${node.n}(x) = x²`);
      if (node.a.length !== 1) throw Error('User functions need one argument');
      const u = ev(node.a[0]);
      return Array.isArray(u)
        ? u.map(v => callUser(node.n, v, env, stack, budget, branch))
        : callUser(node.n, u, env, stack, budget, branch);
    }
  }
  throw Error('Invalid expression');
}
function callUser(n, u, env, stack, budget, branch) {
  if (stack.has(n)) throw Error('Circular function: ' + n);
  const fn = env.fn.get(n),
    scope = {
      [fn.param]: u,
      [BRANCH]: branch,
    },
    next = new Set([...stack, n]),
    v = evaluate(fn.ast, scope, env, next, budget);
  return fn.row.k.filter &&
    !evaluate(
      fn.row.k.filter.ast,
      {
        x: u,
        y: v,
        ...scope,
      },
      env,
      next,
      budget,
    )
    ? NaN
    : v;
}
/* The real-number part of the language as plain closures, since drawing evaluates one expression hundreds of
   thousands of times a second. `keys` are the names the scope will hold. null wherever the expression leaves
   that part (lists, complex numbers, points, sums, integrals), which evaluate then handles. Definitions are read
   once, so a compiled expression is good for as long as env.cache, and only while env.complex is off. */
const REAL = new Set(
  (
    'sin cos tan asin acos atan atan2 sinh cosh tanh exp sqrt abs floor ceil round sign pow cbrt hypot asinh ' +
    'acosh atanh log2 ln log arcsin arccos arctan sec csc cot arcsec arccsc arccot sech csch coth nthroot mod ' +
    'fact ncr npr piece erf erfi Si Ci Ei li Shi Chi fresnelS fresnelC'
  )
    .split(' ')
    .filter(n => !own(listFns, n)),
);
const NOT_REAL = Symbol('not real');
export function compileReal(node, env, keys, branched = false) {
  const uses = [];
  try {
    const f = realFn(node, env, new Set(keys), new Set(), uses, branched);
    f.uses = uses;
    return f;
  } catch {
    return null;
  }
}
// Whether the function rows a compiled expression calls are still the ones compiled into it.
export const stillReal = (f, env) => f.uses.every(([n, fn]) => env.fn.get(n) === fn);
function realFn(node, env, keys, seen, uses, branched) {
  const go = n => realFn(n, env, keys, seen, uses, branched),
    // A list in a row drawn once per element gives the element of the copy being drawn.
    known = v => {
      if (typeof v === 'number') return () => v;
      if (!branched || !Array.isArray(v) || !v.every(x => typeof x === 'number')) throw NOT_REAL;
      return s => v[s[BRANCH]] ?? NaN;
    };
  switch (node.k) {
    case 'num': {
      const v = node.v;
      if (typeof v !== 'number') throw NOT_REAL;
      return () => v;
    }
    case 'list':
    case 'range':
      return known(evaluate(node, nullObj(), env));
    case 'name': {
      const n = node.n;
      if (keys.has(n)) return s => s[n];
      if (own(constants, n)) {
        const v = constants[n];
        if (typeof v !== 'number') throw NOT_REAL;
        return () => v;
      }
      if (own(math, n) || env.fn.has(n)) throw NOT_REAL;
      if (own(env.cache, n) || env.def.has(n)) return known(evaluate(node, nullObj(), env));
      if (own(env.vars, n)) {
        if (typeof env.vars[n] !== 'number') throw NOT_REAL;
        return () => env.vars[n];
      }
      if (keys.has('x') && keys.has('y')) {
        if (n === 'r') return s => Math.hypot(s.x, s.y);
        if (n === 'theta') return s => Math.atan2(s.y, s.x);
      }
      throw NOT_REAL;
    }
    case 'unary': {
      const a = go(node.a);
      if (node.op === '-') return s => -a(s);
      if (node.op === '+') return s => +a(s);
      throw NOT_REAL;
    }
    case 'binary': {
      const a = go(node.a),
        b = go(node.b);
      switch (node.op) {
        case '+':
          return s => a(s) + b(s);
        case '-':
          return s => a(s) - b(s);
        case '*':
          return s => a(s) * b(s);
        case '/':
          return s => a(s) / b(s);
        case '%':
          return s => a(s) % b(s);
        case '^':
          return s => a(s) ** b(s);
      }
      throw NOT_REAL;
    }
    case 'cmp': {
      const vals = node.a.map(go),
        ops = node.ops;
      return s => {
        let a = vals[0](s);
        for (let i = 0; i < ops.length; i++) {
          const b = vals[i + 1](s);
          if (!compare(a, ops[i], b)) return false;
          a = b;
        }
        return true;
      };
    }
    case 'call': {
      const n = node.n;
      if (n === 'deriv') {
        const [body, v] = node.a;
        if (
          node.a.length !== 2 ||
          v.k !== 'name' ||
          (body.k === 'name' && (own(math, body.n) || env.fn.has(body.n)))
        )
          throw NOT_REAL;
        const nm = v.n,
          f = realFn(body, env, new Set([...keys, nm]), seen, uses, branched),
          at = go(v);
        return s => {
          const a = at(s),
            h = 1e-5 * (1 + Math.abs(a)),
            inner = { ...s };
          inner[nm] = a + h;
          const up = f(inner);
          inner[nm] = a - h;
          return (up - f(inner)) / (2 * h);
        };
      }
      if (special.has(n) || own(listFns, n)) throw NOT_REAL;
      if (own(math, n)) {
        if (!REAL.has(n)) throw NOT_REAL;
        const f = math[n],
          args = node.a.map(go);
        if (args.length === 1) {
          const [a] = args;
          return s => f(a(s));
        }
        if (args.length === 2) {
          const [a, b] = args;
          return s => f(a(s), b(s));
        }
        return s => f(...args.map(a => a(s)));
      }
      const fn = env.fn.get(n);
      if (!fn || node.a.length !== 1 || seen.has(n) || fn.row?.k?.filter) throw NOT_REAL;
      uses.push([n, fn]);
      const p = fn.param,
        u = go(node.a[0]),
        body = realFn(fn.ast, env, new Set([p]), new Set([...seen, n]), uses, branched);
      return branched ? s => body({ [p]: u(s), [BRANCH]: s[BRANCH] }) : s => body({ [p]: u(s) });
    }
  }
  throw NOT_REAL;
}
/* How many copies an expression draws: the length of the shortest list it uses element by element,
   or null when it uses none. Lists inside summaries such as total(L) don't count. */
export function listLength(node, env, seen = new Set()) {
  const shortest = (...ls) => ls.reduce((m, l) => (l === null ? m : m === null ? l : Math.min(m, l)), null),
    walk = n => listLength(n, env, seen),
    // undefined when the value can't be worked out without x, y or t.
    measure = n => {
      try {
        const v = evaluate(n, {}, env);
        return Array.isArray(v) ? v.length : null;
      } catch {
        return undefined;
      }
    };
  switch (node.k) {
    case 'list':
      return node.a.length;
    case 'range':
      return measure(node) ?? null;
    case 'index': {
      const known = measure(node);
      if (known !== undefined) return known;
      return walk(node.i.k === 'list' && node.i.a.length === 1 ? node.i.a[0] : node.i);
    }
    case 'name':
      return env.def.has(node.n) ? (measure(node) ?? null) : null;
    case 'unary':
      return walk(node.a);
    case 'binary':
      return shortest(walk(node.a), walk(node.b));
    case 'cmp':
      return shortest(...node.a.map(walk));
    case 'method':
      return node.n === 'random' ? (measure(node) ?? null) : shortest(walk(node.a), ...node.args.map(walk));
    case 'point':
      return shortest(...node.a.map(walk));
    case 'comp':
      return measure(node) ?? null;
    case 'with':
      return shortest(walk(node.a), ...node.binds.map(b => walk(b[1])));
    case 'call': {
      if (own(listFns, node.n)) return measure(node) ?? null;
      if (special.has(node.n)) return null;
      const args = node.a.map(walk),
        fn = env.fn.get(node.n);
      if (fn && !seen.has(node.n)) {
        seen.add(node.n);
        args.push(walk(fn.ast));
        seen.delete(node.n);
      }
      return shortest(...args);
    }
  }
  return null;
}
export function splitTop(s, separator = ',') {
  let depth = 0,
    out = [],
    start = 0;
  for (let i = 0; i < s.length; i++) {
    if ('([{'.includes(s[i])) depth++;
    if (')]}'.includes(s[i])) depth--;
    if (s[i] === separator && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
    if (depth < 0) throw Error('Unmatched bracket');
  }
  if (depth !== 0) throw Error('Unmatched bracket');
  out.push(s.slice(start));
  return out;
}
export function parts(text) {
  if (text.trim().startsWith('"'))
    return {
      body: text.trim(),
      filter: '',
    };
  let body = normalize(textNotation(text.trim())),
    filter = '';
  if (body.includes('{')) {
    const i = body.indexOf('{');
    if (!body.endsWith('}') || body.slice(i + 1, -1).includes('{'))
      throw Error('Use one restriction in braces');
    filter = body.slice(i + 1, -1);
    body = body.slice(0, i).trim();
    if (!filter.trim()) throw Error('Empty restriction');
    if (splitTop(filter).some(p => splitTop(p, ':').length === 2)) {
      body +=
        ' piece(' +
        splitTop(filter)
          .flatMap(p => {
            const q = splitTop(p, ':');
            return q.length === 2 ? q : [p];
          })
          .join(',') +
        ')';
      filter = '';
    }
  }
  return {
    body,
    filter,
  };
}
// xy, yx and ax read as products, as in Desmos, so `xy = 10` is a curve. x_y is the way to name a variable.
export const productName = n => /^(?:[a-zA-Z]|[xy]+)[xy]$/.test(n) && !own(math, n) && !own(constants, n);

const DOMAIN = {
  sqrt: v => v < 0 && 'the square root of a negative number isn’t a real number',
  ln: v => v <= 0 && 'logarithms need a positive number',
  log: v => v <= 0 && 'logarithms need a positive number',
  log2: v => v <= 0 && 'logarithms need a positive number',
  arcsin: v => Math.abs(v) > 1 && 'arcsin needs a value from −1 to 1',
  arccos: v => Math.abs(v) > 1 && 'arccos needs a value from −1 to 1',
  arcsec: v => Math.abs(v) < 1 && 'arcsec needs a value of at least 1 in size',
  arccsc: v => Math.abs(v) < 1 && 'arccsc needs a value of at least 1 in size',
  fact: v => v < 0 && Number.isInteger(v) && 'the factorial of a negative whole number is undefined',
  acosh: v => v < 1 && 'acosh needs a value of at least 1',
  atanh: v => Math.abs(v) >= 1 && 'atanh needs a value between −1 and 1',
};
const DIST_RULES = {
  normaldist: 'a normal distribution needs a positive standard deviation',
  tdist: 'a t distribution needs positive degrees of freedom',
  poissondist: 'a Poisson distribution needs a positive mean',
  binomialdist: 'a binomial distribution needs a whole number of trials and a probability from 0 to 1',
  uniformdist: 'a uniform distribution needs its lower end below its upper end',
};
// Why a value came out undefined: the innermost step that left the real numbers.
export function undefinedReason(node, scope, env) {
  const num = a => {
    try {
      const v = evaluate(a, scope, env);
      return typeof v === 'number' ? v : NaN;
    } catch {
      return NaN;
    }
  };
  const walk = n => {
    if (!n || typeof n !== 'object' || (n.k === 'call' && special.has(n.n))) return null;
    for (const c of [n.a, n.b, n.i, n.s].flat()) {
      const why = walk(c);
      if (why) return why;
    }
    if (n.k === 'call' && own(DOMAIN, n.n) && n.a.length === 1) return DOMAIN[n.n](num(n.a[0])) || null;
    if (n.k === 'call' && own(DIST_RULES, n.n)) {
      try {
        if (Number.isNaN(evaluate(n, scope, env))) return DIST_RULES[n.n];
      } catch {}
    }
    if (n.k === 'binary' && n.op === '/' && num(n.b) === 0) return 'it divides by zero';
    if (n.k === 'binary' && n.op === '^' && num(n.a) < 0 && !Number.isInteger(num(n.b)))
      return 'a negative number to a fractional power isn’t a real number';
    return null;
  };
  return walk(node);
}
export function definition(body) {
  let m;
  if ((m = body.match(/^([a-zA-Z_]\w*)\(\s*([a-zA-Z_]\w*)\s*\)\s*=([^=].*)$/)))
    return {
      name: m[1],
      param: m[2],
      rhs: m[3],
    };
  if ((m = body.match(/^([a-zA-Z_]\w*)\s*=([^=].*)$/))) {
    if (!coords.has(m[1]) && !productName(m[1]))
      return {
        name: m[1],
        rhs: m[2],
      };
  }
  return null;
}
