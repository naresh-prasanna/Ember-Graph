import { rebuild } from '../app/model.js';
import { S } from '../app/state.js';
import {
  mqAt,
  mqBack,
  mqCaret,
  mqDraw,
  mqFix,
  mqInsert,
  mqLeft,
  mqNew,
  mqPrune,
  mqRight,
  mqSer,
  mqType,
  mqVert,
  parseText,
} from './structure.js';
import {
  acceptCompletion,
  closeCompletions,
  enterAccepts,
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
    draw = () => {
      mqDraw(st, el);
      el.classList.toggle('all', !!st.all);
    },
    // Replaces everything with an empty expression; on a row that is already empty, removes the row.
    wipe = () => {
      if (!r.inp.value) {
        if (S.rows.length > 1) del(S.rows.indexOf(r));
        return;
      }
      st = mqNew('');
      commit();
    },
    reload = pos => {
      load();
      if (pos !== undefined) mqAt(st, pos);
      draw();
    };
  // Moving the cursor can leave an empty slot behind; tidy it away and save the text if it changed.
  const settle = () => {
    mqPrune(st);
    if (mqSer(st.root) !== r.inp.value) commit();
    else draw();
  };
  const commit = () => {
    const t = mqSer(st.root),
      at = mqCaret(st);
    r.inp.value = t;
    r.inp.setSelectionRange(at, at);
    r.text = t;
    decorate(r);
    rebuild();
    draw();
    updateCompletions(r);
  };
  el.onfocus = () => {
    if (!st || mqSer(st.root) !== r.inp.value) load();
    draw();
  };
  el.onblur = () => {
    if (st) {
      st.all = false;
      el.classList.remove('all');
      mqPrune(st, false);
      const t = mqSer(st.root);
      // Leaving a half-finished expression ends the guess at what it meant; it now shows its error.
      if (t !== r.inp.value || r.assumed) {
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
    st.all = false;
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
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const c = e.key.toLowerCase();
      if (c === 'a') {
        e.preventDefault();
        closeCompletions();
        st.all = !!r.inp.value;
        draw();
      } else if (c === 'backspace') {
        e.preventDefault();
        closeCompletions();
        wipe();
      } else if (st.all && (c === 'c' || c === 'x')) {
        e.preventDefault();
        navigator.clipboard?.writeText(r.inp.value).catch(() => {});
        if (c === 'x') wipe();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    // With everything selected, typing replaces it, deleting clears it, and arrows drop the cursor at an end.
    if (st.all) {
      st.all = false;
      if (k === 'Backspace' || k === 'Delete') {
        e.preventDefault();
        wipe();
        return;
      }
      if (k.length === 1) st = mqNew('');
      else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        st.cur = { blk: st.root, i: k === 'ArrowLeft' ? 0 : st.root.items.length };
        draw();
        return;
      } else draw();
    }
    if (S.completion?.r === r) {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        S.completion.navigated = true;
        selectCompletion(S.completion.index + (k === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (k === 'Tab' || (k === 'Enter' && enterAccepts())) {
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
      if (mqVert(st, k === 'ArrowUp')) {
        settle();
        return;
      }
      // Out of the top or bottom of the expression: on to the neighbouring one, keeping the cursor's x.
      const rows = S.rows.slice(0, S.rows.indexOf(r)).reverse(),
        next = (k === 'ArrowUp' ? rows : S.rows.slice(S.rows.indexOf(r) + 1)).find(q => q.ed);
      if (next) next.ed.focusAt(el.querySelector('.cur')?.getBoundingClientRect().left);
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
    const items = parseText(
      (e.clipboardData.getData('text') || '')
        .split(/\b(with|for|and|or)\b/)
        .map((s, i) => (i % 2 ? ' ' + s + ' ' : s.replace(/\s+/g, '')))
        .join(''),
    );
    if (st.all) st = mqNew('');
    st.cur.blk.items.splice(st.cur.i, 0, ...items);
    mqFix(st.root);
    st.cur.i += items.length;
    commit();
  };
  // Focuses with the cursor at the top-level gap nearest to screen position x (the end when x is unknown).
  const focusAt = x => {
    el.focus();
    st.cur = { blk: st.root, i: st.root.items.length };
    if (x !== undefined) {
      let best = Infinity;
      for (const e of el.firstChild?.children || []) {
        if (!e._p || e._p[0] !== st.root) continue;
        const b = e.getBoundingClientRect();
        [
          [b.left, e._p[1]],
          [b.right, e._p[1] + 1],
        ].forEach(([edge, i]) => {
          if (Math.abs(edge - x) < best) [best, st.cur.i] = [Math.abs(edge - x), i];
        });
      }
    }
    draw();
  };
  const insert = (name, drop) => {
    if (!st) load();
    el.focus();
    mqInsert(st, name, drop);
    mqPrune(st);
    commit();
  };
  return {
    el,
    reload,
    insert,
    focus: () => el.focus(),
    focusAt,
  };
}
