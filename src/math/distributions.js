/* Probability distributions, as in Desmos. normaldist(0, 1) is a value of its own: a row holding one draws its
   density, D.pdf(x), D.cdf(x), D.cdf(a, b) and D.random(n) evaluate it, and mean, median, stdev, var and
   quantile summarise it. */

// Lanczos approximation, good to about 15 digits.
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
export function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let a = LANCZOS[0];
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * a;
}
// ln|Γ(z)|, which stays finite where Γ itself overflows.
function lgamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lgamma(1 - z);
  z -= 1;
  let a = LANCZOS[0];
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}
const TINY = 1e-300;
// The upper regularised incomplete gamma Q(a, x): a series below a + 1, a continued fraction above.
function gammaQ(a, x) {
  if (x <= 0) return 1;
  const front = Math.exp(-x + a * Math.log(x) - lgamma(a));
  if (x < a + 1) {
    let term = 1 / a,
      sum = term;
    for (let n = 1; n < 1000 && Math.abs(term) > Math.abs(sum) * 1e-17; n++) sum += term *= x / (a + n);
    return 1 - sum * front;
  }
  let b = x + 1 - a,
    c = 1 / TINY,
    d = 1 / b,
    h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    c = b + an / c;
    d = 1 / (Math.abs(d) < TINY ? TINY : d);
    c = Math.abs(c) < TINY ? TINY : c;
    h *= d * c;
    if (Math.abs(d * c - 1) < 1e-16) break;
  }
  return front * h;
}
// The regularised incomplete beta I_x(a, b), by Lentz's continued fraction.
function betaI(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - betaI(1 - x, b, a);
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x)) / a;
  let c = 1,
    d = 1 - ((a + b) * x) / (a + 1),
    h;
  d = 1 / (Math.abs(d) < TINY ? TINY : d);
  h = d;
  for (let m = 1; m < 1000; m++) {
    for (const aa of [
      (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m)),
      (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1)),
    ]) {
      d = 1 + aa * d;
      c = 1 + aa / c;
      d = 1 / (Math.abs(d) < TINY ? TINY : d);
      c = Math.abs(c) < TINY ? TINY : c;
      h *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-16) break;
  }
  return front * h;
}
// Standard normal CDF; each tail is computed directly so tiny probabilities keep their digits.
const phi = z => (z < 0 ? 0.5 * gammaQ(0.5, (z * z) / 2) : 1 - 0.5 * gammaQ(0.5, (z * z) / 2));
// Inverse of phi: Acklam's rational approximation, then one Halley step to full precision.
const IA = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ],
  IB = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
  IC = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ],
  ID = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416],
  poly = (c, x) => c.reduce((s, k) => s * x + k, 0);
function invPhi(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let x;
  if (p < 0.02425 || p > 0.97575) {
    const q = Math.sqrt(-2 * Math.log(Math.min(p, 1 - p)));
    x = (poly(IC, q) / (poly(ID, q) * q + 1)) * (p < 0.5 ? 1 : -1);
  } else {
    const q = p - 0.5;
    x = (poly(IA, q * q) * q) / (poly(IB, q * q) * q * q + 1);
  }
  const u = (phi(x) - p) * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}
const whole = n => Number.isInteger(n);

const KINDS = {
  normaldist: {
    name: 'Normal',
    params: [0, 1],
    valid: (m, s) => s > 0,
    pdf: (x, m, s) => Math.exp(-(((x - m) / s) ** 2) / 2) / (s * Math.sqrt(2 * Math.PI)),
    cdf: (x, m, s) => phi((x - m) / s),
    quantile: (p, m, s) => m + s * invPhi(p),
    mean: m => m,
    variance: (m, s) => s * s,
    describe: (m, s) => `mean ${m}, standard deviation ${s}`,
  },
  tdist: {
    name: 'Student’s t',
    params: [NaN],
    valid: v => v > 0,
    pdf: (x, v) =>
      Math.exp(lgamma((v + 1) / 2) - lgamma(v / 2) - ((v + 1) / 2) * Math.log1p((x * x) / v)) /
      Math.sqrt(v * Math.PI),
    cdf: (x, v) => {
      const tail = betaI(v / (v + x * x), v / 2, 0.5) / 2;
      return x > 0 ? 1 - tail : tail;
    },
    mean: v => (v > 1 ? 0 : NaN),
    variance: v => (v > 2 ? v / (v - 2) : v > 1 ? Infinity : NaN),
    describe: v => `${v} degrees of freedom`,
  },
  poissondist: {
    name: 'Poisson',
    discrete: true,
    params: [NaN],
    valid: l => l > 0,
    pdf: (k, l) => (whole(k) && k >= 0 ? Math.exp(k * Math.log(l) - l - lgamma(k + 1)) : 0),
    cdf: (x, l) => (x < 0 ? 0 : gammaQ(Math.floor(x) + 1, l)),
    mean: l => l,
    variance: l => l,
    describe: l => `mean ${l}`,
  },
  binomialdist: {
    name: 'Binomial',
    discrete: true,
    params: [NaN, 0.5],
    valid: (n, p) => whole(n) && n >= 0 && p >= 0 && p <= 1,
    pdf: (k, n, p) => {
      if (!whole(k) || k < 0 || k > n) return 0;
      if (p === 0 || p === 1) return k === (p ? n : 0) ? 1 : 0;
      return Math.exp(
        lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log1p(-p),
      );
    },
    cdf: (x, n, p) => {
      const k = Math.floor(x);
      return k < 0 ? 0 : k >= n ? 1 : betaI(1 - p, n - k, k + 1);
    },
    mean: (n, p) => n * p,
    variance: (n, p) => n * p * (1 - p),
    describe: (n, p) => `${n} trials, probability ${p}`,
  },
  uniformdist: {
    name: 'Uniform',
    params: [0, 1],
    valid: (a, b) => a < b,
    pdf: (x, a, b) => (x >= a && x <= b ? 1 / (b - a) : 0),
    cdf: (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a))),
    mean: (a, b) => (a + b) / 2,
    variance: (a, b) => (b - a) ** 2 / 12,
    quantile: (p, a, b) => a + p * (b - a),
    describe: (a, b) => `from ${a} to ${b}`,
  },
};
export const DIST_NAMES = Object.keys(KINDS);

