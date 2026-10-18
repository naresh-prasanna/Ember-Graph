# 架构设计

```
src/
  editor/structure.js   # mq editor model + DOM draw
  ui/panel.js           # expression rows, errors, sliders
  ui/mathDisplay.js     # typeset HTML for results/steps
  styles/01-base.css    # tokens, shell, .sl-lim
  styles/04-math.css    # display math, italic on <i>
  styles/05-editor.css  # .mq editor chrome
  math/                 # parse, eval, symbolic
```

Entry: Vite app shell. Rows toggle `.equation-display` vs `.mq` on focus.
