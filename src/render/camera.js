import { S, reduceMotion } from '../app/state.js';
import { clamp } from '../math/format.js';
import { kick } from './renderer.js';

export const camera = {
  enabled: !reduceMotion,
  trace: null,
  roll: {
    x: 0,
    v: 0,
  },
  pitch: {
    x: 0,
    v: 0,
  },
  yaw: {
    x: 0,
    v: 0,
  },
  push: {
    x: 0,
    v: 0,
  },
  impulse: {
    roll: 0,
    pitch: 0,
    yaw: 0,
    push: 0,
  },
  matrix: [1, 0, 0, 1, 0, 0],
};
export function cameraKick(dx = 0, dy = 0, zoom = 0) {
  if (!camera.enabled || reduceMotion) return;
  const c = camera.impulse;
  c.roll = clamp(c.roll + dx * 0.001, -0.07, 0.07);
  c.pitch = clamp(c.pitch + dy * 0.003 + zoom * 0.1, -0.23, 0.23);
  c.yaw = clamp(c.yaw - dx * 0.003, -0.23, 0.23);
  c.push = clamp(c.push + zoom * 0.016, -0.018, 0.028);
  kick();
}
export function cameraStep(dt) {
  if (typeof S.drag !== 'undefined' && S.drag) return false;
  const quiet =
      !camera.enabled || reduceMotion || !!document.activeElement?.matches('input[type=text],textarea,.mq'),
    gain = S.presentation ? 1.25 : 0.8,
    trace = quiet ? null : camera.trace;
  const tx = trace ? clamp((trace[0] - S.V.cx) / Math.max(90, S.V.s * 3), -1, 1) : 0,
    ty = trace ? clamp((trace[1] - S.V.cy) / Math.max(90, S.V.s * 3), -1, 1) : 0;
  const targets = {
    roll: quiet ? 0 : gain * (camera.impulse.roll + tx * 0.045),
    pitch: quiet ? 0 : gain * (camera.impulse.pitch - ty * 0.14),
    yaw: quiet ? 0 : gain * (camera.impulse.yaw - tx * 0.15),
    push: quiet ? 0 : gain * (camera.impulse.push + (trace ? 0.008 : 0)),
  };
  let moving = false;
  for (const n of ['roll', 'pitch', 'yaw', 'push']) {
    const c = camera[n],
      target = targets[n],
      omega = 9,
      delta = c.x - target,
      term = c.v + omega * delta,
      decay = Math.exp(-omega * dt);
    c.x = target + (delta + term * dt) * decay;
    c.v = (c.v - omega * term * dt) * decay;
    camera.impulse[n] *= Math.exp(-dt * 6);
    if (Math.abs(c.x - target) + Math.abs(c.v) + Math.abs(target) > 0.00004) moving = true;
    else {
      c.x = 0;
      c.v = 0;
    }
  }
  const r = camera.roll.x,
    p = camera.pitch.x,
    y = camera.yaw.x,
    z = 1 + camera.push.x,
    co = Math.cos(r),
    si = Math.sin(r),
    a = z * (co * Math.cos(y) - si * Math.sin(p) * Math.sin(y)),
    b = z * (si * Math.cos(y) + co * Math.sin(p) * Math.sin(y)),
    c = -z * si * Math.cos(p),
    d = z * co * Math.cos(p),
    ox = S.W / 2,
    oy = S.H * 0.55;
  camera.matrix = [a, b, c, d, ox - a * ox - c * oy, oy - b * ox - d * oy];
  return moving;
}
export function unprojectPoint(p) {
  const [a, b, c, d, e, f] = camera.matrix,
    det = a * d - b * c,
    x = p[0] - e,
    y = p[1] - f;
  return [(d * x - c * y) / det, (-b * x + a * y) / det];
}
