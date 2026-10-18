import { SYM, math, own, textNotation } from '../math/catalog.js';
import { SPELLINGS } from '../math/names.js';
import { FN_HELP } from '../ui/keyHelp.js';

/* ===== Structured maths editor: type directly into fractions, roots, exponents and subscripts ===== */
const MQ_FN = [
  ...Object.keys(math).filter(k => k.length > 1),
  'integral',
  'deriv',
  'sum',
  'prod',
  'fractal',
  'pdf',
  'cdf',
  'random',
  'with',
  'for',
  'and',
  'or',
];
// π, θ, … back to the letters they were typed as.
const GLYPH = Object.fromEntries(
  Object.entries(SYM)
    .filter(([k]) => k !== 'sqrt')
    .map(([k, v]) => [v, k]),
);
// Typed as one item with its spaces, as Desmos does: "a with a = 2" rather than the product a·w·i·t·h.
const WORDS = ['with', 'for', 'and', 'or'],
  isWord = c => typeof c === 'string' && WORDS.includes(c.trim()) && c !== c.trim();
const isL = c => typeof c === 'string' && /^[A-Za-zα-ω]$/.test(c),
  isD = c => typeof c === 'string' && /^\d$/.test(c),
  isAt = c =>
    typeof c === 'string'
      ? /^[A-Za-z0-9.α-ω₀-₉]$/.test(c)
      : !!c && ['sup', 'sub', 'sqrt', 'abs'].includes(c.t);
function mkNode(t, arrs) {
  const n = {
    t,
    blocks: [],
    blk: null,
  };
  n.blocks = arrs.map(a => ({
    items: a,
    node: n,
  }));
  return n;
}
/* Names that become a layout with slots as they are typed, as in Desmos: log with its base, Σ with bounds,
   ⁿ√ with its index. ∫ is only offered as a suggestion, since int is also a fine name for a variable.
   d/dx comes from typing the fraction itself. Slots, in order:
   log [base, x]   int [from, to, body, variable]   sum/prod [n = from, to, body]   root [index, x]   deriv [x, body] */
const TEMPLATES = ['log', 'sum', 'prod', 'nthroot'],
  BIG = { int: '∫', sum: 'Σ', prod: '∏' },
  // The slot that holds the expression itself: where space, ( and → lead.
  MAIN = { log: 1, int: 2, sum: 2, prod: 2, root: 1, deriv: 1 },
  isTpl = n => !!n && typeof n === 'object' && own(MAIN, n.t);
function mkTemplate(name) {
  if (name === 'log') return mkNode('log', [[], []]);
  if (name === 'int') return mkNode('int', [[], [], [], ['x']]);
  if (name === 'nthroot') return mkNode('root', [[], []]);
  return mkNode(name, [['n', '='], [], []]);
}
const splitArgs = items =>
  items.reduce((acc, it) => (it === ',' ? acc.push([]) : acc.at(-1).push(it), acc), [[]]);
// Saved text back into a template; null leaves the call as plain letters and brackets.
function fromCall(name, args) {
  const n = args.length,
    word = x => x.length > 0 && x.every(isL);
  if (name === 'log' && n <= 2) return mkNode('log', [args[1] || [], args[0]]);
  if (name === 'nthroot' && n === 2) return mkNode('root', [args[1], args[0]]);
  if (name === 'deriv' && n === 2 && word(args[1])) return mkNode('deriv', [args[1], args[0]]);
  if (name === 'integral' && n === 4 && word(args[1]))
    return mkNode('int', [args[2], args[3], args[0], args[1]]);
  if (name === 'integral' && n === 2 && word(args[1])) return mkNode('int', [[], [], args[0], args[1]]);
  if ((name === 'sum' || name === 'prod') && n === 4 && word(args[1]))
    return mkNode(name, [[...args[1], '=', ...args[2]], args[3], args[0]]);
  return null;
}
function tplSer(t, [a, b, c, d]) {
  if (t === 'log') return 'log(' + b + (a ? ',' + a : '') + ')';
  if (t === 'root') return 'nthroot(' + b + ',' + a + ')';
  if (t === 'deriv') return 'deriv(' + b + ',' + a + ')';
  if (t === 'int') return 'integral(' + c + ',' + (d || 'x') + (a || b ? ',' + a + ',' + b : '') + ')';
  const eq = a.indexOf('=');
  return t + '(' + c + ',' + (eq < 0 ? 'n,' + a : a.slice(0, eq) + ',' + a.slice(eq + 1)) + ',' + b + ')';
}
// A template with nothing filled in, so backspace can take it away.
const blank = n =>
  n.blocks.every(
    (b, k) =>
      !b.items.length ||
      (n.t === 'int' && k === 3) ||
      (BIG[n.t] && k === 0 && b.items.indexOf('=') === b.items.length - 1),
  );
