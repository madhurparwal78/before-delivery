// Public site: home with the featured rail, work index with sector filter
// and view switch, case study pages and the three-step enquiry.

import { api, ApiError, refusalCopy } from './api.js';
import { announce, clear, h, reportProblem, showFieldErrors } from './ui.js';

interface CaseStudy {
  slug: string;
  title: string;
  sector: string;
  location: string;
  summary: string;
  coverUrl: string;
}

export function publicHeader(active: string): HTMLElement {
  const banner = h(
    'header',
    { class: 'public-header', 'data-tone': 'light' },
    h('a', { href: '/', class: 'brand brand-public', text: 'Marrow Hall' }),
    h(
      'nav',
      { 'aria-label': 'Main', class: 'public-nav' },
      h('a', { href: '/work', class: active === 'work' ? 'nav-link active' : 'nav-link', text: 'Work' }),
      rollingLabel(h('a', { href: '/start', class: 'nav-link', text: 'Start a project' })),
    ),
  );
  return banner;
}

function rollingLabel(link: HTMLElement): HTMLElement {
  link.setAttribute('data-rolling', 'true');
  const inner = document.createElement('span');
  inner.className = 'rolling-label';
  inner.setAttribute('aria-hidden', 'true');
  const text = link.textContent ?? '';
  inner.textContent = text;
  link.textContent = '';
  const visible = document.createElement('span');
  visible.textContent = text;
  link.append(visible, inner);
  return link;
}

export async function homeScreen(): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content' });
  document.title = 'Marrow Hall Interiors';
  const hero = h(
    'section',
    { class: 'public-section plaster', 'data-tone': 'light' },
    h('h1', { class: 'reveal-heading', text: 'Rollouts built store by store, signed off stage by stage.' }),
    rollingLabel(h('a', { href: '/work', class: 'button-primary', text: 'See the work' })),
  );
  const featured = await api('/api/public/featured');
  const studies = (featured.caseStudies ?? []) as CaseStudy[];
  const rail = h('section', { class: 'public-section rail-section', 'aria-label': 'Featured work', 'data-tone': 'light', role: 'region' });
  const railHeading = h('h2', { class: 'reveal-heading', text: 'Featured work' });
  const track = h('div', { class: 'rail-track' });
  for (const study of studies) {
    track.append(
      h('a', { href: `/work/${study.slug}`, class: 'rail-card' },
        h('img', { src: study.coverUrl, alt: `Procedural cover for ${study.title}`, class: 'rail-cover' }),
        h('span', { class: 'rail-title', text: study.title })),
    );
  }
  const previous = h('button', { class: 'button-quiet rail-nav', text: 'Previous', onclick: () => stepRail(-1) }) as unknown as HTMLButtonElement;
  const next = h('button', { class: 'button-quiet rail-nav', text: 'Next', onclick: () => stepRail(1) }) as unknown as HTMLButtonElement;
  function stepRail(direction: number): void {
    const card = track.querySelector('.rail-card') as HTMLElement | null;
    if (!card) return;
    const width = card.offsetWidth + 24;
    track.scrollBy({ left: width * direction, behavior: 'smooth' });
  }
  // Drag with inertia for mouse and touch.
  let dragLastX = 0;
  let dragging = false;
  let velocity = 0;
  let moved = 0;
  track.addEventListener('pointerdown', (event) => {
    dragLastX = event.clientX;
    moved = 0;
    dragging = true;
    velocity = 0;
  });
  track.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const delta = event.clientX - dragLastX;
    dragLastX = event.clientX;
    moved += Math.abs(delta);
    track.scrollLeft -= delta;
    velocity = delta;
  });
  window.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    if (moved > 6) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (Math.abs(velocity) > 0.5) {
      const card = track.querySelector('.rail-card') as HTMLElement | null;
      const width = card ? card.offsetWidth + 24 : 320;
      const direction = velocity > 0 ? 1 : -1;
      track.scrollBy({ left: width * direction, behavior: 'smooth' });
    }
  });
  rail.append(railHeading, track, h('div', { class: 'rail-nav-row' }, previous, next));
  const how = h(
    'section',
    { class: 'public-section dark', 'data-tone': 'dark' },
    h('h2', { class: 'reveal-heading', text: 'How we deliver' }),
    h('p', { text: 'One rollout, one workspace. Stage gates, the drawing register, sealed tenders, levelling and retention all live together.' }),
  );
  const cta = h(
    'section',
    { class: 'public-section plaster cta', 'data-tone': 'light' },
    rollingLabel(h('a', { href: '/start', class: 'button-primary', text: 'Start a project' })),
  );
  main.append(hero, rail, how, cta);
  return main;
}

