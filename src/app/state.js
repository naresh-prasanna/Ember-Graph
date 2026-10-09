import { nullObj } from '../math/catalog.js';

export const PAL = ['#ff783b', '#d9c8ad', '#a79886', '#cf9b73', '#91b5b2', '#b2a8c3'];
export const sceneMemory = new Map();
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const S = {
  activeScene: 'orbit',
  presentation: false,
  construction: true,
  drifting: false,
  rows: [],
  uid: 0,
  env: undefined,
  vars: nullObj(),
  VM: nullObj(),
  // Slider limits chosen by the user, by variable name: { min, max, step }; step 0 means continuous.
  ranges: nullObj(),
  playing: new Set(),
  marks: [],
  sparks: [],
  V: {
    cx: 0,
    cy: 0,
    s: 50,
  },
  C: {
    y: 0.7,
    p: 0.9,
    s: 38,
  },
  W: 0,
  H: 0,
  dpr: 1,
  mode3: false,
  dirty: true,
  on: false,
  fast: false,
  lastT: 0,
  drag: null,
  completion: null,
  restored: false,
};
