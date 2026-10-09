import {
  columnColour,
  compile,
  fractalParams,
  geoValue,
  makeRow,
  parameter,
  rebuild,
  setVar,
  tableFit,
  tableValues,
  val,
} from '../app/model.js';
import { saveSoon } from '../app/persistence.js';
import { frameFractal } from '../app/scenes.js';
import { S } from '../app/state.js';
import { $ } from '../core/dom.js';
import { makeEditor } from '../editor/mathEditor.js';
import { SYM, own } from '../math/catalog.js';
import { fmt } from '../math/format.js';
import { isGeoText } from '../io/geogebraEval.js';
import { boxCells, boxDimension, defaultBoxSize } from '../math/boxCount.js';
import { FRACTALS, fractalText } from '../math/fractals.js';
import { FITS, columnName, emptyTable, fitEquation, isTableText, writeTable } from '../math/table.js';
import { kick } from '../render/renderer.js';
import { bindCompletions, closeCompletions, updateCompletions } from './completions.js';
import { nm, pretty } from './mathDisplay.js';

function autoSym(inp) {
  const pos = inp.selectionStart,
    v = inp.value,
    b = v.slice(0, pos),
    m = b.match(/[A-Za-z]+$/);
  let r = null,
    len = 0;
  if (m && own(SYM, m[1])) {
    r = SYM[m[1]];
    len = m[1].length;
  } else if (/<=$|>=$/.test(b)) {
    r = b.endsWith('<=') ? '≤' : '≥';
    len = 2;
  } else {
    const sm = b.match(/(?<![A-Za-z_])([A-Za-zα-ω][₀-₉]*)(\d)$/);
    if (sm && !(/^[eE]/.test(sm[1]) && /\d$/.test(b.slice(0, b.length - sm[0].length)))) {
      r = String.fromCharCode(0x2080 + +sm[2]);
      len = 1;
    }
  }
  if (r) {
    inp.value = v.slice(0, pos - len) + r + v.slice(pos);
    const q = pos - len + r.length;
    inp.setSelectionRange(q, q);
  }
}
export function showError(r) {
  decorate(r);
  if (r.errEl) {
    const answer = !r.err && r.k?.type === 'calc';
    r.errEl.textContent = r.err || r.info;
    r.errEl.style.color = r.err || answer ? '' : 'var(--dim)';
    r.errEl.classList.toggle('answer', answer);
  }
}
export function syncSliders() {
  for (const r of S.rows)
    for (const el of r.slEl?.children || []) {
      if (!el.dataset.v) continue;
      let v;
      try {
        v = parameter(el.dataset.v);
      } catch {
        continue;
      }
      el.querySelector('input').value = v;
      el.querySelector('input').style.setProperty(
        '--fill',
        ((v - S.VM[el.dataset.v].min) / (S.VM[el.dataset.v].max - S.VM[el.dataset.v].min)) * 100 + '%',
      );
      el.querySelector('b').textContent = fmt(v);
    }
}
export function sliders(r) {
  if (!r.slEl) return;
  // A rebuild redraws a table's grid; remember the cell being typed in so tableUI can restore it.
  const was = document.activeElement;
  r.cellFocus =
    r.slEl.contains(was) && was.closest('.tbl') ? [+was.dataset.i, +was.dataset.j, was.selectionStart] : null;
  r.slEl.replaceChildren();
  if (r.k?.type === 'lreg' || r.k?.reg) return;
  for (const n of Object.keys(S.VM).filter(n => S.VM[n].own === r.id)) {
    const m = S.VM[n],
      d = document.createElement('div');
    d.className = 'sl';
    d.dataset.v = n;
    const label = document.createElement('span');
    label.innerHTML = nm(n);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = m.min;
    input.max = m.max;
    input.step = 'any';
    input.setAttribute('aria-label', n);
    let v = 1;
    try {
      v = parameter(n);
    } catch {}
    input.value = v;
    const b = document.createElement('b');
    b.textContent = fmt(v);
    const play = document.createElement('button');
    play.textContent = S.playing.has(n) ? '❚❚' : '▶';
    play.setAttribute('aria-label', 'Animate ' + n);
    play.onclick = () => {
      S.playing.has(n) ? S.playing.delete(n) : S.playing.add(n);
      play.textContent = S.playing.has(n) ? '❚❚' : '▶';
      kick();
    };
    input.oninput = () => setVar(n, +input.value);
    input.style.setProperty('--fill', ((v - m.min) / (m.max - m.min)) * 100 + '%');
    input.step = m.step || 'any';
    label.title = 'Change the limits';
    label.onclick = () => {
      d.closest('.row')?.classList.add('edit-limits');
      lim.querySelector('input').focus();
    };
    d.append(label, input, b, play);
    const lim = limitsEditor(n, input);
    r.slEl.append(d, lim);
  }
  if (r.slEl.contains(was) || !was?.dataset.k) return;
  const back = r.slEl.querySelector(
    `[data-lim="${was.closest('[data-lim]')?.dataset.lim}"] [data-k="${was.dataset.k}"]`,
  );
  back?.focus();
}
function readLimit(text) {
  try {
    return val(compile(text.replace(/π/g, 'pi')));
  } catch {
    return NaN;
  }
}
/* Shown in place of the slider while its row is being edited: lower ≤ name ≤ upper, and a step. */
function limitsEditor(n, slider) {
  const m = S.VM[n],
    box = document.createElement('div'),
    field = (k, value, label) => {
      const i = document.createElement('input');
      i.dataset.k = k;
      i.value = value;
      i.spellcheck = false;
      i.autocomplete = 'off';
      i.setAttribute('aria-label', label);
      i.oninput = apply;
      i.onkeydown = e => {
        if (e.key === 'Enter' || e.key === 'Escape') i.blur();
      };
      return i;
    },
    words = (html, cls) => {
      const s = document.createElement('span');
      s.innerHTML = html;
      if (cls) s.className = cls;
      return s;
    };
  box.className = 'sl-lim';
  box.dataset.lim = n;
  const lo = field('min', fmt(m.min), `Lowest ${n}`),
    hi = field('max', fmt(m.max), `Highest ${n}`),
    st = field('step', m.step ? fmt(m.step) : '', `Step for ${n}`);
  st.placeholder = 'any';
  function apply() {
    const a = readLimit(lo.value),
      b = readLimit(hi.value),
      s = st.value.trim() ? readLimit(st.value) : 0,
      order = !(a >= b);
    lo.classList.toggle('bad', !Number.isFinite(a) || !order);
    hi.classList.toggle('bad', !Number.isFinite(b) || !order);
    st.classList.toggle('bad', !(s >= 0 && s <= b - a));
    if (!(a < b && s >= 0 && s <= b - a)) return;
    const vm = S.VM[n];
    if (!vm) return;
    S.ranges[n] = { min: a, max: b, step: s };
    Object.assign(vm, S.ranges[n]);
    slider.min = a;
    slider.max = b;
    slider.step = s || 'any';
    let v;
    try {
      v = parameter(n);
    } catch {}
    const inside = Math.min(b, Math.max(a, v));
    if (Number.isFinite(v) && (inside !== v || s)) setVar(n, inside);
    else syncSliders();
    saveSoon();
  }
  box.append(lo, words(`≤ ${nm(n)} ≤`, 'sl-lim-name'), hi, words('Step', 'sl-lim-step'), st);
  return box;
}

