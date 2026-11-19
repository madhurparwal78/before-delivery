import { h, clear, api, announce, openDialog } from './dom';
import { subscribeLive } from './live';

export async function renderForm(root: HTMLElement): Promise<void> {
  const slug = window.location.pathname.split('/').filter(Boolean)[1] ?? '';
  const meta = await api<{ title: string; categories: string[] }>('GET', `/api/forms/${slug}`);
  if (meta.status === 404) {
    clear(root);
    root.append(h('main', { class: 'empty', style: 'margin:60px auto;max-width:560px' }, h('h1', {}, 'Form not found')));
    return;
  }

  clear(root);
  const page = h('main', { class: 'formpage' });
  page.append(h('h1', {}, meta.data.title));
  const summary = h('div', { class: 'errorsummary', hidden: true, role: 'alert', tabindex: '-1' });

  const mkInput = (label: string, type: string, id: string): HTMLInputElement => {
    const input = h('input', { type, id, 'aria-describedby': `${id}-err` }) as HTMLInputElement;
    input.setAttribute('aria-label', label);
    input.style.minHeight = '44px'; input.style.border = '1.5px solid var(--line-2)'; input.style.borderRadius = '12px'; input.style.padding = '8px 12px';
    return input;
  };
  const title = mkInput('Request title', 'text', 'f-title');
  const details = h('textarea', { id: 'f-details', 'aria-label': 'Details' }) as HTMLTextAreaElement;
  details.style.minHeight = '88px'; details.style.border = '1.5px solid var(--line-2)'; details.style.borderRadius = '12px'; details.style.padding = '8px 12px';
  const needed = mkInput('Needed by', 'date', 'f-needed');
  const email = mkInput('Your email', 'email', 'f-email');
  const category = h('select', { id: 'f-category', 'aria-label': 'Category' }) as HTMLSelectElement;
  category.append(h('option', { value: '' }, 'Choose a category'));
  for (const c of meta.data.categories ?? []) category.append(h('option', { value: c }, c));
  category.style.minHeight = '44px'; category.style.borderRadius = '12px'; category.style.border = '1.5px solid var(--line-2)'; category.style.padding = '8px 12px';

  const errs: Record<string, HTMLElement> = {
    title: h('div', { id: 'f-title-err', class: 'err' }),
    neededBy: h('div', { id: 'f-needed-err', class: 'err' }),
    email: h('div', { id: 'f-email-err', class: 'err' }),
    category: h('div', { id: 'f-category-err', class: 'err' }),
  };

  const submit = h('button', {
    class: 'pill primary', onclick: async () => {
      for (const k of Object.keys(errs)) errs[k].textContent = '';
      summary.hidden = true;
      const body: Record<string, string> = {
        title: title.value.trim(),
        neededBy: needed.value,
        email: email.value.trim(),
      };
      if (details.value.trim()) body.details = details.value.trim();
      if (category.value) body.category = category.value;
      const r = await api<{ reference: string; taskId: string }>('POST', `/api/forms/${slug}/submissions`, body);
      if (r.status === 422 && r.data.errors) {
        const e = r.data.errors;
        const links: { field: keyof typeof errs; msg: string }[] = [];
        if (e.title) { errs.title.textContent = e.title; links.push({ field: 'title', msg: e.title }); }
        if (e.neededBy) { errs.neededBy.textContent = e.neededBy; links.push({ field: 'neededBy', msg: e.neededBy }); }
        if (e.email) { errs.email.textContent = e.email; links.push({ field: 'email', msg: e.email }); }
        if (e.category) { errs.category.textContent = e.category; links.push({ field: 'category', msg: e.category }); }
        clear(summary);
        summary.append(h('h2', {}, 'There is a problem'));
        for (const l of links) {
          const a = h('a', { href: '#', onclick: (ev: Event) => { ev.preventDefault(); focusField(l.field); } }, l.msg);
          summary.append(a);
        }
        summary.hidden = false;
        summary.focus();
        return;
      }
      if (r.ok) {
        const ref = r.data.reference;
        clear(page);
        page.append(h('h1', {}, 'Request received'),
          h('p', {}, `Request received. Your reference is ${ref}.`));
      }
    },
  }, 'Submit request');

  const fieldRow = (labelText: string, input: HTMLElement, errKey: keyof typeof errs): HTMLElement => {
    const id = input.id;
    return h('div', { class: 'field' }, h('label', { for: id }, labelText), input, errs[errKey]);
  };

  page.append(summary,
    fieldRow('Request title', title, 'title'),
    fieldRow('Details', details, 'category'),
    fieldRow('Needed by', needed, 'neededBy'),
    fieldRow('Your email', email, 'email'),
    fieldRow('Category', category, 'category'),
    submit);
  root.append(page);

  const focusField = (key: keyof typeof errs): void => {
    const map: Record<keyof typeof errs, HTMLElement> = { title, neededBy: needed, email, category };
    map[key].focus();
  };
  void openDialog;
  void announce;
  void subscribeLive;
}
