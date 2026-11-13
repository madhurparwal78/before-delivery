/** The stack of open dialogs, sheets and menus: Escape closes the topmost one, in one place. */
interface Layer {
  close: () => void;
  name: string;
}

const stack: Layer[] = [];
let listening = false;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || stack.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  stack[stack.length - 1]!.close();
}

export function pushLayer(layer: Layer): () => void {
  stack.push(layer);
  if (!listening) {
    document.addEventListener('keydown', onKeyDown, true);
    listening = true;
  }
  return () => {
    const index = stack.indexOf(layer);
    if (index >= 0) stack.splice(index, 1);
  };
}

export function hasOpenLayer(): boolean {
  return stack.length > 0;
}

/** The accessible name of the topmost dialog or menu, if one is open. */
export function topLayerName(): string | null {
  return stack.at(-1)?.name ?? null;
}