/* Damped least squares, with finite input checks and parameter rollback. */
export function regCard(r) {
  if (!r.stat || !r.slEl || r.err) return;
  const S = r.stat,
    box = document.createElement('div'),
    sec = (t, items) =>
      `<div class="rh">${t}</div><div class="rg">${items.map(i => `<span>${i}</span>`).join('')}</div>`,
    res = S.resid.slice(0, 6).map(fmt).join(', ') + (S.resid.length > 6 ? ', …' : '');
  box.className = 'rcard';
  box.innerHTML =
    (S.params.length
      ? sec(
          'REGRESSION PARAMETERS',
          S.params.map(([n, v]) => nm(n) + ' = ' + fmt(v)),
        )
      : '') +
    sec(
      'STATISTICS',
      S.stats.map(([n, v]) => nm(n) + ' = ' + fmt(v)),
    ) +
    sec('RESIDUALS', [nm('e') + ' = [' + res + ']']);
  r.slEl.append(box);
}
const blankCell = s => !String(s ?? '').trim();
function nextColumnName(T) {
  const used = new Set(T.cols.map(c => columnName(c.h)));
  let n = 1;
  while (used.has('y' + n)) n++;
  return 'y' + n;
}
// Trailing empty cells and empty, unnamed columns are dropped so the stored table stays minimal.
function tidyTable(T) {
  for (const c of T.cols) while (c.v.length && blankCell(c.v.at(-1))) c.v.pop();
  T.cols = T.cols.filter((c, j) => j < 2 || c.h.trim() || c.v.some(v => !blankCell(v)));
  if (T.fit && T.fit.y >= T.cols.length) T.fit.y = 1;
  return T;
}
/* Desmos-style table: header formulas, any number of columns, live cells, paste from a spreadsheet,
   and a regression chosen from a menu. The stored text is rewritten on every keystroke. */
