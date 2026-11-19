import { listen, need, query, queryAll } from './dom.js';
import { announce } from './status.js';
import { ENQUIRY_COPY, budgetName, descriptionCounter, projectTypeName } from '../shared/copy.js';
import { checkEnquiry } from '../shared/validation.js';
import type { EnquiryField, EnquiryValues, FieldError } from '../shared/validation.js';
import type { MailOutcome } from '../shared/types.js';

interface EnquiryAnswer {
  reference: string;
  brief_url: string;
  mail: MailOutcome;
}

let template: string | null = null;
let submissionId = crypto.randomUUID();
let pending = false;

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

const controlOf = (region: ParentNode, field: EnquiryField): HTMLElement =>
  need<HTMLElement>(`[data-field="${field}"]`, region);

const focusTarget = (region: ParentNode, field: EnquiryField): HTMLElement => {
  const control = controlOf(region, field);
  return field === 'project_type' ? need<HTMLElement>('input', control) : control;
};

function readValues(region: ParentNode): {
  name: string;
  email: string;
  projectType: string | null;
  budget: string;
  description: string;
} {
  const checked = query<HTMLInputElement>('input[name="project_type"]:checked', region);
  return {
    name: need<HTMLInputElement>('[data-field="name"]', region).value,
    email: need<HTMLInputElement>('[data-field="email"]', region).value,
    projectType: checked ? checked.value : null,
    budget: need<HTMLSelectElement>('[data-field="budget"]', region).value,
    description: need<HTMLTextAreaElement>('[data-field="description"]', region).value,
  };
}

function clearMessages(region: ParentNode): void {
  const box = need<HTMLElement>('[data-error-box]', region);
  box.hidden = true;
  need<HTMLElement>('[data-error-list]', region).replaceChildren();
  for (const message of queryAll<HTMLElement>('[data-message]', region)) {
    message.hidden = true;
    message.textContent = '';
  }
  for (const control of queryAll<HTMLElement>('[data-field]', region)) {
    control.removeAttribute('aria-invalid');
    const field = control.dataset.field as EnquiryField;
    if (field === 'description') control.setAttribute('aria-describedby', 'enquiry-description-counter');
    else control.removeAttribute('aria-describedby');
  }
}

function clearAlert(region: ParentNode): void {
  need<HTMLElement>('[data-alert-slot]', region).replaceChildren();
}

function showErrors(region: ParentNode, errors: FieldError[]): void {
  const list = need<HTMLElement>('[data-error-list]', region);
  for (const error of errors) {
    const field = error.field as EnquiryField;
    const control = controlOf(region, field);
    const message = need<HTMLElement>(`[data-message="${field}"]`, region);
    message.textContent = error.message;
    message.hidden = false;
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute(
      'aria-describedby',
      field === 'description'
        ? `enquiry-description-counter ${message.id}`
        : message.id,
    );
    const item = element('li');
    const link = element('a', error.message);
    link.href = `#${focusTarget(region, field).id}`;
    listen(link, 'click', (event) => {
      event.preventDefault();
      focusTarget(region, field).focus();
    });
    item.append(link);
    list.append(item);
  }
  const box = need<HTMLElement>('[data-error-box]', region);
  box.hidden = false;
  box.focus();
}

function summaryRow(dl: HTMLElement, label: string, value: string, preserve = false): void {
  const row = element('div');
  row.className = 'summary__row';
  row.append(element('dt', label));
  const detail = element('dd', value);
  if (preserve) detail.className = 'summary__description';
  row.append(detail);
  dl.append(row);
}

