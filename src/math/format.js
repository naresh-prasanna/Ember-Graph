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
/* Double-double arithmetic (~32 digits) for calculator rows: literals are read exactly from their decimal text. */
export const rgba = (h, a) =>
  `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
export const nice = v => {
  const p = 10 ** Math.floor(Math.log10(v)),
    f = v / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
};
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
