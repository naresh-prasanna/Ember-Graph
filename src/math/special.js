/* The special functions that integrals without an elementary answer are written in, as Wolfram writes them:
   ∫ e^(−x²) dx = (√π/2)·erf(x), ∫ sin(x)/x dx = Si(x), ∫ eˣ/x dx = Ei(x), ∫ 1/ln(x) dx = li(x).
   Series near 0 and continued fractions further out, after Numerical Recipes, to about 15 digits. */

const EULER = 0.5772156649015329,
  EPS = 1e-16,
  TINY = 1e-300,
  ROOT_PI = Math.sqrt(Math.PI);

// Complex numbers as [re, im], only as much as the continued fractions need.
const cmul = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c],
  cdiv = ([a, b], [c, d]) => {
    const n = c * c + d * d;
    return [(a * c + b * d) / n, (b * c - a * d) / n];
  },
  cadd = ([a, b], [c, d]) => [a + c, b + d],
  cabs = ([a, b]) => Math.hypot(a, b);

// erf(x) = (2/√π) ∫₀ˣ e^(−t²) dt, summed as (2/√π) e^(−x²) Σ 2ⁿx^(2n+1)/(1·3·…·(2n+1)): every term positive.
export function erf(x) {
  if (Number.isNaN(x)) return NaN;
  if (Math.abs(x) > 6) return Math.sign(x);
  let term = x,
    sum = x;
  for (let n = 1; n < 500 && Math.abs(term) > EPS * Math.abs(sum); n++) {
    term *= (2 * x * x) / (2 * n + 1);
    sum += term;
  }
  return (2 / ROOT_PI) * Math.exp(-x * x) * sum || 0;
}
// erfi(x) = −i·erf(ix) = (2/√π) ∫₀ˣ e^(t²) dt.
export function erfi(x) {
  if (Number.isNaN(x)) return NaN;
  if (Math.abs(x) > 27) return Math.sign(x) * Infinity;
  let term = x,
    sum = x;
  for (let n = 1; n < 2000 && Math.abs(term) > EPS * Math.abs(sum); n++) {
    term *= (x * x) / n;
    sum += term / (2 * n + 1);
  }
  return (2 / ROOT_PI) * sum;
}

// Si(x) = ∫₀ˣ sin(t)/t dt and Ci(x) = γ + ln x + ∫₀ˣ (cos t − 1)/t dt, together.
function cisi(x) {
  const t = Math.abs(x);
  if (t === 0) return [-Infinity, 0];
  let si, ci;
  if (t > 2) {
    let b = [1, t],
      c = [1 / TINY, 0],
      d = cdiv([1, 0], b),
      h = d;
    for (let i = 2; i < 200; i++) {
      const a = -((i - 1) * (i - 1));
      b = cadd(b, [2, 0]);
      d = cdiv([1, 0], cadd(cmul([a, 0], d), b));
      c = cadd(b, cdiv([a, 0], c));
      const del = cmul(c, d);
      h = cmul(h, del);
      if (cabs(cadd(del, [-1, 0])) < EPS) break;
    }
    h = cmul([Math.cos(t), -Math.sin(t)], h);
    ci = -h[0];
    si = Math.PI / 2 + h[1];
  } else {
    let sum = 0,
      sums = 0,
      sumc = 0,
      sign = 1,
      fact = 1,
      odd = true;
    for (let k = 1; k < 100; k++) {
      fact *= t / k;
      const term = fact / k;
      sum += sign * term;
      const err = term / Math.abs(sum);
      if (odd) {
        sign = -sign;
        sums = sum;
        sum = sumc;
      } else {
        sumc = sum;
        sum = sums;
      }
      if (err < EPS) break;
      odd = !odd;
    }
    si = sums;
    ci = sumc + Math.log(t) + EULER;
  }
  return [ci, x < 0 ? -si : si];
}
export const Si = x => (Number.isNaN(x) ? NaN : cisi(x)[1]);
// For x < 0 this is Ci(|x|), the real antiderivative of cos(x)/x there, as ln|x| is for 1/x.
export const Ci = x => (Number.isNaN(x) ? NaN : cisi(x)[0]);

