import { parseRow } from '../app/model.js';
import { loadState, state } from '../app/persistence.js';
import { $ } from '../core/dom.js';
import { frameBounds } from '../app/scenes.js';
import { evalGeo, freeNames, geoName, geoShapes, isGeoText, parseGeo, writeGeo } from '../io/geogebraEval.js';
import { geogebraXML } from '../io/geogebraFile.js';
import { reserved } from '../math/catalog.js';
import { definition, parts } from '../math/parser.js';
import { notice } from './controls.js';

const visible = el => el.querySelector(':scope > show')?.getAttribute('object') !== 'false';
const emberName = n => /^[A-Za-z_]\w*$/.test(n) && !reserved(n);
const num = v => String(+v.toPrecision(10));
const clean = s => s.replace(/−/g, '-');
const truthy = (el, tag) => el.querySelector(`:scope > ${tag}`)?.getAttribute('val') === 'true';
// A value written back as GeoGebra syntax, for objects whose own definition cannot be re-run.
function literal(v) {
  const p = q => `(${num(q[0])}, ${num(q[1])})`;
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `{${v.map(literal).join(', ')}}`;
  if (v.t === 'pt') return p(v.p);
  if (v.t === 'seg') return `Segment[${p(v.a)}, ${p(v.b)}]`;
  if (v.t === 'line') return `Line[${p(v.a)}, ${p(v.b)}]`;
  return `Polygon[${v.p.map(p).join(', ')}]`;
}
const DRAWN = ['function', 'functionNVar', 'conic', 'implicitpoly'];
/* Re-runs the construction in order with the GeoGebra evaluator and brings across what GeoGebra's
   Algebra view lists, in the same order. Objects hidden on GeoGebra's graph arrive switched off.
   Free numbers become sliders and functions become Ember expressions; everything else stays a live
   GeoGebra object that reads the others by name, so changing s or n flows through the construction.
   Polygon sides are drawn by their polygon, and auxiliary objects stay out unless something needs them. */