export class Dist {
  constructor(kind, params) {
    this.kind = kind;
    this.p = params;
    this.k = KINDS[kind];
  }
  get discrete() {
    return !!this.k.discrete;
  }
  pdf(x) {
    return this.k.pdf(x, ...this.p);
  }
  // cdf(x) is P(X ≤ x); cdf(a, b) is P(a ≤ X ≤ b).
  cdf(a, b) {
    if (b === undefined) return this.k.cdf(a, ...this.p);
    if (a > b) return 0;
    return (
      this.k.cdf(b, ...this.p) -
      (this.discrete ? this.k.cdf(Math.ceil(a) - 1, ...this.p) : this.k.cdf(a, ...this.p))
    );
  }
  // The smallest x with P(X ≤ x) ≥ p.
  quantile(p) {
    if (!(p >= 0 && p <= 1)) return NaN;
    if (this.k.quantile) return this.k.quantile(p, ...this.p);
    const F = x => this.k.cdf(x, ...this.p),
      m = this.mean(),
      s = Math.sqrt(this.variance()),
      centre = Number.isFinite(m) ? m : 0,
      width = Number.isFinite(s) && s > 0 ? s : 1;
    if (p === 0) return this.discrete ? 0 : -Infinity;
    if (p === 1) return this.kind === 'binomialdist' ? this.p[0] : Infinity;
    let lo = centre - width,
      hi = centre + width;
    for (let i = 0; F(lo) > p && i < 60; i++) lo = centre - (centre - lo) * 2;
    for (let i = 0; F(hi) < p && i < 60; i++) hi = centre + (hi - centre) * 2;
    if (this.discrete) {
      lo = Math.max(-1, Math.floor(lo));
      hi = Math.ceil(hi);
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (F(mid) >= p - 1e-12) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    for (let i = 0; i < 200 && hi - lo > 1e-15 * Math.max(1, Math.abs(lo)); i++) {
      const mid = (lo + hi) / 2;
      if (F(mid) < p) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  mean() {
    return this.k.mean(...this.p);
  }
  variance() {
    return this.k.variance(...this.p);
  }
  // n samples, the same ones every time for the same seed, so a graph built on them holds still.
  random(n, seed = 0) {
    const count = n === undefined ? 1 : Math.round(n);
    if (!(count >= 0 && count <= 10000)) return NaN;
    let s = (Math.round(seed * 1000) ^ 0x9e3779b9) >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const draws = Array.from({ length: count }, () => this.quantile(next()));
    return n === undefined ? draws[0] : draws;
  }
  describe() {
    return `${this.k.name} distribution: ${this.k.describe(...this.p.map(v => +v.toPrecision(6)))}`;
  }
  toString() {
    return `${this.kind}(${this.p.join(', ')})`;
  }
}
// normaldist(μ, σ) and friends: missing parameters take Desmos's defaults; impossible ones are undefined.
export function makeDist(kind, args) {
  const K = KINDS[kind],
    p = K.params.map((d, i) => args[i] ?? d);
  if (args.length > K.params.length) throw Error(`${kind} takes at most ${K.params.length} inputs`);
  return p.every(Number.isFinite) && K.valid(...p) ? new Dist(kind, p) : NaN;
}
export const METHODS = new Set(['pdf', 'cdf', 'random']);
// Summaries that also describe a distribution: mean(normaldist(3, 2)) is 3.
export function distStat(name, D, rest) {
  switch (name) {
    case 'mean':
    case 'average':
      return D.mean();
    case 'median':
      return D.quantile(0.5);
    case 'var':
    case 'variance':
      return D.variance();
    case 'stdev':
    case 'stddev':
    case 'standarddeviation':
      return Math.sqrt(D.variance());
    case 'quantile':
      return Array.isArray(rest[0]) ? rest[0].map(p => D.quantile(p)) : D.quantile(rest[0]);
  }
  throw Error(`${name} works on lists, not distributions`);
}
