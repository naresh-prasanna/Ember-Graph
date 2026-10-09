import { $ } from '../core/dom.js';
import { fmt } from '../math/format.js';
import { mxDet, mxInv } from '../math/matrix.js';

let MX = 3;
function mxBuild() {
  const g = $('#mxg');
  g.innerHTML = '';
  g.style.cssText = `display:grid;grid-template-columns:repeat(${MX},64px);gap:6px;margin:12px 0`;
  for (let i = 0; i < MX * MX; i++) {
    const e = document.createElement('input');
    e.type = 'number';
    e.step = 'any';
    e.value = i % (MX + 1) ? 0 : 1;
    g.append(e);
  }
}
const mxGet = () => {
    const v = [...$('#mxg').children].map(e => +e.value),
      A = [];
    for (let i = 0; i < MX; i++) A.push(v.slice(i * MX, i * MX + MX));
    return A;
  },
  mxStr = A => A.map(r => r.map(x => fmt(x).padStart(9)).join('')).join('\n');

export function initMatrixDialog() {
  $('#mx-open').onclick = () => {
    mxBuild();
    $('#mxo').textContent = '';
    $('#mx').showModal();
  };
  $('#mxn').onchange = e => {
    MX = +e.target.value;
    mxBuild();
  };
  $('#mx-x').onclick = () => $('#mx').close();
  $('#mx-det').onclick = () => ($('#mxo').textContent = 'det = ' + fmt(mxDet(mxGet())));
  $('#mx-t').onclick = () => {
    const A = mxGet();
    $('#mxo').textContent = mxStr(A[0].map((_, j) => A.map(r => r[j])));
  };
  $('#mx-inv').onclick = () => {
    const I = mxInv(mxGet());
    $('#mxo').textContent = I ? mxStr(I) : 'Singular matrix: no inverse';
  };
  $('#mx-sq').onclick = () => {
    const A = mxGet();
    $('#mxo').textContent = mxStr(A.map(r => A[0].map((_, j) => r.reduce((s, v, k) => s + v * A[k][j], 0))));
  };
}
