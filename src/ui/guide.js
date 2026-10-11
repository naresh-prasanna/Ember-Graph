/* The help dialog. Its examples are small plots on graph paper; choosing one adds its expressions to the graph,
   so the help doubles as a set of starting points. */
import { S, reduceMotion } from '../app/state.js';
import { $ } from '../core/dom.js';
import { pretty } from './mathDisplay.js';
import { NEW, add } from './panel.js';

const W = 120,
  H = 72;
// A polyline through f(t) for t from a to b, in the plot's own pixels.
function trace(f, a, b, n = 90) {
  let d = '';
  for (let i = 0; i <= n; i++) {
    const [x, y] = f(a + ((b - a) * i) / n);
    d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d;
}
const axes = (x = W / 2, y = H / 2) => `<path class="axes" d="M0 ${y}H${W}M${x} 0V${H}"/>`,
  curve = (d, cls = 'curve') => `<path class="${cls}" pathLength="1" d="${d}"/>`;

const DATA = [
  [1, 2],
  [2, 3.1],
  [3, 5.2],
  [4, 5.9],
  [5, 8.1],
];
const fitX = x => 14 + x * 17,
  fitY = y => 64 - y * 6.4;

const SPECIMENS = [
  {
    name: 'Sliders',
    show: 'y=a sin(x)',
    rows: ['y=a*sin(x)', 'a=2'],
    plot: () => axes() + curve(trace(t => [W / 2 + t * 9, H / 2 - 2 * Math.sin(t) * 9], -6.7, 6.7)),
  },
  {
    name: 'Polar curves',
    show: 'r=2+sin(5θ)',
    rows: ['r=2+sin(5θ)'],
    plot: () =>
      axes() +
      curve(
        trace(
          t => {
            const r = (2 + Math.sin(5 * t)) * 9.5;
            return [W / 2 + r * Math.cos(t), H / 2 - r * Math.sin(t)];
          },
          0,
          Math.PI * 2,
          240,
        ),
      ),
  },
  {
    name: 'Restrict a domain',
    show: 'y=x^2 {-1≤x≤2}',
    rows: ['y=x^2 {-1≤x≤2}'],
    plot: () => {
      const p = t => [W / 2 - 10 + t * 14, 62 - t * t * 12];
      return axes(W / 2 - 10, 62) + curve(trace(p, -2.6, 2.6), 'ghost') + curve(trace(p, -1, 2));
    },
  },
  {
    name: 'Derivatives',
    show: "f'(x)",
    rows: ['f(x)=x^3-3x', "y=f'(x)"],
    plot: () => {
      const at = f => t => [W / 2 + t * 22, H / 2 - f(t) * 6];
      return (
        axes() +
        curve(
          trace(
            at(t => t ** 3 - 3 * t),
            -2.4,
            2.4,
          ),
          'ghost',
        ) +
        curve(
          trace(
            at(t => 3 * t * t - 3),
            -2.2,
            2.2,
          ),
        )
      );
    },
  },
  {
    name: 'Fit a line to data',
    show: 'y_1~mx_1+b',
    rows: [NEW.data],
    plot: () =>
      axes(fitX(0), fitY(0)) +
      curve(`M${fitX(0.3)} ${fitY(0.3 * 1.5 + 0.37)}L${fitX(5.6)} ${fitY(5.6 * 1.5 + 0.37)}`) +
      DATA.map(([x, y]) => `<circle class="dot" cx="${fitX(x)}" cy="${fitY(y)}" r="2.4"/>`).join(''),
  },
  {
    name: '3D surfaces',
    show: 'z=sin(x)cos(y)',
    rows: ['z=sin(x)*cos(y)'],
    three: true,
    plot: () => {
      const at = (x, y) => [W / 2 + (x - y) * 6.6, H / 2 + 4 + (x + y) * 3.1 - Math.sin(x) * Math.cos(y) * 9],
        lines = [];
      for (let k = -3; k <= 3; k += 0.75) {
        lines.push(trace(t => at(t, k), -3, 3, 40));
        lines.push(trace(t => at(k, t), -3, 3, 40));
      }
      return curve(lines.join(''), 'mesh');
    },
  },
];

function card(s, i) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'specimen';
  b.style.setProperty('--i', i);
  let math;
  try {
    math = pretty(s.show);
  } catch {
    math = '';
  }
  b.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${s.plot()}</svg>` +
    `<span class="equation-display"></span><span class="specimen-name"></span>`;
  const eq = b.querySelector('.equation-display');
  if (math) eq.innerHTML = math;
  else eq.textContent = s.show;
  b.querySelector('.specimen-name').textContent = s.name;
  b.setAttribute(
    'aria-label',
    `${s.name}: add ${s.rows.map(r => (typeof r === 'function' ? 'a data table' : r)).join(' and ')}`,
  );
  b.onclick = () => {
    close(() => {
      for (const r of s.rows) add(typeof r === 'function' ? r() : r);
      if (s.three && !S.mode3) $('#d3')?.click();
    });
  };
  return b;
}

let dialog;
function close(then) {
  if (!dialog.open) return;
  const done = () => {
    dialog.classList.remove('closing');
    dialog.close();
    then?.();
  };
  if (reduceMotion) return done();
  dialog.classList.add('closing');
  dialog.addEventListener('animationend', done, { once: true });
}

export function initGuide() {
  dialog = $('#guide-dialog');
  const grid = dialog.querySelector('.specimens');
  grid.append(...SPECIMENS.map(card));
  $('#help').onclick = () => {
    // Replays the plots drawing in.
    grid.classList.remove('drawn');
    void grid.offsetWidth;
    grid.classList.add('drawn');
    dialog.showModal();
    dialog.focus();
  };
  $('#close-guide').onclick = () => close();
  dialog.querySelector('.guide-x').onclick = () => close();
  dialog.addEventListener('cancel', e => {
    e.preventDefault();
    close();
  });
  // A click on the backdrop lands on the dialog element, outside its box.
  dialog.addEventListener('click', e => {
    const r = dialog.getBoundingClientRect();
    if (
      e.target === dialog &&
      (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
    )
      close();
  });
}
