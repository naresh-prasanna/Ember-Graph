export function mxDet(A) {
  A = A.map(r => [...r]);
  let d = 1;
  const n = A.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    if (Math.abs(A[p][i]) < 1e-12) return 0;
    if (p !== i) {
      [A[i], A[p]] = [A[p], A[i]];
      d = -d;
    }
    d *= A[i][i];
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
    }
  }
  return d;
}
export function mxInv(A) {
  const n = A.length,
    M = A.map((r, i) => [
      ...r,
      ...Array.from(
        {
          length: n,
        },
        (_, j) => +(i === j),
      ),
    ]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i];
    M[i] = M[i].map(x => x / d);
    for (let k = 0; k < n; k++)
      if (k !== i) {
        const f = M[k][i];
        M[k] = M[k].map((x, j) => x - f * M[i][j]);
      }
  }
  return M.map(r => r.slice(n));
}
