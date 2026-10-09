export const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k),
  nullObj = () => Object.create(null);
export const math = nullObj();
'sin cos tan asin acos atan atan2 sinh cosh tanh exp sqrt abs floor ceil round sign min max pow cbrt hypot asinh acosh atanh log2'
  .split(' ')
  .forEach(k => (math[k] = Math[k]));
Object.assign(math, {
  ln: Math.log,
  log: Math.log10,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sec: x => 1 / Math.cos(x),
  csc: x => 1 / Math.sin(x),
  cot: x => 1 / Math.tan(x),
  mod: (a, b) => ((a % b) + b) % b,
  piece: (...a) => {
    for (let i = 0; i + 1 < a.length; i += 2) if (a[i]) return a[i + 1];
    return a.length % 2 ? a[a.length - 1] : NaN;
  },
  fact: n => {
    n = Math.round(n);
    if (n < 0 || n > 170) return NaN;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  },
  ncr: (n, k) => {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  },
  npr: (n, k) => {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 0; i < k; i++) r *= n - i;
    return r;
  },
});
export const constants = {
    pi: Math.PI,
    e: Math.E,
    tau: 2 * Math.PI,
  },
  special = new Set(['deriv', 'integral', 'sum', 'prod']),
  coords = new Set(['x', 'y', 'z', 'r', 't', 'theta']);
export const forbidden = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'window',
  'document',
  'globalThis',
  'eval',
  'Function',
  'this',
  'new',
  'return',
]);
export const reserved = n =>
  own(math, n) || own(constants, n) || special.has(n) || coords.has(n) || forbidden.has(n);
export const SYM = {
  pi: 'π',
  theta: 'θ',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  lambda: 'λ',
  sigma: 'σ',
  phi: 'φ',
  omega: 'ω',
  tau: 'τ',
  sqrt: '√',
};
export const normalize = s =>
  s
    .replace(/π/g, 'pi')
    .replace(/θ/g, 'theta')
    .replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080))
    .replace(/τ/g, 'tau')
    .replace(/α/g, 'alpha')
    .replace(/β/g, 'beta')
    .replace(/γ/g, 'gamma')
    .replace(/δ/g, 'delta')
    .replace(/λ/g, 'lambda')
    .replace(/σ/g, 'sigma')
    .replace(/φ/g, 'phi')
    .replace(/ω/g, 'omega')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt')
    .replace(/[−–]/g, '-')
    .replace(/×|·/g, '*')
    .replace(/÷/g, '/')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/\*\*/g, '^');

/* Pratt parser: exponentiation is right associative; -x^2 means -(x^2).
   Implicit multiplication binds like *, and chained comparisons are pairwise. */
