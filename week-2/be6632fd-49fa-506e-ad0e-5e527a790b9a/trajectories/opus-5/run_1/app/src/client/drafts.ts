const PREFIX = 'hourline.draft';

export interface DraftKey {
  memberId: string;
  screen: string;
}

function storageKey(key: DraftKey): string {
  return `${PREFIX}:${key.memberId}:${key.screen}`;
}

export function readDraft(key: DraftKey): Record<string, string> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: DraftKey, values: Record<string, string>): void {
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(values));
  } catch {
    // Storage may be unavailable; the screen still works without a kept draft.
  }
}

export function clearDraft(key: DraftKey): void {
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function collectValues(scope: ParentNode): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of scope.querySelectorAll<HTMLElement>('[data-field-control]')) {
    const name = control.dataset['fieldControl'];
    if (name === undefined) continue;
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      values[name] = control.checked ? 'true' : 'false';
      continue;
    }
    if (control instanceof HTMLInputElement && control.type === 'radio') {
      if (control.checked) values[name] = control.value;
      continue;
    }
    if (control instanceof HTMLInputElement && control.type === 'file') continue;
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLSelectElement
    ) {
      values[name] = control.value;
    }
  }
  const editor = scope.querySelector<HTMLElement>('[data-story-editor]');
  if (editor !== null) values['story'] = editor.innerHTML;
  return values;
}

export function applyValues(scope: ParentNode, values: Record<string, string>): void {
  for (const control of scope.querySelectorAll<HTMLElement>('[data-field-control]')) {
    const name = control.dataset['fieldControl'];
    if (name === undefined) continue;
    const value = values[name];
    if (value === undefined) continue;
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      control.checked = value === 'true';
      continue;
    }
    if (control instanceof HTMLInputElement && control.type === 'radio') {
      control.checked = control.value === value;
      continue;
    }
    if (control instanceof HTMLInputElement && control.type === 'file') continue;
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLSelectElement
    ) {
      control.value = value;
    }
  }
  const editor = scope.querySelector<HTMLElement>('[data-story-editor]');
  const story = values['story'];
  if (editor !== null && story !== undefined) editor.innerHTML = story;
}

/** Keeps a screen's typed values until it saves successfully. */
export function keepDraft(key: DraftKey, scope: ParentNode = document): void {
  const save = (): void => writeDraft(key, collectValues(scope));
  for (const event of ['input', 'change']) {
    document.addEventListener(event, save, true);
  }
}