function showPanel(region: HTMLElement, values: EnquiryValues, answer: EnquiryAnswer): void {
  const panel = element('div');
  panel.className = 'panel';
  panel.dataset.thanks = '';

  const heading = element('h3', ENQUIRY_COPY.thanks(values.name));
  heading.className = 'panel__heading';
  heading.tabIndex = -1;
  panel.append(heading);

  if (answer.mail === 'not_sent') {
    const alert = element('div', ENQUIRY_COPY.mailFailedAlert(answer.reference));
    alert.className = 'alert';
    alert.setAttribute('role', 'alert');
    panel.append(alert);
  }

  panel.append(element('p', ENQUIRY_COPY.thanksLine(answer.reference)));

  const summary = element('dl');
  summary.className = 'summary rules';
  summary.setAttribute('aria-label', ENQUIRY_COPY.summaryHeading);
  summaryRow(summary, 'Reference', answer.reference);
  summaryRow(summary, 'Name', values.name);
  summaryRow(summary, 'Email', values.email);
  summaryRow(summary, 'Project type', projectTypeName(values.projectType));
  summaryRow(summary, 'Budget range', budgetName(values.budget));
  summaryRow(summary, 'Project description', values.description, true);
  panel.append(summary);

  const download = element('a', ENQUIRY_COPY.downloadLink);
  download.className = 'link-underline';
  download.href = answer.brief_url;
  panel.append(download);

  const again = element('button', ENQUIRY_COPY.sendAnother);
  again.type = 'button';
  again.className = 'button';
  again.dataset.sendAnother = '';
  listen(again, 'click', () => {
    region.innerHTML = template!;
    const name = need<HTMLInputElement>('[data-field="name"]', region);
    name.value = '';
    need<HTMLInputElement>('[data-field="email"]', region).value = '';
    need<HTMLSelectElement>('[data-field="budget"]', region).value = '';
    need<HTMLTextAreaElement>('[data-field="description"]', region).value = '';
    for (const radio of queryAll<HTMLInputElement>('input[name="project_type"]', region)) {
      radio.checked = false;
    }
    need<HTMLElement>('[data-counter]', region).textContent = descriptionCounter(0);
    submissionId = crypto.randomUUID();
    bind(region);
    name.focus();
  });
  panel.append(again);

  region.replaceChildren(panel);
  announce(
    answer.mail === 'sent'
      ? ENQUIRY_COPY.sentStatus(answer.reference)
      : ENQUIRY_COPY.savedStatus(answer.reference),
  );
  heading.focus();
}

function showNotSaved(region: HTMLElement): void {
  const alert = element('div', ENQUIRY_COPY.notSavedAlert);
  alert.className = 'alert';
  alert.setAttribute('role', 'alert');
  need<HTMLElement>('[data-alert-slot]', region).replaceChildren(alert);
  announce('');
}

async function send(region: HTMLElement, values: EnquiryValues): Promise<void> {
  pending = true;
  const submit = need<HTMLButtonElement>('[data-submit]', region);
  submit.setAttribute('aria-disabled', 'true');
  announce(ENQUIRY_COPY.sending);
  try {
    const response = await fetch('/api/enquiries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        submission_id: submissionId,
        name: values.name,
        email: values.email,
        project_type: values.projectType,
        budget: values.budget,
        description: values.description,
      }),
    });
    if (response.status === 201 || response.status === 200) {
      const answer = (await response.json()) as EnquiryAnswer;
      showPanel(region, values, answer);
      return;
    }
    if (response.status === 422) {
      const body = (await response.json()) as { fields: Record<string, string> };
      announce('');
      showErrors(
        region,
        Object.entries(body.fields).map(([field, message]) => ({
          field: field as EnquiryField,
          message,
        })),
      );
      return;
    }
    showNotSaved(region);
  } catch {
    showNotSaved(region);
  } finally {
    pending = false;
    const button = query<HTMLButtonElement>('[data-submit]', region);
    if (button) button.removeAttribute('aria-disabled');
  }
}

function bind(region: HTMLElement): void {
  const form = need<HTMLFormElement>('[data-enquiry-form]', region);
  const description = need<HTMLTextAreaElement>('[data-field="description"]', region);
  const counter = need<HTMLElement>('[data-counter]', region);

  listen(description, 'input', () => {
    counter.textContent = descriptionCounter([...description.value].length);
  });

  listen(form, 'submit', (event) => {
    event.preventDefault();
    if (pending) return;
    const raw = readValues(region);
    const check = checkEnquiry({
      name: raw.name,
      email: raw.email,
      projectType: raw.projectType,
      budget: raw.budget,
      description: raw.description,
    });
    clearMessages(region);
    clearAlert(region);
    if (check.values === null) {
      showErrors(region, check.errors);
      return;
    }
    void send(region, check.values);
  });
}

export function initForm(root: ParentNode): void {
  const region = query<HTMLElement>('[data-form-region]', root);
  if (!region) return;
  if (template === null) template = region.innerHTML;
  if (query('[data-enquiry-form]', region)) bind(region);
}
