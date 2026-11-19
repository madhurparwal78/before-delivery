import { api, pick } from './dom';

const PAUSE_MS = 300;

interface State {
  timer: number;
  turn: number;
  active: number;
  materials: { id: string; name: string }[];
}

const state: State = { timer: 0, turn: 0, active: -1, materials: [] };

function listbox(): HTMLElement | null {
  return pick<HTMLElement>('[data-part="material-listbox"]');
}

function draw(): void {
  const list = listbox();
  const input = pick<HTMLInputElement>('#material-search');
  if (!list || !input) return;
  list.textContent = '';
  state.materials.forEach((material, index) => {
    const option = document.createElement('li');
    option.setAttribute('role', 'option');
    option.id = `material-option-${material.id}`;
    option.setAttribute('aria-selected', index === state.active ? 'true' : 'false');
    option.dataset.material = material.id;
    option.textContent = material.name;
    list.append(option);
  });
  const open = state.materials.length > 0;
  list.hidden = !open;
  input.setAttribute('aria-expanded', open ? 'true' : 'false');
  const active = state.materials[state.active];
  if (active) input.setAttribute('aria-activedescendant', `material-option-${active.id}`);
  else input.removeAttribute('aria-activedescendant');
}

/** Typing searches after the published pause, and the latest input wins. */
export function searchMaterials(text: string): void {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => {
    const turn = (state.turn += 1);
    void api('GET', `/api/materials?q=${encodeURIComponent(text)}`).then((answer) => {
      if (turn !== state.turn) return;
      state.materials = (answer.body.materials ?? []) as { id: string; name: string }[];
      state.active = state.materials.length > 0 ? 0 : -1;
      draw();
    });
  }, PAUSE_MS);
}

export function closeList(): void {
  state.materials = [];
  state.active = -1;
  draw();
}

export function pickMaterial(id: string, name: string): void {
  const input = pick<HTMLInputElement>('#material-search');
  if (!input) return;
  input.dataset.materialId = id;
  input.value = name;
  closeList();
}

export function comboboxKeys(event: KeyboardEvent): boolean {
  const input = pick<HTMLInputElement>('#material-search');
  if (!input || event.target !== input) return false;
  if (state.materials.length === 0) return false;
  if (event.key === 'ArrowDown') {
    state.active = (state.active + 1) % state.materials.length;
    draw();
    event.preventDefault();
    return true;
  }
  if (event.key === 'ArrowUp') {
    state.active = (state.active - 1 + state.materials.length) % state.materials.length;
    draw();
    event.preventDefault();
    return true;
  }
  if (event.key === 'Enter') {
    const active = state.materials[state.active];
    if (active) pickMaterial(active.id, active.name);
    event.preventDefault();
    return true;
  }
  if (event.key === 'Escape') {
    closeList();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  return false;
}

export function optionAt(target: EventTarget | null): { id: string; name: string } | null {
  if (!(target instanceof Element)) return null;
  const option = target.closest('[role="option"]') as HTMLElement | null;
  if (!option || !option.dataset.material) return null;
  return { id: option.dataset.material, name: option.textContent ?? '' };
}
