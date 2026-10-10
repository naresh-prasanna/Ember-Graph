import { S } from '../app/state.js';
import { $ } from '../core/dom.js';
import { own } from '../math/catalog.js';
import { FN_HELP } from './keyHelp.js';

/* On-screen maths keypad. Keys go through the editor's own key handling, so typing "pi", "sqrt" or "/" on the
   keypad behaves exactly as it does on a keyboard. */
const FNS = [
  ['Trigonometry', 'sin cos tan csc sec cot'],
  ['Inverse trigonometry', 'arcsin arccos arctan arccsc arcsec arccot'],
  [
    'Statistics',
    'mean median mode min max quartile quantile stdev stdevp var varp mad cov covp corr spearman stats count total',
  ],
  ['List operations', 'length repeat join sort shuffle unique for'],
  ['Visualizations', 'histogram dotplot boxplot'],
  ['Probability distributions', 'normaldist tdist poissondist binomialdist uniformdist .pdf .cdf .random'],
  ['Inference', 'ttest ittest tscore ittscore'],
  ['Calculus', 'exp ln log log2 deriv integral sum prod'],
  ['Hyperbolic', 'sinh cosh tanh csch sech coth asinh acosh atanh'],
  ['Geometry', 'polygon distance midpoint'],
  ['Custom colors', 'rgb hsv'],
  ['Matrices', 'det inv transpose rref trace'],
  ['Number theory', 'lcm gcd mod ceil floor round sign abs sqrt cbrt nthroot fact ncr npr hypot'],
  ['Advanced', 'tone with and or'],
];
// Words typed with spaces around them rather than as calls.
const WORDS = new Set(['with', 'for', 'and', 'or']);
// Keys that open a layout with slots in the editor, typed the way Desmos would type them.
const TYPED = {
  sqrt: 'sqrt',
  log: 'log',
  integral: 'int',
  sum: 'sum',
  prod: 'prod',
  nthroot: 'nthroot',
  deriv: 'd/dx',
};
const FN_LABEL = {
  arcsin: 'sin<sup>−1</sup>',
  arccos: 'cos<sup>−1</sup>',
  arctan: 'tan<sup>−1</sup>',
  arccsc: 'csc<sup>−1</sup>',
  arcsec: 'sec<sup>−1</sup>',
  arccot: 'cot<sup>−1</sup>',
  nthroot: '<sup><i>n</i></sup>√',
  fact: '<i>n</i>!',
};
const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
// [label, keys, help]. Pairs type both ends and step back between them.
const SYMBOLS = [
  [
    '<i>a</i><sub><i>b</i></sub>',
    '_',
    ['Subscript', 'Names a variable a₁ or x_y. Plain xy means x times y.', '_'],
  ],
  ['!', '!', ['Factorial', '5! = 120. Between whole numbers it’s a smooth curve.', '!']],
  ['′', "'", ['Derivative', 'After a function name: f′(x) is the slope of f.', "'"]],
  ['[ ]', ['[', ']', 'ArrowLeft'], ['List', 'Many values at once: [1, 2, 3], or [1...10].', '[']],
  [
    '{ }',
    ['{', '}', 'ArrowLeft'],
    ['Restriction', 'Draws only where it holds: y = x² {x > 0}. With a colon it makes cases.', '{'],
  ],
  [':', ':', ['Cases', 'Inside braces, condition: value. {x < 0: −x, x} is |x|.', ':']],
  ['~', '~', ['Fit', 'Fits a curve to data: y₁ ~ m x₁ + b finds m and b.', '~']],
  ['%', '%', ['Remainder', '7 % 3 = 1. mod(a, b) stays positive for negative a.', '%']],
  ['(', '('],
  [')', ')'],
  ['=', '='],
  [',', ','],
];
const CONSTANTS = [
  ['π', 'pi'],
  ['e', 'e'],
  ['τ', 'tau'],
  ['θ', 'theta'],
];
// [label, keys, help: [title, description, what to type on a keyboard], class]
const MAIN = [
  [
    ['<i>x</i>', 'x', ['x', 'The horizontal axis. y = 2x draws a line.', 'x']],
    ['<i>y</i>', 'y', ['y', 'The vertical axis. x = y² draws a sideways parabola.', 'y']],
    ['<i>a</i><sup>2</sup>', ['^', '2', 'ArrowRight'], ['Square', 'Multiplies a number by itself.', '^2']],
    ['<i>a</i><sup><i>b</i></sup>', ['^'], ['Power', 'Raises to any power. The cursor moves up.', '^']],
    ['(', '('],
    [')', ')'],
    ['&lt;', '<', ['Less than', 'Shades the region below a curve, as in y < x².', '<']],
    ['&gt;', '>', ['Greater than', 'Shades the region above a curve, as in y > x².', '>']],
    ['|<i>a</i>|', '|', ['Absolute value', 'Distance from zero, so |−3| = 3.', '|']],
    [',', ','],
    ['≤', ['<', '='], ['Less than or equal', 'Shades below a curve, including the curve itself.', '<=']],
    ['≥', ['>', '='], ['Greater than or equal', 'Shades above a curve, including the curve itself.', '>=']],
    ['√', 'sqrt', ['Square root', 'The number that squares to what’s inside.', 'sqrt']],
    ['π', 'pi', ['Pi', FN_HELP.pi[1], 'pi']],
    ['[', '[', ['List', 'Many values at once: [1, 2, 3], or a range like [1...10].', '[']],
    [']', ']', ['End list', 'Closes a list. y = [1, 2, 3]x draws three lines.', ']']],
  ],
  [
    ['7', '7'],
    ['8', '8'],
    ['9', '9'],
    ['÷', '/', ['Fraction', 'Starts a fraction. What you type next goes underneath.', '/']],
    ['4', '4'],
    ['5', '5'],
    ['6', '6'],
    ['×', '*', ['Multiply', 'Writing things side by side multiplies too, as in 2x.', '*']],
    ['1', '1'],
    ['2', '2'],
    ['3', '3'],
    ['−', '-', ['Subtract', 'Also makes a number negative.', '-']],
    ['0', '0'],
    ['.', '.'],
    ['=', '='],
    ['+', '+', ['Add', null, '+']],
  ].map(k => [k[0], k[1], k[2], 'num']),
];
const ICON = {
  left: '<svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6" /></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m10 6 6 6-6 6" /></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M9 6h11v12H9l-5-6zM12 9.5l5 5m0-5-5 5" /></svg>',
  enter: '<svg viewBox="0 0 24 24"><path d="M19 6v5a3 3 0 0 1-3 3H6m4-4-4 4 4 4" /></svg>',
  hide: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>',
  shift: '<svg viewBox="0 0 24 24"><path d="M12 4 4.5 12H9v7h6v-7h4.5z" /></svg>',
};
let target = null;
const pad = $('#keypad'),
  toggle = $('#keypad-toggle'),
  coarse = matchMedia('(pointer: coarse)'),
  tip = document.createElement('div');