function convertGeoGebra(xml) {
  if (xml.length > 5 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error('Unsupported XML document');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'geogebra')
    throw Error('Invalid GeoGebra XML');
  const root = doc.querySelector('construction');
  if (!root) throw Error('No construction found');
  const defs = new Map(),
    partOf = new Map();
  for (const n of root.children) {
    const label = n.getAttribute('label');
    if (n.localName === 'expression' && label) defs.set(label, n.getAttribute('exp'));
    else if (n.localName === 'command') {
      const input = n.querySelector(':scope > input'),
        output = n.querySelector(':scope > output'),
        out = output?.getAttribute('a0'),
        args = input
          ? [...input.attributes]
              .filter(a => /^a\d+$/.test(a.name))
              .sort((a, b) => a.name.slice(1) - b.name.slice(1))
              .map(a => a.value)
          : [];
      if (out && !defs.has(out)) defs.set(out, `${n.getAttribute('name')}[${args.join(', ')}]`);
      for (const a of output?.attributes || [])
        if (/^a[1-9]\d*$/.test(a.name) && a.value && out && /^poly(gon|line)$/i.test(n.getAttribute('name')))
          partOf.set(a.value, out);
    }
  }

  const objs = Object.create(null),
    elements = [];
  for (const el of root.querySelectorAll(':scope > element')) {
    const label = el.getAttribute('label') || 'unnamed',
      type = el.getAttribute('type'),
      q = el.querySelector(':scope > coords'),
      c = q ? ['x', 'y', 'z'].map(k => Number(q.getAttribute(k))) : null;
    let v,
      err,
      exp = null;
    // A number written as `s = 0.5` is still a free number, so it becomes a slider.
    const constant =
      (type === 'numeric' || type === 'angle') &&
      defs.has(label) &&
      (() => {
        try {
          return freeNames(parseGeo(clean(defs.get(label)))).size === 0;
        } catch {
          return false;
        }
      })();
    if (defs.has(label) && !DRAWN.includes(type) && !constant)
      try {
        v = evalGeo(parseGeo(clean(defs.get(label))), n => objs[n]);
        exp = clean(defs.get(label));
      } catch (e) {
        err = e.message;
      }
    if (v === undefined && type === 'point' && c?.every(Number.isFinite) && c[2])
      v = { t: 'pt', p: [c[0] / c[2], c[1] / c[2]] };
    else if (v === undefined && (type === 'numeric' || type === 'angle'))
      v = Number(el.querySelector(':scope > value')?.getAttribute('val'));
    if (v !== undefined && (typeof v !== 'number' || Number.isFinite(v))) objs[label] = v;
    else v = undefined;
    const script = [...el.querySelectorAll(':scope > ggbscript, :scope > javascript')].some(s =>
      [...s.attributes].some(a => a.value.trim()),
    );
    elements.push({
      el,
      label,
      type,
      c,
      v,
      err,
      exp,
      script,
      shown: visible(el),
      aux: truthy(el, 'auxiliary'),
    });
  }

  const report = [],
    folded = new Map(),
    ranges = {},
    items = new Map();
  for (const e of elements) {
    const { el, label, type, c, v } = e;
    if (partOf.has(label)) {
      folded.set(partOf.get(label), (folded.get(partOf.get(label)) || 0) + 1);
      continue;
    }
    let item = null;
    if (DRAWN.includes(type) && defs.has(label)) {
      let exp = clean(defs.get(label)).replace(/π/g, 'pi');
      if (type !== 'function') item = { kind: 'expression', text: exp };
      else if (emberName(label)) {
        exp = exp.replace(/^[A-Za-z_]\w*\(x\)\s*=\s*/, '');
        item = { kind: 'expression', text: `${label}(x) = ${exp}`, ember: label };
      }
    } else if (type === 'line' && !e.exp && c?.every(Number.isFinite) && (c[0] || c[1]))
      item = { kind: 'expression', text: `(${num(c[0])})*x+(${num(c[1])})*y+(${num(c[2])})=0` };
    else if (
      (type === 'numeric' || type === 'angle') &&
      !e.exp &&
      typeof v === 'number' &&
      emberName(label)
    ) {
      const slider = el.querySelector(':scope > slider'),
        [lo, hi] = slider ? ['min', 'max'].map(k => Number(slider.getAttribute(k))) : [],
        step = Number(el.querySelector(':scope > animation')?.getAttribute('step'));
      if (lo < hi)
        ranges[label] = {
          min: Math.min(lo, v),
          max: Math.max(hi, v),
          step: step > 0 && step <= hi - lo && Number.isInteger(+((v - lo) / step).toFixed(9)) ? step : 0,
        };
      item = { kind: 'slider', text: `${label} = ${num(v)}`, ember: label };
    } else if (v !== undefined)
      item = { kind: 'geo', exp: e.exp || literal(v), fixed: !e.exp && !!defs.get(label) };
    if (!item) {
      if (e.aux) continue;
      const why =
        (type === 'numeric' || type === 'angle') && v === undefined
          ? 'it is undefined in GeoGebra too'
          : e.err || (type || 'unknown') + ' objects are not supported yet';
      report.push(`${label}: skipped (${why})`);
      continue;
    }
    if (item.kind === 'geo') item.uses = freeNames(parseGeo(item.exp));
    items.set(label, { ...item, e });
  }

  // GeoGebra keeps auxiliary objects out of its list; they come along only when something uses them.
  const wanted = new Set([...items.keys()].filter(l => !items.get(l).e.aux));
  for (let grew = true; grew;) {
    grew = false;
    for (const l of [...wanted])
      for (const n of items.get(l).uses || [])
        if (items.has(n) && !wanted.has(n)) {
          wanted.add(n);
          grew = true;
        }
  }
  let chosen = [...items.keys()].filter(l => wanted.has(l));
  // Over the expression limit, hidden objects that nothing else reads are the first to go.
  if (chosen.length > 100) {
    const read = new Set(chosen.flatMap(l => [...(items.get(l).uses || [])]));
    const spare = chosen.filter(l => !items.get(l).e.shown && !read.has(l));
    const drop = new Set(spare.slice(0, chosen.length - 100));
    if (drop.size)
      report.push(`${drop.size} hidden objects that nothing uses were left out to fit 100 expressions`);
    chosen = chosen.filter(l => !drop.has(l));
  }
  if (chosen.length > 100)
    throw Error(`This construction has ${chosen.length} objects; Ember holds up to 100 expressions`);

  const emberNames = new Set(chosen.filter(l => items.get(l).ember)),
    rows = [];
  for (const label of chosen) {
    const it = items.get(label);
    let text = it.text;
    if (it.kind === 'geo') {
      const env = {};
      for (const n of it.uses) if (!chosen.includes(n) && n in objs) env[n] = objs[n];
      text = writeGeo({ name: label, exp: it.exp, env });
      if (text.length > 190000) {
        report.push(`${label}: skipped (too large to bring across)`);
        continue;
      }
    } else
      try {
        const r = { text, uses: new Set() };
        parseRow(r, new Set([...emberNames].filter(n => items.get(n).kind === 'expression')));
        if (!r.k) throw Error('empty expression');
        for (const n of r.uses)
          if (!reserved(n) && !emberNames.has(n) && n !== r.k.param) throw Error('it needs ' + n);
      } catch (err) {
        report.push(`${label}: skipped (${err.message})`);
        continue;
      }
    rows.push({ text, off: !it.e.shown, label, it });
  }

  const shown = rows.filter(r => !r.off).length,
    kinds = {};
  for (const { it } of rows) {
    const k = it.kind === 'geo' ? describeKind(it.e) : it.kind === 'slider' ? 'slider' : 'expression';
    kinds[k] = (kinds[k] || 0) + 1;
  }
  report.unshift(
    `Brought across ${rows.length} objects: ` +
      Object.entries(kinds)
        .map(([k, n]) => `${n} ${n === 1 ? k : k + 's'}`)
        .join(', ') +
      '.',
    `${shown} shown on the graph; ${rows.length - shown} hidden in GeoGebra, folded under "Construction steps".`,
  );
  for (const [poly, n] of folded) report.push(`${poly}: its ${n} sides are drawn as part of it`);
  const aux = elements.filter(e => e.aux && items.has(e.label) && !wanted.has(e.label)).length;
  if (aux) report.push(`${aux} auxiliary helpers left out (GeoGebra keeps these out of its list too)`);
  for (const e of elements)
    if (e.script) report.push(`${e.label}: has a GeoGebra script, which Ember does not run`);
  for (const { label, it } of rows)
    if (it.fixed) report.push(`${label}: kept as a fixed value (its definition could not be re-run)`);

  const xs = [],
    ys = [];
  for (const { label, off, it } of rows)
    if (!off && it.kind === 'geo') {
      const { paths, points } = geoShapes(objs[label]);
      for (const w of paths) for (let i = 0; i < w.length; i += 2) xs.push(w[i]) && ys.push(w[i + 1]);
      for (const [x, y] of points) xs.push(x) && ys.push(y);
    }
  const box = arr => arr.reduce(([lo, hi], v) => [Math.min(lo, v), Math.max(hi, v)], [Infinity, -Infinity]);
  return {
    r: rows.map(({ text, off }) => ({ text, off, helper: off })),
    ranges,
    bounds: xs.length && box(xs).every(v => Math.abs(v) < 1e6) ? [...box(xs), ...box(ys)] : null,
    report,
    hiddenCount: rows.length - shown,
    unsupported: report.filter(l => l.includes('skipped')).length,
  };
}
function describeKind(e) {
  const v = e.v;
  if (typeof v === 'number') return 'number';
  if (Array.isArray(v)) return 'list';
  return { pt: 'point', seg: 'segment', line: 'line', poly: 'polygon' }[v?.t] || 'object';
}
// An unzipped .ggb is a folder; its construction lives in geogebra.xml.
function pickConstruction(files) {
  files = [...files];
  return (
    files.find(f => /(^|[\\/])geogebra\.xml$/i.test(f.webkitRelativePath || f.name)) ||
    files.find(f => /\.(ggb|zip)$/i.test(f.name)) ||
    files.find(f => /\.xml$/i.test(f.name) && !/defaults/i.test(f.name))
  );
}
// Folders dropped onto the dialog arrive as directory entries rather than files.
async function droppedFiles(dt) {
  const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean),
    out = [];
  const walk = async (entry, depth) => {
    if (entry.isFile) out.push(await new Promise((ok, fail) => entry.file(ok, fail)));
    else if (entry.isDirectory && depth < 3) {
      const list = await new Promise((ok, fail) => entry.createReader().readEntries(ok, fail));
      for (const e of list) await walk(e, depth + 1);
    }
  };
  for (const e of entries) await walk(e, 0);
  return out.length ? out : [...dt.files];
}
const nameOf = text => {
  if (isGeoText(text)) return geoName(text);
  try {
    return definition(parts(text).body)?.name;
  } catch {
    return undefined;
  }
};
function status(text, bad = false) {
  const el = $('#ggb-status');
  el.textContent = text;
  el.classList.toggle('bad', bad);
}
async function importFiles(files) {
  const file = pickConstruction(files);
  $('#ggb-details').hidden = true;
  if (!file) {
    status("That isn't a GeoGebra file. Choose a .ggb file, or the folder it was unzipped into.", true);
    return;
  }
  status('Reading ' + file.name + '…');
  let result;
  try {
    result = convertGeoGebra(await geogebraXML(file));
  } catch (err) {
    status(`Couldn't read ${file.name}: ${err.message}`, true);
    return;
  }
  $('#ggb-report').textContent = result.report.join('\n');
  $('#ggb-details').hidden = !result.report.length;
  if (!result.r.length) {
    status('Nothing in this construction can be drawn here yet.', true);
    return;
  }
  const kept = $('#ggb-append').checked ? state().r.filter(row => row.text.trim()) : [],
    names = new Set(kept.map(row => nameOf(row.text)).filter(Boolean)),
    fresh = result.r.filter(row => !names.has(nameOf(row.text))),
    next = [...kept, ...fresh];
  if (next.length > 100) {
    status(
      `This would make ${next.length} expressions; the limit is 100. Untick "Keep my current expressions".`,
      true,
    );
    return;
  }
  const now = state(),
    ranges = kept.length ? now.ranges : {};
  for (const row of fresh) {
    const n = nameOf(row.text);
    if (n && result.ranges[n]) ranges[n] = result.ranges[n];
  }
  loadState({ ...now, r: next, ranges, mode3: false });
  $('#ggb-dialog').close();
  if (result.bounds) frameBounds(...result.bounds);
  const skipped = result.r.length - fresh.length,
    hidden = fresh.filter(row => row.off).length,
    source = (file.webkitRelativePath.split('/')[0] || file.name).replace(/\.(zip|xml)$/i, '');
  notice(
    `Imported ${fresh.length} object${fresh.length === 1 ? '' : 's'} from ${source}` +
      (hidden ? `; ${hidden} hidden construction steps are folded at the bottom` : '') +
      (result.unsupported ? `; ${result.unsupported} could not be brought across` : '') +
      (skipped ? `; ${skipped} already existed` : ''),
  );
}

export function initGeogebraDialog() {
  const dialog = $('#ggb-dialog'),
    drop = $('#ggb-drop');
  $('#import-ggb').onclick = () => {
    status('');
    $('#ggb-details').hidden = true;
    dialog.showModal();
  };
  $('#ggb-close').onclick = () => dialog.close();
  $('#ggb-pick-file').onclick = () => $('#ggb-file').click();
  $('#ggb-pick-folder').onclick = () => $('#ggb-folder').click();
  for (const input of [$('#ggb-file'), $('#ggb-folder')])
    input.onchange = async () => {
      if (input.files.length) await importFiles(input.files);
      input.value = '';
    };
  dialog.ondragover = e => {
    e.preventDefault();
    drop.classList.add('over');
  };
  dialog.ondragleave = e => {
    if (!dialog.contains(e.relatedTarget)) drop.classList.remove('over');
  };
  dialog.ondrop = async e => {
    e.preventDefault();
    drop.classList.remove('over');
    await importFiles(await droppedFiles(e.dataTransfer));
  };
}
