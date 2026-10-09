import { SYM, math, own } from '../math/catalog.js';

/* ===== Structured maths editor: type directly into fractions, roots, exponents and subscripts ===== */
const MQ_FN = [
  ...Object.keys(math).filter(k => k.length > 1),
  'integral',
  'deriv',
  'sum',
  'prod',
  'fractal',
].sort((a, b) => b.length - a.length);
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
export function mqSer(b) {
  return b.items
    .map(it =>
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
  k > 0 ? mqEnter(st, n, k - 1, true) : mqBefore(st, n);
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
  k < n.blocks.length - 1 ? mqEnter(st, n, k + 1, false) : mqAfter(st, n);
}
/* Empty slots the cursor has left behind are removed, as in Desmos: a fraction with a blank
   denominator becomes its numerator, and blank exponents, subscripts, roots, |…| and () vanish.
   Pass the state with a cursor to keep the slot being typed in; without one everything is tidied. */
const MARK = { t: 'mark', blocks: [] };
// Typing / after (a+b) moves a+b into the numerator, so taking the fraction away puts the brackets back.
const numerator = items =>
  items.some(it => typeof it === 'string' && '+-−*/=<>≤≥,'.includes(it)) ? [mkNode('paren', [items])] : items;
const hasMark = b => b.items.some(it => it === MARK || (typeof it === 'object' && it.blocks.some(hasMark)));
function pruneBlock(b) {
  for (let i = 0; i < b.items.length; i++) {
    const n = b.items[i];
    if (typeof n !== 'object' || n === MARK) continue;
    n.blocks.forEach(pruneBlock);
    if (n.blocks.some(hasMark)) continue;
    const empty = n.blocks.map(c => !c.items.length);
    let swap = null;
    if (n.t === 'frac' && empty[1]) swap = numerator(n.blocks[0].items);
    else if (['sup', 'sub', 'sqrt', 'abs'].includes(n.t) && empty[0]) swap = [];
    else if (n.t === 'paren' && empty[0] && !isL(b.items[i - 1])) swap = [];
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
        top = numerator(n.blocks[0].items);
      c.items.splice(j, 1, ...top);
      mqFix(st.root);
      st.cur = { blk: c, i: j + top.length };
      return;
    }
    mqEnter(st, n, k - 1, true);
    return;
  }
  if (n.blocks.every(b => !b.items.length)) {
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
/* Brackets work like MathQuill (Desmos): '(' opens a group whose closing side is a dim "ghost" until you close it;
   ')' closes the nearest open group (or wraps everything to its left if none is open). Backspace on a bracket
   removes just that bracket and the group re-forms around its neighbours. */
const isP = x => !!x && typeof x === 'object' && x.t === 'paren';
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
    if (nd.t === 'sqrt' || nd.t === 'abs') {
      if (pos > 0 && !nd.swallowed) break;
      mqAfter(st, nd);
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
        n = mkNode('frac', [popOperand(items), []]);
      b.items = items.concat([n], tail);
      mqFix(st.root);
      mqEnter(st, n, 1, false);
      return;
    }
    if (ch === '^') return put(mkNode('sup', [[]]));
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
    last = it[i - 1];
  if (isL(last)) {
    let j = i;
    while (j > 0 && isL(it[j - 1])) j--;
    const w = it.slice(j, i).join('');
    if (w === 'frac') {
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
        it.splice(j, w.length, SYM[w]);
        st.cur.i = j + 1;
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
        const run = b.items.slice(j, k).join('');
        for (let p = 0; p < run.length;) {
          const f = MQ_FN.find(f => run.startsWith(f, p));
          if (f) {
            for (let q = 0; q < f.length; q++) up.add(j + p + q);
            p += f.length;
          } else p++;
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
        e = mk(
          'span',
          (isL(it) && !up.has(i) ? 'v ' : '') +
            (/[+\-=<>≤≥]/.test(it) ? 'op' : '') +
            (/[()]/.test(it) ? ' pb' : ''),
        );
        e.textContent = it === '*' ? '·' : it === '-' ? '−' : it;
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
      else {
        e = mk('span', 'nd');
        const a = mk('span', 'pb'),
          z = mk('span', 'pb'),
          v = it.t === 'abs' ? '|' : '';
        a.textContent = v || '(';
        z.textContent = v || ')';
        if (it.gl) a.classList.add('gh');
        if (it.gr) z.classList.add('gh');
        e.append(a, blockEl(it.blocks[0]), z);
      }
      e._p = [b, i];
      s.append(e);
    }
    return s;
  }
  el.replaceChildren(blockEl(st.root));
}
