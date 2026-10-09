import { zoomAt } from '../app/interaction.js';
import { val } from '../app/model.js';
import { saveSoon } from '../app/persistence.js';
import { frameScene, replay, updateStatus } from '../app/scenes.js';
import { S, reduceMotion } from '../app/state.js';
import { $ } from '../core/dom.js';
import { camera } from '../render/camera.js';
import { kick } from '../render/renderer.js';
import { add } from './panel.js';

let noticeTimer;
export function notice(message) {
  $('#notice').textContent = message;
  $('#notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($('#notice').hidden = true), 3200);
}

export function initControls() {
  $('#d3').onclick = () => {
    S.mode3 = !S.mode3;
    S.sparks = [];
    S.marks = [];
    if (S.mode3 && !S.rows.some(r => r.k?.type === 'surf')) add('z = 2*sin(x)*cos(y)');
    S.rows.forEach(r => (r.prog = reduceMotion ? 1 : 0));
    updateStatus();
    S.dirty = true;
    kick();
    saveSoon();
  };
  $('#zi').onclick = () => zoomAt(S.W / 2, S.H / 2, 1.4);
  $('#zo').onclick = () => zoomAt(S.W / 2, S.H / 2, 1 / 1.4);
  $('#hm').onclick = () => frameScene();
  $('#rp').onclick = () => replay();
  $('#guides').onclick = () => {
    S.construction = !S.construction;
    $('#guides').setAttribute('aria-pressed', String(S.construction));
    kick();
    saveSoon();
  };
  $('#drift').onclick = () => {
    if (!S.mode3) {
      notice('Drift is available in 3D. Try the Terrain scene.');
      return;
    }
    if (reduceMotion) {
      notice('Camera drift is disabled by your reduced-motion preference.');
      return;
    }
    S.drifting = !S.drifting;
    $('#drift').setAttribute('aria-pressed', String(S.drifting));
    kick();
  };
  $('#motion').setAttribute('aria-pressed', String(camera.enabled));
  $('#motion').onclick = () => {
    if (reduceMotion) {
      notice('Camera motion is disabled by your reduced-motion preference.');
      return;
    }
    camera.enabled = !camera.enabled;
    camera.trace = null;
    $('#motion').setAttribute('aria-pressed', String(camera.enabled));
    kick();
  };
  $('#hc').onclick = () => {
    const on = document.body.classList.toggle('hc');
    $('#hc').setAttribute('aria-pressed', String(on));
  };
  $('#read').onclick = () => {
    if (!('speechSynthesis' in window)) {
      notice('Speech is not supported in this browser');
      return;
    }
    speechSynthesis.cancel();
    const say = t =>
      t
        .replace(/\^2/g, ' squared ')
        .replace(/\^3/g, ' cubed ')
        .replace(/\^/g, ' to the power of ')
        .replace(/\*/g, ' times ')
        .replace(/\//g, ' over ')
        .replace(/\+/g, ' plus ')
        .replace(/-/g, ' minus ')
        .replace(/=/g, ' equals ')
        .replace(/~/g, ' regression to ')
        .replace(/[()]/g, ' ');
    S.rows.forEach((r, i) => {
      if (r.text.trim())
        speechSynthesis.speak(
          new SpeechSynthesisUtterance(
            'Expression ' +
              (i + 1) +
              ': ' +
              say(r.text) +
              (r.err ? '. Error: ' + r.err : r.info ? '. ' + r.info.replace(/·/g, ',') : ''),
          ),
        );
    });
  };
  $('#trace').onclick = () => {
    const r = S.rows.find(r => !r.off && !r.err && r.k && ['cart', 'function'].includes(r.k.type)),
      AC = window.AudioContext || window.webkitAudioContext;
    if (!r || !AC) {
      notice('Add a function of x to trace');
      return;
    }
    const ac = new AC(),
      o = ac.createOscillator(),
      g = ac.createGain(),
      x0 = -S.V.cx / S.V.s,
      x1 = (S.W - S.V.cx) / S.V.s,
      N = 80,
      T = 4,
      ys = [];
    for (let i = 0; i <= N; i++) {
      const x = x0 + ((x1 - x0) * i) / N;
      try {
        const y = val(
          r.k.c,
          r.k.type === 'function'
            ? {
                [r.k.param]: x,
              }
            : {
                x,
              },
        );
        ys.push(Number.isFinite(y) ? y : null);
      } catch {
        ys.push(null);
      }
    }
    const f = ys.filter(v => v !== null);
    if (!f.length) return;
    const lo = Math.min(...f),
      hi = Math.max(...f);
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(ac.destination);
    ys.forEach((y, i) =>
      o.frequency.setValueAtTime(
        y === null ? 1 : 220 + (hi > lo ? (y - lo) / (hi - lo) : 0.5) * 660,
        ac.currentTime + (T * i) / N,
      ),
    );
    o.start();
    o.stop(ac.currentTime + T);
    notice('Audio trace, left to right: higher pitch means higher value');
  };

  /* ===== Structured maths editor: type directly into fractions, roots, exponents and subscripts ===== */
}
