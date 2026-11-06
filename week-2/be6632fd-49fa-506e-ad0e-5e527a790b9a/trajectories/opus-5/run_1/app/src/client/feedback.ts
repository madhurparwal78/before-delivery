import { SHARED_COPY, staleStart } from '../domain/copy.ts';
import { formatCopenhagenInstant, parseInstant } from '../domain/time.ts';
import { RequestFailed, type ApiFailure } from './net.ts';

export function announce(region: string, copy: string): void {
  const node = document.querySelector<HTMLElement>(`[data-status-region="${region}"]`);
  if (node === null) return;
  node.textContent = copy;
}

export function fieldLabel(name: string): string {
  const field = document.querySelector<HTMLElement>(`[data-field="${name}"]`);
  const label = field?.querySelector<HTMLElement>('.field__label');
  return label?.textContent?.trim() ?? name;
}

function controlFor(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-field-control="${name}"]`);
}

export function clearFieldErrors(scope: ParentNode = document): void {
  for (const node of scope.querySelectorAll<HTMLElement>('[data-field-error]')) {
    node.textContent = '';
    node.hidden = true;
  }
  for (const node of scope.querySelectorAll<HTMLElement>('[data-field-control]')) {
    node.removeAttribute('aria-invalid');
  }
  const problems = scope.querySelector<HTMLElement>('[data-problems]');
  if (problems !== null) problems.hidden = true;
}

/** Maps an API field path such as `markets.tokyo` onto the screen's field name. */
export type FieldMapper = (path: string) => string;

export function showFieldErrors(
  fields: Record<string, string>,
  options: { scope?: ParentNode; map?: FieldMapper; summary?: boolean } = {},
): void {
  const scope = options.scope ?? document;
  const map = options.map ?? ((path: string): string => path);
  const entries: { name: string; message: string }[] = [];

  for (const [path, message] of Object.entries(fields)) {
    const name = map(path);
    const node = scope.querySelector<HTMLElement>(`[data-field-error="${name}"]`);
    if (node !== null) {
      node.textContent = message;
      node.hidden = false;
    }
    const control = controlFor(name);
    control?.setAttribute('aria-invalid', 'true');
    entries.push({ name, message });
  }

  if (options.summary === false) return;
  const problems = scope.querySelector<HTMLElement>('[data-problems]');
  const list = problems?.querySelector<HTMLElement>('[data-problems-list]');
  if (problems === null || list === undefined || list === null) return;
  list.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#f-${entry.name}`;
      link.textContent = `${fieldLabel(entry.name)}: ${entry.message}`;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        controlFor(entry.name)?.focus();
      });
      item.append(link);
      return item;
    }),
  );
  problems.hidden = entries.length === 0;
  if (entries.length > 0) problems.focus();
}

export interface PendingButton {
  done(): void;
}

export function startPending(button: HTMLButtonElement): PendingButton {
  const original = button.textContent ?? '';
  const pending = button.dataset['pendingCopy'];
  button.disabled = true;
  button.dataset['busy'] = 'true';
  if (pending !== undefined) button.textContent = pending;
  return {
    done(): void {
      button.disabled = false;
      delete button.dataset['busy'];
      if (pending !== undefined) button.textContent = original;
    },
  };
}

export function staleCopy(failure: ApiFailure): string {
  const savedAt = failure.savedAt === undefined ? null : parseInstant(failure.savedAt);
  return staleStart(
    failure.savedBy ?? '',
    savedAt === null ? '' : formatCopenhagenInstant(savedAt),
  );
}

export interface EndedSessionHandler {
  (copy: string): void;
}

let endedSessionHandler: EndedSessionHandler | null = null;

export function onEndedSession(handler: EndedSessionHandler): void {
  endedSessionHandler = handler;
}

/**
 * Turns a failure into the region copy, handling the shared states and letting a screen add its
 * own copy for the codes it names.
 */
export function failureCopy(error: unknown, own: (failure: ApiFailure) => string | null = () => null): string {
  if (!(error instanceof RequestFailed)) return SHARED_COPY.unreachable;
  const failure = error.failure;
  const chosen = own(failure);
  const sessionCopy: Record<string, string> = {
    session_ended: SHARED_COPY.sessionEnded,
    access_removed: SHARED_COPY.accessRemoved,
    unauthenticated: SHARED_COPY.unauthenticated,
  };
  const shared = sessionCopy[failure.code];
  if (shared !== undefined) {
    endedSessionHandler?.(shared);
    return chosen ?? shared;
  }
  if (chosen !== null) return chosen;
  if (failure.status === 412) return staleCopy(failure);
  return failure.message;
}
