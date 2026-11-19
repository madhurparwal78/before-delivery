// The motion contract: data-motion follows the system preference at once.

const query = window.matchMedia('(prefers-reduced-motion: reduce)');
const listeners = new Set();

export function reduced() {
  return document.documentElement.dataset.motion === 'reduced';
}

export function onMotionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply() {
  document.documentElement.dataset.motion = query.matches ? 'reduced' : 'full';
  document.querySelectorAll('[data-motion-ms]').forEach((node) => {
    const full = node.dataset.motionFull;
    if (full) node.dataset.motionMs = query.matches ? '0' : full;
  });
  listeners.forEach((listener) => listener(query.matches));
}

export function startMotionWatch() {
  apply();
  query.addEventListener('change', apply);
}

export function motionAttributes(node, milliseconds) {
  node.dataset.motionFull = String(milliseconds);
  node.dataset.motionMs = reduced() ? '0' : String(milliseconds);
  return node;
}
