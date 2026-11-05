import type { CatalogProduct, Cycle, CycleSummary } from '../../shared/types.ts';
import { errorFields, request } from '../api.ts';
import { copy, fieldLabels, fieldOrder } from '../copy.ts';
import { clear, el, isBusy, setBusy } from '../dom.ts';
import { clubFieldText, fieldTextToLocal } from '../clubTimeText.ts';
import type { Page, Shell } from './page.ts';

export function createCoordinatorCyclesPage(shell: Shell): Page {
  const rows = el('tbody');
  const newButton = el('button', { type: 'button', class: 'primary', text: 'New cycle' }) as HTMLButtonElement;
  const element = el('main', { class: 'screen coordinator-cycles' }, [
    el('h1', { text: 'Cycles' }),
    newButton,
    el('table', { class: 'cycles-table', 'aria-label': 'Cycles' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'NAME' }),
          el('th', { scope: 'col', text: 'STATUS' }),
          el('th', { scope: 'col', text: 'CUTOFF' }),
        ]),
      ]),
      rows,
    ]),
  ]);
  let timer: number | null = null;
  let shown = '';

  async function load(): Promise<void> {
    const reply = await request<{ cycles: CycleSummary[] }>('GET', '/api/cycles');
    if (!reply.ok) return;
    const signature = reply.body.cycles
      .map((cycle) => `${cycle.id}:${cycle.status}:${cycle.name}:${cycle.cutoff_display}`)
      .join('|');
    if (signature === shown) return;
    shown = signature;
    clear(rows);
    for (const cycle of [...reply.body.cycles].reverse()) {
      rows.append(
        el('tr', {}, [
          el('td', {}, [el('a', { href: `/coordinator/cycles/${cycle.id}`, class: 'text-link', text: cycle.name })]),
          el('td', { text: cycle.status }),
          el('td', { text: cycle.cutoff_display ?? '' }),
        ]),
      );
    }
  }

  newButton.addEventListener('click', () => shell.navigate('/coordinator/cycles/new'));

  return {
    element,
    start() {
      void load();
      timer = window.setInterval(() => void load(), 10_000);
    },
    destroy() {
      if (timer !== null) window.clearInterval(timer);
    },
  };
}

interface FieldSet {
  name: HTMLInputElement;
  cutoff_local: HTMLInputElement;
  pickup_start_local: HTMLInputElement;
  pickup_end_local: HTMLInputElement;
}