export function tableUI(r) {
  const row = r.inp?.closest('.row');
  row?.classList.toggle('is-table', r.k?.type === 'table');
  if (!r.slEl || r.k?.type !== 'table') return;
  const T = r.k.table,
    { xs, cols } = tableValues(r),
    rows = Math.max(0, ...T.cols.map(c => c.v.length)),
    width = T.cols.length + 1,
    box = document.createElement('div'),
    scroll = document.createElement('div'),
    table = document.createElement('table');
  box.className = 'tbl-box';
  scroll.className = 'tbl-scroll';
  table.className = 'tbl';

  const cell = (i, j) => {
    const input = document.createElement('input'),
      c = T.cols[j],
      K = r.k.cols[j],
      computed = i >= 0 && j > 0 && (K?.formula || K?.err);
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.i = i;
    input.dataset.j = j;
    if (i < 0) {
      input.value = c?.h ?? '';
      input.placeholder = j === T.cols.length ? '+' : '';
      input.setAttribute('aria-label', 'Column ' + (j + 1) + ' heading');
      if (K?.err) {
        input.classList.add('bad');
        input.title = K.err;
      }
    } else if (computed) {
      const v = cols[j - 1]?.ys[i];
      input.value = i < xs.length && Number.isFinite(v) ? fmt(v) : '';
      input.readOnly = true;
      input.tabIndex = -1;
      input.classList.add('calc');
    } else {
      input.value = c?.v[i] ?? '';
      input.inputMode = 'decimal';
      if (j === T.cols.length) input.tabIndex = -1;
      input.setAttribute('aria-label', 'Row ' + (i + 1) + ', column ' + (j + 1));
      if (K?.cells[i] && !Number.isFinite(j ? cols[j - 1]?.ys[i] : xs[i])) {
        input.classList.add('bad');
        input.title = K.cells[i].err ? 'Not a number yet: ' + K.cells[i].err : 'This cell has no value';
      }
    }
    if (!input.readOnly) {
      input.oninput = () => edit(i, j, input.value, input.selectionStart);
      input.onkeydown = e => keys(e, i, j, input);
      input.onpaste = e => paste(e, i, j);
    }
    return input;
  };

  const head = document.createElement('tr');
  for (let j = 0; j < width; j++) {
    const th = document.createElement('th'),
      c = T.cols[j];
    if (j > 0 && c) {
      const dot = document.createElement('button');
      dot.className = 'pt-dot' + (c.off ? ' off' : '');
      dot.style.setProperty('--curve', columnColour(r, j));
      dot.setAttribute('aria-label', (c.off ? 'Show ' : 'Hide ') + 'column ' + (j + 1));
      dot.setAttribute('aria-pressed', String(!c.off));
      dot.onmousedown = e => e.preventDefault();
      dot.onclick = () => {
        const next = structuredClone(T);
        next.cols[j].off = !c.off || undefined;
        commit(next);
      };
      th.append(dot);
    }
    const label = document.createElement('span');
    label.className = 'th-math';
    label.innerHTML = c?.h.trim() && !r.k.cols[j]?.err ? `<span>${pretty(c.h)}</span>` : '';
    th.append(label, cell(-1, j));
    if (j === T.cols.length) th.className = 'th-new';
    head.append(th);
  }
  const thead = document.createElement('thead'),
    body = document.createElement('tbody');
  thead.append(head);
  for (let i = 0; i <= rows; i++) {
    const tr = document.createElement('tr');
    for (let j = 0; j < width; j++) {
      const td = document.createElement('td');
      td.append(cell(i, j));
      if (j === T.cols.length) td.className = 'td-new';
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(thead, body);
  scroll.append(table);
  box.append(scroll);
  const problem = r.k.cols.find(c => c.err);
  if (problem) {
    const note = document.createElement('p');
    note.className = 'tbl-note';
    note.textContent = problem.err;
    box.append(note);
  }
  box.append(fitBar());
  r.slEl.append(box);
  if (r.cellFocus) focusTableCell(r, ...r.cellFocus);

  function fitBar() {
    const bar = document.createElement('div'),
      model = document.createElement('select');
    bar.className = 'tbl-fitbar';
    model.className = 'tbl-select';
    model.setAttribute('aria-label', 'Regression model');
    model.innerHTML =
      '<option value="">No regression</option>' +
      Object.entries(FITS)
        .map(([k, m]) => `<option value="${k}">${m.label} regression</option>`)
        .join('');
    model.value = T.fit?.type || '';
    model.onchange = () => {
      const next = structuredClone(T);
      if (model.value) next.fit = { type: model.value, y: T.fit?.y || 1 };
      else delete next.fit;
      commit(next);
    };
    const line = document.createElement('div');
    line.className = 'tbl-fitline';
    line.append(model);
    const ys = r.k.cols.slice(1);
    if (T.fit && ys.length > 1) {
      const which = document.createElement('select');
      which.className = 'tbl-select';
      which.setAttribute('aria-label', 'Column to fit');
      which.append(...ys.map(c => new Option('for ' + (T.cols[c.j].h || 'column ' + (c.j + 1)), c.j)));
      which.value = String(T.fit.y);
      which.onchange = () => {
        const next = structuredClone(T);
        next.fit.y = +which.value;
        commit(next);
      };
      line.append(which);
    }
    bar.append(line);
    const fit = tableFit(r);
    if (!fit) return bar;
    const info = document.createElement('div');
    info.className = 'rcard tbl-stats';
    if (fit.error) {
      info.innerHTML = `<div class="rh">${fit.error}</div>`;
      bar.append(info);
      return bar;
    }
    const yName = fit.column.name || 'y',
      eq = fitEquation(fit, yName, r.k.x, fmt),
      sec = (t, items) =>
        `<div class="rh">${t}</div><div class="rg">${items.map(i => `<span>${i}</span>`).join('')}</div>`,
      res = fit.resid.slice(0, 6).map(fmt).join(', ') + (fit.resid.length > 6 ? ', …' : '');
    info.innerHTML =
      sec('EQUATION', [pretty(eq)]) +
      sec('STATISTICS', [
        nm('R') + '<sup>2</sup> = ' + fmt(fit.r2),
        ...(fit.r == null ? [] : ['<i>r</i> = ' + fmt(fit.r)]),
      ]) +
      sec('RESIDUALS', [nm('e') + ' = [' + res + ']']);
    const copy = document.createElement('button');
    copy.className = 'tbl-copy';
    copy.textContent = 'Add as an equation';
    copy.onclick = () =>
      add(
        fitEquation(fit, 'y', 'x', v => String(+v.toPrecision(8))),
        S.rows.indexOf(r),
      );
    info.append(copy);
    bar.append(info);
    return bar;
  }
  function commit(next, focus) {
    r.text = writeTable(tidyTable(next));
    r.inp.value = r.text;
    decorate(r);
    rebuild();
    if (focus) focusTableCell(r, ...focus);
  }
  function edit(i, j, value, caret) {
    const next = structuredClone(T);
    if (j >= next.cols.length) next.cols.push({ h: i < 0 ? '' : nextColumnName(next), v: [] });
    const c = next.cols[j];
    if (i < 0) c.h = value;
    else {
      while (c.v.length <= i) c.v.push('');
      c.v[i] = value;
    }
    commit(next, [i, j, caret]);
  }
  function keys(e, i, j, input) {
    const at = input.selectionStart,
      collapsed = at === input.selectionEnd;
    let to = null;
    if (e.key === 'Enter' || e.key === 'ArrowDown') to = [i + 1, j];
    else if (e.key === 'ArrowUp' && i >= 0) to = [i - 1, j];
    else if (e.key === 'ArrowLeft' && collapsed && at === 0 && j > 0) to = [i, j - 1];
    else if (e.key === 'ArrowRight' && collapsed && at === input.value.length) to = [i, j + 1];
    else if (e.key === 'Backspace' && !input.value && i >= 0 && i < rows) {
      if (T.cols.every(c => blankCell(c.v[i]))) {
        e.preventDefault();
        const next = structuredClone(T);
        for (const c of next.cols) c.v.splice(i, 1);
        commit(next, [Math.max(0, i - 1), j]);
        return;
      }
      if (j > 0) to = [i, j - 1];
    }
    if (!to) return;
    e.preventDefault();
    focusTableCell(r, ...to);
  }
  // Pasted rows and columns (tabs, commas or semicolons) fill the grid from this cell; a text first
  // line pasted at the top becomes the headings.
  function paste(e, i, j) {
    const text = e.clipboardData?.getData('text') || '';
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    let lines = text
      .trim()
      .split(/\r?\n/)
      .map(l => l.split(l.includes('\t') ? '\t' : /[,;]/).map(s => s.trim()));
    const next = structuredClone(T);
    if (i <= 0 && lines[0].some(v => v && !Number.isFinite(+v))) {
      lines[0].forEach((h, d) => {
        while (next.cols.length <= j + d) next.cols.push({ h: '', v: [] });
        next.cols[j + d].h = h;
      });
      lines = lines.slice(1);
      i = 0;
    }
    i = Math.max(0, i);
    lines.forEach((line, a) =>
      line.forEach((v, d) => {
        while (next.cols.length <= j + d) next.cols.push({ h: nextColumnName(next), v: [] });
        const c = next.cols[j + d];
        while (c.v.length <= i + a) c.v.push('');
        c.v[i + a] = v;
      }),
    );
    commit(next, [i + lines.length, j]);
  }
}
const escapeHTML = s =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// GeoGebra labels such as A'_{1} or g_1: primes stay, the index becomes a subscript.
function geoLabel(name) {
  const m = name.match(/^([^_']+)('*)(?:_\{([^}]*)\}|_(\w+))?('*)$/);
  if (!m) return escapeHTML(name);
  const sub = m[3] ?? m[4];
  return (
    escapeHTML(m[1]) +
    m[2].replace(/'/g, '′') +
    (sub ? `<sub>${escapeHTML(sub)}</sub>` : '') +
    m[5].replace(/'/g, '′')
  );
}
const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';
const geoPlain = name =>
  name.replace(/_\{?(\d+)\}?/g, (_, d) => [...d].map(c => SUBSCRIPT[c]).join('')).replace(/'/g, '′');
const KINDS = { pt: 'point', seg: 'segment', line: 'line', poly: 'polygon' };
const hasLines = v => (Array.isArray(v) ? v.some(hasLines) : v?.t === 'line');
const kindOf = v => (typeof v === 'number' ? 'number' : Array.isArray(v) ? 'list' : KINDS[v?.t] || 'value');
// What a GeoGebra value is, in words: "= 166", "4,096 segments", "point (2, 3)".
function describeGeo(v) {
  if (typeof v === 'number') return '= ' + fmt(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    if (!v.length) return 'empty list';
    const kinds = new Set(v.map(kindOf)),
      n = v.length.toLocaleString();
    if (kinds.size > 1) return `list of ${n} items`;
    const kind = [...kinds][0];
    return v.length === 1 ? `list of 1 ${kind}` : `${n} ${kind === 'list' ? 'lists' : kind + 's'}`;
  }
  if (v.t === 'pt') return `point (${fmt(v.p[0])}, ${fmt(v.p[1])})`;
  if (v.t === 'seg') return `segment, length ${fmt(Math.hypot(v.b[0] - v.a[0], v.b[1] - v.a[1]))}`;
  if (v.t === 'poly') return `polygon with ${v.p.length} corners`;
  return KINDS[v.t] || '';
}
// A GeoGebra object shows its name, what it is built from and what it makes.
export function geoUI(r) {
  const row = r.inp?.closest('.row');
  row?.classList.toggle('is-geo', r.k?.type === 'ggb');
  if (!r.slEl || r.k?.type !== 'ggb') return;
  const card = document.createElement('div'),
    head = document.createElement('div'),
    exp = document.createElement('code'),
    meta = document.createElement('small');
  card.className = 'geo-card';
  head.className = 'geo-head';
  head.innerHTML = `<b>${r.k.name ? geoLabel(r.k.name) : 'Object'}</b><span>from GeoGebra</span>`;
  exp.textContent = r.k.exp.replace(/\[/g, '(').replace(/\]/g, ')');
  exp.title = r.k.exp;
  let what = '',
    G = null;
  try {
    G = geoValue(r);
    what = describeGeo(G.raw);
  } catch {}
  r.cardVer = r.geoVer;
  const inputs = r.k.live.map(geoPlain),
    using = inputs.length
      ? 'uses ' +
        (inputs.length > 5
          ? inputs.slice(0, 4).join(', ') + ` and ${inputs.length - 4} more`
          : inputs.join(', '))
      : '';
  meta.textContent = [what, using].filter(Boolean).join(' · ');
  // A plain value such as (1.98, 2.2) needs no separate line for its definition.
  const literal = !inputs.length && !/[A-Za-z]/.test(r.k.exp);
  card.classList.toggle('is-number', typeof G?.raw === 'number');
  const toggle = document.createElement('button');
  toggle.className = 'box-toggle';
  toggle.dataset.box = 'toggle';
  toggle.textContent = 'Box count';
  toggle.setAttribute('aria-pressed', String(!!r.box?.on));
  toggle.title = 'Cover the drawing with a grid and count the squares it touches';
  toggle.onclick = () => {
    r.box = r.box?.on ? null : { on: true };
    geoUI(r);
    kick();
  };
  // Counting boxes only means something for a detailed drawing that is on the graph: not a single
  // segment, not a hidden construction step, and not a grid of endless lines.
  const countable =
    G && !r.off && !hasLines(G.raw) && G.paths.reduce((s, w) => s + w.length, 0) + 2 * G.points.length >= 32;
  if (countable) head.append(toggle);
  else if (r.box) r.box = null;
  const active = document.activeElement,
    was = r.slEl.contains(active) ? active.dataset.box : null;
  card.append(head, ...(literal ? [] : [exp]), meta);
  if (r.box?.on) card.append(boxPanel(r));
  r.slEl.querySelector('.geo-card')?.remove();
  r.slEl.prepend(card);
  if (was) card.querySelector(`[data-box="${was}"]`)?.focus();
}
// The box count for a GeoGebra drawing: the shaded squares on the graph, N for this size, and the dimension.
function boxPanel(r) {
  const box = document.createElement('div'),
    B = r.box;
  box.className = 'box-panel';
  let G;
  try {
    G = geoValue(r);
  } catch {
    box.textContent = 'Nothing to count until the object draws.';
    return box;
  }
  if (B.src !== G) {
    B.src = G;
    B.fit = boxDimension(G.paths, G.points);
    B.s ??= defaultBoxSize(G.paths, G.points);
    B.cellsS = null;
  }
  if (B.cellsS !== B.s) {
    B.cellsS = B.s;
    B.cells = boxCells(G.paths, G.points, B.s);
  }
  const n = B.cells ? B.cells.length / 2 : NaN,
    size = document.createElement('div'),
    button = (label, aria, factor) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.box = aria;
      b.setAttribute('aria-label', aria);
      b.onclick = () => {
        B.s *= factor;
        geoUI(r);
        kick();
      };
      return b;
    };
  size.className = 'box-size';
  const value = document.createElement('span');
  value.innerHTML = `${nm('s')} = <b>${fmt(B.s)}</b>`;
  const count = document.createElement('span');
  count.className = 'box-n';
  count.innerHTML = B.cells
    ? `${nm('N')} = <b>${n.toLocaleString()}</b> boxes`
    : 'Too many boxes; make them bigger';
  size.append(button('½', 'Halve box size', 0.5), value, button('2×', 'Double box size', 2), count);
  box.append(size);
  const fit = B.fit;
  if (fit && Number.isFinite(fit.dim)) {
    const out = document.createElement('div');
    out.className = 'box-fit';
    out.innerHTML =
      `<div><span>Box-counting dimension</span><b>≈ ${fit.dim.toFixed(2)}</b>` +
      `<small>slope of log N against log 1/s over ${fit.sizes.length} sizes</small></div>` +
      loglog(fit, B.s);
    box.append(out);
  }
  const note = document.createElement('small');
  note.className = 'box-note';
  note.textContent =
    'Halve s and count again. A line roughly doubles N, a filled area roughly quadruples it; a fractal lands in between.';
  box.append(note);
  return box;
}
function loglog(fit, current) {
  const W = 96,
    H = 56,
    P = 5,
    X = fit.sizes.map(p => -Math.log2(p.s)),
    Y = fit.sizes.map(p => Math.log2(p.n)),
    [x0, x1] = [Math.min(...X), Math.max(...X)],
    [y0, y1] = [Math.min(...Y), Math.max(...Y)],
    sx = x => P + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * P),
    sy = y => H - P - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * P),
    my = Y.reduce((a, b) => a + b) / Y.length,
    mx = X.reduce((a, b) => a + b) / X.length,
    line = x => my + fit.dim * (x - mx),
    dots = X.map(
      (x, i) =>
        `<circle cx="${sx(x).toFixed(1)}" cy="${sy(Y[i]).toFixed(1)}" r="${fit.sizes[i].s === current ? 3 : 2}"${fit.sizes[i].s === current ? ' class="on"' : ''}/>`,
    ).join('');
  return (
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="log N against log 1/s">` +
    `<line x1="${sx(x0)}" y1="${sy(line(x0)).toFixed(1)}" x2="${sx(x1)}" y2="${sy(line(x1)).toFixed(1)}"/>${dots}</svg>`
  );
}
function focusTableCell(r, i, j, caret) {
  const input = r.slEl?.querySelector(`.tbl input[data-i="${i}"][data-j="${j}"]`);
  if (!input || input.readOnly) return;
  input.focus();
  const at = caret ?? input.value.length;
  input.setSelectionRange(at, at);
}
export function decorate(r) {
  const row = r.inp?.closest('.row');
  row?.style.setProperty('--curve', r.k?.type === 'fractal' ? '#ff783b' : r.col);
  row?.classList.toggle('blank', !r.text.trim());
  if (r.preview && isTableText(r.text)) r.preview.textContent = 'Table';
  else if (r.preview && isGeoText(r.text)) r.preview.textContent = 'GeoGebra object';
  else if (r.preview) {
    r.preview.innerHTML = r.text.trim().startsWith('"')
      ? r.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/^\s*"/, '').replace(/"\s*$/, '')
      : pretty(r.text);
    r.preview.title = r.text;
    r.preview.style.fontSize = Math.max(14, Math.min(23, 360 / Math.max(1, r.text.length))) + 'px';
  }
  if (r.inp) r.inp.title = r.text;
  if (r.label)
    r.label.textContent =
      ({
        fractal: 'Fractal',
        const: 'Parameter',
        function: 'Function',
        cart: 'Function',
        cartY: 'Function',
        polar: 'Polar curve',
        par: 'Parametric',
        pt: 'Point',
        pts: 'Data points',
        imp: 'Implicit curve',
        ineq: 'Region',
        surf: 'Surface',
      }[r.k?.type] || 'Expression') +
      ' / ' +
      String(S.rows.indexOf(r) + 1).padStart(2, '0');
}
/* Like a spreadsheet, the list always ends in an empty row to type into; typing there opens the next one.
   Imported construction helpers sit after it, folded into one group. */
const mainCount = () => S.rows.findLastIndex(r => !r.helper) + 1;
function ensureBlank() {
  const end = mainCount();
  if (S.rows.length >= 100 || (end && !S.rows[end - 1].text.trim())) return null;
  const r = makeRow();
  S.rows.splice(end, 0, r);
  return r;
}
function countRows() {
  $('#row-count').textContent = String(S.rows.filter(r => r.text.trim()).length).padStart(2, '0');
}
function renumber() {
  S.rows.forEach((r, i) => {
    const idx = r.inp?.closest('.row')?.querySelector('.idx');
    if (idx) idx.textContent = i + 1;
  });
}
export function syncBlank() {
  countRows();
  const r = ensureBlank();
  if (!r) return;
  mountRow(r);
  renumber();
}
let helpersOpen = false;
function helperGroup(count) {
  const box = document.createElement('div'),
    head = document.createElement('button'),
    body = document.createElement('div');
  box.className = 'helpers';
  box.classList.toggle('open', helpersOpen);
  head.className = 'helpers-head';
  head.setAttribute('aria-expanded', String(helpersOpen));
  head.innerHTML = `<span class="helpers-arrow" aria-hidden="true"></span><b>Construction steps</b><small>${count} hidden</small>`;
  head.title = 'The pieces the drawing is built from. Show one to move it into the main list.';
  head.onclick = () => {
    helpersOpen = !helpersOpen;
    box.classList.toggle('open', helpersOpen);
    head.setAttribute('aria-expanded', String(helpersOpen));
  };
  body.className = 'helpers-body';
  box.append(head, body);
  return box;
}
export function render() {
  closeCompletions();
  S.rows = [...S.rows.filter(r => !r.helper), ...S.rows.filter(r => r.helper)];
  ensureBlank();
  $('#rows').replaceChildren();
  countRows();
  const helpers = S.rows.filter(r => r.helper).length;
  if (helpers) $('#rows').append(helperGroup(helpers));
  S.rows.forEach(mountRow);
}
function mountRow(r) {
  const i = S.rows.indexOf(r);
  const el = document.createElement('div');
  el.className = 'row' + (r.off ? ' off' : '');
  el.style.setProperty('--curve', r.col);
  el.innerHTML =
    '<div class="gut"><span class="idx"></span><button class="dot" aria-label="Show or hide"></button></div><div class="col"><div class="row-label"></div><div class="entry"><div class="equation-display" aria-hidden="true"></div><input type="text" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="Type an equation"></div><div class="err" role="status"></div><div class="sls"></div></div><button class="x" aria-label="Delete">×</button>';
  el.querySelector('.idx').textContent = i + 1;
  const dot = el.querySelector('.dot');
  dot.setAttribute('aria-pressed', String(!r.off));
  r.inp = el.querySelector('input');
  r.inp.setAttribute('aria-label', 'Expression ' + (i + 1));
  r.inp.value = r.text;
  r.preview = el.querySelector('.equation-display');
  r.label = el.querySelector('.row-label');
  r.errEl = el.querySelector('.err');
  r.slEl = el.querySelector('.sls');
  r.ed = makeEditor(r);
  r.inp.focus = () => r.ed.focus();
  const ent = el.querySelector('.entry');
  ent.append(r.ed.el);
  ent.onmousedown = e => {
    if (!r.ed.el.contains(e.target)) {
      e.preventDefault();
      r.ed.focus();
    }
  };
  decorate(r);
  r.inp.oninput = () => {
    autoSym(r.inp);
    r.text = r.inp.value;
    decorate(r);
    rebuild();
  };
  r.inp.onkeydown = e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add('', S.rows.indexOf(r));
    } else if (e.key === 'Backspace' && !r.inp.value && S.rows.length > 1) {
      e.preventDefault();
      del(S.rows.indexOf(r));
    }
  };
  dot.oncontextmenu = e => {
    e.preventDefault();
    const c = document.createElement('input');
    c.type = 'color';
    c.value = r.col;
    c.oninput = () => {
      r.col = c.value;
      decorate(r);
      S.dirty = true;
      kick();
      saveSoon();
    };
    c.click();
  };
  dot.onclick = () => {
    r.off = !r.off;
    if (r.helper && !r.off) {
      // Showing a construction step lifts it into the main list, just above the empty row.
      r.helper = false;
      S.rows.splice(S.rows.indexOf(r), 1);
      S.rows.splice(Math.max(0, mainCount() - 1), 0, r);
      render();
      rebuild();
      return;
    }
    el.classList.toggle('off', r.off);
    dot.setAttribute('aria-pressed', String(!r.off));
    rebuild();
  };
  el.querySelector('.x').onclick = () => del(S.rows.indexOf(r));
  const group = $('#rows').querySelector(':scope > .helpers');
  if (r.helper && group) group.querySelector('.helpers-body').append(el);
  else if (group) $('#rows').insertBefore(el, group);
  else $('#rows').append(el);
  bindCompletions(r);
}
export function add(text = '', after) {
  const end = mainCount();
  if (after != null && after >= end) after = null;
  const next = S.rows[after == null ? end - 1 : after + 1];
  if (!text && next && !next.helper && !next.text.trim()) {
    next.inp.focus();
    return next;
  }
  if (S.rows.length >= 100) {
    $('#status').textContent = 'Maximum 100 expressions';
    return;
  }
  if (after == null && end && !S.rows[end - 1].text.trim()) after = end - 2;
  const r = makeRow(
    text,
    /^fractal\s*\(/i.test(text)
      ? {
          col: '#ff783b',
        }
      : {},
  );
  S.rows.splice(after == null ? end : after + 1, 0, r);
  render();
  rebuild();
  if (isTableText(text)) focusTableCell(r, 0, 0);
  else r.inp.focus();
  return r;
}
export function del(i) {
  S.rows.splice(i, 1);
  if (!S.rows.length) S.rows.push(makeRow());
  render();
  rebuild();
  S.rows[Math.max(0, i - 1)].inp.focus();
}
export function fractalControls(r) {
  if (r.k?.type !== 'fractal' || r.err) return;
  let p;
  try {
    p = fractalParams(r);
  } catch (e) {
    r.err = e.message;
    showError(r);
    return;
  }
  const spec = FRACTALS[p.family],
    box = document.createElement('div');
  box.className = 'fractal-card';
  const familyLabel = document.createElement('label');
  familyLabel.textContent = 'Family';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Fractal family');
  for (const [k, s] of Object.entries(FRACTALS)) {
    const option = document.createElement('option');
    option.value = k;
    option.textContent = s.title;
    select.append(option);
  }
  select.value = p.family;
  select.onchange = () => {
    r.text = fractalText(select.value);
    r.inp.value = r.text;
    rebuild();
    frameFractal();
  };
  familyLabel.append(select);
  box.append(familyLabel);
  const info = document.createElement('p');
  info.className = 'fractal-rule';
  info.textContent = spec.rule + (spec.labels.includes('Power') ? ` · p = ${p.power}` : '');
  box.append(info);
  spec.labels.forEach((name, i) => {
    const label = document.createElement('label');
    label.textContent = name;
    const input = document.createElement('input');
    input.type = 'number';
    input.setAttribute('aria-label', name);
    input.value = val(r.k.args[i]);
    input.step = name === 'Iterations' ? '16' : name === 'Power' ? '1' : '0.01';
    if (name === 'Iterations') {
      input.min = 16;
      input.max = 1200;
    }
    if (name === 'Power') {
      input.min = 2;
      input.max = 8;
    }
    input.onchange = () => {
      const a = r.k.args.map(c => String(val(c)));
      a[i] = input.value;
      r.text = `fractal(${p.family}, ${a.join(', ')})`;
      r.inp.value = r.text;
      rebuild();
    };
    label.append(input);
    box.append(label);
  });
  const detail = document.createElement('details'),
    summary = document.createElement('summary');
  summary.textContent = 'About this fractal';
  const description = document.createElement('p');
  description.textContent =
    spec.hint +
    '. ' +
    (p.julia ? 'Each pixel is z₀; c is the seed.' : 'z₀ = 0; each pixel is c.') +
    ' Dark regions did not escape within the iteration limit. Contours show smooth escape time, not the orbit of a single point.';
  detail.append(summary, description);
  box.append(detail);
  const button = document.createElement('button');
  button.textContent = 'Frame fractal';
  button.onclick = frameFractal;
  box.append(button);
  r.slEl.append(box);
}
// Integer complex powers preserve the polynomial map without polar branch ambiguities.

export function initPanel() {
  document
    .querySelectorAll('.panel-actions button')
    .forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
  const menu = open => {
    $('.panel-actions').classList.toggle('open', open);
    $('#more').setAttribute('aria-expanded', String(open));
  };
  $('#more').onclick = () => menu(!$('.panel-actions').classList.contains('open'));
  $('.panel-actions').addEventListener('click', e => {
    if (e.target.closest('button')) menu(false);
  });
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.panel-actions, #more')) menu(false);
  });
  $('#add').onclick = () => add();
  $('#rows').addEventListener('mousedown', e => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    S.rows.at(-1)?.inp?.focus();
  });
  $('#tb').onclick = () =>
    add(
      writeTable({
        cols: [
          { h: 'x1', v: ['1', '2', '3', '4', '5'] },
          { h: 'y1', v: ['2', '3.1', '5.2', '5.9', '8.1'] },
        ],
        fit: { type: 'linear', y: 1 },
      }),
    );
  $('#add-fractal').onclick = () => {
    const r = add('fractal(');
    if (r) updateCompletions(r);
  };
  $('#add-table').onclick = () => add(writeTable(emptyTable()));
  $('#add-note').onclick = () => add('"');
  // Slider limits show while the equation or a limit field has focus. Removal waits a tick, so moving
  // between the two never hides the field that is about to receive focus.
  const editingLimits = el => el?.matches?.('.mq, .sl-lim input');
  document.addEventListener('focusin', e => {
    const row = e.target.closest?.('.row');
    if (row) row.classList.toggle('edit-limits', editingLimits(e.target));
  });
  document.addEventListener('focusout', e => {
    const row = e.target.closest?.('.row');
    if (row)
      setTimeout(() => {
        if (!row.contains(document.activeElement) || !editingLimits(document.activeElement))
          row.classList.remove('edit-limits');
      });
  });
  document.addEventListener('focusout', e => {
    const row = e.target.closest?.('.row');
    if (row && !e.target.closest('.tbl'))
      setTimeout(() => {
        if (!row.contains(document.activeElement)) rebuild();
      }, 80);
  });
}
