/* H hides every control, leaving only the graph and its numbers; H or Escape brings them back. */

// Single-key shortcuts stand down while the user is typing.
export const typing = e =>
  !!e.target.closest?.('input, textarea, select, [contenteditable="true"], .mq, dialog');

function bare(on) {
  const body = document.body;
  if (on === body.classList.contains('bare')) return;
  if (on) document.activeElement?.blur?.();
  body.classList.toggle('bare', on);
  body.classList.toggle('unbare', !on);
}

export function initHud() {
  // Capture, so Escape out of the bare view doesn't also leave Present mode.
  document.addEventListener(
    'keydown',
    e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e)) return;
      const on = document.body.classList.contains('bare');
      if (e.key === 'h' || e.key === 'H') bare(!on);
      else if (e.key === 'Escape' && on) bare(false);
      else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  document.addEventListener('animationend', e => {
    if (e.animationName === 'hud-in') document.body.classList.remove('unbare');
  });
}