// The expression the keypad types into: the one last focused, or the empty one at the bottom.
function editor() {
  if (!S.rows.includes(target) || !target.ed) target = [...S.rows].reverse().find(r => r.ed && !r.helper);
  return target?.ed;
}
function press(keys) {
  const ed = editor();
  if (!ed) return;
  if (document.activeElement !== ed.el) ed.focus();
  for (const key of typeof keys === 'string' && keys.length > 1 && !/^[A-Z]/.test(keys)
    ? [...keys]
    : [].concat(keys))
    document.activeElement?.onkeydown?.({
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() {},
      stopPropagation() {},
    });
}

/* Tooltips: the first waits a moment so passing the pointer over the keypad stays quiet; once one is showing,
   neighbours show at once, like the operating system's own. */
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const pretty = s =>
  esc(
    s
      .replace(/\bpi\b/g, 'π')
      .replace(/\^2\b/g, '²')
      .replace(/\*/g, '×')
      .replace(/-/g, '−'),
  );
let tipTimer = 0,
  tipKey = null,
  warmUntil = 0;
function tipHTML({ title, sig, group, desc, ex, value, type }) {
  const head = sig
    ? `<span class="kt-sig">${esc(sig).replace(/\w+(?=\()|^\w+$/, '<b>$&</b>')}</span>`
    : `<span class="kt-sig"><b>${esc(title)}</b></span>`;
  return (
    `<div class="kt-head">${head}${group ? `<span class="kt-group">${group}</span>` : ''}</div>` +
    (desc ? `<p>${esc(desc)}</p>` : '') +
    (ex
      ? `<div class="kt-ex"><code>${pretty(ex)}</code>${value === null ? '' : `<span>= ${pretty(value)}</span>`}</div>`
      : '') +
    (type ? `<div class="kt-type">Keyboard <kbd>${esc(type)}</kbd></div>` : '')
  );
}
function placeTip(b) {
  const r = b.getBoundingClientRect(),
    w = tip.offsetWidth,
    h = tip.offsetHeight,
    x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)),
    above = r.top - h - 10 >= 8;
  tip.style.left = x + 'px';
  tip.style.top = (above ? r.top - h - 10 : r.bottom + 10) + 'px';
  tip.style.setProperty('--nub', r.left + r.width / 2 - x + 'px');
  tip.classList.toggle('below', !above);
}
function showTip(b) {
  clearTimeout(tipTimer);
  const warm = performance.now() < warmUntil || !!tipKey,
    open = () => {
      tipKey = b;
      tip.innerHTML = tipHTML(b._help);
      tip.classList.toggle('warm', warm);
      tip.hidden = false;
      placeTip(b);
    };
  if (warm) open();
  else tipTimer = setTimeout(open, 450);
}
function hideTip() {
  clearTimeout(tipTimer);
  if (tipKey) warmUntil = performance.now() + 300;
  tipKey = null;
  tip.hidden = true;
}

