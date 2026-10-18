import {
  colorVariables,
  columnColour,
  compile,
  curveSteps,
  defaultStep,
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
import { hideTip, setTip } from './tip.js';
import { frameFractal } from '../app/scenes.js';
import { PAL, S, reduceMotion } from '../app/state.js';
import { tone } from '../app/theme.js';
import { $ } from '../core/dom.js';
import { makeEditor } from '../editor/mathEditor.js';
import { SYM, own } from '../math/catalog.js';
import { fmt } from '../math/format.js';
import { isGeoText } from '../io/geogebraEval.js';
import { boxCells, boxDimension, defaultBoxSize } from '../math/boxCount.js';
import { FRACTALS, curvePoints, fractalText } from '../math/fractals.js';
import { derivativeSteps, integralSteps, odeSteps } from '../math/symbolic.js';
import { FITS, columnName, emptyTable, fitEquation, isTableText, writeTable } from '../math/table.js';
import { kick } from '../render/renderer.js';
import { isPlaying, toggleTone } from '../app/sound.js';
import { Color, Matrix, TTest, Tone } from '../math/values.js';
import { bindCompletions, closeCompletions, updateCompletions } from './completions.js';
import { astHTML, nm, pretty } from './mathDisplay.js';

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
// The variable a row's series is in: x for ∫ f dx, and the upper bound's for ∫₀ˣ f(t) dt.
const seriesVar = r => (r.symSrc?.a.length === 4 ? r.symSrc.a[3]?.n : r.symSrc?.a[1]?.n) || 'x';
export function showError(r) {
  r.errShown = '';
  decorate(r);
  if (r.errEl) {
    // Only a value gets the large answer style; a sentence like "Undefined: …" reads as a note.
    const answer = !r.err && (r.k?.type === 'calc' || r.k?.complex) && /^(= |True|False)/.test(r.info);
    // An empty box in ∫, Σ or d/dx is a step still to take, so it reads as a note rather than a mistake.
    const step = /^Add /.test(r.err);
    const formula = !r.err && (r.sym || r.symArea),
      series = !r.err && !r.sym && r.series,
      solved = !r.err && r.symEq,
      frac = answer && r.frac?.info === r.info ? r.frac : null,
      fr = r.errEl.closest('.row')?.querySelector('.fr');
    r.errEl.closest('.row')?.classList.toggle('has-frac', !!frac);
    if (fr) {
      fr.setAttribute('aria-pressed', String(!!r.asFrac));
      const frTip = r.asFrac ? 'Show as a decimal' : 'Show as a fraction';
      fr.ariaLabel = frTip;
      setTip(fr, frTip);
    }
    const plusC = '<span class="math-tail">\u00a0+ <i>C</i></span>';
    if (solved)
      r.errEl.innerHTML =
        `<span class="sym-note">${
          solved.deq
            ? `General solution of <i>dy</i>/<i>dx</i> = ${astHTML(solved.deq)}`
            : 'With the constant the antiderivatives leave'
        }</span>` + `<span class="sym-series">${astHTML(solved.left)} = ${astHTML(solved.right)}</span>`;
    else if (formula) r.errEl.innerHTML = '= ' + astHTML(formula) + (r.symIndef ? plusC : '');
    else if (series)
      r.errEl.innerHTML =
        `<span class="sym-note">As a power series near ${seriesVar(r)} = ${fmt(r.seriesAt || 0).replace(/-/g, '−')}</span>` +
        `<span class="sym-series">≈ ${astHTML(r.series)} + ⋯${r.symIndef ? plusC : ''}</span>`;
    else if (answer && r.k.complex && r.polar) {
      r.errEl.textContent = r.info;
      const note = document.createElement('span');
      note.className = 'sym-note polar';
      note.textContent = r.polar;
      r.errEl.append(note);
    } else if (!r.err && r.listFull?.short === r.info) {
      // "… N more" opens the whole list in place, and "show less" closes it again.
      const open = !!r.listOpen,
        L = r.listFull,
        b = document.createElement('button');
      b.className = 'list-more';
      b.textContent = open ? 'show less' : `… ${L.n.toLocaleString()} more`;
      b.onmousedown = e => e.preventDefault();
      b.onclick = e => {
        e.stopPropagation();
        r.listOpen = !open;
        showError(r);
      };
      r.errEl.textContent = open ? L.full + ' ' : L.short.slice(0, L.short.lastIndexOf(', …')) + ', ';
      r.errEl.append(b);
      if (!open) r.errEl.append(']');
    }     else if (frac && r.asFrac)
      r.errEl.innerHTML = `= ${frac.n < 0 ? '−' : ''}<span class="frac"><span>${Math.abs(frac.n)}</span><span>${frac.d}</span></span>`;
    else if (r.err) {
      // Keep the sentence in the UI sans, but set the name and the example formula in math italic.
      const undef = r.err.match(/^(.*?) isn't defined\. Add a row like (.*)$/);
      r.errEl.innerHTML = undef
        ? `${nm(undef[1])} isn't defined. Add a row like <span class="mi">${pretty(undef[2])}</span>`
        : '';
      if (!undef) r.errEl.textContent = r.err;
    } else r.errEl.textContent = r.info || '';
    r.errEl.classList.toggle('list-open', !r.err && !!r.listOpen && r.listFull?.short === r.info);
    r.errEl.style.color = (r.err && !step) || answer || formula || series || solved ? '' : 'var(--dim)';
    r.errEl.classList.toggle('answer', answer || !!formula || !!series || !!solved);
    // Full-precision value behind a rounded numeric readout; clear when there isn't one
    // so a stale tip (e.g. "1" from a previous answer) can't linger on "= —" or an error.
    if (answer && r.infoExact) setTip(r.errEl, r.infoExact);
    else setTip(r.errEl, '');
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
    setTip(label, 'Change the limits');
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
    chosen = S.ranges[n]?.step,
    // Left blank, the step follows the range (0.1 for −10…10); 0 means as smooth as the slider can go.
    st = field('step', chosen === undefined ? '' : fmt(chosen), `Step for ${n}, 0 for smooth`);
  st.placeholder = fmt(defaultStep(m.min, m.max));
  function apply() {
    const a = readLimit(lo.value),
      b = readLimit(hi.value),
      s = st.value.trim() ? readLimit(st.value) : undefined,
      order = !(a >= b),
      stepOk = s === undefined || (s >= 0 && s <= b - a);
    lo.classList.toggle('bad', !Number.isFinite(a) || !order);
    hi.classList.toggle('bad', !Number.isFinite(b) || !order);
    st.classList.toggle('bad', !stepOk);
    if (!(a < b && stepOk)) return;
    const vm = S.VM[n];
    if (!vm) return;
    S.ranges[n] = s === undefined ? { min: a, max: b } : { min: a, max: b, step: s };
    Object.assign(vm, { min: a, max: b, step: s ?? defaultStep(a, b) });
    st.placeholder = fmt(defaultStep(a, b));
    slider.min = a;
    slider.max = b;
    slider.step = vm.step || 'any';
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
          S.solutions ? 'SOLUTIONS' : 'REGRESSION PARAMETERS',
          S.params.map(([n, v]) => nm(n) + ' = ' + fmt(v)),
        )
      : '') +
    (S.solutions
      ? ''
      : sec(
          'STATISTICS',
          S.stats.map(([n, v]) => nm(n) + ' = ' + fmt(v)),
        ) + sec('RESIDUALS', [nm('e') + ' = [' + res + ']']));
  r.slEl.append(box);
}
/* The working behind an integral row's formula, behind a toggle, with a tab for each method that gives a
   different-looking answer. */
const sameAst = (a, b) => JSON.stringify(a) === JSON.stringify(b),
  // Inline maths in a sentence: letters italic, function names and the d of a differential upright.
  mtext = s =>
    escapeHTML(s).replace(
      /\b(arcsin|arctan|sin|cos|tan|cot|sec|csc|ln)\b|d(?=[A-Za-zθ])|([A-Za-zθ])/g,
      (m, fn, letter) => fn || (letter ? `<i>${letter}</i>` : m),
    ),
  say = parts =>
    parts
      .map(p =>
        typeof p === 'string'
          ? escapeHTML(p)
          : `<span class="mi">${p.k === 'mtext' ? mtext(p.s) : astHTML(p)}</span>`,
      )
      .join(''),
  work = (lines, first = true) =>
    `<div class="step-work">${lines.map((x, i) => `<span>${i || !first ? '= ' : ''}${astHTML(x)}</span>`).join('')}</div>`;
function stepHTML(n) {
  const kids = n.kids.length ? `<ol class="steps">${n.kids.map(stepHTML).join('')}</ol>` : '',
    top = [n.head, ...n.chain],
    after = (n.after || []).filter(x => !sameAst(x, n.to)),
    end = [
      ...after,
      ...(sameAst(top.at(-1), n.to) ||
      (!after.length && n.kids.length === 1 && !n.kidsFirst && sameAst(n.kids[0].to, n.to))
        ? []
        : [n.to]),
    ],
    body = n.kidsFirst
      ? work([...top, ...end])
      : n.kids.length
        ? work(top) + kids + (end.length ? work(end, false) : '')
        : work([...top, ...end]);
  return (
    (n.kidsFirst ? n.kids.map(stepHTML).join('') : '') +
    `<li class="step"><div class="step-rule">${escapeHTML(n.rule)}</div>` +
    (n.why.length ? `<div class="step-why">${say(n.why)}</div>` : '') +
    body +
    '</li>'
  );
}
function seriesHTML(r, s) {
  const at = s.series?.center ?? r.seriesAt ?? 0,
    c = { k: 'num', v: at },
    v = at
      ? { k: 'binary', op: at < 0 ? '+' : '-', a: { k: 'name', n: s.v }, b: { k: 'num', v: Math.abs(at) } }
      : { k: 'name', n: s.v },
    f = s.f,
    where = `${s.v} = ${fmt(at).replace(/-/g, '−')}`,
    lead = (rule, why, html) =>
      `<li class="step"><div class="step-rule">${rule}</div><div class="step-why">${why}</div>${html}</li>`;
  return (
    '<ol class="steps">' +
    lead(
      'Beyond standard functions',
      s.series
        ? 'No combination of powers, exponentials, logarithms, trig functions, their inverses or the special functions (erf, Si, Ci, Ei, li) has this derivative. Near any point where the integrand is smooth it is still a power series, so the answer is written as one'
        : 'No combination of powers, exponentials, logarithms, trig functions, their inverses or the special functions has this derivative, and the integrand has no power series nearby. The answer is the area function itself, which the graph draws',
      s.series
        ? ''
        : `<div class="step-work"><span>${astHTML(r.symSrc)}</span><span>= ${astHTML(r.symArea)} + <i>C</i></span></div>`,
    ) +
    (s.series
      ? lead(
          'Expand the integrand',
          `Write it as a power series about ${where}${s.series.exact ? '' : ', with coefficients to four figures'}`,
          `<div class="step-work"><span>${astHTML(f)}</span><span>= ${astHTML(s.series.integrand)} + ⋯</span></div>`,
        ) +
        lead(
          'Integrate term by term',
          `Each <span class="mi">${astHTML({ k: 'binary', op: '^', a: v, b: { k: 'name', n: 'n' } })}</span> becomes <span class="mi">` +
            astHTML({
              k: 'binary',
              op: '/',
              a: {
                k: 'binary',
                op: '^',
                a: v,
                b: { k: 'binary', op: '+', a: { k: 'name', n: 'n' }, b: { k: 'num', v: 1 } },
              },
              b: { k: 'binary', op: '+', a: { k: 'name', n: 'n' }, b: { k: 'num', v: 1 } },
            }) +
            '</span>',
          `<div class="step-work"><span>${astHTML(r.symSrc)}</span><span>≈ ${astHTML(r.series)} + ⋯${
            r.symIndef ? ' + <i>C</i>' : ''
          }</span></div>`,
        )
      : '') +
    '</ol>' +
    `<p class="steps-note">${
      (r.graphFrom || 0) === at
        ? `The constant is chosen so the answer is 0 at ${where}. The graph shows that same function, the area from ${astHTML(c)}, found numerically.`
        : `The graph shows the area from ${astHTML({ k: 'num', v: r.graphFrom || 0 })}, found numerically. It differs from the series by a constant, which the + <i>C</i> absorbs.`
    }</p>`
  );
}
/* The working opens in a sheet beside the list rather than inside the row: a list row is too narrow for
   maths at a size that reads without zooming. One row's steps are open at a time, and they follow its edits. */
let sheet = null,
  sheetRow = null;
function closeSteps() {
  const r = sheetRow;
  if (!r) return;
  sheetRow = null;
  sheet.dataset.k = '';
  stepsCard(r);
  if (reduceMotion) sheet.hidden = true;
  else sheet.classList.add('closing');
}
function stepsSheet() {
  if (sheet) {
    sheet.classList.remove('closing');
    return sheet;
  }
  sheet = document.createElement('section');
  sheet.className = 'steps-sheet';
  sheet.hidden = true;
  sheet.setAttribute('aria-label', 'Working');
  sheet.innerHTML =
    '<div class="ss-bar"><span class="ss-kicker">Steps</span><button class="ss-close" aria-label="Close steps">' +
    '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="ss-scroll"></div>';
  sheet.querySelector('.ss-close').onclick = closeSteps;
  sheet.addEventListener('animationend', e => {
    if (e.target === sheet && sheet.classList.contains('closing')) {
      sheet.classList.remove('closing');
      sheet.hidden = true;
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sheetRow && (sheet.contains(e.target) || e.target === document.body))
      closeSteps();
  });
  document.body.append(sheet);
  return sheet;
}
// A differential equation's working: equations line under line, the integrals it needed worked in between.
function odeSheet(r) {
  const id = JSON.stringify(r.symEq),
    el = stepsSheet(),
    shown = id + '|' + r.id;
  el.hidden = false;
  if (el.dataset.k === shown) return;
  el.dataset.k = shown;
  let s = null;
  try {
    s = odeSteps(r.symEq, S.env);
  } catch {
    // Shown as no working below.
  }
  const lines = xs =>
      xs?.length ? `<div class="step-work">${xs.map(e => `<span>${astHTML(e)}</span>`).join('')}</div>` : '',
    scroll = el.querySelector('.ss-scroll');
  scroll.innerHTML = !s
    ? '<p class="steps-note">No working to show for this one.</p>'
    : `<div class="ss-title"><span class="ss-q">${astHTML(s.question)}</span><span class="ss-a">${astHTML(s.answer)}</span></div>` +
      '<ol class="steps">' +
      s.steps
        .map(
          st =>
            `<li class="step"><div class="step-rule">${escapeHTML(st.rule)}</div>` +
            (st.why?.length ? `<div class="step-why">${say(st.why)}</div>` : '') +
            lines(st.eqs) +
            (st.kids?.length ? `<ol class="steps">${st.kids.map(stepHTML).join('')}</ol>` : '') +
            lines(st.after) +
            '</li>',
        )
        .join('') +
      '</ol>';
  scroll.scrollTop = 0;
}
function renderSheet(r) {
  if (r.symEq) return odeSheet(r);
  const src = r.symSrc,
    id = JSON.stringify([src, r.sym, r.series]);
  if (r.stepsKey !== id) {
    r.stepsKey = id;
    try {
      r.steps = (src.n === 'deriv' ? derivativeSteps : integralSteps)(src, S.env);
    } catch {
      r.steps = null;
    }
    r.stepsMethod = 0;
  }
  const s = r.steps,
    i = Math.min(r.stepsMethod || 0, Math.max(0, (s?.methods.length || 1) - 1)),
    el = stepsSheet(),
    shown = id + '|' + i + '|' + r.id;
  el.hidden = false;
  if (el.dataset.k === shown) return;
  el.dataset.k = shown;
  const scroll = el.querySelector('.ss-scroll'),
    C = r.symIndef ? '<span class="math-tail">\u00a0+ <i>C</i></span>' : '',
    m = s?.methods[i];
  const answer =
    r.sym || r.symArea
      ? `<span class="ss-a">= ${astHTML(r.sym || r.symArea)}${C}</span>`
      : r.series
        ? `<span class="ss-a">≈ ${astHTML(r.series)} + ⋯${C}</span>`
        : r.info?.startsWith('=')
          ? `<span class="ss-a">${escapeHTML(r.info)}</span>`
          : m
            ? `<span class="ss-a">= ${astHTML(m.tree.to)}</span>`
            : '';
  let html = `<div class="ss-title"><span class="ss-q">${astHTML(src)}</span>${answer}</div>`;
  if (s?.note) html += `<p class="steps-warn">${say(s.note)}</p>`;
  if (!s) html += '<p class="steps-note">No working to show for this one.</p>';
  else if (!m) html += seriesHTML(r, s);
  else {
    if (s.methods.length > 1)
      html +=
        '<div class="steps-tabs" role="tablist" aria-label="Methods">' +
        s.methods
          .map(
            (x, j) =>
              `<button role="tab" data-j="${j}" aria-selected="${j === i}"><b>${j + 1}</b>${say(x.label || [x.name])}</button>`,
          )
          .join('') +
        '</div>';
    html += `<ol class="steps">${stepHTML(m.tree)}</ol>`;
    if (i && !s.definite && m.offset !== undefined)
      html += `<p class="steps-note">${
        Math.abs(m.offset) < 1e-9
          ? 'Same function as method 1, written another way.'
          : `Differs from method 1 by the constant ${fmt(m.offset).replace(/-/g, '−')}, which the + <i>C</i> absorbs.`
      }</p>`;
  }
  scroll.innerHTML = html;
  scroll.scrollTop = 0;
  for (const b of scroll.querySelectorAll('.steps-tabs button'))
    b.onclick = () => {
      r.stepsMethod = +b.dataset.j;
      renderSheet(r);
    };
}
// Undo and redo rebuild every row; the open sheet moves to the row in the same place.
let heldAt = -1;
export function holdSteps() {
  heldAt = sheetRow ? S.rows.indexOf(sheetRow) : -1;
}
export function stepsCard(r) {
  r.slEl?.querySelector('.steps-card')?.remove();
  if (sheetRow && !S.rows.includes(sheetRow)) {
    const next = S.rows[heldAt];
    heldAt = -1;
    if (next) sheetRow = next;
    else closeSteps();
  }
  const src = r.symSrc,
    // Definite ∫ₐᵇ keeps its numeric answer on the row; steps still open from symSrc alone.
    integral =
      src?.k === 'call' &&
      ((src.n === 'integral' && (r.sym || r.series || r.symArea || src.a?.length === 4)) ||
        (src.n === 'deriv' && r.sym));
  if (!r.slEl || r.err || !(integral || r.symEq)) {
    // Mid-edit the row is not an integral for a moment: the sheet waits, hidden, for it to be one again.
    if (sheetRow === r && sheet) sheet.hidden = true;
    return;
  }
  const open = sheetRow === r,
    box = document.createElement('div'),
    toggle = document.createElement('button');
  box.className = 'rcard steps-card';
  toggle.className = 'steps-toggle';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h9M5 18h11"/></svg>' +
    (open ? 'Hide steps' : 'Show steps');
  toggle.onmousedown = e => e.preventDefault();
  toggle.onclick = () => {
    if (sheetRow === r) return closeSteps();
    const was = sheetRow;
    sheetRow = r;
    if (was) stepsCard(was);
    stepsCard(r);
  };
  box.append(toggle);
  r.slEl.append(box);
  if (open) renderSheet(r);
}
/* Cards for values that read better laid out: a matrix as a grid, colours as swatches, a t-test's numbers,
   and a play button for tones. */
export function valueCard(r) {
  r.slEl?.querySelector('.vcard')?.remove();
  const v = r.value;
  if (!v || !r.slEl || r.err) return;
  const box = document.createElement('div'),
    items = [v].flat(),
    num = x => fmt(x).replace(/-/g, '−');
  box.className = 'rcard vcard';
  if (items.every(t => t instanceof Tone)) {
    const b = document.createElement('button'),
      on = isPlaying(r);
    b.className = 'tone-play';
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = on
      ? '<svg viewBox="0 0 24 24"><rect x="7" y="6" width="3.5" height="12" rx="1"/><rect x="13.5" y="6" width="3.5" height="12" rx="1"/></svg>Stop'
      : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>Play';
    b.onclick = () => {
      toggleTone(r);
      valueCard(r);
    };
    box.append(b);
  } else if (v instanceof Matrix) {
    // A matrix written out in numbers is already on screen as typed.
    if (/^\s*(?:[A-Za-z_]\w*\s*=)?[\s[\],\d.-]*$/.test(r.text)) return;
    box.innerHTML = `<div class="mx-card" style="--cols:${v.n}">${v.rows
      .flat()
      .map(x => `<span>${num(x)}</span>`)
      .join('')}</div>`;
  } else if (items.every(c => c instanceof Color)) {
    box.innerHTML = `<div class="swatches">${items
      .slice(0, 24)
      .map(c => `<span style="background:${c.hex}" title="${c}"></span>`)
      .join('')}</div>`;
  } else if (v instanceof TTest) {
    box.innerHTML =
      `<div class="rg">` +
      [
        ['t', num(v.score)],
        ['df', num(v.df)],
        ['p (≠)', num(v.p)],
        ['p (<)', num(v.pleft)],
        ['p (>)', num(v.pright)],
      ]
        .map(([n, x]) => `<span>${n} = ${x}</span>`)
        .join('') +
      '</div>';
  } else return;
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
        setTip(input, K.err || '');
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
        setTip(input, K.cells[i].err ? 'Not a number yet: ' + K.cells[i].err : 'This cell has no value');
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
  setTip(exp, r.k.exp);
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
  setTip(toggle, 'Cover the drawing with a grid and count the squares it touches');
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
  // A colour definition paints its own radio dot with the live colour, matching the swatch below.
  const live =
    r.value instanceof Color
      ? r.value.hex
      : Array.isArray(r.value) && r.value[0] instanceof Color
        ? r.value[0].hex
        : null;
  row?.style.setProperty('--curve', tone(r.k?.type === 'fractal' ? '#ff783b' : live || r.col));
  row?.classList.toggle('blank', !r.text.trim());
  if (r.preview && isTableText(r.text)) r.preview.textContent = 'Table';
  else if (r.preview && isGeoText(r.text)) r.preview.textContent = 'GeoGebra object';
  else if (r.preview) {
    r.preview.innerHTML = r.text.trim().startsWith('"')
      ? r.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/^\s*"/, '').replace(/"\s*$/, '')
      : pretty(r.text);
    // Don't echo the expression in a tip — you already see it; that popup read as noise.
    setTip(r.preview, '');
  }
  if (r.inp) setTip(r.inp, '');
  if (r.label)
    r.label.textContent =
      ({
        fractal: 'Fractal',
        lsys: 'Fractal curve',
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
        shape: 'Shape',
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
function renumber() {
  S.rows.forEach((r, i) => {
    const idx = r.inp?.closest('.row')?.querySelector('.idx');
    if (idx) idx.textContent = i + 1;
  });
}
export function syncBlank() {
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
  setTip(head, 'The pieces the drawing is built from. Show one to move it into the main list.');
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
  const helpers = S.rows.filter(r => r.helper).length;
  if (helpers) $('#rows').append(helperGroup(helpers));
  S.rows.forEach(mountRow);
}
function mountRow(r) {
  const i = S.rows.indexOf(r);
  const el = document.createElement('div');
  el.className = 'row' + (r.off ? ' off' : '');
  el.style.setProperty('--curve', tone(r.col));
  el.innerHTML =
    '<div class="gut"><span class="idx"></span><button class="dot"></button><button class="fr" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="4.5" width="6" height="5" rx="1.2" /><path d="M6.5 12h11" /><rect x="9" y="14.5" width="6" height="5" rx="1.2" /></svg></button></div><div class="col"><div class="row-label"></div><div class="entry"><div class="equation-display" aria-hidden="true"></div><input type="text" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="Type an equation"></div><div class="err" role="status"></div><div class="sls"></div></div><button class="x" aria-label="Delete"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg></button>';
  el.querySelector('.idx').textContent = i + 1;
  const dot = el.querySelector('.dot'),
    touchUi = () => matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches,
    colorTip = () => (touchUi() ? 'Tap to change color' : 'Right-click to change color');
  const tipDot = () => {
    const tip = colorTip();
    dot.setAttribute('aria-label', 'Show or hide. ' + tip);
    setTip(dot, tip);
  };
  tipDot();
  matchMedia('(pointer: coarse)').addEventListener?.('change', tipDot);
  matchMedia('(hover: none)').addEventListener?.('change', tipDot);
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
      r.ed.placeAt(e.clientX, e.clientY);
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
  const openColor = e => {
    e?.preventDefault?.();
    colorMenu(r, dot);
  };
  dot.oncontextmenu = e => {
    e.preventDefault();
    openColor();
  };
  // Touch/pen: tap or hold opens the colour menu; mouse click still toggles visibility.
  let hold = 0,
    touchOpen = false,
    touchMoved = false;
  dot.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    touchOpen = false;
    touchMoved = false;
    hold = setTimeout(() => {
      hold = 0;
      touchOpen = true;
      openColor();
    }, 420);
  });
  const clearHold = () => {
    if (hold) clearTimeout(hold);
    hold = 0;
  };
  dot.addEventListener('pointerup', clearHold);
  dot.addEventListener('pointercancel', clearHold);
  dot.addEventListener('pointermove', e => {
    if (!hold) return;
    if (Math.abs(e.movementX) > 6 || Math.abs(e.movementY) > 6) {
      touchMoved = true;
      clearHold();
    }
  });
  dot.onclick = e => {
    if (touchOpen) {
      touchOpen = false;
      return;
    }
    // Touch/pen: a short tap opens colour (hold does too). Mouse click still toggles visibility.
    if (!touchMoved && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
      openColor();
      return;
    }
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
  el.querySelector('.fr').onclick = () => {
    r.asFrac = !r.asFrac;
    showError(r);
    saveSoon();
  };
  el.querySelector('.x').onclick = () => del(S.rows.indexOf(r), true);
  const group = $('#rows').querySelector(':scope > .helpers');
  if (r.helper && group) group.querySelector('.helpers-body').append(el);
  else if (group) $('#rows').insertBefore(el, group);
  else $('#rows').append(el);
  bindCompletions(r);
}
const COLOR_HINT_KEY = 'ember-color-hint-tab',
  colorHintCopy = {
    rgb: {
      before: 'Type ',
      code: 'C = rgb(255, g, 0)',
      after:
        ' in a new row. Red, green and blue each go from 0 to 255. Drag g to fade red to yellow, then pick C here.',
    },
    hsv: {
      before: 'Type ',
      code: 'C = hsv(h, 1, 1)',
      after:
        ' in a new row. Hue is the color wheel, 0 to 360. Saturation and brightness are 0 to 1. Drag h for a rainbow, then pick C here.',
    },
  };
function colorHintTab() {
  try {
    return sessionStorage.getItem(COLOR_HINT_KEY) === 'hsv' ? 'hsv' : 'rgb';
  } catch {
    return 'rgb';
  }
}
function setColorHintTab(tab) {
  try {
    sessionStorage.setItem(COLOR_HINT_KEY, tab);
  } catch {}
}
function colorFromMathHint(collapsed) {
  const more = document.createElement('details');
  more.className = 'col-more';
  more.open = !collapsed;
  const summary = document.createElement('summary');
  summary.textContent = collapsed ? 'How?' : 'Color from math';
  const body = document.createElement('div');
  body.className = 'col-math';
  const tabs = document.createElement('div');
  tabs.className = 'col-segs';
  tabs.setAttribute('role', 'tablist');
  tabs.ariaLabel = 'Color formula style';
  const copy = document.createElement('p');
  copy.className = 'col-math-copy';
  const paint = tab => {
    const t = colorHintCopy[tab];
    copy.replaceChildren();
    copy.append(t.before, Object.assign(document.createElement('code'), { textContent: t.code }), t.after);
    for (const b of tabs.querySelectorAll('button'))
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  };
  for (const id of ['rgb', 'hsv']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tab = id;
    b.textContent = id.toUpperCase();
    b.setAttribute('role', 'tab');
    b.onclick = () => {
      setColorHintTab(id);
      paint(id);
    };
    tabs.append(b);
  }
  paint(colorHintTab());
  body.append(tabs, copy);
  more.append(summary, body);
  return more;
}
/* The color menu: the palette, any color variables (C = hsv(h, 1, 1) colors a row and follows its
   sliders, as in Desmos), or any color at all from the system picker. */
function colorMenu(r, anchor) {
  document.querySelector('.col-menu')?.remove();
  hideTip();
  const menu = document.createElement('div'),
    active = c => !r.colVar && c.toLowerCase() === r.col.toLowerCase(),
    set = (col, colVar = null) => {
      r.colVar = colVar;
      if (col) r.col = col;
      decorate(r);
      S.dirty = true;
      kick();
      saveSoon();
    },
    done = () => {
      menu.remove();
      removeEventListener('pointerdown', outside, true);
      removeEventListener('keydown', esc, true);
    },
    close = () => {
      if (menu.classList.contains('closing')) return;
      if (reduceMotion) return done();
      menu.classList.add('closing');
      menu.addEventListener('animationend', done, { once: true });
    },
    outside = e => !menu.contains(e.target) && close(),
    esc = e => e.key === 'Escape' && close(),
    swatch = (col, label, pressed, pick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'col-swatch';
      b.style.setProperty('--sw', col);
      b.ariaLabel = label;
      setTip(b, label);
      b.setAttribute('aria-pressed', String(pressed));
      b.onclick = () => {
        pick();
        close();
      };
      return b;
    },
    section = (title, items) => {
      if (!items.length) return;
      const h = document.createElement('div'),
        g = document.createElement('div');
      h.className = 'col-head';
      h.textContent = title;
      g.className = 'col-grid';
      g.append(...items);
      menu.append(h, g);
    };
  menu.className = 'col-menu';
  menu.setAttribute('role', 'dialog');
  menu.ariaLabel = 'Curve color';
  section(
    'Color',
    PAL.map(c => swatch(tone(c), tone(c), active(c), () => set(c))),
  );
  const vars = colorVariables();
  section(
    'Variables',
    vars.map(([n, c]) => {
      const b = swatch(c.hex, `${n} = ${c}`, r.colVar === n, () => set(c.hex, n));
      b.classList.add('named');
      b.textContent = n;
      return b;
    }),
  );
  const row = document.createElement('div');
  row.className = 'col-row';
  const custom = document.createElement('label');
  custom.className = 'col-custom';
  custom.setAttribute('aria-pressed', String(!r.colVar && !PAL.some(active)));
  custom.innerHTML = '<input type="color" aria-label="Custom color">';
  setTip(custom, 'Pick any color');
  const input = custom.querySelector('input');
  input.value = r.col;
  input.oninput = () => {
    set(input.value);
    custom.setAttribute('aria-pressed', 'true');
  };
  const lab = document.createElement('span');
  lab.className = 'col-custom-label';
  lab.textContent = 'Custom';
  row.append(custom, lab);
  menu.append(row);
  menu.append(colorFromMathHint(!!vars.length));
  document.body.append(menu);
  const a = anchor.getBoundingClientRect(),
    left = Math.min(innerWidth - menu.offsetWidth - 8, Math.max(8, a.left + a.width / 2 - 18)),
    top = Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, a.bottom + 10));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.setProperty('--nub', a.left + a.width / 2 - left + 'px');
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', esc, true);
  menu.querySelector('button')?.focus();
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
// What the add menu's Table, Data + fit and Note start a row with.
export const NEW = {
  table: () => writeTable(emptyTable()),
  data: () =>
    writeTable({
      cols: [
        { h: 'x1', v: ['1', '2', '3', '4', '5'] },
        { h: 'y1', v: ['2', '3.1', '5.2', '5.9', '8.1'] },
      ],
      fit: { type: 'linear', y: 1 },
    }),
  note: () => '"',
};
// "table" typed into a row turns that row into a table, where it stands.
export function replaceRow(r, text) {
  const i = S.rows.indexOf(r);
  S.rows.splice(i, 1);
  return add(text, i - 1);
}
// Only a click animates: deleting from the keyboard happens mid-typing, where any motion is in the way.
export function del(i, animate = false) {
  const gone = S.rows[i]?.inp?.closest('.row'),
    motion = animate && !reduceMotion && gone,
    before = motion
      ? new Map(S.rows.map(r => [r, r.inp?.closest('.row')?.getBoundingClientRect().top]))
      : null,
    at = motion ? gone.getBoundingClientRect() : null;
  S.rows.splice(i, 1);
  if (!S.rows.length) S.rows.push(makeRow());
  render();
  rebuild();
  S.rows[Math.max(0, i - 1)].inp.focus();
  if (motion) closeGap(gone, at, before);
}
/* The deleted row folds away like a closing window, over the rows beneath as they slide up into its place.
   Both move by transform alone: the list has already been laid out without the row. */
function closeGap(ghost, at, before) {
  const box = $('#rows'),
    b = box.getBoundingClientRect();
  ghost.classList.add('row-ghost');
  Object.assign(ghost.style, {
    top: at.top - b.top + box.scrollTop + 'px',
    left: at.left - b.left + 'px',
    width: at.width + 'px',
    height: at.height + 'px',
  });
  ghost.addEventListener('animationend', () => ghost.remove(), { once: true });
  box.append(ghost);
  const moved = [];
  for (const r of S.rows) {
    const el = r.inp?.closest('.row'),
      d = before.get(r) - el?.getBoundingClientRect().top;
    if (!(Math.abs(d) > 0.5)) continue;
    el.style.transition = 'none';
    el.style.transform = `translateY(${d}px)`;
    moved.push(el);
  }
  void box.offsetHeight;
  for (const el of moved) {
    el.style.transition = 'transform 260ms var(--panel-ease)';
    el.style.transform = '';
    const done = e => {
      if (e.target !== el || e.propertyName !== 'transform') return;
      el.style.transition = '';
      el.removeEventListener('transitionend', done);
    };
    el.addEventListener('transitionend', done);
  }
}
export function fractalControls(r) {
  const curve = r.k?.type === 'lsys';
  if ((r.k?.type !== 'fractal' && !curve) || r.err) return;
  let p;
  try {
    p = curve ? { family: r.k.family, steps: curveSteps(r) } : fractalParams(r);
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
    input.step = name === 'Iterations' ? '16' : name === 'Power' || curve ? '1' : '0.01';
    if (curve) {
      input.min = 0;
      input.max = spec.curve.max;
    }
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
  description.textContent = curve
    ? `${spec.hint}. Each step rewrites every letter by the rule; F, G, A and B draw one segment, + and − turn. This one has ${fmt((curvePoints(p.family, p.steps).length - 2) / 2)} segments.`
    : spec.hint +
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
  $('#tb').onclick = () => add(NEW.data());
  $('#add-fractal').onclick = () => {
    const r = add('fractal(');
    if (r) updateCompletions(r);
  };
  $('#add-table').onclick = () => add(NEW.table());
  $('#add-note').onclick = () => add(NEW.note());
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