export async function workScreen(): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'public-main' });
  document.title = 'Work · Marrow Hall Interiors';
  const params = new URLSearchParams(window.location.search);
  let sector = params.get('sector') ?? '';
  let view = params.get('view') ?? 'grid';
  const heading = h('h1', { class: 'reveal-heading', text: 'Work' });
  const sectorsBody = await api('/api/public/sectors');
  const total = Number(sectorsBody.total ?? 0);
  const sectors = (sectorsBody.sectors ?? []) as { key: string; label: string; count: number }[];
  const filterGroup = h('div', { class: 'sector-group', role: 'group', 'aria-label': 'Sector' });
  const buttons: Record<string, HTMLButtonElement> = {};
  const allButton = h('button', { class: 'sector-toggle', 'aria-pressed': sector === '' ? 'true' : 'false', text: `All (${total})` });
  allButton.addEventListener('click', () => {
    sector = '';
    update();
  });
  buttons[''] = allButton as HTMLButtonElement;
  filterGroup.append(allButton);
  for (const entry of sectors) {
    const button = h('button', { class: 'sector-toggle', 'aria-pressed': sector === entry.key ? 'true' : 'false', text: `${entry.label} (${entry.count})` });
    button.addEventListener('click', () => {
      sector = entry.key;
      update();
    });
    buttons[entry.key] = button as HTMLButtonElement;
    filterGroup.append(button);
  }
  const viewGroup = h('div', { class: 'view-group', role: 'radiogroup', 'aria-label': 'View' });
  const gridRadio = h('input', { type: 'radio', name: 'view', id: 'view-grid', value: 'grid' }) as HTMLInputElement;
  const listRadio = h('input', { type: 'radio', name: 'view', id: 'view-list', value: 'list' }) as HTMLInputElement;
  if (view === 'grid') gridRadio.setAttribute('checked', 'true');
  else listRadio.setAttribute('checked', 'true');
  gridRadio.addEventListener('change', () => {
    view = 'grid';
    update();
  });
  listRadio.addEventListener('change', () => {
    view = 'list';
    update();
  });
  viewGroup.append(
    h('div', { class: 'radio-row' }, gridRadio, h('label', { for: 'view-grid', text: 'Grid' })),
    h('div', { class: 'radio-row' }, listRadio, h('label', { for: 'view-list', text: 'List' })),
  );
  const list = h('ul', { class: view === 'grid' ? 'case-studies grid' : 'case-studies list', 'aria-label': 'Case studies' });

  function update(): void {
    const next = new URLSearchParams();
    if (sector) next.set('sector', sector);
    if (view !== 'grid') next.set('view', view);
    const query = next.toString();
    window.history.pushState({}, '', `/work${query ? `?${query}` : ''}`);
    for (const [key, button] of Object.entries(buttons)) {
      button.setAttribute('aria-pressed', key === sector ? 'true' : 'false');
    }
    if (view === 'grid') gridRadio.checked = true;
    else listRadio.checked = true;
    list.className = view === 'grid' ? 'case-studies grid' : 'case-studies list';
    void render();
  }

  async function render(): Promise<void> {
    clear(list);
    const body = await api(`/api/public/case-studies${sector ? `?sector=${sector}` : ''}`);
    const studies = (body.caseStudies ?? []) as CaseStudy[];
    for (const study of studies) {
      const item = h('li', { class: 'case-study-item' });
      const link = h('a', { href: `/work/${study.slug}`, text: study.title });
      item.append(
        view === 'grid' ? h('img', { src: study.coverUrl, alt: `Procedural cover for ${study.title}`, class: 'case-cover' }) : '',
        link,
        h('p', { class: 'small-caps', text: `${sectorLabel(study.sector)} · ${study.location}` }),
        h('p', { text: study.summary }),
      );
      list.append(item);
    }
  }

  main.append(h('section', { class: 'public-section plaster', 'data-tone': 'light' }, heading, filterGroup, viewGroup, list));
  await render();
  return main;
}

function sectorLabel(sector: string): string {
  return { retail: 'Retail', workplace: 'Workplace', food_beverage: 'Food & beverage' }[sector] ?? sector;
}