// E₁(t) = ∫ₜ^∞ e^(−s)/s ds for t > 0.
function E1(t) {
  if (t <= 1) {
    let sum = 0,
      term = 1;
    for (let k = 1; k < 100; k++) {
      term *= -t / k;
      const add = term / k;
      sum += add;
      if (Math.abs(add) < EPS * Math.abs(sum)) break;
    }
    return -EULER - Math.log(t) - sum;
  }
  let b = t + 1,
    c = 1 / TINY,
    d = 1 / b,
    h = d;
  for (let i = 1; i < 300; i++) {
    const a = -i * i;
    b += 2;
    d = 1 / (a * d + b);
    c = b + a / c;
    const del = c * d;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h * Math.exp(-t);
}
// Ei(x) = −∫₋ₓ^∞ e^(−t)/t dt, the principal value: the antiderivative of eˣ/x.
export function Ei(x) {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return -Infinity;
  if (x < 0) return -E1(-x);
  if (x > 709) return Infinity;
  if (x < 50) {
    let sum = 0,
      term = 1;
    for (let k = 1; k < 500; k++) {
      term *= x / k;
      const add = term / k;
      sum += add;
      if (add < EPS * sum) break;
    }
    return EULER + Math.log(x) + sum;
  }
  let sum = 1,
    term = 1;
  for (let k = 1; k < 40; k++) {
    const next = (term * k) / x;
    if (next > term) break;
    term = next;
    sum += term;
    if (term < EPS * sum) break;
  }
  return (Math.exp(x) / x) * sum;
}
// li(x) = ∫₀ˣ dt / ln t, the antiderivative of 1/ln x.
export const li = x => (x < 0 || Number.isNaN(x) ? NaN : x === 0 ? 0 : x === 1 ? -Infinity : Ei(Math.log(x)));
// Shi(x) = ∫₀ˣ sinh(t)/t dt and Chi(x) = γ + ln|x| + ∫₀ˣ (cosh t − 1)/t dt.
export function Shi(x) {
  if (Number.isNaN(x)) return NaN;
  if (Math.abs(x) > 5) return (Math.sign(x) * (Ei(Math.abs(x)) - Ei(-Math.abs(x)))) / 2;
  let term = x,
    sum = x;
  for (let k = 1; k < 100 && Math.abs(term) > EPS * Math.abs(sum); k++) {
    term *= (x * x) / (2 * k * (2 * k + 1));
    sum += term / (2 * k + 1);
  }
  return sum;
}
export function Chi(x) {
  if (Number.isNaN(x)) return NaN;
  const t = Math.abs(x);
  if (t === 0) return -Infinity;
  if (t > 5) return (Ei(t) + Ei(-t)) / 2;
  let term = 1,
    sum = 0;
  for (let k = 1; k < 100; k++) {
    term *= (t * t) / ((2 * k - 1) * (2 * k));
    sum += term / (2 * k);
    if (term < EPS * sum) break;
  }
  return EULER + Math.log(t) + sum;
}

// The Fresnel integrals S(x) = ∫₀ˣ sin(πt²/2) dt and C(x) = ∫₀ˣ cos(πt²/2) dt, together.
function fresnel(x) {
  const ax = Math.abs(x);
  let s, c;
  if (ax < 1e-150) [s, c] = [0, ax];
  else if (ax <= 1.5) {
    const fact = (Math.PI / 2) * ax * ax;
    let sum = 0,
      sums = 0,
      sumc = ax,
      sign = 1,
      odd = true,
      term = ax,
      n = 3;
    for (let k = 1; k < 100; k++) {
      term *= fact / k;
      sum += (sign * term) / n;
      const test = Math.abs(sum) * EPS;
      if (odd) {
        sign = -sign;
        sums = sum;
        sum = sumc;
      } else {
        sumc = sum;
        sum = sums;
      }
      if (term < test) break;
      odd = !odd;
      n += 2;
    }
    [s, c] = [sums, sumc];
  } else {
    const pix2 = Math.PI * ax * ax;
    let b = [1, -pix2],
      cc = [1 / TINY, 0],
      d = cdiv([1, 0], b),
      h = d,
      n = -1;
    for (let k = 2; k < 200; k++) {
      n += 2;
      const a = -n * (n + 1);
      b = cadd(b, [4, 0]);
      d = cdiv([1, 0], cadd(cmul([a, 0], d), b));
      cc = cadd(b, cdiv([a, 0], cc));
      const del = cmul(cc, d);
      h = cmul(h, del);
      if (cabs(cadd(del, [-1, 0])) < EPS) break;
    }
    h = cmul(h, [ax, -ax]);
    const cs = cmul([0.5, 0.5], cadd([1, 0], cmul([-Math.cos(pix2 / 2), -Math.sin(pix2 / 2)], h)));
    [c, s] = cs;
  }
  return x < 0 ? [-s, -c] : [s, c];
}
export const fresnelS = x => (Number.isNaN(x) ? NaN : fresnel(x)[0]);
export const fresnelC = x => (Number.isNaN(x) ? NaN : fresnel(x)[1]);
