import { rebuild } from '../app/model.js';
import { frameFractal } from '../app/scenes.js';
import { S } from '../app/state.js';
import { $ } from '../core/dom.js';
import { constants, math, own } from '../math/catalog.js';
import { FRACTALS, fractalText } from '../math/fractals.js';
import { LONG_FORMS, NAMES, nameMatch } from '../math/names.js';
import { productName } from '../math/parser.js';
import { FN_HELP } from './keyHelp.js';
import { NEW, del, replaceRow } from './panel.js';
import { THEMES } from '../app/theme.js';
import { chooseTheme } from './themeMenu.js';

const REG = [
  ['Linear', 'y ~ m*x+b'],
  ['Quadratic', 'y ~ a*x^2+b*x+c'],
  ['Cubic', 'y ~ a*x^3+b*x^2+c*x+d'],
  ['Exponential', 'y ~ a*exp(b*x)'],
  ['Power', 'y ~ a*x^b'],
  ['Logarithmic', 'y ~ a*ln(x)+b'],
  ['Logistic', 'y ~ L/(1+exp(-k*(x-x0)))'],
  ['Sinusoidal', 'y ~ a*sin(b*x+c)+d'],
];
export const STATS = {
  length: 'number of elements',
  count: 'number of elements',
  total: 'sum of a list',
  mean: 'average',
  average: 'mean',
  median: 'middle value',
  mode: 'most common value',
  var: 'sample variance',
  variance: 'sample variance, var',
  varp: 'population variance',
  populationvariance: 'varp',
  stdev: 'sample standard deviation',
  stddev: 'sample standard deviation',
  standarddeviation: 'sample, stdev',
  stdevp: 'population standard deviation',
  stddevp: 'population standard deviation',
  populationstandarddeviation: 'stdevp',
  mad: 'mean absolute deviation',
  meanabsolutedeviation: 'mad',
  quantile: 'quantile(L, p), p from 0 to 1',
  quartile: 'quartile(L, q), q from 0 to 4',
  stats: '[min, Q1, median, Q3, max]',
  cov: 'sample covariance of two lists',
  covariance: 'cov',
  covp: 'population covariance',
  populationcovariance: 'covp',
  corr: 'correlation of two lists',
  correlation: 'corr',
  spearman: 'rank correlation of two lists',
  min: 'smallest value',
  minimum: 'min',
  max: 'largest value',
  maximum: 'max',
  sort: 'smallest to largest',
  unique: 'repeats removed',
  join: 'lists joined end to end',
};
/* Context-aware expression completions: local math catalog, no network requests. */
const completionBox = document.createElement('div');
export function closeCompletions() {
  if (S.completion) {
    S.completion.r.inp.setAttribute('aria-expanded', 'false');
    S.completion.r.inp.removeAttribute('aria-activedescendant');
  }
  S.completion = null;
  completionBox.hidden = true;
}
function completionItems(r) {
  const input = r.inp,
    pos = input.selectionStart ?? input.value.length,
    before = input.value.slice(0, pos),
    token = before.match(/[A-Za-z_][\w]*$/)?.[0] || '',
    start = pos - token.length,
    whole = input.value.trim();
  if (/^\s*(y\s*~|reg)/i.test(before) || /^\s*reg\w*$/i.test(whole))
    return REG.map(([label, value]) => ({
      label,
      detail: value,
      value,
      start: 0,
      end: input.value.length,
    }));
  if (/^\s*fractal\s*\(\s*[\w]*$/i.test(before) || /^fra\w*$/i.test(whole)) {
    const prefix = /\(/.test(before) ? token.toLowerCase() : '';
    return Object.entries(FRACTALS)
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, spec]) => ({
        label: spec.title,
        detail: spec.hint,
        value: fractalText(name),
        start: 0,
        end: input.value.length,
        fractal: true,
        selection: fractalText(name).indexOf(', ') + 2,
      }))
      .concat(
        !whole
          ? [
              {
                label: 'Linear regression',
                detail: 'y ~ m*x+b',
                value: 'y ~ m*x+b',
                start: 0,
                end: 0,
              },
              {
                label: 'More regressions…',
                detail: 'Quadratic, exponential, power, log, logistic, sine',
                value: 'y ~ ',
                start: 0,
                end: 0,
                browse: true,
              },
              {
                label: 'Circle',
                detail: 'One continuous implicit curve',
                value: 'x^2+y^2=9',
                start: 0,
                end: 0,
              },
              {
                label: 'Sine wave',
                detail: 'A simple Cartesian function',
                value: 'y = sin(x)',
                start: 0,
                end: 0,
              },
            ]
          : [],
      );
  }
  if (token.length < 2) return [];
  const catalog = [
    ...functionItems(token),
    ...Object.keys(constants).map(name => ({
      label: name,
      detail: name === 'i' ? 'Imaginary unit' : 'Constant',
      value:
        {
          pi: 'π',
          tau: 'τ',
        }[name] || name,
    })),
    {
      label: 'fractal',
      detail: 'Browse fractal families',
      value: 'fractal(',
      browse: true,
    },
    ...[...S.env.fn.keys()].map(name => ({
      label: name,
      detail: 'Your function',
      value: name + '()',
      caret: 1,
    })),
    ...[...S.env.def].map(([name, d]) => ({
      label: name,
      detail: ['list', 'range'].includes(d.ast.k) ? 'Your list' : 'Your variable',
      value: name,
      mine: d.row,
    })),
    ...Object.keys(S.vars).map(name => ({
      label: name,
      detail: 'Slider',
      value: name,
      mine: S.rows.find(q => q.id === S.VM[name]?.own),
    })),
  ];
  const found = catalog
    .filter(
      (x, i, a) =>
        (x.rank !== undefined || x.label.toLowerCase().startsWith(token.toLowerCase())) &&
        a.findIndex(y => y.label === x.label) === i &&
        x.label.toLowerCase() !== token.toLowerCase(),
    )
    .sort((a, b) => {
      const c = ['sin', 'cos', 'tan', 'sqrt', 'abs', 'ln', 'log', 'exp', 'floor', 'round'],
        f = x => (c.includes(x.name) ? c.indexOf(x.name) : 99);
      return (a.rank ?? 0) - (b.rank ?? 0) || f(a) - f(b);
    })
    .slice(0, 6);
  // A row holding just "table", "note", "matrix" … can become that, as the add menu would make it.
  const actions =
    whole.toLowerCase() === token.toLowerCase()
      ? ACTIONS.filter(([, , words]) => words.some(w => w.startsWith(token.toLowerCase()))).map(
          ([label, detail, , action]) => ({ label, detail, value: '', action }),
        )
      : [];
  found.unshift(...actions);
  // What was typed comes first: a known function as itself ("tan"), otherwise as a name of its own ("vari")
  // that the user can keep while the best match stays selected.
  // A half-typed name gets an automatic slider, so only a definition in another row counts as the user's own.
  const exact = catalog.find(x => x.label === token && (!x.mine || (S.env.def.get(token)?.row || r) !== r));
  const end = pos + (input.value.slice(pos).match(/^\w*/)?.[0].length || 0);
  // xy reads as x·y; the subscripted x_y is offered as the way to make it one name.
  const product =
    !exact && productName(token)
      ? [
          {
            label: [...token].join('·'),
            detail: 'Multiply, how ' + token + ' is read',
            value: token,
            keep: true,
          },
          {
            label: token[0] + '_' + token.slice(1),
            detail: 'One name, written with a subscript',
            value: token[0] + '_' + token.slice(1),
          },
        ]
      : null;
  if (product)
    return [...product, ...found].map(x => ({
      ...x,
      start,
      end: x.keep ? pos : end,
      word: true,
      product: true,
    }));
  if (!found.length && !exact?.caret) return [];
  return [exact || { label: token, detail: 'Keep as typed', value: token, keep: true }, ...found].map(x => ({
    ...x,
    start,
    end: x.keep ? pos : end,
    drop: pos - start,
    ...(x.value.endsWith('()') && /^\s*\(/.test(input.value.slice(end))
      ? {
          value: x.name,
          caret: 0,
          node: null,
        }
      : {}),
    word: true,
  }));
}
// What ∫, Σ … are written as where there is no maths editor to lay them out.
const LAYOUT_TEXT = {
  int: ['integral(f, x)', 0, '∫'],
  deriv: ['deriv(f, x)', 0, 'd/dx'],
  sum: ['sum(n, n, 1, 10)', 0, 'Σ'],
  prod: ['prod(n, n, 1, 10)', 0, '∏'],
  sqrt: ['sqrt()', 1, '√'],
  nthroot: ['nthroot()', 1, 'ⁿ√'],
  abs: ['abs()', 1, '|x|'],
  log: ['log()', 1, 'log'],
};
/* Functions found by their name, long name or another name. A long name shows as typed, "standard deviation",
   while the row gets the short name, stdev, or the layout itself: ∫ for integral, √ for square root. */
