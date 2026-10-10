import { S } from './state.js';
import { Tone } from '../math/values.js';

/* tone(f, g) rows play sine waves while switched on. Frequency and gain follow sliders smoothly, and a list
   of tones plays as a chord. Everything goes through one quiet master gain so a gain of 1 isn't harsh. */
let audio = null,
  master = null;
const playing = new Map();
const tonesOf = r => [r.value].flat().filter(t => t instanceof Tone);

export const isPlaying = r => playing.has(r);
export function toggleTone(r) {
  if (playing.has(r)) return stopTone(r);
  audio ||= new AudioContext();
  if (!master) {
    master = audio.createGain();
    master.gain.value = 0.18;
    master.connect(audio.destination);
  }
  audio.resume();
  playing.set(r, []);
  tune(r);
}
export function stopTone(r) {
  const voices = playing.get(r);
  if (!voices) return;
  playing.delete(r);
  const now = audio.currentTime;
  for (const { osc, gain } of voices) {
    gain.gain.setTargetAtTime(0, now, 0.03);
    osc.stop(now + 0.2);
  }
}
function tune(r) {
  const voices = playing.get(r),
    tones = tonesOf(r),
    now = audio.currentTime;
  while (voices.length < tones.length) {
    const osc = audio.createOscillator(),
      gain = audio.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(master);
    osc.start();
    voices.push({ osc, gain });
  }
  voices.forEach(({ osc, gain }, i) => {
    const t = tones[i],
      ok = t && t.freq > 0 && t.freq < 22000;
    if (ok) osc.frequency.setTargetAtTime(t.freq, now, 0.015);
    gain.gain.setTargetAtTime(
      ok ? Math.min(1, Math.max(0, t.gain)) / Math.max(1, tones.length) : 0,
      now,
      0.02,
    );
  });
}
// After any change: retune what's playing, and silence rows that were deleted, hidden or broken.
export function syncTones() {
  for (const r of [...playing.keys()]) {
    if (!S.rows.includes(r) || r.off || r.err || !tonesOf(r).length) stopTone(r);
    else tune(r);
  }
}
