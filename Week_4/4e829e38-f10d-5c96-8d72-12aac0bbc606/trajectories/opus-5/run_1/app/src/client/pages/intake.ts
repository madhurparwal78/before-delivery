import { api, ApiCallError } from '../api.js';
import { el, on } from '../dom.js';
import { errorSummary, labelledField } from '../forms.js';

const EMAIL_MESSAGE = 'Enter an email address like name@example.com';

export async function renderIntake(main: HTMLElement, slug: string): Promise<void> {
  main.className = 'page page--intake';
  let form: { title: string; categories: string[] };
  try {
    form = await api.get<{ title: string; categories: string[] }>(`/api/forms/${slug}`);
  } catch {
    main.append(
      el('h1', { class: 'page__title' }, 'Form not found'),
      el('p', { class: 'empty__sentence' }, 'That request form is not available.'),
    );
    return;
  }

  const title = labelledField({ name: 'Request title' });
  const details = labelledField({ name: 'Details', kind: 'textarea' });
  const neededBy = labelledField({ name: 'Needed by', kind: 'date' });
  const email = labelledField({ name: 'Your email', kind: 'email' });
  const category = labelledField({
    name: 'Category',
    kind: 'select',
    options: ['', ...form.categories],
  });
  const submit = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Submit request');
  const summaryHost = el('div', { class: 'summary-host' });
  const result = el('p', { class: 'intake__result', role: 'status', 'aria-live': 'polite' });

  const fields = { title, details, neededBy, email, category };

  const showErrors = (errors: Record<string, string>) => {
    for (const field of Object.values(fields)) field.setError(null);
    const entries: { message: string; target: HTMLElement }[] = [];
    for (const key of ['title', 'neededBy', 'email', 'category'] as const) {
      const message = errors[key];
      if (!message) continue;
      fields[key].setError(message);
      entries.push({ message, target: fields[key].input as HTMLElement });
    }
    summaryHost.replaceChildren();
    if (entries.length === 0) return;
    const summary = errorSummary(entries);
    summaryHost.appendChild(summary);
    summary.focus();
  };

  const page = el('form', { class: 'stack intake' }, [
    el('h1', { class: 'page__title' }, form.title),
    summaryHost,
    title.wrap,
    details.wrap,
    neededBy.wrap,
    email.wrap,
    category.wrap,
    submit,
    result,
  ]) as HTMLFormElement;

  on(page, 'submit', (event) => {
    event.preventDefault();
    if (submit.getAttribute('aria-busy') === 'true') return;
    const titleValue = (title.input as HTMLInputElement).value.trim();
    const neededByValue = (neededBy.input as HTMLInputElement).value.trim();
    const emailValue = (email.input as HTMLInputElement).value.trim();
    const categoryValue = (category.input as HTMLSelectElement).value;

    const errors: Record<string, string> = {};
    if (titleValue === '') errors.title = 'Enter a request title';
    else if (titleValue.length > 120) {
      errors.title = 'Request title must be 120 characters or fewer';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(neededByValue)) errors.neededBy = 'Enter a date today or later';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) errors.email = EMAIL_MESSAGE;
    if (categoryValue !== '' && !form.categories.includes(categoryValue)) {
      errors.category = 'Choose a category from the list';
    }
    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }

    submit.setAttribute('aria-busy', 'true');
    void api
      .post<{ reference: string; taskId: string }>(`/api/forms/${slug}/submissions`, {
        title: titleValue,
        details: (details.input as HTMLTextAreaElement).value,
        neededBy: neededByValue,
        email: emailValue,
        category: categoryValue === '' ? undefined : categoryValue,
      })
      .then((response) => {
        showErrors({});
        result.textContent = `Request received. Your reference is ${response.reference}.`;
      })
      .catch((err) => {
        if (err instanceof ApiCallError && err.failure.errors) showErrors(err.failure.errors);
      })
      .finally(() => submit.removeAttribute('aria-busy'));
  });

  main.appendChild(page);
}