function functionItems(token) {
  return [...new Set([...Object.keys(NAMES), ...Object.keys(math)])]
    .filter(n => !LONG_FORMS.has(n))
    .flatMap(name => {
      const m = nameMatch(name, token);
      if (!m) return [];
      const [long = name, kind = own(STATS, name) ? 'Statistics' : 'Math function', , layout] =
          NAMES[name] || [],
        [text, caret, shown] = LAYOUT_TEXT[layout] || [name + '()', 1, name];
      return [
        {
          label: m.label,
          detail:
            kind +
            ' · ' +
            (layout || m.label !== name
              ? 'writes ' + shown
              : long !== name
                ? long
                : FN_HELP[name]?.[1].split(/[.:]/)[0] || kind),
          value: text,
          caret,
          node: layout || null,
          name,
          rank: m.rank,
        },
      ];
    });
}
const click = id => () => $(id).click(),
  // Actions that turn the row itself into something, rather than act elsewhere.
  into = kind => Object.assign(r => replaceRow(r, NEW[kind]()), { keepsRow: true }),
  ACTIONS = [
    ['Table', 'Turn this row into a table', ['table', 'tables'], into('table')],
    [
      'Data + fit',
      'A table of data with a line of best fit',
      ['data', 'datafit', 'fit', 'scatter', 'bestfit'],
      into('data'),
    ],
    ['Note', 'A line of text between expressions', ['note', 'text', 'comment'], into('note')],
    [
      'Matrix calculator',
      'Determinants, inverses and row reduction',
      ['matrix', 'matrices'],
      click('#mx-open'),
    ],
    ['Import .ggb', 'Open a GeoGebra file', ['import', 'geogebra', 'ggb'], click('#import-ggb')],
    ['Read aloud', 'Describe the graph out loud', ['readaloud', 'read', 'speak'], click('#read')],
    [
      'Audio trace',
      'Hear the curves, left to right',
      ['audiotrace', 'audio', 'sonify', 'listen'],
      click('#trace'),
    ],
    ...Object.entries(THEMES).map(([id, t]) => [
      `${t.name} theme`,
      t.note,
      [
        id + 'theme',
        id,
        'theme',
        ...(id === 'contrast' ? ['highcontrast'] : []),
        ...(id === 'safe' ? ['colourblind', 'colorblind'] : []),
      ],
      () => chooseTheme(id),
    ]),
  ];
