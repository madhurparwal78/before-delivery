/**
 * Escape closes the top-most dialog or panel. Handlers form a stack, so the
 * newest dialog answers first and the shell's own handler — the rail, then the
 * detail column — answers only when no dialog is open.
 */
const handlers: (() => void)[] = [];

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const top = handlers[handlers.length - 1];
  if (top === undefined) return;
  event.preventDefault();
  top();
}

export function pushEscapeHandler(handler: () => void): () => void {
  if (handlers.length === 0) document.addEventListener('keydown', onKeyDown);
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
    if (handlers.length === 0) document.removeEventListener('keydown', onKeyDown);
  };
}
