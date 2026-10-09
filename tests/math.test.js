import { describe, expect, it } from 'vitest';
import { nullObj } from '../src/math/catalog.js';
import { stitchContours } from '../src/math/contours.js';
import { ddValue } from '../src/math/doubleDouble.js';
import { calcFmt, fmt, nice } from '../src/math/format.js';
import { escapeSample, parseFractal } from '../src/math/fractals.js';
import { findImplicitPoints, findKeyPoints, findParametricPoints } from '../src/math/keyPoints.js';
import { mxDet, mxInv } from '../src/math/matrix.js';
import { compileExpr, definition, evaluate, parts, splitTop } from '../src/math/parser.js';
import { solve } from '../src/math/regression.js';
import { evalGeo, freeNames, geoName, geoShapes, parseGeo, writeGeo } from '../src/io/geogebraEval.js';
import { boxCells, boxDimension } from '../src/math/boxCount.js';
import { mqBack, mqNew, mqPrune, mqRight, mqSer, mqType } from '../src/editor/structure.js';

describe('maths editor tidies empty slots', () => {
  const typed = keys => {
    const st = mqNew('');
    for (const k of keys) {
      if (k === '→') mqRight(st);
      else if (k === '⌫') mqBack(st);
      else mqType(st, k);
      mqPrune(st);
    }
    return mqSer(st.root);
  };

  it('keeps the slot being typed in, and drops it once the cursor leaves', () => {
    expect(typed(['x', '/'])).toBe('(x)/()');
    expect(typed(['x', '/', '→'])).toBe('x');
    expect(typed(['x', '/', '→', '+', '1'])).toBe('x+1');
    expect(typed(['2', '^', '→'])).toBe('2');
    expect(typed(['x', '/', '2'])).toBe('(x)/(2)');
  });

  it('steps out of roots, powers, subscripts and fractions on space', () => {
    expect(typed([...'sqrt2 +1'])).toBe('sqrt(2)+1');
    expect(typed([...'x^2 x'])).toBe('x^(2)x');
    expect(typed([...'a_1 +b'])).toBe('a1+b');
    expect(typed([...'1/2 3'])).toBe('(1)/(2)3');
    expect(typed([...'(a b)'])).toBe('(ab)');
  });

  it('removes a fraction on backspace in its empty denominator', () => {
    expect(typed(['x', '/', '⌫'])).toBe('x');
  });

  it('keeps empty function brackets and tidies saved text on blur', () => {
    expect(typed(['s', 'i', 'n', '('])).toBe('sin()');
    const st = mqNew('sin(pi^(3)x)*(sqrt((e^(2)-(x^(2))/())/(2))+abs(x))/()');
    mqPrune(st, false);
    expect(mqSer(st.root)).toBe('sin(π^(3)x)*(sqrt((e^(2)-x^(2))/(2))+abs(x))');
  });

  it('keeps brackets when a bracketed numerator loses its fraction', () => {
    expect(typed(['2', '*', '(', 'a', '+', 'b', ')', '/', '→'])).toBe('2*(a+b)');
    expect(typed(['2', '*', '(', 'a', '+', 'b', ')', '/', '⌫'])).toBe('2*(a+b)');
  });
});
import { columnName, fitData, fitEquation, isTableText, readTable, writeTable } from '../src/math/table.js';

const env = (vars = {}) => ({
  fn: new Map(),
  def: new Map(),
  vars: Object.assign(nullObj(), vars),
  cache: nullObj(),
});
const calc = (src, scope = {}, e = env()) => evaluate(compileExpr(src).ast, scope, e);