// Name suggestions take Enter straight away; whole-row templates only after the user has picked one.
export const enterAccepts = () => !!S.completion && (S.completion.navigated || S.completion.items[0].word);
function placeCompletions() {
  if (!S.completion) return;
  const b = (S.completion.r.ed?.el || S.completion.r.inp).getBoundingClientRect(),
    width = Math.min(370, innerWidth - 24);
  completionBox.style.width = width + 'px';
  completionBox.style.left = Math.max(12, Math.min(b.left, innerWidth - width - 12)) + 'px';
  const roomBelow = innerHeight - b.bottom - 16,
    above = roomBelow < 180;
  completionBox.style.maxHeight = Math.max(90, Math.min(340, above ? b.top - 18 : roomBelow)) + 'px';
  completionBox.style.top = above ? 'auto' : b.bottom + 8 + 'px';
  completionBox.style.bottom = above ? innerHeight - b.top + 8 + 'px' : 'auto';
}
export function selectCompletion(index) {
  if (!S.completion) return;
  S.completion.index = (index + S.completion.items.length) % S.completion.items.length;
  const opts = completionBox.querySelectorAll('[role=option]');
  opts.forEach((el, i) => el.setAttribute('aria-selected', String(i === S.completion.index)));
  const option = opts[S.completion.index];
  S.completion.r.inp.setAttribute('aria-activedescendant', option.id);
  option.scrollIntoView({
    block: 'nearest',
  });
}
export function acceptCompletion() {
  if (!S.completion) return;
  const { r, items, index } = S.completion,
    item = items[index],
    input = r.inp;
  if (item.action) {
    closeCompletions();
    input.value = r.text = '';
    r.ed?.reload(0);
    // The row was only there for the word; an empty row already waits at the end.
    const i = S.rows.indexOf(r);
    if (i < S.rows.length - 1 && !S.rows.at(-1).text.trim() && !item.action.keepsRow) del(i);
    else rebuild();
    item.action(r);
    return;
  }
  if (item.node && r.ed) {
    closeCompletions();
    r.ed.insert(item.node, item.drop);
    return;
  }
  input.value = input.value.slice(0, item.start) + item.value + input.value.slice(item.end);
  r.text = input.value;
  const pos = item.start + item.value.length - (item.caret || 0);
  if (r.ed) r.ed.reload(pos);
  if (item.fractal) r.col = '#ff783b';
  closeCompletions();
  rebuild();
  input.focus();
  if (item.fractal) {
    const start = item.selection,
      end = input.value.indexOf(',', start);
    input.setSelectionRange(start, end < 0 ? input.value.length - 1 : end);
    frameFractal();
  } else input.setSelectionRange(pos, pos);
  if (item.browse) updateCompletions(r);
}
export function updateCompletions(r) {
  const items = completionItems(r);
  closeCompletions();
  if (!items.length) return;
  S.completion = {
    r,
    items,
    index: 0,
  };
  completionBox.replaceChildren();
  const header = document.createElement('div');
  header.className = 'completion-head';
  header.textContent = items[0].word ? 'ENTER TO INSERT · ↑ ↓ TO CHOOSE' : 'TAB TO INSERT · ↑ ↓ TO CHOOSE';
  completionBox.append(header);
  items.forEach((item, i) => {
    const button = document.createElement('div');
    button.id = 'completion-option-' + i;
    button.setAttribute('role', 'option');
    button.className = 'completion-option' + (item.keep ? ' keep' : '');
    const title = document.createElement('strong'),
      detail = document.createElement('span'),
      arrow = document.createElement('b');
    title.textContent = item.label;
    detail.textContent = item.detail;
    arrow.textContent = '↵';
    button.append(title, detail, arrow);
    button.onpointerdown = e => {
      e.preventDefault();
      S.completion.index = i;
      acceptCompletion();
    };
    completionBox.append(button);
  });
  completionBox.hidden = false;
  r.inp.setAttribute('aria-expanded', 'true');
  placeCompletions();
  selectCompletion(items[0].keep && !items[0].product ? 1 : 0);
}
export function bindCompletions(r) {
  const input = r.inp;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'completions');
  input.setAttribute('aria-expanded', 'false');
  const previousInput = input.oninput,
    previousKey = input.onkeydown;
  input.oninput = e => {
    previousInput(e);
    updateCompletions(r);
  };
  input.onblur = () =>
    setTimeout(() => {
      if (S.completion?.r === r && document.activeElement !== input) closeCompletions();
    }, 120);
  input.onkeydown = e => {
    if (e.isComposing) return;
    if (S.completion?.r === r) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        S.completion.navigated = true;
        selectCompletion(S.completion.index + (e.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && enterAccepts())) {
        e.preventDefault();
        acceptCompletion();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeCompletions();
        return;
      }
    }
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      updateCompletions(r);
      return;
    }
    previousKey(e);
  };
  input.addEventListener('click', () => updateCompletions(r));
}

export function initCompletions() {
  completionBox.id = 'completions';
  completionBox.hidden = true;
  completionBox.setAttribute('role', 'listbox');
  completionBox.setAttribute('aria-label', 'Expression suggestions');
  document.body.append(completionBox);
  window.addEventListener('resize', placeCompletions);
  $('#rows').addEventListener('scroll', placeCompletions);
  document.addEventListener('pointerdown', e => {
    if (S.completion && !completionBox.contains(e.target) && e.target !== S.completion.r.inp)
      closeCompletions();
  });

  /* GeoGebra ZIP/XML importer. Only construction data is interpreted. */
}
