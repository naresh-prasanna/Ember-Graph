import { compile } from '../app/model.js';
import { S } from '../app/state.js';
import { SYM, math, own, special, textNotation } from '../math/catalog.js';
import { splitTop } from '../math/parser.js';

/* UI and state. All imported state is validated before mutation. */
function styleMath(h) {
  const pass = (h, f) =>
    h
      .split(/(<[^>]+>|&[a-z]+;)/)
      .map((p, i) => (i % 2 ? p : f(p)))
      .join('');
  return pass(
    pass(h, p =>
      p.replace(/[₀-₉]+/g, m => '<sub>' + [...m].map(c => c.charCodeAt(0) - 0x2080).join('') + '</sub>'),
    ),
    p =>
      p.replace(/[A-Za-zΑ-ω]+/g, w =>
        own(math, w) || special.has(w) || w === 'fractal' ? w : '<i>' + w + '</i>',
      ),
  );
}
export function nm(n) {
  const sub = n.match(/^([A-Za-z]+)_(\w+)$/);
  if (sub) return `<i>${sub[1]}</i><sub><i>${sub[2]}</i></sub>`;
  return styleMath(
    n.replace(
      /^([A-Za-z])(\d+)$/,
      (m, a, d) => a + [...d].map(c => String.fromCharCode(0x2080 + +c)).join(''),
    ),
  );
}
/* Structured maths display: stacked fractions, radicals, |x|, real sub/superscripts. */
// Spaced by CSS exactly as the editor spaces them, with a break opportunity either side.
const OP = s => '&#8203;<span class="op">' + s + '</span>&#8203;';
const nameH = n => {
  const m = n.match(/^([A-Za-z]+?)(\d+)$/),
    g = x => (own(SYM, x) && x !== 'sqrt' ? SYM[x] : x),
    sub = n.match(/^([A-Za-z]+)_(\w+)$/);
  if (sub) return `<i>${g(sub[1])}</i><sub><i>${sub[2]}</i></sub>`;
  if (m && (/^[A-Za-z]$/.test(m[1]) || g(m[1]) !== m[1])) return `<i>${g(m[1])}</i><sub>${m[2]}</sub>`;
  return `<i>${g(n)}</i>`;
};
function R(n) {
  const Z = '&#8203;',
    W = (x, m) => (x.p < m ? '(' + x.h + ')' : x.h);
  switch (n.k) {
    case 'num':
      return {
        h: n.raw ?? String(n.v),
        p: 100,
      };
    case 'name':
      return {
        h: n.n === SLOT ? '<span class="slot"></span>' : nameH(n.n),
        p: 100,
      };
    case 'unary':
      return {
        h: (n.op === '-' ? '−' : n.op) + W(R(n.a), 20),
        p: 25,
      };
    case 'cmp':
      return {
        h: n.a
          .map(
            (x, i) =>
              R(x).h +
              (i < n.ops.length
                ? OP(
                    {
                      '<': '&lt;',
                      '>': '&gt;',
                      '<=': '≤',
                      '>=': '≥',
                      '==': '=',
                      '!=': '≠',
                    }[n.ops[i]],
                  )
                : ''),
          )
          .join(''),
        p: 5,
      };
    case 'binary': {
      const a = R(n.a),
        b = R(n.b);
      switch (n.op) {
        case '/':
          return {
            h: `<span class="frac"><span>${a.h}</span><span>${b.h}</span></span>`,
            p: 25,
          };
        case '^':
          return {
            h: W(a, 31) + '<sup>' + b.h + '</sup>',
            p: 30,
          };
        case '+':
          return {
            h: W(a, 10) + OP('+') + W(b, 11),
            p: 10,
          };
        case '-':
          return {
            h: W(a, 10) + OP('−') + W(b, 11),
            p: 10,
          };
        case '*': {
          const at = x =>
              ['name', 'call', 'list', 'range', 'index'].includes(x.k) ||
              (x.k === 'binary' && x.op === '^' && (x.a.k === 'name' || x.a.k === 'call')),
            last = x =>
              x.k === 'binary' && x.op === '*' ? last(x.b) : x.k === 'unary' && x.op === '-' ? last(x.a) : x,
            l = last(n.a),
            // Letters side by side read as one name (hello), so h·e keeps its dot; m x₁ and 2πr need none.
            letters =
              l.k === 'name' &&
              n.b.k === 'name' &&
              ![l.n, n.b.n].some(v => own(SYM, v)) &&
              !/^[xyt](_|\d|$)/.test(n.b.n);
          return {
            h:
              W(a, 20) +
              ((l.k === 'num' || at(l)) && at(n.b) && !(l.k === 'call' && n.b.k === 'call') && !letters
                ? ''
                : Z + '·' + Z) +
              W(b, 21),
            p: 20,
          };
        }
        case '%':
          return {
            h: W(a, 20) + ' mod ' + W(b, 21),
            p: 20,
          };
        default:
          return {
            h: a.h + (n.op === '&&' ? ' and ' : ' or ') + b.h,
            p: 3,
          };
      }
    }
    case 'call': {
      const args = n.a.map(x => R(x).h);
      if (n.n === 'sqrt' && args.length === 1)
        return {
          h: `<span class="rad"><span class="rs">√</span><span class="radc">${args[0]}</span></span>`,
          p: 100,
        };
      if (n.n === 'nthroot' && args.length === 2)
        return {
          h: `<span class="rad"><sup class="rad-n">${args[1]}</sup><span class="rs">√</span><span class="radc">${args[0]}</span></span>`,
          p: 100,
        };
      if (n.n === 'abs' && args.length === 1)
        return {
          h: '|' + args[0] + '|',
          p: 100,
        };
      if (n.postfix)
        return {
          h: W(R(n.a[0]), 100) + '!',
          p: 100,
        };
      const named = n.a[1]?.k === 'name';
      if (n.n === 'integral' && args.length === 4 && named)
        return {
          h: `<span class="bigop int"><span class="bo-sym">∫</span><span class="bo-lims"><span>${args[3]}</span><span>${args[2]}</span></span><span class="bo-body">${W(R(n.a[0]), 10)}</span><span class="bo-d">d</span>${args[1]}</span>`,
          p: 5,
        };
      if (n.n === 'integral' && args.length === 2 && named)
        return {
          h: `<span class="bigop int"><span class="bo-sym">∫</span><span class="bo-body">${W(R(n.a[0]), 10)}</span><span class="bo-d">d</span>${args[1]}</span>`,
          p: 5,
        };
      if ((n.n === 'sum' || n.n === 'prod') && args.length === 4 && named)
        return {
          h: `<span class="bigop"><span class="bo-lims"><span>${args[3]}</span><span class="bo-sym">${n.n === 'sum' ? 'Σ' : '∏'}</span><span>${args[1]}=${args[2]}</span></span><span class="bo-body">${W(R(n.a[0]), 20)}</span></span>`,
          p: 5,
        };
      if (n.n === 'deriv' && args.length === 2 && named && (n.a[0].k !== 'name' || n.a[0].n === n.a[1].n))
        return {
          h: `<span class="frac"><span>d</span><span>d${args[1]}</span></span>(${args[0]})`,
          p: 100,
        };
      // f′(x): the function's name, and the point it is taken at.
      if (n.n === 'deriv' && args.length === 2 && n.a[0].k === 'name')
        return {
          h: nameH(n.a[0].n) + '<span class="prime">′</span>(' + args[1] + ')',
          p: 100,
        };
      if (n.n === 'log' && args.length === 2)
        return {
          h: `log<sub>${args[1]}</sub>(${args[0]})`,
          p: 100,
        };
      return {
        h: (own(math, n.n) || special.has(n.n) ? n.n : nameH(n.n)) + '(' + args.join(', ') + ')',
        p: 100,
      };
    }
    case 'method':
      return {
        h:
          W(R(n.a), 100) +
          '.' +
          n.n +
          (['pdf', 'cdf', 'random'].includes(n.n) ? '(' + n.args.map(x => R(x).h).join(', ') + ')' : ''),
        p: 100,
      };
    case 'point':
      return {
        h: '(' + n.a.map(x => R(x).h).join(', ') + ')',
        p: 100,
      };
    case 'matrix':
      return {
        h: `<span class="mx" style="--cols:${n.a[0].length}">${n.a
          .flat()
          .map(x => `<span>${R(x).h}</span>`)
          .join('')}</span>`,
        p: 100,
      };
    case 'with':
    case 'comp': {
      const binds = n.binds.map(([v, e]) => nameH(v) + ' = ' + R(e).h).join(', '),
        body = R(n.a).h + `<span class="kw">${n.k === 'with' ? 'with' : 'for'}</span>` + binds;
      return {
        h: n.k === 'comp' ? '[' + body + ']' : body,
        p: n.k === 'comp' ? 100 : 0,
      };
    }
    case 'list':
      return {
        h: '[' + n.a.map(x => R(x).h).join(', ') + ']',
        p: 100,
      };
    case 'range':
      return {
        h:
          '[' +
          [n.a, n.s, ...(n.more || [])]
            .filter(Boolean)
            .map(x => R(x).h + ', ')
            .join('') +
          '…, ' +
          R(n.b).h +
          ']',
        p: 100,
      };
    case 'index':
      return {
        h: W(R(n.a), 100) + R(n.i).h,
        p: 100,
      };
  }
  return {
    h: '',
    p: 100,
  };
}
function chunkH(c) {
  try {
    const call = c.match(/^([a-zA-Z_]\w*)\(\s*[a-zA-Z_]\w*\s*\)$/);
    if (call && !own(math, call[1]) && !special.has(call[1])) return styleMath(prettyBase(c));
    if (c[0] === '(' && c.at(-1) === ')') {
      let parts = null;
      try {
        parts = splitTop(c.slice(1, -1));
      } catch {}
      if (parts && parts.length > 1) return '(' + parts.map(x => chunkH(x.trim())).join(', ') + ')';
    }
    if (c[0] === '[' && c.at(-1) === ']' && /^\[\s*\(/.test(c) && !/\bfor\b/.test(c)) {
      let parts = null;
      try {
        parts = splitTop(c.slice(1, -1));
      } catch {}
      if (parts) return '[' + parts.map(x => chunkH(x.trim())).join(',&#8203; ') + ']';
    }
    return R(compile(c, new Set(typeof S.env !== 'undefined' && S.env ? [...S.env.fn.keys()] : [])).ast).h;
  } catch {
    try {
      const t = c.match(/[+\-*/^\s]*$/)[0],
        b = c.slice(0, c.length - t.length),
        o = (b.match(/\(/g) || []).length - (b.match(/\)/g) || []).length;
      if (!b || o < 0) throw 0;
      return (
        R(
          compile(
            b + ')'.repeat(o),
            new Set(typeof S.env !== 'undefined' && S.env ? [...S.env.fn.keys()] : []),
          ).ast,
        ).h + t.replace(/\*/g, '·').replace(/-/g, '−').replace(/</g, '&lt;')
      );
    } catch {
      return styleMath(prettyBase(c));
    }
  }
}
function richMath(text) {
  const out = [],
    SYMB = {
      '=': OP('='),
      '~': OP('~'),
      '<': OP('&lt;'),
      '>': OP('&gt;'),
      '≤': OP('≤'),
      '≥': OP('≥'),
      ',': ',&#8203; ',
      ':': ': ',
    };
  let par = 0,
    cur = '';
  for (let i = 0, d = 0; i < text.length; i++) {
    if ('([{'.includes(text[i])) d++;
    else if (')]}'.includes(text[i])) d--;
    else if (!d && /^with\b/.test(text.slice(i)) && !/\w/.test(text[i - 1] || ''))
      return richMath(text.slice(0, i)) + '<span class="kw">with</span>' + richMath(text.slice(i + 4));
  }
  const push = c => {
    c = c.trim();
    if (c) out.push(chunkH(c));
  };
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    if (ch === '(' || ch === '[') par++;
    if (ch === ')' || ch === ']') par--;
    if (par === 0 && '=~<>≤≥,{}:'.includes(ch)) {
      if ((ch === '<' || ch === '>') && text[i + 1] === '=') {
        ch = ch === '<' ? '≤' : '≥';
        i++;
      }
      push(cur);
      cur = '';
      out.push(own(SYMB, ch) ? SYMB[ch] : ch);
      continue;
    }
    cur += ch;
  }
  push(cur);
  return out.join('');
}
export const astHTML = ast => R(ast).h;
// An unfilled box of ∫, Σ or ⁿ√ is saved as an empty argument; it is drawn as an empty box, not as text.
const SLOT = '_slot';
export function pretty(text) {
  const fractal = text.match(/^\s*fractal\s*\((.*)\)\s*$/i);
  if (fractal) {
    const [family = '', ...args] = splitTop(fractal[1]).map(s => s.trim());
    return `fractal(${[prettyBase(family), ...args.map(pretty)].join(', ')})`;
  }
  // As maths dy/dx reads (d·y/d)·x; at the start of a differential equation it is the derivative.
  text = textNotation(text).replace(/^\s*dy\s*\/\s*dx(?=\s*=)/, '(dy)/(dx)');
  try {
    return richMath(text.replace(/\((?=\s*,)/g, '(' + SLOT).replace(/,(?=\s*[,)])/g, ',' + SLOT));
  } catch {
    return styleMath(prettyBase(text));
  }
}
function prettyBase(text) {
  return text
    .replace(/\.\.\./g, '…')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\btheta\b/g, 'θ')
    .replace(/\b(alpha|beta|gamma|delta|lambda|sigma|phi|omega|tau)\b/g, m => SYM[m])
    .replace(/\bsqrt\b/g, '√')
    .replace(/(?<![A-Za-z0-9_])([A-Za-z]+)_([A-Za-z0-9]+)/g, '$1<sub>$2</sub>')
    .replace(/(?<![A-Za-z_])([A-Za-z])(\d+)(?![A-Za-z_])/g, (m, a, d, off, str) =>
      /[eE]/.test(a) && /\d/.test(str[off - 1] || '')
        ? m
        : a + [...d].map(c => String.fromCharCode(0x2080 + +c)).join(''),
    )
    .replace(/&lt;=/g, '≤')
    .replace(/&gt;=/g, '≥')
    .replace(/\bpi\b/g, 'π')
    .replace(/\^([+-]?\d+(?:\.\d+)?)/g, '<sup>$1</sup>')
    .replace(/\*/g, '·')
    .replace(/=/g, ' = ')
    .replace(/~/g, ' ≈ ');
}