export function mqFix(b) {
  for (const it of b.items)
    if (typeof it === 'object') {
      it.blk = b;
      for (const c of it.blocks) {
        c.node = it;
        mqFix(c);
      }
    }
}
function popOperand(items) {
  const last = items[items.length - 1];
  if (last && typeof last === 'object' && last.t === 'paren') {
    let k = 0,
      j = items.length - 2;
    while (j >= 0 && isL(items[j])) {
      k++;
      j--;
    }
    if (k >= 2) return items.splice(items.length - 1 - k, k + 1);
    items.pop();
    return last.blocks[0].items;
  }
  let j = items.length;
  while (j > 0 && isAt(items[j - 1])) j--;
  return items.splice(j);
}
function subPass(a) {
  for (let i = 0; i < a.length; i++) {
    const it = a[i];
    if (typeof it === 'object') {
      it.blocks.forEach(b => subPass(b.items));
      continue;
    }
    if (isD(it) && isL(a[i - 1]) && !isL(a[i - 2]) && !(/[eE]/.test(a[i - 1]) && isD(a[i - 2]))) {
      let j = i;
      while (isD(a[j])) j++;
      const n = mkNode('sub', [a.slice(i, j)]);
      n.auto = true;
      a.splice(i, j - i, n);
    }
  }
}
export function parseText(str) {
  if (str[0] === '"') return [...str];
  str = textNotation(str);
  let i = 0,
    closed = false;
  const run = re => {
    const m = str.slice(i).match(re),
      t = m ? m[0] : '';
    i += t.length;
    return [...t];
  };
  function items(stop) {
    const a = [];
    while (i < str.length) {
      const c = str[i];
      if (c === ')') {
        i++;
        if (stop) {
          closed = true;
          return a;
        }
        const n = mkNode('paren', [a.splice(0)]);
        n.gl = true;
        a.push(n);
        continue;
      }
      if (c === '(') {
        i++;
        const inner = items(true),
          n = mkNode('paren', [inner]);
        n.gr = !closed;
        a.push(n);
        continue;
      }
      const call = !isWordChar(str[i - 1]) && str.slice(i).match(/^(log|integral|sum|prod|nthroot|deriv)\(/);
      if (call) {
        const from = i;
        i += call[0].length;
        const n = fromCall(call[1], splitArgs(items(true)));
        if (n) {
          a.push(n);
          continue;
        }
        i = from;
      }
      if (str.startsWith('sqrt(', i)) {
        i += 5;
        a.push(mkNode('sqrt', [items(true)]));
        continue;
      }
      if (str.startsWith('√(', i)) {
        i += 2;
        a.push(mkNode('sqrt', [items(true)]));
        continue;
      }
      if (str.startsWith('abs(', i)) {
        i += 4;
        a.push(mkNode('abs', [items(true)]));
        continue;
      }
      if (c === '^') {
        i++;
        let x;
        if (str[i] === '(') {
          i++;
          x = items(true);
        } else x = run(/^[+-]?[A-Za-z0-9.α-ω]+/);
        // x^(^(3)) from a doubled ^ is just x^(3).
        while (typeof x[0] === 'object' && x[0].t === 'sup') x = [...x[0].blocks[0].items, ...x.slice(1)];
        a.push(mkNode('sup', [x]));
        continue;
      }
      if (c === '/') {
        i++;
        const num = popOperand(a);
        let d;
        if (str[i] === '(') {
          i++;
          d = items(true);
        } else d = run(/^[A-Za-z0-9.α-ω]+/);
        a.push(mkNode('frac', [num, d]));
        continue;
      }
      if (c === '_') {
        i++;
        a.push(mkNode('sub', [run(/^[A-Za-z0-9α-ω]+/)]));
        if (str[i] === ' ') i++;
        continue;
      }
      const kw =
        (c === ' ' || !isWordChar(str[i - 1])) && str.slice(i).match(/^ *(with|for|and|or)(?![\w(]) */);
      if (kw) {
        a.push(' ' + kw[1] + ' ');
        i += kw[0].length;
        continue;
      }
      if (/[₀-₉]/.test(c)) {
        const d = run(/^[₀-₉]+/).map(x => String(x.charCodeAt(0) - 0x2080));
        const n = mkNode('sub', [d]);
        n.auto = true;
        a.push(n);
        continue;
      }
      a.push(c);
      i++;
    }
    closed = false;
    return a;
  }
  const a = items(false);
  subPass(a);
  symPass(a);
  return a;
}
function symPass(a) {
  for (let i = 0; i < a.length; i++) {
    const it = a[i];
    if (typeof it === 'object') {
      it.blocks.forEach(b => symPass(b.items));
      continue;
    }
    if (!isL(it) || isL(a[i - 1])) continue;
    let j = i;
    while (isL(a[j])) j++;
    const w = a.slice(i, j).join('');
    if (w !== 'sqrt' && own(SYM, w)) a.splice(i, j - i, SYM[w]);
  }
}
const CARET = '\u0001',
  isWordChar = c => typeof c === 'string' && /[A-Za-z0-9α-ω]/.test(c);
// A subscript of digits is part of the name (a1); one with letters keeps its underscore, so x_y stays a
// single name instead of reading as x·y. A space keeps the next letter out of the name.
const subSer = (it, next) => {
  const inner = mqSer(it.blocks[0]);
  return /^\d*$/.test(inner.replace(CARET, '')) ? inner : '_' + inner + (isWordChar(next) ? ' ' : '');
};
// Where the cursor falls in the saved text, so completions can work inside brackets and fractions.
export function mqCaret(st) {
  const { blk, i } = st.cur;
  blk.items.splice(i, 0, CARET);
  const at = mqSer(st.root).indexOf(CARET);
  blk.items.splice(i, 1);
  return at;
}
export function mqAt(st, pos) {
  const saved = st.cur,
    visit = b => {
      for (let i = 0; i <= b.items.length; i++) {
        st.cur = { blk: b, i };
        if (mqCaret(st) === pos) return true;
        const it = b.items[i];
        if (it && typeof it === 'object' && it.blocks.some(visit)) return true;
      }
      return false;
    };
  if (!visit(st.root)) st.cur = saved;
}
export function mqSer(b) {
  return b.items
    .map((it, n) =>
      typeof it === 'string'
        ? it
        : it.t === 'frac'
          ? '(' + mqSer(it.blocks[0]) + ')/(' + mqSer(it.blocks[1]) + ')'
          : it.t === 'sqrt'
            ? 'sqrt(' + mqSer(it.blocks[0]) + ')'
            : it.t === 'abs'
              ? 'abs(' + mqSer(it.blocks[0]) + ')'
              : it.t === 'paren'
                ? '(' + mqSer(it.blocks[0]) + ')'
                : it.t === 'sup'
                  ? '^(' + mqSer(it.blocks[0]) + ')'
                  : it.t === 'sub'
                    ? subSer(it, b.items[n + 1])
                    : isTpl(it)
                      ? tplSer(it.t, it.blocks.map(mqSer))
                      : mqSer(it.blocks[0]),
    )
    .join('');
}
export function mqNew(text) {
  const root = {
    items: parseText(text),
    node: null,
  };
  mqFix(root);
  const last = root.items.at(-1);
  return {
    root,
    cur:
      last && typeof last === 'object' && last.t === 'paren' && !last.blocks[0].items.length
        ? {
            blk: last.blocks[0],
            i: 0,
          }
        : {
            blk: root,
            i: root.items.length,
          },
  };
}
const mqIdx = n => n.blk.items.indexOf(n),
  mqEnter = (st, n, k, end) => {
    const b = n.blocks[k];
    st.cur = {
      blk: b,
      i: end ? b.items.length : 0,
    };
  },
  mqAfter = (st, n) => {
    st.cur = {
      blk: n.blk,
      i: mqIdx(n) + 1,
    };
  },
  mqBefore = (st, n) => {
    st.cur = {
      blk: n.blk,
      i: mqIdx(n),
    };
  };
// What d/dx applies to when typed in front of an expression already on the row.
const BODY_STOP = new Set('=<>≤≥≠,'.split(''));
function takeBody(items) {
  let depth = 0,
    i = 0;
  for (; i < items.length; i++) {
    const it = items[i];
    if (typeof it === 'string') {
      if (it === '(' || it === '[') depth++;
      else if ((it === ')' || it === ']') && depth) depth--;
      else if (!depth && BODY_STOP.has(it)) break;
      else if (!depth && /^\s*(with|for|and|or)\b/.test(it)) break;
    }
  }
  return items.splice(0, i);
}
// Empty d/dx in front of ln(x) pulls ln(x) into the body, so the row becomes d/dx(ln(x)).
function fillDeriv(n, after) {
  if (n.blocks[1].items.length || !after.length) return;
  n.blocks[1].items = takeBody(after);
}
export function mqLeft(st) {
  const { blk, i } = st.cur;
  if (i > 0) {
    const it = blk.items[i - 1];
    if (typeof it === 'object') mqEnter(st, it, it.blocks.length - 1, true);
    else st.cur.i--;
    return;
  }
  const n = blk.node;
  if (!n) return;
  const k = n.blocks.indexOf(blk);
  // The two bounds of ∫ and Σ share a column: left from either leaves.
  k > 0 && !(BIG[n.t] && k === 1) ? mqEnter(st, n, k - 1, true) : mqBefore(st, n);
}
/* ↑ and ↓ between the slots stacked above one another: numerator and denominator, the bounds of ∫ and Σ,
   log's base below its argument. Returns false at the top or bottom, so the row above or below takes over. */
export function mqVert(st, up) {
  let b = st.cur.blk;
  for (let n = b.node; n; b = n.blk, n = b.node) {
    const k = n.blocks.indexOf(b),
      t =
        n.t === 'frac'
          ? +!up
          : BIG[n.t]
            ? +up
            : n.t === 'log' || n.t === 'deriv'
              ? k === 1 && !up
                ? 0
                : k === 0 && up
                  ? 1
                  : k
              : n.t === 'root'
                ? +!up
                : k;
    if (t !== k) {
      mqEnter(st, n, t, true);
      return true;
    }
  }
  return false;
}
export function mqRight(st) {
  const { blk, i } = st.cur;
  if (i < blk.items.length) {
    const it = blk.items[i];
    if (typeof it === 'object') mqEnter(st, it, 0, false);
    else st.cur.i++;
    return;
  }
  const n = blk.node;
  if (!n) return;
  const k = n.blocks.indexOf(blk);
  // From either bound of ∫ or Σ, on to what is being added up.
  if (BIG[n.t] && k < 2) mqEnter(st, n, 2, false);
  // Past the end of ∫'s expression and over dx in one step; ← still reaches the x of dx.
  else if (n.t === 'int' && k === 2) mqAfter(st, n);
  else k < n.blocks.length - 1 ? mqEnter(st, n, k + 1, false) : mqAfter(st, n);
}
/* Empty slots the cursor has left behind are removed: a fraction with a blank denominator becomes its
   numerator, and blank exponents, subscripts, roots and |…| vanish. A typed ( stays until it is deleted.
   Pass the state with a cursor to keep the slot being typed in; without one everything is tidied. */
const MARK = { t: 'mark', blocks: [] };
// Typing / after (a+b) moves a+b into the numerator, so taking the fraction away puts the brackets back.
const numerator = (items, paren = false) =>
  paren || items.some(it => typeof it === 'string' && '+-−*/=<>≤≥,'.includes(it))
    ? [mkNode('paren', [items])]
    : items;
const hasMark = b => b.items.some(it => it === MARK || (typeof it === 'object' && it.blocks.some(hasMark)));
function pruneBlock(b) {
  for (let i = 0; i < b.items.length; i++) {
    const n = b.items[i];
    if (typeof n !== 'object' || n === MARK) continue;
    n.blocks.forEach(pruneBlock);
    if (n.blocks.some(hasMark)) continue;
    const empty = n.blocks.map(c => !c.items.length);
    let swap = null;
    if (n.t === 'frac' && empty[1]) swap = numerator(n.blocks[0].items, n.paren);
    else if (['sup', 'sub', 'sqrt', 'abs'].includes(n.t) && empty[0]) swap = [];
    if (!swap) continue;
    b.items.splice(i, 1, ...swap);
    i += swap.length - 1;
  }
}
export function mqPrune(st, keepCursor = true) {
  const { blk, i } = st.cur;
  if (keepCursor) blk.items.splice(i, 0, MARK);
  pruneBlock(st.root);
  mqFix(st.root);
  if (!keepCursor) {
    st.cur = { blk: st.root, i: st.root.items.length };
    return;
  }
  const find = b => {
    const j = b.items.indexOf(MARK);
    if (j >= 0) return [b, j];
    for (const it of b.items)
      if (typeof it === 'object')
        for (const c of it.blocks) {
          const f = find(c);
          if (f) return f;
        }
    return null;
  };
  const [b, j] = find(st.root);
  b.items.splice(j, 1);
  st.cur = { blk: b, i: j };
}
export function mqBack(st) {
  const { blk, i } = st.cur;
  if (i > 0) {
    const it = blk.items[i - 1];
    if (isP(it)) {
      if (it.gr) {
        mqEnter(st, it, 0, true);
        return;
      }
      const rest = blk.items.splice(i),
        c = it.blocks[0],
        len = c.items.length;
      it.gr = true;
      c.items.push(...rest);
      if (it.gl) {
        const u = mqUnwrap(st, it);
        st.cur = {
          blk: u.c,
          i: u.j + len,
        };
        return;
      }
      mqFix(st.root);
      st.cur = {
        blk: c,
        i: len,
      };
      return;
    }
    if (typeof it === 'object') {
      mqEnter(st, it, it.blocks.length - 1, true);
      return;
    }
    blk.items.splice(i - 1, 1);
    st.cur.i--;
    return;
  }
  const n = blk.node;
  if (!n) return;
  const k = n.blocks.indexOf(blk);
  if (isP(n)) {
    if (n.gl) {
      mqBefore(st, n);
      return;
    }
    const u = mqUnwrap(st, n);
    st.cur = {
      blk: u.c,
      i: u.j,
    };
    return;
  }
  if (k > 0) {
    // Backspace in an empty denominator removes the fraction and keeps the numerator.
    if (n.t === 'frac' && !blk.items.length) {
      const c = n.blk,
        j = mqIdx(n),
        top = numerator(n.blocks[0].items, n.paren);
      c.items.splice(j, 1, ...top);
      mqFix(st.root);
      st.cur = { blk: c, i: j + top.length };
      return;
    }
    mqEnter(st, n, k - 1, true);
    return;
  }
  if (n.blocks.every(b => !b.items.length) || (isTpl(n) && blank(n))) {
    const c = n.blk,
      j = mqIdx(n);
    c.items.splice(j, 1);
    st.cur = {
      blk: c,
      i: j,
    };
  } else mqBefore(st, n);
}

/* Brackets work like MathQuill (Desmos): '(' opens a group whose closing side is a dim "ghost" until you close it;
   ')' closes the nearest open group (or wraps everything to its left if none is open). Backspace on a bracket
   removes just that bracket and the group re-forms around its neighbours. */
const isP = x => !!x && typeof x === 'object' && x.t === 'paren';
/* Ghost styling is only for an untyped closing delimiter (gr). A completed pair — including one
   whose opener was auto-inserted by typing ')' — draws both sides at full weight. */
export const parenCloserGhost = it => !!(it && it.gr);
function mqSol(st) {
  const { blk, i } = st.cur,
    l = blk.items[i - 1],
    r = blk.items[i];
  if (isP(l)) l.gr = false;
  if (isP(r)) r.gl = false;
}
function mqOpen(st) {
  const b = st.cur.blk,
    pos = st.cur.i,
    r = b.items[pos];
  if (isP(r) && r.gl) {
    r.gl = false;
    st.cur = {
      blk: r.blocks[0],
      i: 0,
    };
    return;
  }
  const p = b.node;
  if (p && p.t === 'paren' && p.gl) {
    const left = b.items.splice(0, pos),
      c = p.blk,
      j = c.items.indexOf(p);
    c.items.splice(j, 0, ...left);
    p.gl = false;
    mqFix(st.root);
    st.cur = {
      blk: b,
      i: 0,
    };
    return;
  }
  mqSol(st);
  const right = b.items.splice(pos),
    n = mkNode('paren', [right]);
  n.gr = true;
  b.items.splice(pos, 0, n);
  mqFix(st.root);
  st.cur = {
    blk: n.blocks[0],
    i: 0,
  };
}
function mqClose(st) {
  let b = st.cur.blk,
    pos = st.cur.i;
  const l = b.items[pos - 1];
  if (isP(l) && l.gr) {
    l.gr = false;
    return;
  }
  for (;;) {
    const nd = b.node;
    if (!nd) break;
    if (nd.t === 'paren') {
      if (nd.gr) {
        const out = b.items.splice(pos),
          c = nd.blk,
          j = c.items.indexOf(nd);
        nd.gr = false;
        c.items.splice(j + 1, 0, ...out);
        mqFix(st.root);
        st.cur = {
          blk: c,
          i: j + 1,
        };
        return;
      }
      break;
    }
    if (nd.t === 'sqrt' || nd.t === 'abs' || (nd.t === 'root' && b === nd.blocks[1])) {
      if (pos > 0 && !nd.swallowed) break;
      mqAfter(st, nd);
      return;
    }
    // log and d/dx draw their own brackets, so ) closes them. Anything after the cursor leaves
    // the body: d/dx(x|·x²) becomes d/dx(x)·x². A trailing · or + that would be left hanging
    // either goes outside with what follows, or is dropped if nothing follows.
    if ((nd.t === 'log' || nd.t === 'deriv') && b === nd.blocks[MAIN[nd.t]]) {
      const out = b.items.splice(pos),
        c = nd.blk,
        j = c.items.indexOf(nd),
        bin = x => typeof x === 'string' && '+-−*/·^'.includes(x);
      while (b.items.length && bin(b.items.at(-1))) {
        const op = b.items.pop();
        if (out.length) out.unshift(op);
      }
      if (out.length) c.items.splice(j + 1, 0, ...out);
      mqFix(st.root);
      st.cur = {
        blk: c,
        i: j + 1,
      };
      return;
    }
    pos = nd.blk.items.indexOf(nd) + 1;
    b = nd.blk;
  }
  if (pos > 0) {
    const seg = b.items.splice(0, pos),
      n = mkNode('paren', [seg]);
    n.gl = true;
    b.items.unshift(n);
    mqFix(st.root);
    st.cur = {
      blk: b,
      i: 1,
    };
  }
}
function mqUnwrap(st, p) {
  const c = p.blk,
    j = c.items.indexOf(p),
    inner = p.blocks[0].items;
  c.items.splice(j, 1, ...inner);
  mqFix(st.root);
  return {
    c,
    j,
    len: inner.length,
  };
}
export function mqType(st, ch) {
  const plain = st.root.items[0] === '"';
  let { blk } = st.cur;
  const node = blk.node,
    jm = node && node.justMade;
  if (node) node.justMade = false;
  if (!plain && node) {
    if (node.t === 'sub' && !(node.auto ? /\d/ : /[A-Za-z0-9]/).test(ch)) {
      mqAfter(st, node);
      return ch === ' ' ? undefined : mqType(st, ch);
    }
    if (node.t === 'sup' && blk.items.length && '+-*/=<>,'.includes(ch)) {
      mqAfter(st, node);
      return mqType(st, ch);
    }
    if (isTpl(node)) {
      const k = node.blocks.indexOf(blk);
      // log_2 goes to the base, and so does the 2 of log2(8); log100 is log(100).
      if (node.t === 'log' && k === 1 && ch === '_' && !blk.items.length) {
        mqEnter(st, node, 0, true);
        return;
      }
      if (
        node.t === 'log' &&
        k === 1 &&
        ch === '(' &&
        !node.swallowed &&
        blk.items.length &&
        blk.items.every(isD) &&
        st.cur.i === blk.items.length
      ) {
        node.blocks[0].items.push(...blk.items.splice(0));
        node.swallowed = true;
        st.cur.i = 0;
        return;
      }
      // The body of ∫, Σ, ∏ and d/dx runs on until → leaves it, as in Desmos, so ∫ x sin(x) dx can be typed with a space.
      if (ch === ' ' && k === MAIN[node.t] && (BIG[node.t] || node.t === 'deriv')) return;
      if (ch === ' ' || (ch === ')' && k !== MAIN[node.t]) || (ch === '(' && node.t === 'log' && k === 0)) {
        k === MAIN[node.t] ? mqAfter(st, node) : mqEnter(st, node, MAIN[node.t], false);
        return;
      }
    }
  }
  const ins = x => {
      mqSol(st);
      st.cur.blk.items.splice(st.cur.i, 0, x);
      st.cur.i++;
    },
    put = (n, k = 0) => {
      ins(n);
      mqFix(st.root);
      mqEnter(st, n, k, false);
    };
  if (!plain) {
    if (ch === '(' && jm) {
      node.swallowed = true;
      return;
    }
    if (ch === '/') {
      const b = st.cur.blk,
        items = b.items.slice(0, st.cur.i),
        tail = b.items.slice(st.cur.i),
        last = items.at(-1),
        top = popOperand(items),
        n = mkNode('frac', [top, []]);
      n.paren = typeof last === 'object' && last?.t === 'paren' && top === last.blocks[0].items;
      b.items = items.concat([n], tail);
      mqFix(st.root);
      mqEnter(st, n, 1, false);
      return;
    }
    if (ch === '^') {
      // A second ^ at the start of an exponent has nothing to raise.
      if (node?.t === 'sup' && st.cur.i === 0) return;
      return put(mkNode('sup', [[]]));
    }
    if (ch === '_') {
      const n = mkNode('sub', [[]]);
      return put(n);
    }
    if (ch === '(') {
      mqOpen(st);
      return;
    }
    if (ch === ')') {
      mqClose(st);
      return;
    }
    if (ch === '|') {
      if (node && node.t === 'abs') {
        mqAfter(st, node);
        return;
      }
      return put(mkNode('abs', [[]]));
    }
    if (ch === ' ') {
      if (!node || node.t === 'paren') return;
      if (node.t === 'frac' && node.blocks.indexOf(blk) === 0) mqEnter(st, node, 1, false);
      else mqAfter(st, node);
      return;
    }
  }
  ins(ch);
  if (plain) return;
  const it = st.cur.blk.items,
    i = st.cur.i,
    last = it[i - 1],
    fr = st.cur.blk.node;
  // d/dx: once the bottom reads d and a letter, the fraction becomes the derivative, waiting for what to differentiate.
  if (
    fr?.t === 'frac' &&
    st.cur.blk === fr.blocks[1] &&
    it.length === 2 &&
    it[0] === 'd' &&
    isL(last) &&
    fr.blocks[0].items.join('') === 'd'
  ) {
    const n = mkNode('deriv', [[last], []]),
      c = fr.blk,
      idx = mqIdx(fr),
      after = c.items.splice(idx + 1);
    fillDeriv(n, after);
    c.items.splice(idx, 1, n, ...after);
    mqFix(st.root);
    mqEnter(st, n, 1, !!n.blocks[1].items.length);
    return;
  }
  if (isL(last)) {
    let j = i;
    while (j > 0 && isL(it[j - 1])) j--;
    const w = it
        .slice(j, i)
        .map(c => GLYPH[c] || c)
        .join(''),
      kw =
        !isL(it[i]) &&
        WORDS.find(
          k =>
            w === k ||
            (w.endsWith(k) && k.length > 2 && ![...MQ_FN, ...SPELLINGS].some(f => f.startsWith(w))),
        );
    const tpl =
      !kw &&
      !isL(it[i]) &&
      st.cur.blk.node?.t !== 'sub' &&
      TEMPLATES.find(k => w === k || (w.length === k.length + 1 && w.endsWith(k)));
    if (kw) {
      it.splice(i - kw.length, kw.length, ' ' + kw + ' ');
      st.cur.i = i - kw.length + 1;
    } else if (tpl) {
      const n = mkTemplate(tpl);
      it.splice(i - tpl.length, tpl.length, n);
      mqFix(st.root);
      n.justMade = true;
      if (tpl === 'log') mqEnter(st, n, 1, false);
      else mqEnter(st, n, 0, true);
    } else if (w === 'frac') {
      it.splice(j, 4);
      const n = mkNode('frac', [[], []]);
      it.splice(j, 0, n);
      mqFix(st.root);
      mqEnter(st, n, 0, false);
    } else if (own(SYM, w)) {
      if (w === 'sqrt') {
        it.splice(j, 4);
        const n = mkNode('sqrt', [[]]);
        n.justMade = true;
        it.splice(j, 0, n);
        mqFix(st.root);
        mqEnter(st, n, 0, false);
      } else {
        it.splice(j, i - j, SYM[w]);
        st.cur.i = j + 1;
      }
    } else if (!isL(it[i])) {
      // The run is read the way the parser reads it: "pizza" is one name, so a π typed on the way turns
      // back into p, i; "pix" is π·x.
      const pix = w.match(/^pi([xyt])$/),
        want = pix ? ['π', pix[1]] : [...w];
      if (want.join('') !== it.slice(j, i).join('')) {
        it.splice(j, i - j, ...want);
        st.cur.i = j + want.length;
      }
    }
  } else if (last === '=' && (it[i - 2] === '<' || it[i - 2] === '>')) {
    it.splice(i - 2, 2, it[i - 2] === '<' ? '≤' : '≥');
    st.cur.i = i - 1;
  } else if (isD(last) && isL(it[i - 2]) && !isL(it[i - 3]) && !(/[eE]/.test(it[i - 2]) && isD(it[i - 3]))) {
    it.splice(i - 1, 1);
    const n = mkNode('sub', [[last]]);
    n.auto = true;
    it.splice(i - 1, 0, n);
    mqFix(st.root);
    mqEnter(st, n, 0, true);
  }
}
// A layout picked from the suggestions takes the place of the letters typed to find it.
export function mqInsert(st, name, drop) {
  const it = st.cur.blk.items;
  let j = st.cur.i;
  while (j > 0 && st.cur.i - j < drop && isL(it[j - 1])) j--;
  it.splice(j, st.cur.i - j);
  const n =
    name === 'sqrt' || name === 'abs'
      ? mkNode(name, [[]])
      : name === 'deriv'
        ? mkNode('deriv', [['x'], []])
        : mkTemplate(name);
  const after = name === 'deriv' ? it.splice(j) : [];
  if (name === 'deriv') fillDeriv(n, after);
  it.splice(j, 0, n, ...after);
  mqFix(st.root);
  n.justMade = true;
  if (name === 'log' || name === 'deriv') mqEnter(st, n, 1, name === 'deriv' && !!n.blocks[1].items.length);
  else mqEnter(st, n, 0, isTpl(n));
}
// Inside tone( … ) the arguments still to come show faintly: "frequency, gain", then ", gain" after the first.
function paramHint(items, i, inner) {
  let j = i;
  while (j > 0 && isL(items[j - 1])) j--;
  const name = items.slice(j, i).join(''),
    sig = name && own(FN_HELP, name) ? FN_HELP[name][0] : '',
    at = sig.indexOf(name + '(');
  if (at < 0 || (at > 0 && sig[at - 1] !== '.')) return '';
  const params = sig
      .slice(at + name.length + 1, sig.lastIndexOf(')'))
      .split(/,\s*/)
      .filter(Boolean),
    args = splitArgs(inner),
    k = args.length - 1,
    rest = args[k].length ? params.slice(k + 1) : params.slice(k);
  return rest.length ? (args[k].length ? ', ' : '') + rest.join(', ') : '';
}
export function mqDraw(st, el) {
  const mk = (t, c) => {
      const e = document.createElement(t);
      if (c) e.className = c;
      return e;
    },
    cur = () => mk('span', 'cur');
  function blockEl(b, tag = 'span') {
    const s = mk(tag, 'blk' + (b.items.length ? '' : ' e'));
    s._blk = b;
    const up = new Set();
    for (let j = 0; j < b.items.length;) {
      if (isL(b.items[j])) {
        let k = j;
        while (k < b.items.length && isL(b.items[k])) k++;
        // The parser reads a run of letters as one name, so only a run that is a whole function name is upright:
        // "standarddeviation" is the function, while "stand" doesn't contain tan.
        if (MQ_FN.includes(b.items.slice(j, k).join(''))) for (let q = j; q < k; q++) up.add(q);
        // Before a bracket, xsin is x·sin, so its sin is upright too.
        else if (b.items[k] === '(' || b.items[k]?.t === 'paren')
          for (let q = j + 1; q < k; q++)
            if (MQ_FN.includes(b.items.slice(q, k).join(''))) {
              for (let z = q; z < k; z++) up.add(z);
              break;
            }
        j = k;
      } else j++;
    }
    for (let i = 0; i <= b.items.length; i++) {
      if (st.cur.blk === b && st.cur.i === i) s.append(cur());
      if (i === b.items.length) break;
      const it = b.items[i];
      let e;
      if (typeof it === 'string') {
        // A leading minus, as in −3 or (−x), is a sign and sits tight against what follows.
        const sign =
          it === '-' &&
          (!i || (typeof b.items[i - 1] === 'string' && /^[([{=<>≤≥~,+\-*/^]$/.test(b.items[i - 1])));
        e = mk(
          'span',
          (isWord(it) ? 'kw ' : '') +
            (isL(it) && !up.has(i) ? 'v ' : '') +
            (/[+\-=<>≤≥~]/.test(it) && !sign ? 'op' : '') +
            (/[()]/.test(it) ? ' pb' : ''),
        );
        e.textContent = it === '*' ? '·' : it === '-' ? '−' : it.trim() || it;
      } else if (it.t === 'frac') {
        e = mk('span', 'frac');
        e.append(blockEl(it.blocks[0]), blockEl(it.blocks[1]));
      } else if (it.t === 'sqrt') {
        e = mk('span', 'rad');
        const r = mk('span', 'rs');
        r.textContent = '√';
        const c = blockEl(it.blocks[0]);
        c.classList.add('radc');
        e.append(r, c);
      } else if (it.t === 'sup') e = blockEl(it.blocks[0], 'sup');
      else if (it.t === 'sub') e = blockEl(it.blocks[0], 'sub');
      else if (it.t === 'log') {
        e = mk('span', 'nd tpl-log');
        const name = mk('span', 'fn'),
          base = blockEl(it.blocks[0], 'sub'),
          a = mk('span', 'pb'),
          z = mk('span', 'pb');
        name.textContent = 'log';
        base.dataset.ghost = '10';
        a.textContent = '(';
        z.textContent = ')';
        e.append(name, base, a, blockEl(it.blocks[1]), z);
      } else if (BIG[it.t]) {
        e = mk('span', 'bigop ' + it.t);
        const sym = mk('span', 'bo-sym'),
          lims = mk('span', 'bo-lims');
        sym.textContent = BIG[it.t];
        lims.append(blockEl(it.blocks[1]), blockEl(it.blocks[0]));
        e.append(...(it.t === 'int' ? [sym, lims] : [lims]));
        if (it.t !== 'int') lims.insertBefore(sym, lims.lastChild);
        const body = blockEl(it.blocks[2]);
        body.classList.add('bo-body');
        e.append(body);
        if (it.t === 'int') {
          const d = mk('span', 'bo-d');
          d.textContent = 'd';
          e.append(d, blockEl(it.blocks[3]));
        }
      } else if (it.t === 'root') {
        e = mk('span', 'rad');
        const idx = blockEl(it.blocks[0], 'sup'),
          r = mk('span', 'rs'),
          c = blockEl(it.blocks[1]);
        idx.classList.add('rad-n');
        r.textContent = '√';
        c.classList.add('radc');
        e.append(idx, r, c);
      } else if (it.t === 'deriv') {
        e = mk('span', 'nd');
        const f = mk('span', 'frac'),
          top = mk('span', 'blk'),
          bot = mk('span', 'blk'),
          d = mk('span', 'v'),
          a = mk('span', 'pb gh'),
          z = mk('span', 'pb gh');
        top.textContent = 'd';
        d.textContent = 'd';
        bot.append(d, blockEl(it.blocks[0]));
        f.append(top, bot);
        a.textContent = '(';
        z.textContent = ')';
        e.append(f, a, blockEl(it.blocks[1]), z);
      } else {
        e = mk('span', 'nd');
        const a = mk('span', 'pb'),
          z = mk('span', 'pb'),
          v = it.t === 'abs' ? '|' : '';
        a.textContent = v || '(';
        z.textContent = v || ')';
        // Only the untyped closer is a ghost. An auto-inserted opener (gl) still completes the pair —
        // both sides must match in weight once they are drawn.
        if (parenCloserGhost(it)) z.classList.add('gh');
        e.append(a, blockEl(it.blocks[0]), z);
        const hint = st.cur.blk === it.blocks[0] && paramHint(b.items, i, it.blocks[0].items);
        if (hint) {
          const g = mk('span', 'args-hint');
          g.textContent = hint;
          z.before(g);
        }
      }
      e._p = [b, i];
      // A long expression wraps at its operators, at the same points as the typeset preview.
      if (e.classList.contains('op')) s.append(mk('wbr'), e, mk('wbr'));
      else s.append(e);
    }
    return s;
  }
  el.replaceChildren(blockEl(st.root));
}
