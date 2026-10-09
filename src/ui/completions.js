import { rebuild } from '../app/model.js';
import { frameFractal } from '../app/scenes.js';
import { S } from '../app/state.js';
import { $ } from '../core/dom.js';
import { constants, math } from '../math/catalog.js';
import { FRACTALS, fractalText } from '../math/fractals.js';

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
    ...Object.keys(math).map(name => ({
      label: name,
      detail: 'Math function',
      value: name + '()',
      caret: 1,
    })),
    ...Object.keys(constants).map(name => ({
      label: name,
      detail: 'Constant',
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
    {
      label: 'deriv',
      detail: 'Numerical derivative · deriv(f, x)',
      value: 'deriv(f, x)',
    },
    {
      label: 'integral',
      detail: 'Definite integral · integral(f, 0, x)',
      value: 'integral(f, 0, x)',
    },
    ...[...S.env.fn.keys()].map(name => ({
      label: name,
      detail: 'Your function',
      value: name + '()',
      caret: 1,
    })),
    ...[...S.env.def.keys(), ...Object.keys(S.vars)].map(name => ({
      label: name,
      detail: 'Your parameter',
      value: name,
    })),
  ];
  return catalog
    .filter(
      (x, i, a) =>
        x.label.toLowerCase().startsWith(token.toLowerCase()) &&
        a.findIndex(y => y.label === x.label) === i &&
        x.label.toLowerCase() !== token.toLowerCase(),
    )
    .sort((a, b) => {
      const c = ['sin', 'cos', 'tan', 'sqrt', 'abs', 'ln', 'log', 'exp', 'floor', 'round'],
        f = x => (c.includes(x.label) ? c.indexOf(x.label) : 99);
      return f(a) - f(b);
    })
    .slice(0, 6)
    .map(x => {
      const end = pos + (input.value.slice(pos).match(/^\w*/)?.[0].length || 0);
      return {
        ...x,
        start,
        end,
        ...(x.value.endsWith('()') && /^\s*\(/.test(input.value.slice(end))
          ? {
              value: x.label,
              caret: 0,
            }
          : {}),
      };
    });
}
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
  input.value = input.value.slice(0, item.start) + item.value + input.value.slice(item.end);
  r.text = input.value;
  if (r.ed) r.ed.reload();
  if (item.fractal) r.col = '#ff783b';
  closeCompletions();
  rebuild();
  input.focus();
  const pos = item.start + item.value.length - (item.caret || 0);
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
  header.textContent = 'TAB TO INSERT · ↑ ↓ TO CHOOSE';
  completionBox.append(header);
  items.forEach((item, i) => {
    const button = document.createElement('div');
    button.id = 'completion-option-' + i;
    button.setAttribute('role', 'option');
    button.className = 'completion-option';
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
  selectCompletion(0);
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
      if (e.key === 'Tab' || (e.key === 'Enter' && S.completion.navigated)) {
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
