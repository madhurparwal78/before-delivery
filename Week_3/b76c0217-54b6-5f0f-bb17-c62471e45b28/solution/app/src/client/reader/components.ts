import { copy, reasonPhrases } from '../../shared/copy';
import type { ApiErrorBody, ReaderBoot } from '../../shared/types';
import { timers } from '../../shared/rules';
import { announce, copyText, reducedMotion, setBusy, tell } from '../shared/dom';
import { tween, type Tween } from '../shared/tween';

const CODE_KEY = 'galley-code-title';

function select(host: HTMLElement, tab: HTMLElement, focus: boolean): void {
  for (const other of host.querySelectorAll<HTMLElement>(':scope > .tablist [role="tab"]')) {
    const on = other === tab;
    other.setAttribute('aria-selected', String(on));
    other.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(other.getAttribute('aria-controls') ?? '');
    if (panel !== null) {
      panel.hidden = !on;
    }
  }
  if (focus) {
    tab.focus();
  }
}

function chooseCodeTitle(title: string): void {
  try {
    localStorage.setItem(CODE_KEY, title);
  } catch {
    // the choice still applies to this page
  }
  for (const group of document.querySelectorAll<HTMLElement>('[data-component="code-group"]')) {
    const match = [...group.querySelectorAll<HTMLElement>(':scope > .tablist [role="tab"]')].find((tab) => tab.dataset.title === title);
    if (match) {
      select(group, match, false);
    }
  }
}

function initTabs(host: HTMLElement): void {
  const tabs = [...host.querySelectorAll<HTMLElement>(':scope > .tablist [role="tab"]')];
  const isCode = host.dataset.component === 'code-group';
  const choose = (tab: HTMLElement, focus: boolean): void => {
    select(host, tab, focus);
    if (isCode) {
      chooseCodeTitle(tab.dataset.title ?? '');
    }
  };
  host.addEventListener('keydown', (event) => {
    const at = tabs.indexOf(document.activeElement as HTMLElement);
    const next: Record<string, number> = { ArrowRight: (at + 1) % tabs.length, ArrowLeft: (at - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
    const target = tabs[next[event.key] ?? -1];
    if (at >= 0 && target) {
      event.preventDefault();
      choose(target, true);
    }
  });
  for (const tab of tabs) {
    tab.addEventListener('click', () => choose(tab, false));
  }
}

const running = new WeakMap<HTMLElement, Tween>();

function toggleAccordion(button: HTMLElement): void {
  const region = document.getElementById(button.getAttribute('aria-controls') ?? '');
  if (region === null) {
    return;
  }
  const closing = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!closing));
  running.get(region)?.cancel();
  if (reducedMotion()) {
    region.hidden = closing;
    region.dataset.motion = closing ? 'closed' : 'open';
    region.style.height = '';
    return;
  }
  const from = region.hidden ? 0 : region.getBoundingClientRect().height;
  region.hidden = false;
  region.style.height = 'auto';
  const full = region.scrollHeight;
  const to = closing ? 0 : full;
  region.style.overflow = 'hidden';
  region.dataset.motion = closing ? 'closing' : 'opening';
  running.set(
    region,
    tween(
      timers.accordion * (full === 0 ? 1 : Math.abs(to - from) / full),
      (eased) => {
        region.style.height = `${from + (to - from) * eased}px`;
      },
      () => {
        region.style.height = '';
        region.style.overflow = '';
        region.hidden = closing;
        region.dataset.motion = closing ? 'closed' : 'open';
      },
    ),
  );
}

async function copyCode(button: HTMLElement): Promise<void> {
  const code = button.closest('.code-panel')?.querySelector('code')?.textContent ?? '';
  try {
    await copyText(code);
    tell(copy.copied);
  } catch {
    announce(copy.saveFailed);
  }
}

function initTryIt(panel: HTMLElement, boot: ReaderBoot): void {
  const form = panel.querySelector('form');
  const result = panel.querySelector<HTMLElement>('.tryit-result');
  if (form === null || result === null) {
    return;
  }
  const inputs = [...form.querySelectorAll<HTMLInputElement>('input[data-param]')];
  const body = form.querySelector<HTMLTextAreaElement>('textarea[data-body]');
  const code = form.querySelector<HTMLSelectElement>('select');
  const send = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const show = (field: HTMLElement, message: string): void => {
    const error = document.getElementById(`${field.id}-error`);
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', `${field.id}-error`);
    if (error !== null) {
      error.textContent = message;
      error.hidden = false;
    }
  };
  const clear = (): void => {
    for (const field of [...inputs, ...(body ? [body] : [])]) {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
      const error = document.getElementById(`${field.id}-error`);
      if (error !== null) {
        error.hidden = true;
        error.textContent = '';
      }
    }
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clear();
    const problems: [HTMLElement, string][] = inputs
      .filter((input) => input.dataset.required === 'true' && input.value.trim() === '')
      .map((input) => [input, copy.requiredParameter(input.dataset.param ?? '')]);
    if (body !== null) {
      try {
        JSON.parse(body.value);
      } catch {
        problems.push([body, copy.invalidBody]);
      }
    }
    for (const [field, message] of problems) {
      show(field, message);
    }
    const [first] = problems;
    if (first !== undefined) {
      first[0].focus();
      announce(first[1]);
      return;
    }
    if (send !== null) {
      setBusy(send, true);
    }
    try {
      const response = await fetch(`/api/mock/${boot.siteSlug}/${boot.versionSlug}/${boot.operationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: Number(code?.value),
          parameters: Object.fromEntries(inputs.map((input) => [input.dataset.param, input.value])),
          body: body?.value ?? '',
        }),
      });
      const payload: unknown = await response.json();
      const refusal = (payload as Partial<ApiErrorBody>).error;
      if (response.status === 422 && typeof refusal === 'object' && refusal.fields) {
        for (const input of inputs) {
          const message = refusal.fields[input.dataset.param ?? ''];
          if (message) {
            show(input, message);
          }
        }
        if (body !== null && refusal.fields.body) {
          show(body, refusal.fields.body);
        }
        announce(refusal.message);
        return;
      }
      const status = copy.statusLine(response.status, reasonPhrases[response.status] ?? '');
      panel.querySelector<HTMLElement>('[data-status]')!.textContent = status;
      panel.querySelector<HTMLElement>('[data-response]')!.textContent = JSON.stringify(payload, null, 2);
      result.hidden = false;
      announce(status);
    } finally {
      if (send !== null) {
        setBusy(send, false);
      }
    }
  });
}

/** Wire every component inside `root`. Safe to call again on content that replaced the old. */
export function enhanceContent(root: ParentNode, boot: ReaderBoot): void {
  for (const host of root.querySelectorAll<HTMLElement>('[data-component="tabs"], [data-component="code-group"]')) {
    initTabs(host);
  }
  const stored = (() => {
    try {
      return localStorage.getItem(CODE_KEY);
    } catch {
      return null;
    }
  })();
  if (stored !== null) {
    chooseCodeTitle(stored);
  }
  for (const panel of root.querySelectorAll<HTMLElement>('.tryit')) {
    initTryIt(panel, boot);
  }
}

/** Clicks on copy buttons and accordions are handled once, for content that may be swapped later. */
export function initDelegates(): void {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const copyButton = target?.closest<HTMLElement>('[data-copy]');
    const accordion = target?.closest<HTMLElement>('.accordion-button');
    if (copyButton) {
      void copyCode(copyButton);
    } else if (accordion) {
      toggleAccordion(accordion);
    }
  });
}
