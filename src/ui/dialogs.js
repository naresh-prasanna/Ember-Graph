import { geo } from '../app/geometry.js';
import { loadState, state } from '../app/persistence.js';
import { S } from '../app/state.js';
import { $, cv } from '../core/dom.js';
import { draw } from '../render/renderer.js';

export function initDialogs() {
  $('#sh').onclick = () => {
    $('#code').value = JSON.stringify(state());
    $('#img').hidden = true;
    $('#sharemsg').textContent = 'Copy this code to share. Paste graph code and choose Load to restore it.';
    $('#dlg').showModal();
    $('#code').select();
  };
  $('#copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('#code').value);
      $('#sharemsg').textContent = 'Copied.';
    } catch {
      $('#code').focus();
      $('#code').select();
      $('#sharemsg').textContent = 'Use Ctrl+C or Cmd+C to copy the selected code.';
    }
  };
  $('#cl').onclick = () => $('#dlg').close();
  $('#ld').onclick = () => {
    try {
      const source = $('#code').value;
      if (source.length > 300000) throw Error('Graph code is too large');
      loadState(JSON.parse(source));
      $('#dlg').close();
    } catch (e) {
      $('#sharemsg').textContent = 'Could not load: ' + e.message;
    }
  };
  $('#im').onclick = () => {
    if (S.rows.some(r => !r.off && r.k?.type === 'fractal' && r.fractalPending)) {
      $('#sharemsg').textContent = 'Fractal is still rendering. Try again in a moment.';
      return;
    }
    S.rows.forEach(r => {
      r.prog = 1;
      r.m = null;
      r.g = null;
    });
    S.sparks = [];
    if (!S.mode3) S.rows.forEach(geo);
    draw(0);
    $('#img').src = cv.toDataURL('image/png');
    $('#img').hidden = false;
    $('#sharemsg').textContent = 'Right-click or long-press the image to save it.';
  };
}
