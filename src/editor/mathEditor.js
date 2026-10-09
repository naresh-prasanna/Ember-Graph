import { rebuild } from '../app/model.js';
import { S } from '../app/state.js';
import {
  mqBack,
  mqDraw,
  mqFix,
  mqLeft,
  mqNew,
  mqPrune,
  mqRight,
  mqSer,
  mqType,
  parseText,
} from './structure.js';
import {
  acceptCompletion,
  closeCompletions,
  selectCompletion,
  updateCompletions,
} from '../ui/completions.js';
import { add, decorate, del } from '../ui/panel.js';

export function makeEditor(r) {
  const el = document.createElement('div');
  el.className = 'mq';
  el.tabIndex = 0;
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-label', 'Expression');
  let st = null;
  const load = () => {
      st = mqNew(r.inp.value);
    },
    draw = () => mqDraw(st, el),
    reload = () => {
      load();
      draw();
    };
  // Moving the cursor can leave an empty slot behind; tidy it away and save the text if it changed.
  const settle = () => {
    mqPrune(st);
    if (mqSer(st.root) !== r.inp.value) commit();
    else draw();
  };
  const commit = () => {
    const t = mqSer(st.root);
    r.inp.value = t;
    r.inp.setSelectionRange(t.length, t.length);
    r.text = t;
    decorate(r);
    rebuild();
    draw();
    st.cur.blk === st.root && st.cur.i === st.root.items.length ? updateCompletions(r) : closeCompletions();
  };
  el.onfocus = () => {
    if (!st || mqSer(st.root) !== r.inp.value) load();
    draw();
  };
  el.onblur = () => {
    if (st) {
      mqPrune(st, false);
      const t = mqSer(st.root);
      if (t !== r.inp.value) {
        r.inp.value = r.text = t;
        decorate(r);
        rebuild();
      }
    }
    setTimeout(() => {
      if (document.activeElement !== el && S.completion?.r === r) closeCompletions();
    }, 120);
  };
  el.onmousedown = e => {
    e.preventDefault();
    if (document.activeElement !== el) el.focus();
    let t = e.target,
      p = null;
    while (t && t !== el) {
      if (t._p || t._blk) {
        p = t;
        break;
      }
      t = t.parentNode;
    }
    if (p && p._p) {
      const b = p.getBoundingClientRect();
      st.cur = {
        blk: p._p[0],
        i: p._p[1] + (e.clientX > b.left + b.width / 2 ? 1 : 0),
      };
    } else if (p)
      st.cur = {
        blk: p._blk,
        i: p._blk.items.length,
      };
    else
      st.cur = {
        blk: st.root,
        i: st.root.items.length,
      };
    closeCompletions();
    settle();
  };
  el.onkeydown = e => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && /^[dc]$/i.test(e.key)) {
      e.preventDefault();
      const i = S.rows.indexOf(r);
      if (/d/i.test(e.key)) {
        if (S.rows.length > 1) del(i);
      } else add(r.text, i);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (S.completion?.r === r) {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        S.completion.navigated = true;
        selectCompletion(S.completion.index + (k === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (k === 'Tab' || (k === 'Enter' && S.completion.navigated)) {
        e.preventDefault();
        acceptCompletion();
        return;
      }
      if (k === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeCompletions();
        return;
      }
    }
    if (k === 'Enter') {
      e.preventDefault();
      add('', S.rows.indexOf(r));
      return;
    }
    if (k === 'Backspace') {
      e.preventDefault();
      if (!r.inp.value && S.rows.length > 1) {
        del(S.rows.indexOf(r));
        return;
      }
      mqBack(st);
      mqPrune(st);
      commit();
      return;
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
      e.preventDefault();
      k === 'ArrowLeft'
        ? mqLeft(st)
        : k === 'ArrowRight'
          ? mqRight(st)
          : (st.cur =
              k === 'Home'
                ? {
                    blk: st.root,
                    i: 0,
                  }
                : {
                    blk: st.root,
                    i: st.root.items.length,
                  });
      closeCompletions();
      settle();
      return;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      let n = st.cur.blk.node,
        b = st.cur.blk;
      while (n && n.t !== 'frac') {
        b = n.blk;
        n = b.node;
      }
      if (n) {
        const q = n.blocks.indexOf(b),
          t = k === 'ArrowUp' ? 0 : 1;
        if (q !== t) {
          st.cur = {
            blk: n.blocks[t],
            i: n.blocks[t].items.length,
          };
          settle();
        }
      }
      return;
    }
    if (k.length === 1) {
      e.preventDefault();
      mqType(st, k);
      mqPrune(st);
      commit();
    }
  };
  el.onpaste = e => {
    e.preventDefault();
    const items = parseText((e.clipboardData.getData('text') || '').replace(/\s+/g, ''));
    st.cur.blk.items.splice(st.cur.i, 0, ...items);
    mqFix(st.root);
    st.cur.i += items.length;
    commit();
  };
  return {
    el,
    reload,
    focus: () => el.focus(),
  };
}
