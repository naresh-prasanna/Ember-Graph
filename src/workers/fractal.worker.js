import { sampleFractalRow, shadeFractalRow } from '../math/fractals.js';

/* One job per fractal row. Work is sliced so a newer job for the same row replaces a stale one mid-render. */
const jobs = new Map();
let running = false;

self.onmessage = ({ data: message }) => {
  const size = message.w * message.h;
  jobs.set(message.row, {
    ...message,
    field: new Float32Array(size),
    pixels: new Uint8ClampedArray(size * 4),
    j: 0,
    phase: 0,
  });
  if (!running) run();
};

function step(job, budget) {
  const start = performance.now();
  while (performance.now() - start < budget) {
    if (job.phase === 0) sampleFractalRow(job, job.field, job.j);
    else shadeFractalRow(job, job.field, job.pixels, job.j);
    if (++job.j < job.h) continue;
    if (job.phase === 1) return true;
    job.phase = 1;
    job.j = 0;
  }
  return false;
}

async function run() {
  running = true;
  while (jobs.size) {
    for (const [row, job] of jobs) {
      if (!step(job, 24)) continue;
      jobs.delete(row);
      self.postMessage({ row, id: job.id, w: job.w, h: job.h, buffer: job.pixels.buffer }, [
        job.pixels.buffer,
      ]);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  running = false;
}
