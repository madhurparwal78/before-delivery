import { api, el, isApiError, mountErrorSummary } from '../shell';
import type { Engagement } from './account';

export function mountStart(): void {
  const main = document.querySelector('main') as HTMLElement;
  main.innerHTML = '';
  main.id = 'main';
  const section = el('section', 'page-section');
  const heading = el('h1', 'display-2');
  heading.textContent = 'Start a project';
  section.appendChild(heading);
  const card = el('div', 'form-card');
  const form = el('form');
  form.setAttribute('aria-label', 'Start a project');
  form.noValidate = true;

  const fields: { name: string; label: string; type?: string }[] = [
    { name: 'brand_name', label: 'Brand name' },
    { name: 'contact_name', label: 'Your name' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'title', label: 'Project title' },
    { name: 'finance_email', label: 'Finance contact email', type: 'email' },
    { name: 'reviewer_email', label: 'Reviewer email', type: 'email' },
  ];
  for (const field of fields) {
    const wrap = el('div', 'field');
    wrap.setAttribute('data-for', field.name);
    const label = el('label');
    label.htmlFor = field.name;
    label.textContent = field.label;
    const input = el('input');
    input.type = field.type ?? 'text';
    input.id = field.name;
    input.name = field.name;
    input.setAttribute('data-field', field.name);
    if (field.name === 'finance_email' || field.name === 'reviewer_email') {
      input.placeholder = 'Optional';
    }
    const error = el('p', 'field-error');
    error.id = `${field.name}-error`;
    wrap.append(label, input, error);
    form.appendChild(wrap);
  }

  const currencyWrap = el('div', 'field');
  currencyWrap.setAttribute('data-for', 'currency');
  const currencyLabel = el('label');
  currencyLabel.textContent = 'Account currency';
  const currencyRow = el('div', 'radio-row');
  currencyRow.setAttribute('role', 'radiogroup');
  currencyRow.setAttribute('aria-label', 'Account currency');
  for (const code of ['EUR', 'GBP', 'USD', 'JPY']) {
    const pill = el('label', 'radio-pill');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'currency';
    radio.value = code;
    radio.id = `currency-${code}`;
    radio.setAttribute('data-field', 'currency');
    if (code === 'GBP') {
      radio.checked = true;
    }
    pill.append(radio, document.createTextNode(code));
    currencyRow.appendChild(pill);
  }
  currencyWrap.append(currencyLabel, currencyRow);
  form.appendChild(currencyWrap);

  const submit = el('button', 'button');
  submit.type = 'submit';
  submit.textContent = 'Start project';
  submit.dataset.pendingLabel = 'Starting';
  form.appendChild(submit);

  const summary = mountErrorSummary(form);
  card.appendChild(form);
  section.appendChild(card);
  main.appendChild(section);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    summary.hide();
    const body: Record<string, string> = {};
    for (const field of fields) {
      const input = form.querySelector(`#${field.name}`) as HTMLInputElement;
      body[field.name] = input.value.trim();
    }
    const currency = form.querySelector<HTMLInputElement>('input[name="currency"]:checked');
    body.currency = currency?.value ?? 'GBP';
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = submit.dataset.pendingLabel ?? 'Starting';
    const { status, json } = await api<{ engagement: Engagement }>('POST', '/api/projects/start', body);
    if (status === 201 && !isApiError(json)) {
      window.location.href = `/rig/${(json as { engagement: Engagement }).engagement.id}`;
      return;
    }
    submit.removeAttribute('aria-busy');
    submit.textContent = 'Start project';
    if (isApiError(json)) {
      if (json.fields && Object.keys(json.fields).length > 0) {
        summary.show(json.fields);
      } else {
        summary.show({ form: json.message });
      }
    }
  });
}
