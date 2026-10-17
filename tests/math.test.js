import { describe, expect, it } from 'vitest';
import { nullObj, textNotation } from '../src/math/catalog.js';
import { measurePaths, stitchContours } from '../src/math/contours.js';
import { ddValue } from '../src/math/doubleDouble.js';
import { calcFmt, fmt, nice, toFraction } from '../src/math/format.js';
import { findRoots } from '../src/math/regression.js';
import { curveBounds, curvePoints, escapeSample, parseFractal } from '../src/math/fractals.js';
import { findImplicitPoints, findKeyPoints, findParametricPoints } from '../src/math/keyPoints.js';
import { mxDet, mxInv } from '../src/math/matrix.js';
import {
  BRANCH,
  compileExpr,
  compileReal,
  definition,
  evaluate,
  listLength,
  parts,
  splitTop,
} from '../src/math/parser.js';
import { solve } from '../src/math/regression.js';
import {
  calculus,
  derivativeSteps,
  integralEquation,
  integralSteps,
  odeSteps,
  solveODE,
} from '../src/math/symbolic.js';
import { antiderivativeSeries, integralSeries } from '../src/math/series.js';
import { evalGeo, freeNames, geoName, geoShapes, parseGeo, writeGeo } from '../src/io/geogebraEval.js';
import { boxCells, boxDimension } from '../src/math/boxCount.js';
import {
  mqBack,
  mqInsert,
  mqNew,
  mqPrune,
  mqRight,
  mqSer,
  mqType,
  mqVert,
  parenCloserGhost,
} from '../src/editor/structure.js';
import { NAMES, SPELLINGS, nameMatch } from '../src/math/names.js';
import { Color, colorSliders } from '../src/math/values.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

  it('opens log, ∫, Σ, ∏, ⁿ√ and d/dx as layouts with slots, as Desmos does', () => {
    const moves = keys => {
      const st = mqNew('');
      for (const k of keys) {
        if (k === '→') mqRight(st);
        else if (k === '↑') mqVert(st, true);
        else if (k === '⌫') mqBack(st);
        // ∫ stands for picking the integral from the suggestions, which replaces the "int" typed to find it.
        else if (k === '∫') mqInsert(st, 'int', 3);
        else mqType(st, k);
        mqPrune(st);
      }
      return mqSer(st.root);
    };
    expect(moves([...'int'])).toBe('int');
    expect(moves([...'int+1'])).toBe('int+1');
    expect(moves([...'log100'])).toBe('log(100)');
    expect(moves([...'log(100)'])).toBe('log(100)');
    expect(moves([...'log2(8)'])).toBe('log(8,2)');
    expect(moves([...'log_3 81'])).toBe('log(81,3)');
    expect(moves([...'int∫0↑3→x^2'])).toBe('integral(x^(2),x,0,3)');
    expect(moves([...'sum1↑10→n^2'])).toBe('sum(n^(2),n,1,10)');
    expect(moves([...'prod1↑5 n'])).toBe('prod(n,n,1,5)');
    expect(moves([...'nthroot3→27'])).toBe('nthroot(27,3)');
    expect(moves([...'d/dxx^3'])).toBe('deriv(x^(3),x)');
    // Typing d/dx in front of an expression already on the row takes that expression as the body.
    {
      const st = mqNew('');
      for (const k of [...'ln(x)']) mqType(st, k);
      mqPrune(st);
      st.cur = { blk: st.root, i: 0 };
      for (const k of [...'d/dx']) {
        mqType(st, k);
        mqPrune(st);
      }
      expect(mqSer(st.root)).toBe('deriv(ln(x),x)');
    }
    // Keypad / suggestion insert in front of an expression pulls it into the body too.
    {
      const st = mqNew('');
      for (const k of [...'sin(x)']) mqType(st, k);
      mqPrune(st);
      st.cur = { blk: st.root, i: 0 };
      mqInsert(st, 'deriv', 0);
      mqPrune(st);
      expect(mqSer(st.root)).toBe('deriv(sin(x),x)');
    }
    expect(textNotation('d/dx()ln(x)')).toBe('deriv(ln(x),x)');
    expect(textNotation('d/dx()x^2 + 1')).toBe('deriv(x^2 + 1,x)');
    expect(textNotation('d/dx()x^2 = 0')).toBe('deriv(x^2,x)= 0');
    // ) closes the drawn brackets of d/dx: what follows the cursor multiplies outside.
    {
      const st = mqNew('');
      for (const k of [...'d/dxx*x^2']) {
        mqType(st, k);
        mqPrune(st);
      }
      st.cur = { blk: st.root.items[0].blocks[1], i: 1 };
      mqType(st, ')');
      mqPrune(st);
      expect(mqSer(st.root)).toBe('deriv(x,x)*x^(2)');
    }
    // Cursor after a trailing · still yields d/dx(x³)·x², not an unfinished d/dx(x³·).
    {
      const st = mqNew('');
      for (const k of [...'d/dxx^3*x^2']) {
        mqType(st, k);
        mqPrune(st);
      }
      const body = st.root.items[0].blocks[1];
      st.cur = { blk: body, i: body.items.indexOf('*') + 1 };
      mqType(st, ')');
      mqPrune(st);
      expect(mqSer(st.root)).toBe('deriv(x^(3),x)*x^(2)');
    }
    expect(moves([...'int∫⌫'])).toBe('');
    expect(moves([...'int∫→x^2'])).toBe('integral(x^(2),x)');
    expect(moves([...'int∫→x sin(x)→+1'])).toBe('integral(xsin(x),x)+1');
    expect(moves([...'2+in∫→x'])).toBe('2+integral(x,x)');
    for (const t of [
      'log(x,2)',
      'integral(x^(2),x,0,3)',
      'integral(x^(2),x)',
      'sum(n,n,1,10)',
      'nthroot(27,3)',
      'deriv(x^(3),x)',
    ])
      expect(mqSer(mqNew(t).root)).toBe(t);
    expect(calc('integral(x^2, x, 0, 3)')).toBeCloseTo(9, 8);
    expect(calc('integral(t^2, t, 0, x)', { x: 3 })).toBeCloseTo(9, 8);
    expect(calc('deriv(x^3, x)', { x: 2 })).toBeCloseTo(12, 5);
    expect(calc('deriv(sin, 0)')).toBeCloseTo(1, 6);
  });

  it('ignores a doubled ^ and repairs rows saved with one', () => {
    expect(typed([...'x^^3'])).toBe('x^(3)');
    expect(typed([...'x^2^3'])).toBe('x^(2^(3))');
    expect(mqSer(mqNew('x^(^(3))').root)).toBe('x^(3)');
  });

  it('types with, for, and and or as words, not products', () => {
    expect(typed([...'[n^2 for n=[1...5]]'])).toBe('[n^(2) for n=[1...5]]');
    expect(typed([...'x^2+a with a=3'])).toBe('x^(2)+a with a=3');
    expect(typed([...'awith a=3'])).toBe('a with a=3');
    expect(typed([...'x>0 and y>0'])).toBe('x>0 and y>0');
    expect(typed([...'floor(x)'])).toBe('floor(x)');
    expect(typed([...'D.random(2)'])).toBe('D.random(2)');
    expect(typed([...'uniformdist()'])).toBe('uniformdist()');
    expect(mqSer(mqNew('[n^(2) for n=[1...5]]').root)).toBe('[n^(2) for n=[1...5]]');
    expect(mqSer(mqNew('x>0 or y>0').root)).toBe('x>0 or y>0');
  });

  it('never drops a bracket that was typed', () => {
    const left = keys => {
      const st = mqNew('');
      for (const k of keys) {
        if (k === '→') mqRight(st);
        else if (k === '⌫') mqBack(st);
        else mqType(st, k);
        mqPrune(st);
      }
      mqPrune(st, false);
      return mqSer(st.root);
    };
    expect(left([...'3('])).toBe('3()');
    expect(left([...'(x)/→'])).toBe('(x)');
    expect(left([...'(x)/⌫'])).toBe('(x)');
    expect(left([...'(sin(x))/→'])).toBe('(sin(x))');
  });

  it('names the empty box of a layout', () => {
    expect(() => compileExpr('integral(,x)')).toThrow('Add what to integrate');
    expect(() => compileExpr('integral(x,x,0,)')).toThrow('Add the upper bound');
    expect(() => compileExpr('tone(440,)')).toThrow('Add a volume');
    expect(() => compileExpr('(3,)')).toThrow('Add the y-coordinate');
    expect(() => compileExpr('(,3)')).toThrow('Add the x-coordinate');
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

  it('reads typed calculus notation the way the editor writes it', () => {
    expect(textNotation('d/dx(x^2)')).toBe('deriv(x^2,x)');
    expect(textNotation('d/dx sin(x)')).toBe('deriv(sin(x),x)');
    expect(textNotation('y = d/dx(sin(x)) + 2')).toBe('y = deriv(sin(x),x) + 2');
    expect(textNotation('∫ x^2 dx')).toBe('integral(x^2,x)');
    expect(textNotation('∫_0^1 x^2 dx')).toBe('integral(x^2,x,0,1)');
    expect(textNotation('Σ_(n=1)^(10) n^2')).toBe('sum(n^2,n,1,10)');
    expect(textNotation('∏_(k=1)^(4) k')).toBe('prod(k,k,1,4)');
    expect(textNotation('||x|-1|')).toBe('abs(abs(x)-1)');
    expect(textNotation('x == 2')).toBe('x = 2');
    expect(textNotation('|x')).toBe('|x');
    expect(calc(textNotation('d/dx(x^3)'), { x: 2 })).toBeCloseTo(12, 6);
  });

  it('gives exact answers for cancelling complex sums, and real bounds for integrals', () => {
    const e = { ...env(), complex: true };
    expect(calc('sum(e^(2pi i k/5), k, 0, 4)', {}, e)).toBe(0);
    expect(() => calc('integral(x, x, 0, i)', {}, e)).toThrow('its bounds have to be real numbers');
  });

  it('compiles real expressions to the same values the evaluator gives', () => {
    const e = env({ s: 0.7 }),
      ast = src => compileExpr(src).ast;
    e.def.set('a', { ast: ast('1.5'), row: {} });
    e.def.set('L', { ast: ast('[1, 2, 3, 4]'), row: {} });
    e.fn.set('f', { ast: ast('x^2 - 2'), param: 'x', row: { k: {} } });
    e.fn.set('g', { ast: ast('f(x) sin(x)'), param: 'x', row: { k: {} } });
    const exprs = [
      'a sin(x) + s',
      'x^3/10 - x',
      '(-8)^(1/3) + x^0.5',
      'tan(x)/5',
      'sqrt(abs(x)) - ln(x) + log(x, 2)',
      'piece(x < 0, -x, x^2/3)',
      '1 < x <= 2',
      'g(x)/4 + f(2)',
      'deriv(x^2 sin(x), x)',
      'x^2 + y^2 - 16',
      'sin(x) + cos(y) - 0.5',
      'r - theta/4',
      'mod(x, 3) + fact(3) + nthroot(-8, 3)',
      '1/x + sec(x) + arccot(x)',
    ];
    for (const src of exprs) {
      const node = ast(src),
        f = compileReal(node, e, ['x', 'y']);
      expect(f, src).toBeTypeOf('function');
      for (const x of [-2.5, -1, 0, 0.3, 1, Math.PI / 2, 7])
        for (const y of [-1, 0.5])
          expect(f({ x, y }), `${src} at ${x}, ${y}`).toBe(evaluate(node, { x, y }, e));
    }
    const listed = ast('L x / 40');
    expect(compileReal(listed, e, ['x'])).toBeNull();
    const copy = compileReal(listed, e, ['x'], true);
    for (const b of [0, 3, 5])
      expect(copy({ x: 2, [BRANCH]: b })).toBe(evaluate(listed, { x: 2, [BRANCH]: b }, e));
    for (const src of [
      'sum(n^2, n, 1, x)',
      'x + i',
      '(x, 1)',
      'integral(t, t, 0, x)',
      'mean(L) + x',
      'q + x',
    ])
      expect(compileReal(ast(src), e, ['x']), src).toBeNull();
  });

  it('evaluates coordinates and parameters', () => {
    expect(calc('a*sin(x)', { x: Math.PI / 2 }, env({ a: 3 }))).toBeCloseTo(3, 12);
    expect(() => calc('q+1')).toThrow('Undefined variable: q');
  });

  it('explains misplaced commas and brackets in plain words', () => {
    expect(() => compileExpr('a*cos(t), sin(t)')).toThrow('A comma can only separate');
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
    expect(evaluate(compileExpr('integral(t^2, t)').ast, { t: 3 }, e)).toBeCloseTo(9, 8);
  });

  it('integrates through singularities and jumps, but not across a pole', () => {
    const I = s => calc(`integral(${s})`);
    expect(I('1/sqrt(t), t, 0, 1')).toBeCloseTo(2, 4);
    expect(I('ln(t), t, 0, 1')).toBeCloseTo(-1, 6);
    expect(I('floor(t), t, 0, 3')).toBeCloseTo(3, 9);
    expect(I('sin(50t), t, 0, 3')).toBeCloseTo((1 - Math.cos(150)) / 50, 8);
    expect(I('tan(t), t, 0, 1.5')).toBeCloseTo(-Math.log(Math.cos(1.5)), 6);
    for (const s of ['tan(t), t, 0, 2', 'tan(t^2), t, 0, 2', '1/t, t, -1, 1', '1/t^2, t, -1, 1'])
      expect(I(s)).toBeNaN();
    // Graphed left to right, ∫₀ˣ tan(t²) dt is undefined beyond ±√(π/2) and defined between.
    const e = env(),
      F = compileExpr('integral(tan(t^2), t, 0, x)').ast,
      at = x => evaluate(F, { x }, e);
    expect(at(-3)).toBeNaN();
    expect(at(-1.2)).toBeCloseTo(-at(1.2), 6);
    expect(at(1.2)).toBeGreaterThan(0.6);
    expect(at(1.3)).toBeNaN();
  });

  it('works out derivatives and antiderivatives as formulas', () => {
    const e = env();
    e.fn.set('f', { ast: compileExpr('x^2').ast, param: 'x', row: { k: {} } });
    const fns = new Set(['f']);
    // Each formula is checked against what it should equal at a few points; antiderivatives up to a constant.
    const check = (text, want, indefinite = false) => {
      const res = calculus(compileExpr(text, fns).ast, e);
      expect(res.indefinite).toBe(indefinite);
      const at = x => evaluate(res.ast, { x }, e),
        w = compileExpr(want).ast,
        wt = x => evaluate(w, { x }, e),
        shift = indefinite ? at(1) - wt(1) : 0;
      for (const x of [0.5, 1.3, 2.7]) expect(at(x) - shift).toBeCloseTo(wt(x), 9);
    };
    check('deriv(x^2, x)', '2x');
    check('deriv(f(x), x)', '2x');
    check('deriv(f, x)', '2x');
    check('deriv(sin(x)^2, x)', '2sin(x)cos(x)');
    check('deriv(x^x, x)', 'x^x (ln(x) + 1)');
    check('deriv(ln(x^2 + 1), x)', '2x/(x^2 + 1)');
    check('integral(x^2, x)', 'x^3/3', true);
    check('integral(f(x), x)', 'x^3/3', true);
    check('integral(x e^x, x)', 'x e^x - e^x', true);
    check('integral(xsin(x), x)', 'sin(x) - x cos(x)', true);
    check('integral(x^2 cos(x), x)', 'x^2 sin(x) + 2x cos(x) - 2sin(x)', true);
    check('integral(ln(x), x)', 'x ln(x) - x', true);
    check('integral(2x cos(x^2), x)', 'sin(x^2)', true);
    check('integral(1/(x^2 + 1), x)', 'arctan(x)', true);
    check('integral(sin(x)^2, x)', 'x/2 - sin(2x)/4', true);
    check('integral(2^x, x)', '2^x/ln(2)', true);
    check('integral(sin(x)sin(2x), x)', 'sin(x)/2 - sin(3x)/6', true);
    check('integral(sin(2x)cos(5x), x)', 'cos(3x)/6 - cos(7x)/14', true);
    check('integral(cos(x)^4, x)', '3x/8 + sin(2x)/4 + sin(4x)/32', true);
    check('integral(sin(x)^3, x)', 'cos(x)^3/3 - cos(x)', true);
    check('integral(sin(x)^2 cos(x), x)', 'sin(x)^3/3', true);
    check('integral(e^x sin(x), x)', 'e^x (sin(x) - cos(x))/2', true);
    check('integral(e^(2x) cos(3x), x)', 'e^(2x) (2cos(3x) + 3sin(3x))/13', true);
    check('integral(tan(x)^2, x)', 'tan(x) - x', true);
    check('integral(sec(x) tan(x), x)', '1/cos(x)', true);
    check('integral(1/sqrt(9 - x^2), x)', 'arcsin(x/3)', true);
    check('integral(1/sqrt(4x^2 + 1), x)', 'ln(2x + sqrt(4x^2 + 1))/2', true);
    expect(calculus(compileExpr('x^2').ast, e)).toBe(null);
    check('integral(t^2, t, 0, x)', 'x^3/3');
    check('integral(cos(t), t, x, 2x)', 'sin(2x) - sin(x)');
    expect(calculus(compileExpr('integral(tan(t^2), t, 0, x)').ast, e)).toMatchObject({ ast: null });
    expect(calculus(compileExpr('integral(tan(t^2), t, 1, x)').ast, e)).toBe(null);
    // Derivatives of everything with a rule, checked the same way.
    check('deriv(arcsec(x + 2), x)', '1/((x + 2) sqrt((x + 2)^2 - 1))');
    check('deriv(floor(x) + x, x)', '1');
    check('deriv(erf(x), x)', '2e^(-x^2)/sqrt(pi)');
    check('deriv(Si(x^2), x)', '2sin(x^2)/x');
    check('deriv(hypot(x, 2), x)', 'x/sqrt(x^2 + 4)');
    check('deriv(sum(x^n/n, n, 1, 4), x)', '1 + x + x^2 + x^3');
    check('deriv(integral(sin(x t), t, 0, x), x)', '2sin(x^2) + (cos(x^2) - 1)/x^2');
  });

  it('answers with special functions where no elementary function will do', () => {
    const e = env();
    const check = (text, want) => {
      const res = calculus(compileExpr(text).ast, e),
        at = x => evaluate(res.ast, { x }, e),
        wt = x => evaluate(compileExpr(want).ast, { x }, e),
        shift = at(2) - wt(2);
      for (const x of [1.3, 2.7, 3.4]) expect(at(x) - shift).toBeCloseTo(wt(x), 9);
    };
    check('integral(e^(-x^2), x)', 'sqrt(pi) erf(x)/2');
    check('integral(e^(x^2), x)', 'sqrt(pi) erfi(x)/2');
    check('integral(e^(-x^2/2), x)', 'sqrt(pi/2) erf(x/sqrt(2))');
    check('integral(sin(x)/x, x)', 'Si(x)');
    check('integral(cos(3x)/x, x)', 'Ci(3x)');
    check('integral(e^x/x, x)', 'Ei(x)');
    check('integral(1/ln(x), x)', 'li(x)');
    check('integral(sin(x^2), x)', 'sqrt(pi/2) fresnelS(x sqrt(2/pi))');
    check('integral(sin(x)/x^2, x)', 'Ci(x) - sin(x)/x');
    check('integral(x^2 e^(-x^2), x)', 'sqrt(pi) erf(x)/4 - x e^(-x^2)/2');
    check('integral(e^x ln(x), x)', 'e^x ln(x) - Ei(x)');
    check('integral(ln(ln(x)), x)', 'x ln(ln(x)) - li(x)');
    check('integral(erf(x), x)', 'x erf(x) + e^(-x^2)/sqrt(pi)');
    // Known values of the functions themselves.
    expect(calc('erf(1)')).toBeCloseTo(0.8427007929497149, 13);
    expect(calc('Si(20)')).toBeCloseTo(1.548241701043439, 13);
    expect(calc('Ci(5)')).toBeCloseTo(-0.190029749656644, 13);
    expect(calc('Ei(-1)')).toBeCloseTo(-0.21938393439552, 13);
    expect(calc('li(10)')).toBeCloseTo(6.165599504787298, 12);
    expect(calc('fresnelC(5)')).toBeCloseTo(0.5636311887040122, 13);
  });

  it('solves separable and linear differential equations', () => {
    const e = env();
    e.fn.set('g', { ast: compileExpr('y^2').ast, param: 'y', row: { k: {} } });
    e.fn.set('f', { ast: compileExpr('1/x').ast, param: 'x', row: { k: {} } });
    const fns = new Set(['f', 'g']),
      at = (ast, scope) => evaluate(ast, scope, env({ C: 0.5 }));
    // ∫ 1/g(y) dy = ∫ f(x) dx is −1/y = ln|x| + C: on the curve, y = −1/(ln x + C).
    const sep = integralEquation(
      compileExpr('integral(1/g(y), y)', fns).ast,
      compileExpr('integral(f(x), x)', fns).ast,
      e,
    );
    for (const x of [0.3, 2, 5]) expect(at(sep.ast, { x, y: -1 / (Math.log(x) + 0.5) })).toBeCloseTo(0, 9);
    expect(at(sep.deq, { x: 2, y: 3 })).toBeCloseTo(9 / 2, 12);
    // dy/dx = x·y is linear: y = C e^(x²/2), explicit.
    const lin = solveODE(compileExpr('x y').ast, e);
    expect(lin.explicit).toBe(true);
    for (const x of [0, 1, 2]) expect(at(lin.right, { x })).toBeCloseTo(0.5 * Math.exp((x * x) / 2), 9);
    // dy/dx = x + y: y = C eˣ − x − 1.
    const lin2 = solveODE(compileExpr('x + y').ast, e);
    for (const x of [0, 1, 2]) expect(at(lin2.right, { x })).toBeCloseTo(0.5 * Math.exp(x) - x - 1, 9);
    // dy/dx = y²/x is separable but not linear.
    expect(solveODE(compileExpr('y^2/x').ast, e)).toMatchObject({ explicit: false, how: 'separable' });
    expect(solveODE(compileExpr('sin(x y)').ast, e)).toBe(null);
  });

  it('shows the working for derivatives', () => {
    const e = env(),
      steps = s => derivativeSteps(compileExpr(`deriv(${s}, x)`).ast, e).methods[0].tree;
    const cases = {
      'x^2': 'Power rule',
      '3x^4 - 2x + 7': 'Sum rule',
      'x^2 sin(x)': 'Product rule',
      'sin(x)/x': 'Quotient rule',
      'sin(x^2)': 'Chain rule',
      'e^(3x)': 'Chain rule',
      '1/(1 + x^2)': 'Reciprocal rule',
      'x^x': 'Logarithmic differentiation',
      'ln(abs(x))': 'Standard derivative',
    };
    for (const [s, rule] of Object.entries(cases)) {
      const t = steps(s);
      expect(t.rule, s).toBe(rule);
      // Every filled-in line is the derivative it simplifies to.
      (function check(n) {
        for (const a of n.after || [])
          for (const x of [0.4, 1.3])
            expect(evaluate(a, { x }, e), s).toBeCloseTo(evaluate(n.to, { x }, e), 9);
        n.kids.forEach(check);
      })(t);
    }
    expect(steps('x^2 sin(x)').kids.map(k => k.rule)).toEqual(['Power rule', 'Standard derivative']);
    expect(derivativeSteps(compileExpr('deriv(deriv(x^3, x), x)').ast, e).methods[0].tree.kids.length).toBe(
      2,
    );
  });

  it('shows the working for differential equations', () => {
    const e = env();
    e.fn.set('g', { ast: compileExpr('x^2').ast, param: 'x', row: { k: {} } });
    e.fn.set('f', { ast: compileExpr('1/x').ast, param: 'x', row: { k: {} } });
    const fns = new Set(['f', 'g']),
      at = (ast, scope) => evaluate(ast, scope, env({ C: 0.5 }));
    // ∫ g(x) dy = ∫ f(x) dx is x²y = ln|x| + C, whose equation comes from differentiating both sides.
    const both = integralEquation(
      compileExpr('integral(g(x), y)', fns).ast,
      compileExpr('integral(f(x), x)', fns).ast,
      e,
    );
    expect(at(both.deq, { x: 2, y: 3 })).toBeCloseTo((1 / 2 - 12) / 4, 12);
    const rules = s => s.steps.map(x => x.rule);
    const shown = odeSteps(both, e);
    expect(rules(shown)).toEqual(['Integrate each side', 'The differential equation']);
    expect(shown.steps[0].kids.length).toBe(2);
    const e2 = env();
    expect(rules(odeSteps(solveODE(compileExpr('x y').ast, e2), e2))).toEqual([
      'Standard form',
      'Integrating factor',
      'Multiply by the integrating factor',
      'Integrate both sides',
      'Undo the factor',
    ]);
    const sep = odeSteps(solveODE(compileExpr('y^2/x').ast, e2), e2);
    expect(rules(sep)).toEqual(['Separate the variables', 'Integrate each side']);
    expect(sep.steps[1].kids.length).toBe(2);
    expect(rules(odeSteps(solveODE(compileExpr('cos(x)').ast, e2), e2))).toEqual(['Integrate both sides']);
  });

  it('writes a series when there is no formula', () => {
    const terms = s => s.antiderivative.map(t => [t.c.join('/'), t.k]);
    expect(terms(integralSeries(compileExpr('tan(x^2)').ast, 'x'))).toEqual([
      ['1/3', 3],
      ['1/21', 7],
      ['2/165', 11],
      ['17/4725', 15],
    ]);
    expect(terms(integralSeries(compileExpr('sin(x)/x').ast, 'x'))).toEqual([
      ['1/1', 1],
      ['-1/18', 3],
      ['1/600', 5],
      ['-1/35280', 7],
    ]);
    expect(integralSeries(compileExpr('ln(x)').ast, 'x')).toBe(null);
    expect(integralSeries(compileExpr('e^x/x').ast, 'x')).toBe(null);
    const res = calculus(compileExpr('integral(tan(x^2), x)').ast, env());
    expect(res).toMatchObject({ ast: null, center: 0, indefinite: true });
    expect(evaluate(res.series, { x: 1 }, env())).toBeCloseTo(1 / 3 + 1 / 21 + 2 / 165 + 17 / 4725, 12);
  });

  it('never leaves an integral without an answer', () => {
    const e = env();
    // ln is undefined at 0, so arctan(ln x) is expanded about 1, in exact fractions.
    const exact = calculus(compileExpr('integral(arctan(ln(x)), x)').ast, e);
    expect(exact.center).toBe(1);
    expect(evaluate(exact.series, { x: 1.1 }, e)).toBeCloseTo(0.01 / 2 - 0.001 / 6, 6);
    // log is base 10, which brings in 1/ln 10: decimals about 1, and the graph starts there too.
    const dec = calculus(compileExpr('integral(arctan(log(x)), x)').ast, e);
    expect(dec.center).toBe(1);
    expect(evaluate(dec.series, { x: 1.2 }, e)).toBeCloseTo(calc('integral(arctan(log(t)), t, 1, 1.2)'), 4);
    // Its graph stays the steadier area from 0, where arctan(log x) is still finite.
    expect(dec).toMatchObject({ from: 0, graph: null });
    // 1/√x·cos x is not finite at 0 either way, so its graph starts at the series' point.
    expect(calculus(compileExpr('integral(cos(x)/sqrt(x) + x^x, x)').ast, e).from).not.toBe(0);
    // xˣ = e^(x ln x) about 1: its coefficients come out as the fractions they are.
    const xx = antiderivativeSeries(compileExpr('x^x').ast, 'x', catalogMath);
    expect(xx.antiderivative.map(t => +t.c.toFixed(9))).toEqual([1, 0.5, 0.333333333]);
    // With no series anywhere nearby, the answer is the area function itself.
    const step = calculus(compileExpr('integral(floor(x) sin(x), x)').ast, e);
    expect(step.area).toBeTruthy();
    expect(step.series).toBe(null);
  });

  it('shows the steps of an integral, by more than one method when there is one', () => {
    const steps = s => integralSteps(compileExpr(s).ast, env());
    const names = s => steps(s).methods.map(m => m.name);
    expect(names('integral(sin(x)sin(2x), x)')).toEqual(['Double-angle identity', 'Product-to-sum']);
    expect(names('integral((x+1)^2, x)')).toEqual(['Multiplying out', 'Substitution']);
    expect(names('integral(x e^x, x)')).toEqual(['Integration by parts']);
    const sc = steps('integral(sin(x)cos(x), x)').methods;
    expect(sc).toHaveLength(2);
    expect(Math.abs(sc[1].offset)).toBeCloseTo(0.5, 12);
    const parts = steps('integral(x e^x, x)').methods[0].tree;
    expect(parts.rule).toBe('Integration by parts');
    expect(parts.kids.map(k => k.rule)).toEqual(['Exponential rule', 'Exponential rule']);
    const area = steps('integral(t^2, t, 0, x)');
    expect(area.definite).toBe(true);
    expect(area.methods[0].tree.rule).toBe('Evaluate between the bounds');
    expect(area.methods[0].tree.kids[0].rule).toBe('Power rule');
    // Numeric bounds (calc-row definite integrals) still get antiderivative working.
    const boxed = steps('integral(x^2, x, -2, 3)');
    expect(boxed.definite).toBe(true);
    expect(boxed.methods.length).toBeGreaterThan(0);
    expect(boxed.methods[0].tree.rule).toBe('Evaluate between the bounds');
    const tan = steps('integral(tan(x), x)').methods[0].tree;
    expect(tan.rule).toBe('Write as sine over cosine');
    expect(tan.kids[0].rule).toBe('Substitution');
    expect(steps('integral(sec(x), x)').methods[0].tree.rule).toBe('Multiply by a form of 1');
    expect(steps('integral(ln(x), x)').methods[0].tree.rule).toBe('Integration by parts');
    expect(steps('integral(sin(x)cos(X), x)').note).toBeTruthy();
    expect(steps('integral(sin(x)cos(x), x)').note).toBeFalsy();
    const none = steps('integral(tan(x^2), x)');
    expect(none.methods).toEqual([]);
    expect(none.series.antiderivative).toBeTruthy();
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

describe('lists', () => {
  const withL = (src, text = '[1, 2, 3, 4]') => {
    const e = env();
    e.def.set('L', { ast: compileExpr(text).ast });
    return calc(src, {}, e);
  };

  it('writes lists and ranges', () => {
    expect(calc('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(calc('[]')).toEqual([]);
    expect(calc('[1...5]')).toEqual([1, 2, 3, 4, 5]);
    expect(calc('[0, 0.5 ... 2]')).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(calc('[5...1]')).toEqual([5, 4, 3, 2, 1]);
    expect(calc('[1, 3, ..., 9]')).toEqual([1, 3, 5, 7, 9]);
    expect(() => calc('[1...1e6]')).toThrow('at most 10,000');
    expect(() => calc('[[1, 2], 3]')).toThrow("can't contain lists");
  });

  it('applies arithmetic and functions to every element', () => {
    expect(calc('2[1, 2, 3]')).toEqual([2, 4, 6]);
    expect(calc('[1, 2, 3] + [10, 20]')).toEqual([11, 22]);
    expect(withL('L^2')).toEqual([1, 4, 9, 16]);
    expect(withL('sqrt(L)')[3]).toBe(2);
    expect(withL('L > 2')).toEqual([false, false, true, true]);
  });

  it('indexes from 1 and takes slices', () => {
    expect(withL('L[1]')).toBe(1);
    expect(withL('L[4]')).toBe(4);
    expect(withL('L[5]')).toBeNaN();
    expect(withL('L[2...3]')).toEqual([2, 3]);
    expect(withL('L[[1, 4]]')).toEqual([1, 4]);
    expect(calc('[10, 20, 30][2]')).toBe(20);
  });

  it('summarises lists', () => {
    expect(withL('length(L)')).toBe(4);
    expect(withL('total(L)')).toBe(10);
    expect(withL('mean(L)')).toBe(2.5);
    expect(withL('median(L)')).toBe(2.5);
    expect(withL('max(L)')).toBe(4);
    expect(withL('min(L, 0)')).toBe(0);
    expect(withL('stdev(L)')).toBeCloseTo(Math.sqrt(5 / 3), 12);
    expect(withL('sort([3, 1, 2])')).toEqual([1, 2, 3]);
    expect(withL('join(L, [9])')).toEqual([1, 2, 3, 4, 9]);
    expect(calc('max(2, 7)')).toBe(7);
    expect(() => compileExpr('mean')).not.toThrow();
    expect([...compileExpr('mean(L)').deps]).toEqual(['mean', 'L']);
  });

  it('computes spread, mode, quantiles and correlation', () => {
    const on = src => withL(src, '[2, 4, 4, 4, 5, 5, 7, 9]');
    expect(on('mode(L)')).toBe(4);
    expect(on('varp(L)')).toBe(4);
    expect(on('stdevp(L)')).toBe(2);
    expect(on('variance(L)')).toBeCloseTo(32 / 7, 12);
    expect(on('stddev(L)')).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(on('mad(L)')).toBe(1.5);
    expect(on('quartile(L, 1)')).toBe(4);
    expect(on('quartile(L, 3)')).toBe(6);
    expect(calc('quartile([1, 2, 3, 4, 5], [1, 3])')).toEqual([1.5, 4.5]);
    expect(on('quantile(L, 0.5)')).toBe(4.5);
    expect(on('count(L)')).toBe(8);
    expect(calc('mode([3, 1, 3, 1])')).toBe(1);
    expect(calc('unique([3, 1, 3])')).toEqual([3, 1]);
    expect(calc('cov([1, 2, 3], [2, 4, 6])')).toBe(2);
    expect(calc('corr([1, 2, 3], [6, 4, 2])')).toBeCloseTo(-1, 12);
    expect([...compileExpr('mode(L)').deps]).toEqual(['mode', 'L']);
  });

  it('has Desmos names, spelled-out names, a five-number summary and rank correlation', () => {
    const on = src => withL(src, '[2, 4, 4, 4, 5, 5, 7, 9]');
    expect(on('var(L)')).toBeCloseTo(32 / 7, 12);
    expect(on('standarddeviation(L)')).toBe(on('stdev(L)'));
    expect(on('populationstandarddeviation(L)')).toBe(2);
    expect(on('populationvariance(L)')).toBe(4);
    expect(on('average(L)')).toBe(5);
    expect(on('minimum(L) + maximum(L)')).toBe(11);
    expect(on('meanabsolutedeviation(L)')).toBe(1.5);
    expect(on('stats(L)')).toEqual([2, 4, 4.5, 6, 9]);
    expect(calc('correlation([1, 2, 3], [2, 4, 6])')).toBeCloseTo(1, 12);
    expect(calc('covariance([1, 2, 3], [2, 4, 6])')).toBe(2);
    expect(calc('spearman([1, 2, 3, 4], [1, 4, 9, 16])')).toBeCloseTo(1, 12);
    expect(calc('spearman([1, 2, 3], [3, 3, 1])')).toBeCloseTo(-Math.sqrt(3) / 2, 12);
  });

  it('picks one element per drawn copy, but summaries still see the whole list', () => {
    const e = env();
    e.def.set('L', { ast: compileExpr('[1, 2, 3]').ast });
    const at = (src, branch, scope = {}) => evaluate(compileExpr(src).ast, { ...scope, [BRANCH]: branch }, e);
    expect(at('L*x', 1, { x: 10 })).toBe(20);
    expect(at('L - mean(L)', 2)).toBe(1);
    expect(at('L[1] + L', 0)).toBe(2);
    expect(at('[5, 6, 7]', 2)).toBe(7);
    expect(listLength(compileExpr('L*x').ast, e)).toBe(3);
    expect(listLength(compileExpr('x + total(L)').ast, e)).toBeNull();
    expect(listLength(compileExpr('[1...5] + L').ast, e)).toBe(3);
    expect(listLength(compileExpr('sin(x)').ast, e)).toBeNull();
    expect(listLength(compileExpr('L[1] + L').ast, e)).toBe(3);
    expect(listLength(compileExpr('L[2...3] x').ast, e)).toBe(2);
    expect(listLength(compileExpr('L[floor(x)]').ast, e)).toBeNull();
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
    expect(fmt(NaN)).toBe('—');
    expect(nice(37)).toBe(50);
  });
  it('snaps tiny values, groups thousands, and uses math scientific notation', () => {
    expect(fmt(-3.55e-15)).toBe('0');
    expect(fmt(1e-12)).toBe('0');
    expect(fmt(155360.4117)).toBe('155,360.41');
    expect(fmt(123456)).toBe('123,456');
    expect(fmt(0.1 + 0.2)).toBe('0.3');
    expect(fmt(1e10)).toMatch(/^1×10¹⁰$/);
    expect(fmt(3e-5)).toMatch(/^3×10⁻⁵$/);
    expect(fmt(0.00003)).toMatch(/×10/);
    expect(fmt(0.0001)).toBe('0.0001');
  });
});

describe('math italic correction and delimiter ghosts', () => {
  it('ghosts only an untyped closing parenthesis, not a completed wrap-from-)', () => {
    expect(parenCloserGhost({ gr: true })).toBe(true);
    expect(parenCloserGhost({ gl: true })).toBe(false);
    expect(parenCloserGhost({ gl: true, gr: false })).toBe(false);
    expect(parenCloserGhost({ gr: false })).toBe(false);
    // Typing f) builds a complete pair whose opener may be flagged gl for backspace, but is not ghosted.
    const st = mqNew('');
    for (const k of [...'f)']) {
      mqType(st, k);
      mqPrune(st);
    }
    const p = st.root.items[0];
    expect(p.t).toBe('paren');
    expect(parenCloserGhost(p)).toBe(false);
  });
  it('keeps italic correction and the shared math stack in CSS', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..'),
      editor = readFileSync(join(root, 'src/styles/05-editor.css'), 'utf8'),
      math = readFileSync(join(root, 'src/styles/04-math.css'), 'utf8'),
      base = readFileSync(join(root, 'src/styles/01-base.css'), 'utf8');
    expect(base).toMatch(/--math:\s*'Cambria Math'/);
    expect(editor).toMatch(/\.mq \.v\s*\{[^}]*padding-inline-end:\s*0\.12em/s);
    expect(math).toMatch(/padding-inline-end:\s*0\.12em/);
    expect(base).toMatch(/\.sl-lim input\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
    expect(base).toMatch(/\.sl-lim-name\s*\{[^}]*var\(--math\)/s);
  });
});

describe('formatting extras', () => {
  it('finds every real root of a scalar equation', () => {
    const quad = findRoots(a => a * a + 5 * a + 6);
    expect(quad).toHaveLength(2);
    expect(quad[0]).toBeCloseTo(-3, 6);
    expect(quad[1]).toBeCloseTo(-2, 6);
    const touch = findRoots(a => (a - 2) * (a - 2));
    expect(touch.some(x => Math.abs(x - 2) < 1e-4)).toBe(true);
  });
  it('reads answers as fractions only when they plainly are one', () => {
    const dd = src => ddValue(compileExpr(src), () => NaN);
    expect(toFraction(dd('5/6'))).toEqual([5, 6]);
    expect(toFraction(4.214)).toEqual([2107, 500]);
    expect(toFraction(-0.75)).toEqual([-3, 4]);
    expect(toFraction(dd('1/3+1/7'))).toEqual([10, 21]);
    expect(toFraction(0.123456)).toEqual([1929, 15625]);
    expect(toFraction(3)).toBe(null);
    expect(toFraction(Math.PI)).toBe(null);
    expect(toFraction(Math.SQRT2)).toBe(null);
    expect(toFraction(1e-7)).toBe(null);
    expect(toFraction(NaN)).toBe(null);
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

  it('marks no maximum at an asymptote, but keeps sharp peaks', () => {
    const kinds = f => findKeyPoints([{ id: 1, c: '#f00', f }], -20, 20).map(p => p.t);
    expect(kinds(x => -Math.log(Math.abs(Math.cos(x))))).not.toContain('maximum');
    expect(kinds(x => -Math.abs(x - 1))).toContain('maximum');
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

  it('measures a curve for drawing by its on-screen length only', () => {
    // From far below the screen, across it, to far above. The screen counts with a 24 px margin.
    const g = { L: [[50, 100000, 50, 50, 50, 150, 50, -100000]] };
    measurePaths(g, { W: 100, H: 200 });
    expect(g.lengths[0][1]).toBeCloseTo(224 - 50, 6);
    expect(g.distance).toBeCloseTo(174 + 100 + 174, 6);
  });

  it('measures a curve with nothing on screen in full', () => {
    const g = { L: [[0, -500, 0, -400]] };
    measurePaths(g, { W: 100, H: 100 });
    expect(g.distance).toBe(100);
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

  it('draws self-similar curves as one polyline with pinned ends', () => {
    expect(parseFractal('fractal(dragon, n)', '', s => s)).toMatchObject({ type: 'lsys', args: ['n'] });
    for (const n of [0, 1, 5, 12]) {
      const p = curvePoints('dragon', n);
      expect(p.length).toBe(2 * (2 ** n + 1));
      expect([...p.slice(0, 2), ...p.slice(-2)].map(v => +v.toFixed(9))).toEqual([-1.5, -0.4, 1.5, -0.4]);
    }
    // Every dragon segment has the same length and turns a right angle.
    const d = curvePoints('dragon', 8),
      len = Math.hypot(d[2] - d[0], d[3] - d[1]);
    for (let i = 2; i + 3 < d.length; i += 2)
      expect(Math.hypot(d[i + 2] - d[i], d[i + 3] - d[i + 1])).toBeCloseTo(len, 9);
    const k = curvePoints('koch', 3);
    expect(k.length).toBe(2 * (3 * 4 ** 3 + 1));
    expect(Math.hypot(k[0] - k.at(-2), k[1] - k.at(-1))).toBeLessThan(1e-9);
    const [x0, x1, y0, y1] = curveBounds(k);
    expect(Math.max(x1 - x0, y1 - y0)).toBeCloseTo(4, 9);
    expect(curvePoints('hilbert', 3).length).toBe(2 * 4 ** 3);
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

  it('keeps pi and defined names whole when splitting', () => {
    expect([...compileExpr('pix').deps].sort()).toEqual(['pi', 'x']);
    expect(evaluate(compileExpr('2pix').ast, { x: 1 }, env())).toBeCloseTo(2 * Math.PI, 12);
    expect([...compileExpr('kmx', new Set(), new Set(['km'])).deps].sort()).toEqual(['km', 'x']);
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

import { FN_HELP } from '../src/ui/keyHelp.js';

describe('functions from the Desmos keypad', () => {
  it('reads n! as a factorial that binds tighter than powers', () => {
    expect(calc('5!')).toBe(120);
    expect(calc('2^3!')).toBe(64);
    expect(calc('-3!')).toBe(-6);
    expect(calc('3!x', { x: 2 })).toBe(12);
    expect(calc('(1+2)!')).toBe(6);
    expect(calc('!0')).toBe(true);
  });
  it('extends the factorial smoothly between whole numbers', () => {
    expect(calc('0.5!')).toBeCloseTo(Math.sqrt(Math.PI) / 2, 10);
    expect(calc('(-1)!')).toBeNaN();
  });
  it('takes a base for log and real odd roots of negatives', () => {
    expect(calc('log(100)')).toBeCloseTo(2, 12);
    expect(calc('log(8, 2)')).toBeCloseTo(3, 12);
    expect(calc('nthroot(-8, 3)')).toBeCloseTo(-2, 12);
    expect(calc('nthroot(-8, 2)')).toBeNaN();
  });
  it('has gcd, lcm and repeat over numbers and lists', () => {
    expect(calc('gcd(12, 18, 27)')).toBe(3);
    expect(calc('lcm([4, 6, 10])')).toBe(60);
    expect(calc('repeat([1, 2], 2)')).toEqual([1, 2, 1, 2]);
  });
  it('covers the inverse reciprocal trig and hyperbolic functions', () => {
    expect(calc('arccot(-1)')).toBeCloseTo((3 * Math.PI) / 4, 12);
    expect(calc('arcsec(0.5)')).toBeNaN();
    expect(calc('sech(0)')).toBe(1);
  });
});

describe('probability distributions', () => {
  it('match reference values for pdf and cdf', () => {
    expect(calc('normaldist().pdf(0)')).toBeCloseTo(0.3989422804, 9);
    expect(calc('normaldist(0, 1).cdf(1.96)')).toBeCloseTo(0.9750021049, 9);
    expect(calc('normaldist(0, 1).cdf(-8)')).toBeCloseTo(6.22096057e-16, 22);
    expect(calc('normaldist(100, 15).cdf(85, 115)')).toBeCloseTo(0.6826894921, 9);
    expect(calc('tdist(5).cdf(2.015048373)')).toBeCloseTo(0.95, 8);
    expect(calc('tdist(1).pdf(0)')).toBeCloseTo(1 / Math.PI, 12);
    expect(calc('binomialdist(10, 0.5).pdf(5)')).toBeCloseTo(0.24609375, 12);
    expect(calc('binomialdist(10, 0.5).cdf(5)')).toBeCloseTo(0.623046875, 12);
    expect(calc('binomialdist(10, 0.3).cdf(2, 4)')).toBeCloseTo(0.7004232, 6);
    expect(calc('poissondist(3).pdf(2)')).toBeCloseTo(0.2240418077, 9);
    expect(calc('poissondist(3).cdf(2)')).toBeCloseTo(0.4231900811, 9);
    expect(calc('poissondist(3).pdf(2.5)')).toBe(0);
    expect(calc('uniformdist(0, 4).cdf(1)')).toBe(0.25);
  });
  it('summarise with mean, stdev, median and quantile', () => {
    expect(calc('mean(binomialdist(10, 0.3))')).toBeCloseTo(3, 12);
    expect(calc('stdev(normaldist(2, 3))')).toBe(3);
    expect(calc('median(uniformdist(2, 6))')).toBe(4);
    expect(calc('quantile(normaldist(), 0.975)')).toBeCloseTo(1.959963985, 9);
    expect(calc('quantile(tdist(5), 0.95)')).toBeCloseTo(2.015048373, 8);
    expect(calc('quantile(poissondist(3), 0.5)')).toBe(3);
    expect(calc('quantile(binomialdist(10, 0.5), [0, 1])')).toEqual([0, 10]);
  });
  it('draw seeded random samples that hold still', () => {
    const a = calc('normaldist(5, 2).random(2000)');
    expect(a).toHaveLength(2000);
    expect(calc('normaldist(5, 2).random(2000)')).toEqual(a);
    expect(a.reduce((s, v) => s + v, 0) / a.length).toBeCloseTo(5, 0);
    expect(calc('normaldist(5, 2).random(5, 7)')).not.toEqual(a.slice(0, 5));
    expect(calc('binomialdist(4, 0.5).random(50)').every(v => Number.isInteger(v) && v >= 0 && v <= 4)).toBe(
      true,
    );
  });
  it('work element by element and reject nonsense', () => {
    expect(calc('normaldist().cdf([-1, 0, 1])')[1]).toBeCloseTo(0.5, 12);
    expect(calc('normaldist([0, 10], 1).pdf([0, 10])')).toHaveLength(2);
    expect(calc('normaldist(0, -1).cdf(0)')).toBeNaN();
    expect(() => calc('normaldist().mean(1)')).toThrow(/\.pdf, \.cdf and \.random/);
    expect(() => calc('(2).pdf(1)')).toThrow(/belongs to a distribution/);
    expect(undefinedReason(compileExpr('normaldist(0, -1).cdf(0)').ast, {}, env())).toMatch(
      /positive standard/,
    );
  });
});

describe('points, matrices and the rest of the Desmos language', () => {
  it('treats (x, y) as a point with .x, .y and arithmetic', () => {
    expect(calc('(1, 2).x + (1, 2).y')).toBe(3);
    expect(String(calc('(1, 2) + 2(3, 4)'))).toBe('(7, 10)');
    expect(calc('distance((0, 0), (3, 4))')).toBe(5);
    expect(String(calc('midpoint((0, 0), (2, 6))'))).toBe('(1, 3)');
    expect(calc('distance([(0, 0), (1, 1)], (0, 0))')[1]).toBeCloseTo(Math.SQRT2, 12);
    expect(String(calc('-(1, 2)'))).toBe('(-1, -2)');
  });
  it('builds matrices and does their algebra', () => {
    expect(calc('det([[1, 2], [3, 4]])')).toBeCloseTo(-2, 12);
    expect(String(calc('inv([[2, 0], [0, 4]])'))).toBe('[[0.5, 0], [0, 0.25]]');
    expect(String(calc('[[1, 2], [3, 4]] [[0, 1], [1, 0]]'))).toBe('[[2, 1], [4, 3]]');
    expect(String(calc('[[1, 1], [0, 1]]^3'))).toBe('[[1, 3], [0, 1]]');
    expect(String(calc('transpose([[1, 2, 3]])'))).toBe('[[1], [2], [3]]');
    expect(String(calc('rref([[1, 2, 3], [4, 5, 6]])'))).toBe('[[1, 0, -1], [0, 1, 2]]');
    expect(calc('trace([[1, 2], [3, 4]])')).toBe(5);
    expect(() => calc('inv([[1, 2], [2, 4]])')).toThrow(/determinant is 0/);
    expect(() => calc('[[1, 2], [3]]')).toThrow(/same number/);
  });
  it('reads with, for, and, or', () => {
    expect(calc('a b with a = 2, b = 5')).toBe(10);
    expect(calc('[n^2 for n = [1...4]]')).toEqual([1, 4, 9, 16]);
    expect(calc('[i j for i = [1, 2], j = [10, 20]]')).toEqual([10, 20, 20, 40]);
    expect(calc('1 < 2 and 3 < 2')).toBe(false);
    expect(calc('1 < 2 or 3 < 2')).toBe(true);
    expect([...compileExpr('a x with a = 3').deps]).toEqual(['x']);
    expect([...compileExpr('[k t for k = [1...3]]').deps]).toEqual(['t']);
  });
  it('draws polygons and statistical plots as shapes', () => {
    const tri = calc('polygon((0, 0), (4, 0), (0, 3))');
    expect(tri.info).toMatch(/area 6, perimeter 12/);
    expect(calc('polygon([0, 4, 0], [0, 0, 3])').info).toMatch(/area 6/);
    const h = calc('histogram([1, 1.5, 2, 2.2, 2.9, 5], 1)');
    expect(h.paths).toHaveLength(3);
    expect(Math.max(...h.paths.map(p => p[5]))).toBe(3);
    expect(calc('dotplot([1, 1, 2])').points).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ]);
    const b = calc('boxplot([1, 2, 3, 4, 5, 6, 7, 8, 100])');
    expect(b.info).toMatch(/Q1 2.5, median 5, Q3 7.5/);
    expect(b.points).toEqual([[100, 1]]);
  });
  it('runs t-tests with p-values for every alternative', () => {
    const t = calc('ttest([5.1, 4.9, 5.6, 5.8, 6.0, 5.4], 5)');
    expect(t.score).toBeCloseTo(2.73513, 4);
    expect(t.df).toBe(5);
    expect(t.p).toBeCloseTo(0.04103, 4);
    expect(calc('ttest([5.1, 4.9, 5.6, 5.8, 6.0, 5.4], 5).pright')).toBeCloseTo(0.02051, 4);
    expect(calc('ittscore([1, 2, 3, 4], [2, 4, 6, 8])')).toBeCloseTo(-Math.sqrt(3), 10);
    expect(calc('ittest([1, 2, 3, 4], [2, 4, 6, 8]).df')).toBeCloseTo(4.4118, 3);
  });
  it('makes colours, tones and shuffles', () => {
    expect(calc('rgb(255, 120, 0)').hex).toBe('#ff7800');
    expect(calc('hsv(120, 1, 1)').hex).toBe('#00ff00');
    expect(String(calc('rgb(255, 24, 0)'))).toBe('rgb(255, 24, 0) · hsv(6°, 100%, 100%)');
    expect(calc('hsv(400, 2, 2)').hex).toBe(calc('hsv(360, 1, 1)').hex);
    expect(calc('tone(440, 0.5)').freq).toBe(440);
    const s = calc('shuffle([1...10], 3)');
    expect([...s].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(calc('shuffle([1...10], 3)')).toEqual(s);
  });
  it('infers slider spans from rgb and hsv channels', () => {
    const rgb = colorSliders(compileExpr('rgb(255, g, 0)').ast);
    expect(rgb.get('g')).toEqual([0, 255, 0, 1]);
    const hsv = colorSliders(compileExpr('hsv(h, s, v)').ast);
    expect(hsv.get('h')).toEqual([0, 360, 0, 1]);
    expect(hsv.get('s')).toEqual([0, 1, 1, 0.01]);
    expect(hsv.get('v')).toEqual([0, 1, 1, 0.01]);
    expect(colorSliders(compileExpr('a + b').ast).size).toBe(0);
    expect(new Color(255, 0, 0).hsv()).toEqual([0, 100, 100]);
  });
});

describe('keypad tooltips', () => {
  it('give examples that evaluate to the value they show', () => {
    for (const [name, [, , ex, shown]] of Object.entries(FN_HELP)) {
      if (shown === null) continue;
      const got = calc(ex),
        want = calc(shown);
      expect(Array.isArray(got), name).toBe(Array.isArray(want));
      [want].flat().forEach((w, i) => expect([got].flat()[i], `${name}: ${ex}`).toBeCloseTo(w, 3));
    }
  });
});

import { mqAt, mqCaret } from '../src/editor/structure.js';
import { productName, undefinedReason } from '../src/math/parser.js';

describe('products, one-word names and undefined values', () => {
  it('reads xy = 10 as an equation, and x_y = 10 as a variable', () => {
    expect(definition('xy=10')).toBeNull();
    expect(definition('ax=3')).toBeNull();
    expect(definition('x_y=10')).toEqual({ name: 'x_y', rhs: '10' });
    expect(definition('tax=5')?.name).toBe('tax');
    expect(definition('pi=3')?.name).toBe('pi');
    expect(productName('xy') && productName('yx') && !productName('ab') && !productName('exp')).toBe(true);
    expect([...compileExpr('x_y+1').deps]).toEqual(['x_y']);
  });

  it('keeps a lettered subscript as one name through the editor', () => {
    const st = mqNew('x_y=10');
    expect(mqSer(st.root)).toBe('x_y=10');
    expect(mqSer(mqNew('x_y z').root)).toBe('x_y z');
    expect(mqSer(mqNew('a_1+b').root)).toBe('a1+b');
  });

  it('finds the cursor in the saved text, inside brackets too', () => {
    const st = mqNew('max(1,an)');
    expect(mqCaret(st)).toBe(9);
    mqAt(st, 3);
    expect(mqCaret(st)).toBe(3);
    const f = mqNew('sqrt()');
    mqAt(f, 5);
    expect(f.cur.blk.node?.t).toBe('sqrt');
  });

  it('says why a value is undefined', () => {
    const why = s => undefinedReason(compileExpr(s).ast, {}, env());
    expect(why('sqrt(-1)')).toMatch(/square root of a negative/);
    expect(why('2*sqrt(3-5)+1')).toMatch(/square root of a negative/);
    expect(why('ln(0)')).toMatch(/positive/);
    expect(why('arcsin(2)')).toMatch(/from .1 to 1/);
    expect(why('(-8)^(1/3)')).toMatch(/fractional power/);
    expect(why('sqrt(4)')).toBeNull();
  });
});

import { math as catalogMath, special } from '../src/math/catalog.js';
describe('function names', () => {
  it('finds a function by its long name or another name, and inserts the short one', () => {
    for (const n of Object.keys(NAMES)) expect(n in catalogMath || special.has(n)).toBe(true);
    expect(nameMatch('stdev', 'standard dev')).toEqual({ rank: 1, label: 'standard deviation' });
    expect(nameMatch('stdev', 'std')).toEqual({ rank: 0, label: 'stdev' });
    expect(nameMatch('gcd', 'hcf')).toEqual({ rank: 2, label: 'greatest common divisor' });
    expect(nameMatch('integral', 'int')).toEqual({ rank: 0, label: 'integral' });
    expect(nameMatch('sin', 'cos')).toBe(null);
    expect(SPELLINGS).toContain('standarddeviation');
  });
  it('types a long name without cutting it short at "and" or "for"', () => {
    for (const word of ['standarddeviation', 'highestcommonfactor', 'meanabsolutedeviation']) {
      const st = mqNew('');
      for (const k of word) mqType(st, k);
      expect(mqSer(st.root)).toBe(word);
    }
  });
});

import { Complex } from '../src/math/complex.js';

describe('complex numbers', () => {
  const z = (src, scope) => {
    const v = calc(src, scope);
    return v instanceof Complex ? [v.re, v.im] : [v, 0];
  };
  const close = (got, [re, im]) => {
    expect(got[0]).toBeCloseTo(re, 10);
    expect(got[1]).toBeCloseTo(im, 10);
  };
  it('does arithmetic with i, and gives back plain numbers when the imaginary part vanishes', () => {
    close(z('(3+4i)/(1-2i)'), [-1, 2]);
    close(z('(1+i)^4'), [-4, 0]);
    expect(calc('i^2')).toBe(-1);
    expect(calc('e^(iπ)')).toBe(-1);
    expect(calc('e^(iπ)+1')).toBe(0);
    expect(calc('sum(i^n, n, 0, 3)')).toBe(0);
    close(z('i^i'), [Math.exp(-Math.PI / 2), 0]);
    expect(String(calc('3-2i'))).toBe('3 - 2i');
    expect(String(calc('-i'))).toBe('-i');
  });
  it('has the complex functions, on the principal branch', () => {
    expect(calc('abs(3+4i)')).toBe(5);
    expect(calc('arg(-1)')).toBeCloseTo(Math.PI, 12);
    expect(calc('re(3+2i)')).toBe(3);
    expect(calc('im(3+2i)')).toBe(2);
    close(z('conj(3+2i)'), [3, -2]);
    close(z('sqrt(i)'), [Math.SQRT1_2, Math.SQRT1_2]);
    close(z('sin(i)'), [0, Math.sinh(1)]);
    close(z('ln(i)'), [0, Math.PI / 2]);
    close(z('total([1, i, 2i])'), [1, 3]);
    expect(calc('[e^(2πik/4) for k = [0...3]]').map(String)).toEqual(['1', 'i', '-1', '-i']);
    expect(() => calc('i < 2')).toThrow(/no order/);
    expect(calc('i == i')).toBe(true);
    expect(() => calc('floor(i)')).toThrow(/complex/);
  });
  it('reads bi as b·i and 2πik as 2·π·i·k, but keeps long names whole', () => {
    expect(compileExpr('a+bi').deps).toEqual(new Set(['a', 'b', 'i']));
    expect(compileExpr('e^(2πik/6)').deps).toEqual(new Set(['e', 'pi', 'i', 'k']));
    expect(compileExpr('e^(iθ)').deps).toEqual(new Set(['e', 'i', 'theta']));
    expect(compileExpr('2πr').deps).toEqual(new Set(['pi', 'r']));
    expect(compileExpr('θ₁').deps).toEqual(new Set(['theta1']));
    expect(compileExpr('hello').deps).toEqual(new Set(['hello']));
    expect(compileExpr('bi', new Set(), new Set(['bi'])).deps).toEqual(new Set(['bi']));
  });
  it('leaves the reals for a value like √(−4), but not on a graph', () => {
    expect(calc('sqrt(-4)')).toBeNaN();
    const e = env();
    e.complex = true;
    const v = calc('sqrt(-4)', {}, e);
    expect([v.re, v.im]).toEqual([0, 2]);
    expect(calc('ln(-1)', {}, e).im).toBeCloseTo(Math.PI, 12);
  });
});

describe('ranges that continue a pattern', () => {
  it('takes the step from the first terms, as Desmos does', () => {
    expect(calc('[1,2,3,...100]')).toHaveLength(100);
    expect(calc('[2,4,6,8,...100]')).toEqual(Array.from({ length: 50 }, (_, j) => 2 * j + 2));
    expect(calc('[10, 7.5, 5 ... 0]')).toEqual([10, 7.5, 5, 2.5, 0]);
    expect(calc('[0.1, 0.2, 0.3 ... 0.5]')).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(calc('length([a, 2a, 3a ... 10a])', { a: 3 })).toBe(10);
  });
  it('says what comes next when the terms do not go up evenly', () => {
    expect(() => calc('[1, 2, 4 ... 100]')).toThrow('equal steps of 1, so 3 comes next, not 4');
    expect(() => calc('[1, 2, 3, ...]')).toThrow(/Add where the range ends/);
  });
});
