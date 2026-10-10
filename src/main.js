import './styles/01-base.css';
import './styles/02-components.css';
import './styles/03-declutter.css';
import './styles/04-math.css';
import './styles/05-editor.css';
import './styles/06-typesetting.css';
import './styles/07-list.css';
import './styles/08-scale.css';
import './styles/09-keypad.css';

import { registerSW } from 'virtual:pwa-register';
import { boot } from './app/boot.js';
import { initInteraction } from './app/interaction.js';
import { initScenes } from './app/scenes.js';
import { kick } from './render/renderer.js';
import { initCompletions } from './ui/completions.js';
import { initControls, notice } from './ui/controls.js';
import { initDialogs } from './ui/dialogs.js';
import { initFps } from './ui/fps.js';
import { initGeogebraDialog } from './ui/geogebraDialog.js';
import { initHistory } from './ui/history.js';
import { initKeyPoints } from './ui/keyPoints.js';
import { initKeypad } from './ui/keypad.js';
import { initMatrixDialog } from './ui/matrixDialog.js';
import { initPanel } from './ui/panel.js';
import { initSidePanel } from './ui/sidePanel.js';

initPanel();
initSidePanel();
initControls();
initDialogs();
initInteraction();
initScenes();
initCompletions();
initKeypad();
initGeogebraDialog();
initMatrixDialog();
boot();
// History snapshots the restored graph, so it starts after boot.
initHistory();
initKeyPoints();
initFps();
kick();

registerSW({
  onOfflineReady: () => notice('Ember is ready to work offline.'),
  onNeedRefresh: () => notice('An update is ready. It loads the next time you open Ember.'),
});
