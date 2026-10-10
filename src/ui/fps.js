/* A debug overlay, toggled with the ` key: frames per second, a frame-time chart, and how long the main
   jobs took. It runs its own frame loop, so a stall shows even while the graph itself is idle. */
import { S } from '../app/state.js';

const KEY = 'ember-fps',
  W = 200,
  H = 44,
  JOBS = ['rebuild', 'curves', 'draw'];
let box = null,
  chart = null,
  text = null,
  raf = 0,
  last = 0,
  opened = 0,
  lastText = 0;
const frames = [],
  jobs = Object.fromEntries(JOBS.map(n => [n, []]));

// Jobs report how long they took; nothing is kept while the overlay is closed.
export function timing(name, ms) {
  if (!raf) return;
  (jobs[name] ||= []).push([performance.now(), ms]);
}

function recent(list, now) {
  while (list.length && now - list[0][0] > 1000) list.shift();
  return list;
}
const ms = v => (v < 10 ? v.toFixed(1) : Math.round(v)).toString().padStart(4);

function paint(now) {
  const dt = now - last;
  last = now;
  frames.push([now, dt]);
  recent(frames, now);
  for (const n in jobs) recent(jobs[n], now);

  const g = chart.getContext('2d'),
    y = v => H - Math.min(v, 50) * (H / 50);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#ffffff1a';
  g.beginPath();
  for (const guide of [1000 / 60, 1000 / 30]) {
    g.moveTo(0, y(guide) + 0.5);
    g.lineTo(W, y(guide) + 0.5);
  }
  g.stroke();
  const shown = frames.slice(-W / 2);
  shown.forEach(([, d], i) => {
    g.fillStyle = d > 50 ? '#ff5a4a' : d > 1000 / 30 ? '#ffb347' : '#ff783b';
    g.fillRect(W - (shown.length - i) * 2, y(d), 1.5, H - y(d));
  });

  if (now - lastText > 250) {
    lastText = now;
    const n = frames.length,
      avg = n ? frames.reduce((s, f) => s + f[1], 0) / n : 0,
      worst = Math.max(0, ...frames.map(f => f[1])),
      slow = frames.filter(f => f[1] > 50).length,
      fps = Math.round((n * 1000) / Math.min(1000, Math.max(1, now - opened))),
      rows = JOBS.map(name => {
        const list = jobs[name],
          top = list.length ? Math.max(...list.map(j => j[1])) : 0,
          lastMs = list.at(-1)?.[1];
        return `${name.padEnd(8)}${lastMs === undefined ? '    –' : ms(lastMs)} ms  max ${ms(top)}  ×${list.length}`;
      });
    text.innerHTML =
      `<b class="${fps >= 55 ? 'ok' : fps >= 30 ? 'meh' : 'bad'}">${fps}</b> FPS` +
      `<span>frame ${ms(avg)} ms  worst ${ms(worst)}</span>` +
      `<span>slow frames ${slow}/s   graph ${S.on ? 'drawing' : 'idle'}</span>` +
      rows.map(r => `<span>${r}</span>`).join('');
  }
  raf = requestAnimationFrame(paint);
}

function show(on) {
  if (on === !!raf) return;
  if (on) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'fps';
      box.setAttribute('aria-hidden', 'true');
      chart = document.createElement('canvas');
      chart.width = W;
      chart.height = H;
      text = document.createElement('div');
      box.append(text, chart);
      document.body.append(box);
    }
    box.hidden = false;
    frames.length = 0;
    last = opened = performance.now();
    raf = requestAnimationFrame(paint);
  } else {
    cancelAnimationFrame(raf);
    raf = 0;
    box.hidden = true;
  }
  try {
    localStorage.setItem(KEY, on ? '1' : '');
  } catch {
    /* Private mode: the overlay just starts closed next time. */
  }
}

export function initFps() {
  document.addEventListener('keydown', e => {
    if (e.key !== '`' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], .mq')) return;
    e.preventDefault();
    show(!raf);
  });
  try {
    if (localStorage.getItem(KEY)) show(true);
  } catch {
    /* Unreadable storage: start closed. */
  }
}