describe('parser and evaluator', () => {
  it('follows mathematical precedence', () => {
    expect(calc('-2^2')).toBe(-4);
    expect(calc('2^3^2')).toBe(512);
    expect(calc('1+2*3')).toBe(7);
    expect(calc('2(3+4)')).toBe(14);
  });

  it('reads unicode maths input', () => {
    expect(calc('2π')).toBeCloseTo(2 * Math.PI, 12);
    expect(calc('3²')).toBe(9);
    expect(calc('√(16)')).toBe(4);
    expect(calc('6÷3×2')).toBe(4);
  });

  it('evaluates coordinates and parameters', () => {
    expect(calc('a*sin(x)', { x: Math.PI / 2 }, env({ a: 3 }))).toBeCloseTo(3, 12);
    expect(() => calc('q+1')).toThrow('Undefined variable: q');
  });

  it('explains misplaced commas and brackets in plain words', () => {
    expect(() => compileExpr('a*(cos(t), sin(t))')).toThrow('A comma can only separate');
    expect(() => compileExpr('(x+1')).toThrow('A ( is missing its closing )');
    expect(() => compileExpr('x+1)')).toThrow('There is a ) without a matching (');
  });

  it('reads r and θ as polar coordinates of an x–y point unless r is defined', () => {
    expect(calc('r', { x: 3, y: 4 })).toBe(5);
    expect(calc('θ', { x: 0, y: 2 })).toBeCloseTo(Math.PI / 2, 12);
    const e = env();
    e.def.set('r', { ast: compileExpr('6').ast });
    expect(calc('x^2+y^2-r', { x: 1, y: 1 }, e)).toBe(-4);
    expect(() => calc('r')).toThrow('Undefined variable: r');
  });

  it('chains comparisons pairwise', () => {
    expect(calc('1 < 2 < 3')).toBe(true);
    expect(calc('1 < 3 < 2')).toBe(false);
  });

  it('computes sums, products and calculus numerically', () => {
    expect(calc('sum(n^2, n, 1, 10)')).toBe(385);
    expect(calc('prod(n, n, 1, 5)')).toBe(120);
    const e = env();
    const f = compileExpr('x^2');
    e.fn.set('f', { ast: f.ast, param: 'x', row: { k: {} } });
    const fns = new Set(['f']);
    expect(evaluate(compileExpr('deriv(f, 3)', fns).ast, {}, e)).toBeCloseTo(6, 6);
    expect(evaluate(compileExpr('integral(f, 0, 3)', fns).ast, {}, e)).toBeCloseTo(9, 9);
  });

  it('refuses code-like and oversized input', () => {
    expect(() => compileExpr('constructor')).toThrow('Reserved name');
    expect(() => compileExpr('1;2')).toThrow('Unsupported character');
    expect(() => compileExpr('1+'.repeat(1001) + '1')).toThrow('too long');
    expect(() => compileExpr('('.repeat(100) + '1' + ')'.repeat(100))).toThrow('nested too deeply');
  });

  it('splits restrictions and definitions', () => {
    expect(splitTop('(1,2),(3,4)')).toEqual(['(1,2)', '(3,4)']);
    expect(parts('y = x^2 {-3<=x<=3}')).toEqual({ body: 'y = x^2', filter: '-3<=x<=3' });
    expect(definition('f(x) = x+1')).toEqual({ name: 'f', param: 'x', rhs: ' x+1' });
    expect(definition('a = 2')).toEqual({ name: 'a', rhs: ' 2' });
    expect(definition('y = 2x')).toBeNull();
  });
});

describe('calculator precision', () => {
  const dd = src => ddValue(compileExpr(src), () => NaN);
  it('cancels decimal rounding error', () => {
    expect(dd('0.1+0.2-0.3')).toBe(0);
    expect(calcFmt(dd('0.1+0.2'))).toBe('0.3');
  });
  it('keeps large integer powers exact', () => {
    expect(dd('2^60-2^60+1')).toBe(1);
  });
});

describe('formatting', () => {
  it('formats axis and readout values', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(1 / 3)).toBe('0.33333');
    expect(fmt(123456)).toBe('1.23e+5');
    expect(fmt(NaN)).toBe('—');
    expect(nice(37)).toBe(50);
  });
});

