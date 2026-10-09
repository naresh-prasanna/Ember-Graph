let worker = null,
  sequence = 0;
const pending = new Map();

function connect() {
  worker = new Worker(new URL('../workers/fractal.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.row);
    if (!job || job.id !== data.id) return;
    pending.delete(data.row);
    job.resolve(new ImageData(new Uint8ClampedArray(data.buffer), data.w, data.h));
  };
  return worker;
}

/* Resolves with the rendered ImageData, or null when a newer render for the same row supersedes it. */
export function renderFractal(row, job) {
  const id = ++sequence;
  pending.get(row)?.resolve(null);
  return new Promise(resolve => {
    pending.set(row, { id, resolve });
    (worker || connect()).postMessage({ ...job, row, id });
  });
}
