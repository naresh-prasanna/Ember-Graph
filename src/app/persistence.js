import { makeRow, rebuild } from './model.js';
import { sceneLabels } from './scenes.js';
import { S } from './state.js';
import { nullObj, reserved } from '../math/catalog.js';
import { isGeoText } from '../io/geogebraEval.js';
import { isTableText } from '../math/table.js';
import { render } from '../ui/panel.js';

let saveTimer;
export function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 200);
}
export function state() {
  return {
    version: 3,
    scene: S.activeScene,
    construction: S.construction,
    r: S.rows.map(r => ({
      text: r.text,
      col: r.col,
      off: r.off,
      ...(r.helper ? { helper: true } : {}),
    })),
    vars: {
      ...S.vars,
    },
    ranges: {
      ...S.ranges,
    },
    v: {
      x: (S.W / 2 - S.V.cx) / S.V.s,
      y: (S.V.cy - S.H / 2) / S.V.s,
      s: S.V.s,
    },
    mode3: S.mode3,
    c: {
      ...S.C,
    },
  };
}
export function save() {
  try {
    localStorage.setItem('ember-v3', JSON.stringify(state()));
  } catch {}
}
export function validateState(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.r) || o.r.length > 100)
    throw Error('Graph code must contain an r array of at most 100 expressions');
  const r = o.r.map(row => {
    const x =
      typeof row === 'string'
        ? {
            text: row,
          }
        : row;
    if (
      !x ||
      typeof x.text !== 'string' ||
      x.text.length > (isTableText(x.text) || isGeoText(x.text) ? 200000 : 2000)
    )
      throw Error('Invalid expression');
    if (x.col !== undefined && !/^#[0-9a-f]{6}$/i.test(x.col)) throw Error('Invalid curve colour');
    if (x.off !== undefined && typeof x.off !== 'boolean') throw Error('Invalid visibility flag');
    return {
      text: x.text,
      col: x.col,
      off: !!x.off,
      helper: x.helper === true && !!x.text.trim(),
    };
  });
  // Imports from before helpers were folded: their hidden GeoGebra objects are helpers too.
  if (!o.r.some(row => row?.helper !== undefined))
    for (const row of r) if (row.off && isGeoText(row.text)) row.helper = true;
  // Construction helpers always sit after the main list, where they are folded away.
  r.sort((a, b) => a.helper - b.helper);
  if (!r.length)
    r.push({
      text: '',
    });
  const v = o.v || {
    x: 0,
    y: 0,
    s: 50,
  };
  if (
    ![v.x, v.y, v.s].every(Number.isFinite) ||
    Math.abs(v.x) > 1e9 ||
    Math.abs(v.y) > 1e9 ||
    v.s < 2 ||
    v.s > 2e5
  )
    throw Error('Invalid view: scale must be between 2 and 200000');
  const c = o.c || {
    y: 0.7,
    p: 0.9,
    s: 38,
  };
  if (![c.y, c.p, c.s].every(Number.isFinite) || c.p < 0.05 || c.p > 1.5 || c.s < 8 || c.s > 300)
    throw Error('Invalid 3D camera');
  const nextVars = nullObj();
  if (o.vars !== undefined) {
    if (!o.vars || typeof o.vars !== 'object' || Array.isArray(o.vars)) throw Error('Invalid parameters');
    for (const [n, value] of Object.entries(o.vars)) {
      if (!/^[a-zA-Z_]\w*$/.test(n) || reserved(n) || !Number.isFinite(value))
        throw Error('Invalid parameter: ' + n);
      nextVars[n] = value;
    }
  }
  if (o.mode3 !== undefined && typeof o.mode3 !== 'boolean') throw Error('Invalid 3D flag');
  const ranges = nullObj();
  if (o.ranges && typeof o.ranges === 'object' && !Array.isArray(o.ranges))
    for (const [n, q] of Object.entries(o.ranges)) {
      const step = q?.step ?? 0;
      if (/^[a-zA-Z_]\w*$/.test(n) && !reserved(n) && [q?.min, q?.max, step].every(Number.isFinite))
        if (q.min < q.max && step >= 0) ranges[n] = { min: q.min, max: q.max, step };
    }
  // Older graphs kept limits in the text as n = 12 {0 <= n <= 12}; move them to the slider.
  for (const row of r) {
    const m = row.text.match(
      /^\s*([A-Za-z_]\w*)\s*=\s*([^{}=]+?)\s*\{\s*(-?[\d.]+)\s*<=\s*\1\s*<=\s*(-?[\d.]+)\s*\}\s*$/,
    );
    if (m && +m[3] < +m[4] && !ranges[m[1]]) {
      ranges[m[1]] = { min: +m[3], max: +m[4], step: 0 };
      row.text = `${m[1]} = ${m[2]}`;
    }
  }
  return {
    r,
    v,
    c,
    ranges,
    vars: nextVars,
    mode3: !!o.mode3,
  };
}
export function loadState(o) {
  const s = validateState(o);
  if (['orbit', 'waves', 'terrain'].includes(o.scene)) S.activeScene = o.scene;
  if (typeof o.construction === 'boolean') S.construction = o.construction;
  S.playing.clear();
  S.sparks = [];
  S.marks = [];
  S.vars = s.vars;
  S.ranges = s.ranges;
  S.rows = s.r.map(r => makeRow(r.text, r));
  S.V = {
    cx: S.W / 2 - s.v.x * s.v.s,
    cy: S.H / 2 + s.v.y * s.v.s,
    s: s.v.s,
  };
  S.C = {
    ...s.c,
  };
  S.mode3 = s.mode3;
  render();
  rebuild({
    reset: true,
  });
  sceneLabels();
}