export async function caseStudyScreen(slug: string): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'public-main' });
  let caseStudy: Record<string, unknown>;
  try {
    const body = await api(`/api/public/case-studies/${slug}`);
    caseStudy = body.caseStudy as Record<string, unknown>;
  } catch {
    return notFoundMain();
  }
  document.title = `${String(caseStudy.title)} · Marrow Hall Interiors`;
  main.append(
    h('section', { class: 'public-section plaster case-study-hero', 'data-tone': 'light' },
      h('h1', { class: 'reveal-heading', text: String(caseStudy.title) }),
      h('img', { src: String(caseStudy.coverUrl), alt: `Procedural cover for ${String(caseStudy.title)}`, class: 'case-cover' }),
      h('p', { class: 'small-caps', text: `${sectorLabel(String(caseStudy.sector))} · ${String(caseStudy.location)}` }),
      h('p', { text: String(caseStudy.summary) })),
    h('section', { class: 'public-section dark', 'data-tone': 'dark' },
      h('h2', { class: 'reveal-heading', text: 'The rollout' }),
      h('p', { text: String(caseStudy.body) })),
    h('section', { class: 'public-section plaster cta', 'data-tone': 'light' },
      rollingLabel(h('a', { href: '/start', class: 'button-primary', text: 'Start a project' }))),
  );
  return main;
}

export function notFoundMain(): HTMLElement {
  document.title = 'Page not found · Marrow Hall Interiors';
  return h(
    'main',
    { id: 'main-content', class: 'public-main' },
    h('section', { class: 'public-section plaster', 'data-tone': 'light' },
      h('h1', { class: 'reveal-heading', text: "We couldn't find that. It may have been removed, or you may not have access." }),
      h('p', {}, h('a', { href: '/', text: 'Back to the Marrow Hall home page' }))),
  );
}

// ---------- Enquiry ----------

