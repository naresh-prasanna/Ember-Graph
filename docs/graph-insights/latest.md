# Graph insights (local fallback)

Degraded GitNexus run; local symbol scan only.

## Math italic / delimiter path

- `src/editor/structure.js` — `mqDraw` marks letters with `.v`, parens with `.pb`, ghost closer via `parenCloserGhost`
- `src/styles/05-editor.css` — `.mq` uses `var(--math)`; `.v { font-style: italic }`
- `src/ui/mathDisplay.js` — `styleMath` / `nameH` wrap variables in `<i>`
- `src/styles/04-math.css` — display `<i>` italic + padding

## Issue

CSS italic on Cambria Math has no OpenType italic correction; browser may faux-italic or fall back to Georgia italic for `.v` while `.pb` stays on the math face → `f(` / `(f)` collision. Prior `0.12em` padding is insufficient for Georgia/Cambria italic `f`.
