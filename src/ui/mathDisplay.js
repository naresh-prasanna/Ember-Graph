import { compile } from '../app/model.js';
import { S } from '../app/state.js';
import { SYM, math, own, special } from '../math/catalog.js';
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
  return styleMath(
    n.replace(
      /^([A-Za-z])(\d+)$/,
      (m, a, d) => a + [...d].map(c => String.fromCharCode(0x2080 + +c)).join(''),
    ),
  );
}
/* Structured maths display: stacked fractions, radicals, |x|, real sub/superscripts. */
/* Structured maths display: stacked fractions, radicals, |x|, real sub/superscripts. */
const nameH = n => {
  const m = n.match(/^([A-Za-z]+?)(\d+)$/),
    g = x => (own(SYM, x) && x !== 'sqrt' ? SYM[x] : x);
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
        h: nameH(n.n),
        p: 100,
      };
    case 'unary':
      return {
        h: (n.op === '-' ? '−' : n.op) + W(R(n.a), 25),
        p: 25,
      };
    case 'cmp':
      return {
        h: n.a
          .map(
            (x, i) =>
              R(x).h +
              (i < n.ops.length
                ? ' ' +
                  {
                    '<': '&lt;',
                    '>': '&gt;',
                    '<=': '≤',
                    '>=': '≥',
                    '==': '=',
                    '!=': '≠',
                  }[n.ops[i]] +
                  ' '
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
            h: W(a, 10) + Z + '+' + Z + W(b, 11),
            p: 10,
          };
        case '-':
          return {
            h: W(a, 10) + Z + '−' + Z + W(b, 11),
            p: 10,
          };
        case '*': {
          const at = x =>
            x.k === 'name' ||
            x.k === 'call' ||
            (x.k === 'binary' && x.op === '^' && (x.a.k === 'name' || x.a.k === 'call'));
          return {
            h:
              W(a, 20) +
              ((n.a.k === 'num' || at(n.a)) && at(n.b) && !(n.a.k === 'call' && n.b.k === 'call')
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
      if (n.n === 'abs' && args.length === 1)
        return {
          h: '|' + args[0] + '|',
          p: 100,
        };
      return {
        h: (own(math, n.n) || special.has(n.n) ? n.n : nameH(n.n)) + '(' + args.join(', ') + ')',
        p: 100,
      };
    }
  }
  return {
    h: '',
    p: 100,
  };
}
function chunkH(c) {
  try {
    if (/^[a-zA-Z_]\w*\(\s*[a-zA-Z_]\w*\s*\)$/.test(c)) return styleMath(prettyBase(c));
    if (c[0] === '(' && c.at(-1) === ')') {
      let parts = null;
      try {
        parts = splitTop(c.slice(1, -1));
      } catch {}
      if (parts && parts.length > 1) return '(' + parts.map(x => chunkH(x.trim())).join(', ') + ')';
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
      '=': ' = ',
      '~': ' ~ ',
      '<': ' &lt; ',
      '>': ' &gt; ',
      '≤': ' ≤ ',
      '≥': ' ≥ ',
      ',': ',&#8203; ',
      ':': ': ',
    };
  let par = 0,
    cur = '';
  const push = c => {
    c = c.trim();
    if (c) out.push(chunkH(c));
  };
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    if (ch === '(') par++;
    if (ch === ')') par--;
    if (par === 0 && '=~<>≤≥,[]{}:'.includes(ch)) {
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
export function pretty(text) {
  try {
    return richMath(text);
  } catch {
    return styleMath(prettyBase(text));
  }
}
function prettyBase(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\btheta\b/g, 'θ')
    .replace(/\b(alpha|beta|gamma|delta|lambda|sigma|phi|omega|tau)\b/g, m => SYM[m])
    .replace(/\bsqrt\b/g, '√')
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