function key(label, keys, help, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'kp-key' + (cls ? ' ' + cls : '');
  b.innerHTML = `<span>${label}</span>`;
  if (help) {
    b._help = help;
    b.setAttribute('aria-label', help.title || help.sig);
    if (help.desc) b.setAttribute('aria-description', help.desc);
    b.onpointerenter = e => e.pointerType === 'mouse' && showTip(b);
    b.onpointerleave = hideTip;
    b.onfocus = () => b.matches(':focus-visible') && showTip(b);
    b.onblur = hideTip;
  }
  b.onpointerdown = e => {
    e.preventDefault();
    hideTip();
  };
  b.onclick = () => press(typeof keys === 'function' ? keys() : keys);
  return b;
}
const mainHelp = ([title, desc, type] = []) => title && { title, desc, type };
// .pdf and friends are typed after a distribution, dot included.
function fnHelp(name, group) {
  const [sig, desc, ex, value] = FN_HELP[name.replace(/^\./, '')] || [name];
  return { title: name, sig, group, desc, ex, value, type: own(TYPED, name) ? TYPED[name] : name };
}
function group(cls, keys) {
  const g = document.createElement('div');
  g.className = 'kp-grid ' + cls;
  g.append(...keys.map(k => key(...k)));
  return g;
}
function build() {
  const main = document.createElement('div'),
    fns = document.createElement('div'),
    nav = group('kp-nav', [
      [ICON.left, 'ArrowLeft', mainHelp(['Move left', null, '←'])],
      [ICON.right, 'ArrowRight', mainHelp(['Move right', null, '→'])],
      [
        ICON.back,
        'Backspace',
        mainHelp(['Delete', 'Ctrl + Backspace clears the whole expression.', 'Backspace']),
        'wide',
      ],
      [ICON.enter, 'Enter', mainHelp(['New expression', null, 'Enter']), 'wide enter'],
    ]);
  main.className = 'kp-page';
  main.dataset.page = 'main';
  main.append(
    ...MAIN.map((keys, i) =>
      group(
        i ? 'kp-nums' : 'kp-vars',
        keys.map(([label, k, help, cls]) => [label, k, mainHelp(help), cls]),
      ),
    ),
  );
  fns.className = 'kp-page kp-fns';
  fns.dataset.page = 'fns';
  fns.hidden = true;
  fns.onscroll = hideTip;
  for (const [name, list] of [...FNS, ['Constants', null]]) {
    const head = document.createElement('h3');
    head.textContent = name;
    fns.append(
      head,
      group(
        'kp-fn-grid',
        list
          ? list
              .split(' ')
              .map(n => [
                FN_LABEL[n] || n,
                own(TYPED, n) ? TYPED[n] : WORDS.has(n) ? ' ' + n + ' ' : n + '(',
                fnHelp(n, name),
                'fn',
              ])
          : CONSTANTS.map(([g, n]) => [g, n, fnHelp(n, name), 'fn']),
      ),
    );
  }
  pad.querySelector('.kp-body').append(main, letters(), fns, nav);
}
// Letters, with a shift that capitalises the next one only.
function letters() {
  let caps = false;
  const letter = c => [
      c,
      () => {
        const typed = caps ? c.toUpperCase() : c;
        setCaps(false);
        return typed;
      },
      null,
      'letter',
    ],
    rows = LETTERS.map(row => [...row].map(letter)),
    page = group('kp-page kp-abc', [
      ...rows[0],
      ...rows[1],
      ['θ', 'theta', fnHelp('theta', 'Constants')],
      [ICON.shift, () => [], mainHelp(['Shift', 'The next letter is a capital.', 'Shift']), 'shift'],
      ...rows[2],
      ...SYMBOLS.map(([label, k, help]) => [label, k, mainHelp(help)]),
    ]),
    shift = page.querySelector('.shift'),
    setCaps = on => {
      caps = on;
      page.classList.toggle('caps', on);
      shift.setAttribute('aria-pressed', String(on));
    };
  shift.addEventListener('click', () => setCaps(!caps));
  setCaps(false);
  page.dataset.page = 'abc';
  page.hidden = true;
  return page;
}
function setPage(page) {
  hideTip();
  pad.querySelectorAll('.kp-page').forEach(p => (p.hidden = p.dataset.page !== page));
  pad
    .querySelectorAll('[role=tab]')
    .forEach(t => t.setAttribute('aria-selected', String(t.dataset.page === page)));
}
function show(open) {
  if (!open) hideTip();
  pad.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('keypad-open', open);
  document.body.style.setProperty('--kp-h', open ? pad.offsetHeight + 'px' : '0px');
}
export function initKeypad() {
  tip.className = 'kp-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  pad.querySelector('.kp-hide').innerHTML = ICON.hide;
  build();
  toggle.onclick = () => {
    show(pad.hidden);
    if (!pad.hidden) editor()?.focus();
  };
  pad.querySelector('.kp-hide').onclick = () => show(false);
  pad.querySelectorAll('[role=tab]').forEach(t => {
    t.onpointerdown = e => e.preventDefault();
    t.onclick = () => setPage(t.dataset.page);
  });
  document.addEventListener('focusin', e => {
    const r = S.rows.find(r => r.ed?.el === e.target);
    if (!r) return;
    target = r;
    // A phone has no other way to type into an expression.
    if (coarse.matches && pad.hidden) show(true);
  });
  addEventListener('resize', () => !pad.hidden && show(true));
}
