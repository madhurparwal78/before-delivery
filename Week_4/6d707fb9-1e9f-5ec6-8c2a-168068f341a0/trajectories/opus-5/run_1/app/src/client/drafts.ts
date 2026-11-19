import { pick, pickAll } from './dom';
import { openDialog, topDialog } from './dialogs';

const STORE = 'fioDraft';

interface Draft {
  dialog: string | null;
  fields: Record<string, string>;
}

function key(): string {
  return `${STORE}:${location.pathname}`;
}

/** The typed draft and which dialog was open stay on the device. */
export function saveDraft(): void {
  const open = topDialog();
  const fields: Record<string, string> = {};
  const scope = open ?? document;
  for (const field of pickAll<HTMLInputElement>('input, select, textarea', scope)) {
    if (field.type === 'file' || field.type === 'password') continue;
    const name = field.name || field.id;
    if (!name) continue;
    if (field.type === 'checkbox' || field.type === 'radio') continue;
    fields[name] = field.value;
  }
  const draft: Draft = { dialog: open ? open.id : null, fields };
  try {
    window.sessionStorage.setItem(key(), JSON.stringify(draft));
  } catch {
    /* a device with no storage keeps nothing */
  }
}

export function restoreDraft(): void {
  let draft: Draft | null = null;
  try {
    const held = window.sessionStorage.getItem(key());
    draft = held ? (JSON.parse(held) as Draft) : null;
    window.sessionStorage.removeItem(key());
  } catch {
    draft = null;
  }
  if (!draft) return;
  const scope = draft.dialog ? pick<HTMLElement>(`#${draft.dialog}`) : null;
  if (scope) openDialog(scope, null);
  for (const [name, value] of Object.entries(draft.fields)) {
    const field =
      pick<HTMLInputElement>(`[name="${name}"]`, scope ?? document) ?? pick<HTMLInputElement>(`#${name}`);
    if (field) field.value = value;
  }
}