describe('key points', () => {
  it('finds roots, extrema and intersections of explicit curves', () => {
    const pts = findKeyPoints(
      [
        { id: 1, c: '#f00', f: x => x * x - 4 },
        { id: 2, c: '#0f0', f: x => x },
      ],
      -5,
      5,
    );
    const of = t => pts.filter(p => p.t === t);
    expect(
      of('root')
        .map(p => p.x)
        .sort((a, b) => a - b),
    ).toEqual([expect.closeTo(-2, 6), expect.closeTo(0, 6), expect.closeTo(2, 6)]);
    expect(of('minimum')[0]).toMatchObject({ x: expect.closeTo(0, 4), y: expect.closeTo(-4, 6) });
    expect(
      of('intersection')
        .map(p => p.x)
        .sort((a, b) => a - b),
    ).toEqual([expect.closeTo((1 - Math.sqrt(17)) / 2, 6), expect.closeTo((1 + Math.sqrt(17)) / 2, 6)]);
  });

  it('finds the axis intercepts of an implicit circle', () => {
    const N = 400,
      circle = new Float64Array(2 * (N + 1));
    for (let i = 0; i <= N; i++) {
      circle[2 * i] = 3 * Math.cos((2 * Math.PI * i) / N);
      circle[2 * i + 1] = 3 * Math.sin((2 * Math.PI * i) / N);
    }
    const pts = findImplicitPoints((x, y) => x * x + y * y - 9, [circle], -5, 5, -5, 5, '#fff', 1);
    const at = t =>
      pts.filter(p => p.t === t).map(p => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6]);
    expect(at('root')).toEqual([
      [-3, 0],
      [3, 0],
    ]);
    expect(at('y-intercept')).toEqual([
      [0, -3],
      [0, 3],
    ]);
  });
});

describe('parametric and polar key points', () => {
  const round =
    pts =>
    (t, k = 6) =>
      pts
        .filter(p => p.t === t)
        .map(p => [+p.x.toFixed(k), +p.y.toFixed(k)])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  it('finds where a polar curve crosses the axes and its extremes', () => {
    const r = t => 2.3 + 0.45 * Math.cos(5 * t);
    const pts = findParametricPoints(
      t => [r(t) * Math.cos(t), r(t) * Math.sin(t)],
      0,
      2 * Math.PI,
      '#f00',
      1,
    );
    const at = round(pts);
    expect(at('root')).toEqual([
      [-1.85, 0],
      [2.75, 0],
    ]);
    expect(at('y-intercept')).toEqual([
      [0, -2.3],
      [0, 2.3],
    ]);
    expect(at('maximum').length).toBeGreaterThan(0);
    expect(at('minimum').length).toBeGreaterThan(0);
  });

  it('finds the four axis points of a parametric circle without duplicates', () => {
    const pts = findParametricPoints(t => [2.3 * Math.cos(t), 2.3 * Math.sin(t)], 0, 2 * Math.PI, '#f00', 1);
    const at = round(pts);
    expect(at('root')).toEqual([
      [-2.3, 0],
      [2.3, 0],
    ]);
    expect(at('y-intercept')).toEqual([
      [0, -2.3],
      [0, 2.3],
    ]);
    expect(pts).toHaveLength(4);
  });

  it('skips parameter values outside a restriction', () => {
    const pts = findParametricPoints(
      t => (t <= Math.PI ? [Math.cos(t), Math.sin(t)] : null),
      0,
      2 * Math.PI,
      '#f00',
      1,
    );
    expect(round(pts)('y-intercept')).toEqual([[0, 1]]);
  });
});

describe('contours', () => {
  it('joins shared segment endpoints into one closed path', () => {
    const square = [
      [0, 0, 1, 0],
      [1, 0, 1, 1],
      [1, 1, 0, 1],
      [0, 1, 0, 0],
    ];
    const paths = stitchContours(square);
    expect(paths).toHaveLength(1);
    expect(paths[0].slice(0, 2)).toEqual(paths[0].slice(-2));
  });

  it('keeps disconnected pieces separate', () => {
    expect(
      stitchContours([
        [0, 0, 1, 0],
        [5, 5, 6, 5],
      ]),
    ).toHaveLength(2);
  });
});

