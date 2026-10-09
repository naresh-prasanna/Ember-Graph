import { constants, coords, forbidden, math, normalize, nullObj, own, special } from './catalog.js';

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
    if ((m = tail.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/))) {
      tokens.push({
        k: 'num',
        v: Number(m[0]),
        raw: m[0],
      });
      p += m[0].length;
    } else if ((m = tail.match(/^[a-zA-Z_][a-zA-Z_0-9]*/))) {
      if (forbidden.has(m[0])) throw Error('Reserved name: ' + m[0]);
      // As in Desmos, mx or ax1 written without a space is m·x or a·x1, unless the name is defined.
      const merged =
        !defined.has(m[0]) &&
        !functionNames.has(m[0]) &&
        !own(math, m[0]) &&
        !own(constants, m[0]) &&
        !special.has(m[0]) &&
        m[0].match(/^([a-zA-Z]{1,2})([xyt]\d*)$/);
      for (const v of merged ? [...merged[1], merged[2]] : [m[0]])
        tokens.push({
          k: 'id',
          v,
        });
      p += m[0].length;
    } else if ((m = tail.match(/^(?:<=|>=|!=|==|&&|\|\||[+\-*/%^(),<>!'])/))) {
      tokens.push({
        k: m[0],
      });
      p += m[0].length;
    } else throw Error('Unsupported character: ' + s[p]);
  }
  tokens.push({
    k: 'end',
  });
  let i = 0,
    depth = 0;
  const deps = new Set();
  const peek = () => tokens[i].k,
    unexpected = k =>
      k === ','
        ? 'A comma can only separate the two coordinates of a point, like (x, y), or the inputs of a function'
        : k === ')'
          ? 'There is a ) without a matching ('
          : k === 'end'
            ? 'The expression is unfinished'
            : 'Unexpected ' + k,
    take = k => {
      if (peek() !== k)
        throw Error(k === ')' && peek() !== ',' ? 'A ( is missing its closing )' : unexpected(peek()));
      return tokens[i++];
    };
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
      if (prime || (peek() === '(' && (own(math, t.v) || special.has(t.v) || functionNames.has(t.v)))) {
        take('(');
        const args = [];
        if (peek() !== ')') {
          do {
            args.push(expr());
            if (peek() !== ',') break;
            i++;
          } while (true);
        }
        take(')');
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
        if ((t.v === 'sum' || t.v === 'prod') && args[1]?.k === 'name') deps.delete(args[1].n);
      }
    } else if (t.k === '(') {
      node = expr();
      take(')');
    } else if (t.k === '+' || t.k === '-' || t.k === '!')
      node = {
        k: 'unary',
        op: t.k,
        a: expr(25),
      };
    else throw Error(unexpected(t.k));
    while (true) {
      let op = peek(),
        implicit = op === 'num' || op === 'id' || op === '(',
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
  const ast = expr();
  if (peek() !== 'end') throw Error(unexpected(peek()));
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
  const ev = a => evaluate(a, scope, env, stack, budget);
  switch (node.k) {
    case 'num':
      return node.v;
    case 'name': {
      const n = node.n;
      if (own(scope, n)) return scope[n];
      if (own(constants, n)) return constants[n];
      if (own(math, n)) return math[n];
      if (env.fn.has(n)) return u => callUser(n, u, env, stack, budget);
      if (own(env.cache, n)) return env.cache[n];
      if (env.def.has(n)) {
        if (stack.has(n)) throw Error('Circular definition: ' + n);
        const st = new Set(stack);
        st.add(n);
        const v = evaluate(env.def.get(n).ast, nullObj(), env, st, budget);
        if (!Number.isFinite(v)) throw Error(n + ' is not a finite number');
        env.cache[n] = v;
        return v;
      }
      if (own(env.vars, n)) return env.vars[n];
      // In an x–y equation, r and θ are the polar coordinates of the point.
      if (own(scope, 'x') && own(scope, 'y')) {
        if (n === 'r') return Math.hypot(scope.x, scope.y);
        if (n === 'theta') return Math.atan2(scope.y, scope.x);
      }
      throw Error('Undefined variable: ' + n);
    }
    case 'unary': {
      const a = ev(node.a);
      return node.op === '-' ? -a : node.op === '+' ? +a : !a;
    }
    case 'binary': {
      const a = ev(node.a);
      if (node.op === '&&') return a && ev(node.b);
      if (node.op === '||') return a || ev(node.b);
      const b = ev(node.b);
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
        case '^':
          return a ** b;
      }
      break;
    }
    case 'cmp': {
      let a = ev(node.a[0]);
      for (let i = 0; i < node.ops.length; i++) {
        const b = ev(node.a[i + 1]);
        if (!compare(a, node.ops[i], b)) return false;
        a = b;
      }
      return true;
    }
    case 'call': {
      if (node.n === 'sum' || node.n === 'prod') {
        if (node.a.length !== 4 || node.a[1].k !== 'name') throw Error(node.n + '(expression, n, from, to)');
        const nm = node.a[1].n,
          a = Math.round(ev(node.a[2])),
          b = Math.round(ev(node.a[3]));
        if (b - a > 1e5) throw Error('Range too large');
        let acc = node.n === 'sum' ? 0 : 1;
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
          acc = node.n === 'sum' ? acc + v : acc * v;
        }
        return acc;
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
        const b = ev(node.a[2]),
          N = 160,
          h = (b - a) / N;
        let sum = f(a) + f(b);
        for (let i = 1; i < N; i++) sum += f(a + i * h) * (i % 2 ? 4 : 2);
        return (sum * h) / 3;
      }
      if (own(math, node.n)) return math[node.n](...node.a.map(ev));
      if (stack.has(node.n)) throw Error('Circular function: ' + node.n);
      const fn = env.fn.get(node.n);
      if (!fn) throw Error('Undefined function: ' + node.n);
      if (node.a.length !== 1) throw Error('User functions need one argument');
      return callUser(node.n, ev(node.a[0]), env, stack, budget);
    }
  }
  throw Error('Invalid expression');
}
function callUser(n, u, env, stack, budget) {
  if (stack.has(n)) throw Error('Circular function: ' + n);
  const fn = env.fn.get(n),
    scope = {
      [fn.param]: u,
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
  let body = normalize(text.trim()),
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
export function definition(body) {
  let m;
  if ((m = body.match(/^([a-zA-Z_]\w*)\(\s*([a-zA-Z_]\w*)\s*\)\s*=([^=].*)$/)))
    return {
      name: m[1],
      param: m[2],
      rhs: m[3],
    };
  if ((m = body.match(/^([a-zA-Z_]\w*)\s*=([^=].*)$/))) {
    if (!coords.has(m[1]))
      return {
        name: m[1],
        rhs: m[2],
      };
  }
  return null;
}
