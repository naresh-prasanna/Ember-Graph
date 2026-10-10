import { loadState, state } from '../app/persistence.js';
import { S } from '../app/state.js';
import { $ } from '../core/dom.js';
import { kick } from '../render/renderer.js';
import { holdSteps } from './panel.js';

const historySnap = () =>
  JSON.stringify({
    r: S.rows.map(r => [r.text, r.col, r.off, !!r.helper]),
    v: S.vars,
  });
let hist = [],
  histPos = 0,
  histTimer,
  histApplying = false;
function syncHistoryButtons() {
  const u = $('#undo'),
    d = $('#redo');
  if (u) {
    u.disabled = histPos <= 0;
    d.disabled = histPos >= hist.length - 1;
  }
}
function historyCommit() {
  clearTimeout(histTimer);
  if (!hist.length) return;
  const s = historySnap();
  if (s !== hist[histPos]) {
    hist.splice(histPos + 1);
    hist.push(s);
    if (hist.length > 150) hist.shift();
    histPos = hist.length - 1;
  }
  syncHistoryButtons();
}
export function scheduleHistory() {
  if (histApplying || !hist.length) return;
  clearTimeout(histTimer);
  histTimer = setTimeout(historyCommit, 450);
}
function applyHistory(i) {
  historyCommit();
  if (i < 0 || i >= hist.length) return;
  histPos = i;
  const o = JSON.parse(hist[i]);
  histApplying = true;
  holdSteps();
  try {
    loadState({
      ...state(),
      r: o.r.map(([text, col, off, helper]) => ({
        text,
        col,
        off,
        helper,
      })),
      vars: o.v,
    });
  } finally {
    histApplying = false;
  }
  syncHistoryButtons();
  kick();
}
function undo() {
  applyHistory(histPos - 1);
}
function redo() {
  applyHistory(histPos + 1);
}
export function initHistory() {
  hist = [historySnap()];
  histPos = 0;
  ['input', 'change', 'pointerup', 'keyup'].forEach(t => document.addEventListener(t, scheduleHistory, true));
  document.addEventListener(
    'keydown',
    e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.target.closest?.('dialog')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
      else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  syncHistoryButtons();
  window.emberHistory = {
    undo,
    redo,
  };
}