export function createCycleFormPage(shell: Shell, cycle: Cycle | null): Page {
  const errors = new Map<string, HTMLElement>();
  const fields: FieldSet = {
    name: field('Cycle name', 'cycle-name'),
    cutoff_local: field('Cutoff (club time)', 'cycle-cutoff'),
    pickup_start_local: field('Pickup starts (club time)', 'cycle-pickup-start'),
    pickup_end_local: field('Pickup ends (club time)', 'cycle-pickup-end'),
  };
  const caseList = el('div', { class: 'case-checklist' });
  const caseError = el('p', { class: 'field-error', id: 'error-product_ids' });
  errors.set('product_ids', caseError);
  const summaryList = el('ul', { class: 'problem-list', 'aria-label': 'Problems with this cycle' });
  const summary = el('div', { class: 'problem-summary', hidden: true }, [
    el('h2', { text: 'PROBLEMS WITH THIS CYCLE' }),
    summaryList,
  ]);
  const saveButton = el('button', { type: 'submit', class: 'primary', text: 'Save draft' }) as HTMLButtonElement;
  const openButton = el('button', { type: 'button', text: 'Open cycle' }) as HTMLButtonElement;
  const checkboxes = new Map<string, HTMLInputElement>();

  function field(label: string, id: string): HTMLInputElement {
    const input = el('input', { type: 'text', id, class: 'text-input', 'aria-label': label }) as HTMLInputElement;
    const error = el('p', { class: 'field-error', id: `error-${id}` });
    input.dataset.errorId = `error-${id}`;
    errors.set(id, error);
    return input;
  }

  function fieldRow(label: string, input: HTMLInputElement, hint?: string): HTMLElement {
    const error = errors.get(input.id)!;
    return el('div', { class: 'form-row' }, [
      el('label', { for: input.id, class: 'label', text: label.toUpperCase() }),
      input,
      hint ? el('p', { class: 'hint', text: hint }) : null,
      error,
    ]);
  }

  const form = el('form', { class: 'cycle-form' }, [
    fieldRow('Cycle name', fields.name),
    fieldRow('Cutoff (club time)', fields.cutoff_local, 'YYYY-MM-DD HH:MM'),
    fieldRow('Pickup starts (club time)', fields.pickup_start_local, 'YYYY-MM-DD HH:MM'),
    fieldRow('Pickup ends (club time)', fields.pickup_end_local, 'YYYY-MM-DD HH:MM'),
    el('fieldset', { class: 'case-fieldset' }, [el('legend', { class: 'label', text: 'CASES' }), caseList, caseError]),
    el('div', { class: 'form-actions' }, [saveButton, cycle ? openButton : null]),
  ]);
  const element = el('main', { class: 'screen cycle-form-screen' }, [
    el('h1', { text: cycle ? 'Draft cycle' : 'New cycle' }),
    summary,
    form,
  ]);

  let revision = cycle?.revision ?? 0;

  function errorIdFor(apiField: string): string {
    if (apiField === 'product_ids') return 'error-product_ids';
    const input = fields[apiField as keyof FieldSet];
    return `error-${input.id}`;
  }

  function fieldElementFor(apiField: string): HTMLElement {
    if (apiField === 'product_ids') {
      return [...checkboxes.values()][0] ?? caseList;
    }
    return fields[apiField as keyof FieldSet];
  }

  function clearProblems(): void {
    summary.hidden = true;
    clear(summaryList);
    for (const [, node] of errors) node.textContent = '';
    for (const input of Object.values(fields)) input.removeAttribute('aria-describedby');
  }

  function showProblems(given: Record<string, string>, action: 'opening' | 'saving'): void {
    clearProblems();
    const failing = fieldOrder.filter((name) => given[name] !== undefined);
    for (const name of failing) {
      const text = given[name]!;
      const errorNode = document.getElementById(errorIdFor(name));
      if (errorNode) errorNode.textContent = text;
      const target = fieldElementFor(name);
      if (target instanceof HTMLInputElement && name !== 'product_ids') {
        target.setAttribute('aria-describedby', errorIdFor(name));
      }
      const link = el('a', { href: '#', class: 'problem-link', text: `${fieldLabels[name]}: ${text}` });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const node = fieldElementFor(name);
        node.focus();
        node.scrollIntoView({ block: 'center' });
      });
      summaryList.append(el('li', {}, [link]));
    }
    summary.hidden = failing.length === 0;
    if (failing.length === 0) return;
    const first = summaryList.querySelector<HTMLElement>('a');
    first?.focus();
    shell.say(
      'coordinator',
      failing.length === 1 ? copy.problemsSingular(action) : copy.problemsPlural(failing.length, action),
    );
  }

  function bodyFromForm(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      name: fields.name.value,
      product_ids: [...checkboxes.entries()].filter(([, box]) => box.checked).map(([id]) => id),
    };
    for (const name of ['cutoff_local', 'pickup_start_local', 'pickup_end_local'] as const) {
      const typed = fields[name].value.trim();
      if (typed !== '') body[name] = fieldTextToLocal(typed);
    }
    return body;
  }

  async function save(): Promise<void> {
    if (isBusy(saveButton)) return;
    setBusy(saveButton, true, { busy: 'Saving...', idle: 'Save draft' });
    const body = bodyFromForm();
    const reply = cycle
      ? await request<Cycle>('PATCH', `/api/cycles/${cycle.id}`, { body, ifMatch: `"r${revision}"` })
      : await request<Cycle>('POST', '/api/cycles', { body });
    setBusy(saveButton, false, { busy: 'Saving...', idle: 'Save draft' });
    if (reply.status === 201 || reply.status === 200) {
      clearProblems();
      revision = reply.body.revision;
      shell.say('coordinator', copy.savedDraft(reply.body.name));
      shell.navigate(`/coordinator/cycles/${reply.body.id}`, { replace: true });
      return;
    }
    if (reply.status === 422) {
      showProblems(errorFields(reply.body), 'saving');
      return;
    }
    if (reply.status === 412 && reply.body) {
      shell.say('coordinator', copy.staleTimes(fields.name.value));
      shell.navigate(`/coordinator/cycles/${cycle?.id ?? ''}`, { replace: true });
    }
  }

  async function open(): Promise<void> {
    if (!cycle) return;
    if (isBusy(openButton)) return;
    setBusy(openButton, true, { busy: 'Working...', idle: 'Open cycle' });
    const reply = await request<Cycle>('POST', `/api/cycles/${cycle.id}/transitions`, {
      body: { to: 'open', ...bodyFromForm() },
      ifMatch: `"r${revision}"`,
    });
    setBusy(openButton, false, { busy: 'Working...', idle: 'Open cycle' });
    if (reply.ok) {
      clearProblems();
      shell.say('coordinator', copy.transitioned(reply.body.name, reply.body.status));
      shell.navigate(`/coordinator/cycles/${cycle.id}`, { replace: true });
      return;
    }
    if (reply.status === 422) {
      showProblems(errorFields(reply.body), 'opening');
      return;
    }
    if (reply.status === 412) {
      shell.say('coordinator', copy.staleTimes(cycle.name));
      shell.navigate(`/coordinator/cycles/${cycle.id}`, { replace: true });
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
  openButton.addEventListener('click', () => void open());

  async function loadCatalogue(): Promise<void> {
    const reply = await request<{ products: CatalogProduct[] }>('GET', '/api/catalog');
    if (!reply.ok) return;
    clear(caseList);
    checkboxes.clear();
    const chosen = new Set(cycle?.lines.map((line) => line.product_id) ?? []);
    for (const product of reply.body.products) {
      const box = el('input', {
        type: 'checkbox',
        id: `case-${product.id}`,
        'aria-label': product.case_name,
      }) as HTMLInputElement;
      box.checked = chosen.has(product.id);
      checkboxes.set(product.id, box);
      caseList.append(
        el('div', { class: 'case-choice' }, [
          box,
          el('label', { for: `case-${product.id}`, text: product.case_name }),
        ]),
      );
    }
  }

  return {
    element,
    start() {
      if (cycle) {
        fields.name.value = cycle.name;
        fields.cutoff_local.value = clubFieldText(cycle.cutoff_at, shell.club.time_zone);
        fields.pickup_start_local.value = clubFieldText(cycle.pickup_start_at, shell.club.time_zone);
        fields.pickup_end_local.value = clubFieldText(cycle.pickup_end_at, shell.club.time_zone);
      }
      void loadCatalogue();
      fields.name.focus();
    },
    destroy() {
      /* nothing to tidy */
    },
  };
}