export async function enquiryScreen(): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'public-main' });
  document.title = 'Start a project · Marrow Hall Interiors';
  const params = new URLSearchParams(window.location.search);
  let step = parseInt(params.get('step') ?? '1', 10);
  if (Number.isNaN(step) || step < 1 || step > 3) step = 1;
  const draft = loadDraft();
  const form = h('form', { 'aria-label': 'Start a project', 'data-error-summary': true });
  form.setAttribute('role', 'form');
  const errorSummary = h('div', { class: 'error-summary', 'data-error-summary': true, role: 'alert' });
  const head = h('h1', { class: 'reveal-heading' });
  const backButton = h('button', { type: 'button', class: 'button-quiet', text: 'Back' });
  const nextButton = h('button', { type: 'button', class: 'button-primary', text: 'Next' });
  const submit = h('button', { type: 'submit', class: 'button-primary' });

  function loadDraft(): Record<string, string> {
    const raw = sessionStorage.getItem('plumbline:enquiry-draft');
    return raw ? JSON.parse(raw) : {};
  }

  function saveDraft(): void {
    const values = collect();
    sessionStorage.setItem('plumbline:enquiry-draft', JSON.stringify(values));
  }

  function collect(): Record<string, string> {
    const result: Record<string, string> = { ...draft };
    form.querySelectorAll<HTMLInputElement>('input, select, textarea').forEach((control) => {
      if (control.name) result[control.name] = control.value;
    });
    return result;
  }

  function restore(values: Record<string, string>): void {
    for (const [name, value] of Object.entries(values)) {
      const control = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (control) control.value = value;
    }
  }

  function setStep(next: number, push: boolean): void {
    step = next;
    if (push) {
      window.history.pushState({}, '', `/start?step=${step}`);
    }
    saveDraft();
    render();
  }

  function render(): void {
    clear(form);
    const headings: Record<number, string> = {
      1: 'Step 1 of 3: About you',
      2: 'Step 2 of 3: The rollout',
      3: 'Step 3 of 3: Your message',
    };
    head.textContent = headings[step];
    form.append(errorSummary, head);
    const fields = stepFields();
    form.append(fields);
    const actions = h('div', { class: 'form-actions enquiry-actions' });
    if (step > 1) {
      backButton.textContent = 'Back';
      actions.append(backButton);
    }
    if (step < 3) {
      nextButton.textContent = 'Next';
      actions.append(nextButton);
    } else {
      submit.textContent = 'Send enquiry';
      actions.append(submit);
    }
    form.append(actions);
    restore(draft);
  }

  function stepFields(): HTMLElement {
    const wrap = h('div', { class: 'enquiry-step' });
    const text = (name: string, label: string, type = 'text', required = true) => {
      const input = h('input', { type, class: 'input', name, id: `field-${name}` }) as HTMLInputElement;
      wrap.append(h('div', { class: 'field' }, h('label', { for: input.id, text: label }), input));
      return input;
    };
    if (step === 1) {
      text('name', 'Your name');
      text('company', 'Company');
      text('email', 'Email', 'email');
      text('phone', 'Phone (optional)', 'tel', false);
    } else if (step === 2) {
      const sector = h('select', { class: 'input', name: 'sector', id: 'field-sector' }) as HTMLSelectElement;
      for (const [value, label] of [['retail', 'Retail'], ['workplace', 'Workplace'], ['food_beverage', 'Food & beverage']]) {
        sector.append(h('option', { value, text: label }));
      }
      wrap.append(h('div', { class: 'field' }, h('label', { for: 'field-sector', text: 'Sector' }), sector));
      const region = h('select', { class: 'input', name: 'region', id: 'field-region' }) as HTMLSelectElement;
      for (const [value, label] of [['HK', 'Hong Kong'], ['SG', 'Singapore'], ['MO', 'Macao']]) {
        region.append(h('option', { value, text: label }));
      }
      wrap.append(h('div', { class: 'field' }, h('label', { for: 'field-region', text: 'Region' }), region));
      const sites = h('input', { type: 'number', class: 'input', name: 'sites', id: 'field-sites', min: '1', max: '200' }) as HTMLInputElement;
      sites.setAttribute('aria-label', 'Number of sites');
      wrap.append(h('div', { class: 'field' }, h('label', { for: 'field-sites', text: 'Number of sites' }), sites));
      const month = h('input', { type: 'month', class: 'input', name: 'openingMonth', id: 'field-openingMonth' }) as HTMLInputElement;
      month.setAttribute('aria-label', 'Target opening month');
      wrap.append(h('div', { class: 'field' }, h('label', { for: 'field-openingMonth', text: 'Target opening month' }), month));
    } else {
      const message = h('textarea', { class: 'input', name: 'message', id: 'field-message', rows: '5' }) as HTMLTextAreaElement;
      wrap.append(h('div', { class: 'field' }, h('label', { for: 'field-message', text: 'Tell us about the rollout' }), message));
    }
    return wrap;
  }

  async function validateStep(): Promise<boolean> {
    clear(errorSummary);
    const values = collect();
    if (step === 1) {
      if (!values.name) {
        showFieldErrors(form, { name: 'Your name is required.' });
        return false;
      }
      if (!values.email) {
        showFieldErrors(form, { email: 'Email is required.' });
        return false;
      }
    }
    if (step === 2) {
      if (!values.sector) {
        showFieldErrors(form, { sector: 'Sector is required.' });
        return false;
      }
      if (!values.region) {
        showFieldErrors(form, { region: 'Region is required.' });
        return false;
      }
      if (!values.sites) {
        showFieldErrors(form, { sites: 'Number of sites is required.' });
        return false;
      }
      if (!values.openingMonth) {
        showFieldErrors(form, { openingMonth: 'Target opening month is required.' });
        return false;
      }
    }
    if (step === 3 && !values.message) {
      showFieldErrors(form, { message: 'Tell us about the rollout is required.' });
      return false;
    }
    return true;
  }

  backButton.addEventListener('click', () => setStep(Math.max(1, step - 1), true));
  nextButton.addEventListener('click', async () => {
    if (await validateStep()) {
      setStep(Math.min(3, step + 1), true);
    }
  });
  form.addEventListener('submit', async (event: Event) => {
    event.preventDefault();
    if (!(await validateStep())) return;
    const values = collect();
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const result = await api('/api/enquiries', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          company: values.company,
          email: values.email,
          phone: values.phone || undefined,
          sector: values.sector,
          region: values.region,
          sites: parseInt(values.sites ?? '0', 10),
          openingMonth: values.openingMonth,
          message: values.message,
        }),
      });
      const enquiry = result.enquiry as { reference: string };
      sessionStorage.removeItem('plumbline:enquiry-draft');
      clear(form);
      const successHeading = h('h1', { class: 'reveal-heading', tabindex: '-1', text: `Thanks, ${values.name}. Your enquiry ${enquiry.reference} is with our studio.` });
      form.append(successHeading);
      successHeading.focus();
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Send enquiry';
      if (error instanceof ApiError) {
        if (error.status === 422) {
          showFieldErrors(form, (error.body.errors ?? {}) as Record<string, string>);
          return;
        }
        reportProblem(refusalCopy(error, { email: values.email }));
      }
    }
  });
  form.addEventListener('input', saveDraft);
  window.addEventListener('beforeunload', saveDraft);

  main.append(h('section', { class: 'public-section plaster', 'data-tone': 'light' }, form));
  if (!params.get('step')) {
    window.history.replaceState({}, '', '/start?step=1');
  }
  render();
  return main;
}

export { announce };
