/** The screen, the status regions and the dialogs live in separate layers. */
function ensure(id: string): HTMLElement {
  const existing = document.getElementById(id);
  if (existing !== null) return existing;
  const created = document.createElement('div');
  created.id = id;
  document.body.append(created);
  return created;
}

export function statusLayer(): HTMLElement {
  return ensure('status-layer');
}

export function dialogLayer(): HTMLElement {
  return ensure('dialog-layer');
}

export function appShell(): HTMLElement | null {
  return document.getElementById('app-shell');
}
