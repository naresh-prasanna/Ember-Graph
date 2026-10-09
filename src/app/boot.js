import { loadState, validateState } from './persistence.js';
import { frameScene, scenes } from './scenes.js';
import { S } from './state.js';

export function boot() {
  let initial = {
    ...scenes.orbit,
    scene: 'orbit',
  };
  try {
    const cached = localStorage.getItem('ember-v3') || localStorage.getItem('ember-v2');
    if (cached) {
      initial = JSON.parse(cached);
      validateState(initial);
      S.restored = true;
    }
  } catch {
    initial = {
      ...scenes.orbit,
      scene: 'orbit',
    };
  }
  loadState(initial);
  requestAnimationFrame(() => {
    if (!S.restored && S.W && S.H) frameScene();
  });
}