describe('linear algebra', () => {
  it('computes determinants and inverses', () => {
    expect(
      mxDet([
        [2, 0],
        [0, 3],
      ]),
    ).toBe(6);
    expect(
      mxInv([
        [2, 0],
        [0, 4],
      ]),
    ).toEqual([
      [0.5, 0],
      [0, 0.25],
    ]);
    expect(
      mxInv([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
  });

  it('solves linear systems', () => {
    expect(
      solve(
        [
          [2, 1],
          [1, 3],
        ],
        [3, 5],
      ),
    ).toEqual([expect.closeTo(0.8, 12), expect.closeTo(1.4, 12)]);
  });
});

describe('fractals', () => {
  const p = { family: 'mandelbrot', julia: false, cr: 0, ci: 0, power: 2, iterations: 100 };
  it('marks bounded points and gives smooth escape times elsewhere', () => {
    expect(escapeSample(0, 0, p)).toBe(-1);
    expect(escapeSample(2, 2, p)).toBeGreaterThan(0);
  });

  it('parses fractal expressions with defaults', () => {
    const k = parseFractal('fractal(julia)', '', s => s);
    expect(k).toMatchObject({ type: 'fractal', family: 'julia', args: ['-0.8', '0.156', '280'] });
    expect(() => parseFractal('fractal(nope)', '', s => s)).toThrow('Unknown fractal family');
  });
});

describe('tables', () => {
  it('round-trips the stored table text and recognises column names', () => {
    const t = {
      cols: [
        { h: 'x1', v: ['1', '2'] },
        { h: 'y_1', v: ['3', ''], off: true },
      ],
      fit: { type: 'linear', y: 1 },
    };
    const text = writeTable(t);
    expect(isTableText(text)).toBe(true);
    expect(isTableText('y = table')).toBe(false);
    expect(readTable(text)).toEqual(t);
    expect(readTable('table {nope')).toBeNull();
    expect(columnName('y_1')).toBe('y1');
    expect(columnName('x1^2')).toBeNull();
  });

  it('fits a line with the same coefficients as Desmos', () => {
    const fit = fitData('linear', [2, 4, 9], [5, 7, 10]);
    expect(fit.p[0]).toBeCloseTo(0.692308, 5);
    expect(fit.p[1]).toBeCloseTo(3.871795, 5);
    expect(fit.r).toBeCloseTo(Math.sqrt(fit.r2), 10);
    expect(fitEquation(fit, 'y1', 'x1', v => v.toFixed(3))).toBe('y1 = 0.692x1 + 3.872');
  });

  it('passes a quartic exactly through five points and reports too few points', () => {
    const xs = [-2, -1, 0, 1, 3],
      ys = xs.map(x => x ** 4 - 2 * x ** 2 + 1);
    const fit = fitData('quartic', xs, ys);
    expect(fit.r2).toBeCloseTo(1, 9);
    fit.resid.forEach(e => expect(Math.abs(e)).toBeLessThan(1e-8));
    expect(fitData('quartic', [1, 2], [1, 2]).error).toMatch(/at least 5/);
  });

  it('recovers exponential and sinusoidal models', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7];
    const ex = fitData(
      'exponential',
      xs,
      xs.map(x => 2 * Math.exp(0.3 * x)),
    );
    expect(ex.p[0]).toBeCloseTo(2, 4);
    expect(ex.p[1]).toBeCloseTo(0.3, 4);
    const sx = Array.from({ length: 30 }, (_, i) => i * 0.4);
    const sn = fitData(
      'sinusoidal',
      sx,
      sx.map(x => 3 * Math.sin(1.5 * x + 0.4) + 1),
    );
    expect(sn.r2).toBeGreaterThan(0.999);
  });
});

describe('merged names', () => {
  it('reads mx and ax1 as products unless the name is defined', () => {
    expect([...compileExpr('mx + b').deps].sort()).toEqual(['b', 'm', 'x']);
    expect([...compileExpr('abx1').deps].sort()).toEqual(['a', 'b', 'x1']);
    expect(evaluate(compileExpr('mx + b').ast, { x: 3 }, env({ m: 2, b: 1 }))).toBe(7);
    expect([...compileExpr('ax', new Set(), new Set(['ax'])).deps]).toEqual(['ax']);
    expect([...compileExpr('apples + rate + exp(x)').deps].sort()).toEqual(['apples', 'exp', 'rate', 'x']);
  });
});

describe('GeoGebra evaluator', () => {
  const dragon =
    'Iteration[Flatten[Zip[{Dilate[Rotate[f, ((-((k * pi)))) / 4, Point[f, 0]], 1 / sqrt(2), Point[f, 0]], Dilate[Rotate[f, ((k * pi)) / 4, Point[f, 1]], 1 / sqrt(2), Point[f, 1]]}, f, fs, k, Sequence[(-1)^(p), p, 1, Length[fs]]]], fs, {{f}}, n]';
  const f = { t: 'seg', a: [1.98, 2.2], b: [8.5, 1.84] };

  it('re-runs the dragon curve construction as one connected path', () => {
    const ast = parseGeo(dragon);
    expect([...freeNames(ast)].sort()).toEqual(['f', 'n']);
    const v = evalGeo(ast, name => ({ f, n: 12 })[name]);
    expect(v).toHaveLength(4096);
    const { paths } = geoShapes(v);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveLength(2 * 4097);
    expect(paths[0].slice(0, 2)).toEqual(f.a);
    expect(paths[0].at(-2)).toBeCloseTo(8.5, 9);
  });

  it('handles points, lists and friendly errors', () => {
    expect(evalGeo(parseGeo('Sequence((i, i^2), i, 1, 3)'), () => undefined)).toEqual(
      [1, 2, 3].map(i => ({ t: 'pt', p: [i, i * i] })),
    );
    expect(evalGeo(parseGeo('Length[{1,2,3}] + 2pi'), () => undefined)).toBeCloseTo(3 + 2 * Math.PI);
    expect(() => evalGeo(parseGeo('Spline[{(1,2)}]'), () => undefined)).toThrow('Spline is not supported');
    expect(() => evalGeo(parseGeo('Iteration[Flatten[{fs, fs}], fs, {{1}}, 20]'), () => undefined)).toThrow(
      'more than',
    );
  });

  it('reads a stored object name without parsing the whole object', () => {
    expect(geoName(writeGeo({ name: "A'_{1}", exp: '(1, 2)', env: {} }))).toBe("A'_{1}");
    expect(geoName('geogebra {"exp":"1"}')).toBe('');
  });

  it('box-counts lines, areas and the dragon', () => {
    expect(boxCells([[0.1, 0.1, 3.9, 0.1]], [], 1)).toEqual(Int32Array.from([0, 0, 1, 0, 2, 0, 3, 0]));
    // A diagonal crosses one new square per step plus the shared corners it skims.
    expect(boxCells([[0.5, 0.5, 2.5, 2.7]], [], 1).length / 2).toBe(5);
    expect(boxDimension([[0, 0, 7.3, 2.1]], []).dim).toBeCloseTo(1, 1);
    const fill = [];
    for (let i = 0; i < 400; i++) for (let j = 0; j < 400; j++) fill.push([i / 100, j / 100]);
    expect(boxDimension([], fill).dim).toBeCloseTo(2, 1);
    const { paths } = geoShapes(evalGeo(parseGeo(dragon), name => ({ f, n: 14 })[name]));
    const { dim } = boxDimension(paths, []);
    expect(dim).toBeGreaterThan(1.4);
    expect(dim).toBeLessThan(2.05);
  });
});
