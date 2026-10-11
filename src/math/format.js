export const fmt = v =>
  !Number.isFinite(v)
    ? '—'
    : Math.abs(v) < 1e-15
      ? '0'
      : Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3
        ? v.toExponential(2)
        : String(+v.toPrecision(5));
export const calcFmt = v =>
  !Number.isFinite(v)
    ? 'undefined'
    : Math.abs(v) < 1e-15
      ? '0'
      : Math.abs(v) >= 1e10 || Math.abs(v) < 1e-6
        ? v.toExponential(9).replace(/\.?0+e/, 'e')
        : String(+v.toPrecision(10));
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// [n, d] when an answer is plainly a fraction: 0.8333… is 5/6 and 4.214 is 2107/500, but π is not 355/113.
export function toFraction(v) {
  if (!Number.isFinite(v) || Number.isInteger(v) || Math.abs(v) >= 1e9) return null;
  const x = Math.abs(v),
    s = Math.sign(v),
    tol = 1e-12 * Math.max(1, x);
  let [h0, h1, k0, k1] = [0, 1, 1, 0],
    y = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(y);
    [h0, h1, k0, k1] = [h1, a * h1 + h0, k1, a * k1 + k0];
    if (k1 > 10000) break;
    if (Math.abs(x - h1 / k1) <= tol) return [s * h1, k1];
    if (y - a < 1e-15) break;
    y = 1 / (y - a);
  }
  // A short decimal keeps its larger denominator: 0.123456 is 1929/15625.
  const m = calcFmt(x).match(/^\d+\.(\d{1,6})$/);
  if (!m) return null;
  const d = 10 ** m[1].length,
    n = Math.round(x * d),
    g = gcd(n, d);
  return Math.abs(x - n / d) <= tol ? [(s * n) / g, d / g] : null;
}
/* Double-double arithmetic (~32 digits) for calculator rows: literals are read exactly from their decimal text. */
export const rgba = (h, a) =>
  `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
export const nice = v => {
  const p = 10 ** Math.floor(Math.log10(v)),
    f = v / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
};
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
