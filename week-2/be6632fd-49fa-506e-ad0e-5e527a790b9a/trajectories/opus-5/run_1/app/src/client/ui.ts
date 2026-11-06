import { SHARED_COPY } from '../domain/copy.ts';
import { closeDialog, showDialogAlert } from './dialogs.ts';
import {
  announce,
  clearFieldErrors,
  failureCopy,
  showFieldErrors,
  startPending,
  type FieldMapper,
} from './feedback.ts';
import { clearDraft, type DraftKey } from './drafts.ts';
import { RequestFailed, type ApiFailure } from './net.ts';

const CARRIED = 'hourline.announce';

let draftKey: DraftKey | null = null;

/** The screen's draft, cleared whenever an action saves successfully. */
export function useDraft(key: DraftKey): void {
  draftKey = key;
}

export interface CarriedResult {
  region: string;
  copy: string;
  focus: string | null;
}

/** Carries a success announcement and focus target across the reload that refreshes a screen. */
export function takeCarriedAnnouncement(): CarriedResult | null {
  const raw = window.sessionStorage.getItem(CARRIED);
  if (raw === null) return null;
  window.sessionStorage.removeItem(CARRIED);
  try {
    return JSON.parse(raw) as CarriedResult;
  } catch {
    return null;
  }
}

export function control(name: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
  return document.querySelector(`[data-field-control="${name}"]`);
}

export function valueOf(name: string): string {
  return control(name)?.value.trim() ?? '';
}

export function numberOf(name: string): number {
  return Number(control(name)?.value ?? '0');
}

export function checkedOf(name: string): boolean {
  const node = control(name);
  return node instanceof HTMLInputElement ? node.checked : false;
}

export function radioValue(name: string): string {
  const node = document.querySelector<HTMLInputElement>(
    `[data-field-control="${name}"]:checked`,
  );
  return node?.value ?? '';
}

export interface ActionOptions {
  region: string;
  /** The copy for codes this screen names itself. */
  own?: (failure: ApiFailure) => string | null;
  map?: FieldMapper;
  /** The dialog the action runs inside, which stays open when the server refuses. */
  dialog?: string;
  /** The action name of a sticky-bar button that submits this form in the phone layout. */
  stickyTrigger?: string;
  success?: string | ((result: unknown) => string);
  /** Reloads the screen after success, carrying the announcement across. */
  reload?: boolean;
  /** The element focus moves to after a reload, as a selector. */
  focusAfter?: string;
  after?: (result: unknown) => void | Promise<void>;
}

/**
 * Wires a dialog opener. Every matching button is wired, so the sticky-bar copy of an action in
 * the phone layout behaves exactly like the one in the content.
 */
export function onOpen(action: string, open: (button: HTMLElement) => void): void {
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      `[data-action="${action}"]`,
    );
    if (button === null || button === undefined) return;
    event.preventDefault();
    open(button);
  });
}

export function onAction(
  name: string,
  run: (button: HTMLButtonElement) => Promise<unknown>,
  options: ActionOptions,
): void {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>(`[data-action="${name}"]`);
    if (button === null || button === undefined) return;
    event.preventDefault();
    if (button.dataset['busy'] === 'true') return;
    void execute(button, run, options);
  });
}

async function execute(
  button: HTMLButtonElement,
  run: (button: HTMLButtonElement) => Promise<unknown>,
  options: ActionOptions,
): Promise<void> {
  const dialog =
    options.dialog === undefined
      ? null
      : document.querySelector<HTMLDialogElement>(`[data-dialog="${options.dialog}"]`);
  const scope: ParentNode = dialog ?? document;
  clearFieldErrors(scope);
  const pending = startPending(button);
  try {
    const result = await run(button);
    if (draftKey !== null) clearDraft(draftKey);
    const copy =
      options.success === undefined
        ? null
        : typeof options.success === 'function'
          ? options.success(result)
          : options.success;
    if (copy !== null) announce(options.region, copy);
    if (dialog !== null) closeDialog(dialog);
    await options.after?.(result);
    if (options.reload === true) {
      if (copy !== null) {
        window.sessionStorage.setItem(
          CARRIED,
          JSON.stringify({
            region: options.region,
            copy,
            focus: options.focusAfter ?? null,
          }),
        );
      }
      window.location.reload();
    }
  } catch (error) {
    const copy = failureCopy(error, options.own);
    if (error instanceof RequestFailed && error.failure.status === 422) {
      showFieldErrors(error.failure.fields, {
        scope,
        map: options.map,
        summary: dialog === null,
      });
    }
    announce(options.region, copy);
    if (dialog !== null) showDialogAlert(dialog, copy);
  } finally {
    pending.done();
  }
}

export function onSubmit(
  formSelector: string,
  run: (form: HTMLFormElement) => Promise<unknown>,
  options: ActionOptions,
): void {
  const form = document.querySelector<HTMLFormElement>(formSelector);
  if (form === null) return;
  const inForm = form.querySelector<HTMLButtonElement>('.button--primary');
  const triggers = [
    ...(inForm === null ? [] : [inForm]),
    ...(options.stickyTrigger === undefined
      ? []
      : [...document.querySelectorAll<HTMLButtonElement>(`[data-action="${options.stickyTrigger}"]`)]),
  ];
  const submit = (from?: HTMLButtonElement): void => {
    const button =
      from ?? triggers.find((candidate) => candidate.offsetParent !== null) ?? triggers[0] ?? null;
    if (button === null || button.dataset['busy'] === 'true') return;
    void execute(button, () => run(form), options);
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  for (const trigger of triggers) {
    trigger.addEventListener('click', () => submit(trigger));
  }
  for (const control of form.querySelectorAll<HTMLElement>('input')) {
    control.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
  }
}

export function pageData<T>(): T {
  const node = document.querySelector<HTMLScriptElement>('[data-page-data]');
  if (node === null) return {} as T;
  try {
    return JSON.parse(node.textContent ?? '{}') as T;
  } catch {
    return {} as T;
  }
}

export function unreachableCopy(): string {
  return SHARED_COPY.unreachable;
}
