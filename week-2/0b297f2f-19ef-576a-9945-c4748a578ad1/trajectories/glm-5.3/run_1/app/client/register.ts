import { api, isApiError, errorBody, getStaffId, getUnit } from './api.js';
import type { ObjectRecord, Staff, Lender } from './types.js';
import { formatLength, formatLux, formatLuxHours, objectStatusText, photoCountText } from './types.js';
import { el, banner, skipLink } from './ui.js';
import { navigateTo, requestHeadingFocus } from './navigation.js';
import { renderStaffHeader, fetchStaff } from './header.js';

interface RegisterQuery {
  q: string;
  lender: string;
  sort: 'number' | 'title' | 'lender' | 'lux';
  dir: 'asc' | 'desc';
}

const DEFAULTS: RegisterQuery = { q: '', lender: '', sort: 'number', dir: 'asc' };

function queryFromUrl(): RegisterQuery {
  const params = new URL(window.location.href).searchParams;
  const sort = params.get('sort');
  const dir = params.get('dir');
  return {
    q: params.get('q') ?? '',
    lender: params.get('lender') ?? '',
    sort: sort === 'title' || sort === 'lender' || sort === 'lux' ? sort : 'number',
    dir: dir === 'desc' ? 'desc' : 'asc',
  };
}

function urlForQuery(query: RegisterQuery, push: boolean): string {
  const params = new URLSearchParams();
  if (query.q !== '') params.set('q', query.q);
  if (query.lender !== '') params.set('lender', query.lender);
  if (query.sort !== 'number') params.set('sort', query.sort);
  if (query.dir !== 'asc') params.set('dir', query.dir);
  const search = params.toString();
  const url = search === '' ? '/records' : `/records?${search}`;
  if (push) window.history.pushState({}, '', url);
  else window.history.replaceState({}, '', url);
  return url;
}

export class LoanRegister {
  private staffList: Staff[] = [];
  private staffId = getStaffId();
  private unit = getUnit();
  private lenders: Lender[] = [];
  private query: RegisterQuery = queryFromUrl();
  private results: ObjectRecord[] = [];
  private dbDown = false;
  private announcementText = '';
  private searchToken = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSearch = 0;

  constructor(private root: HTMLElement) {}

  async start(): Promise<void> {
    this.staffList = await fetchStaff();
    const exhibition = await api<{ lenders: Lender[] }>('GET', '/api/exhibition', undefined, { staffId: this.staffId });
    if (!isApiError(exhibition)) {
      this.lenders = (exhibition.body as { lenders: Lender[] }).lenders;
    }
    await this.load();
    this.render();
    window.addEventListener('popstate', () => {
      this.query = queryFromUrl();
      void this.load();
      this.render();
    });
    setInterval(() => { void this.checkStatus(); }, 5000);
  }

  private async checkStatus(): Promise<void> {
    const status = await api<{ services: { database: string } }>('GET', '/api/status');
    if (!isApiError(status)) {
      const down = (status.body as { services: { database: string } }).services.database === 'down';
      if (down !== this.dbDown) {
        this.dbDown = down;
        this.render();
      }
    }
  }

  private async load(): Promise<void> {
    const token = ++this.searchToken;
    const search = new URLSearchParams();
    if (this.query.q !== '') search.set('q', this.query.q);
    if (this.query.lender !== '') search.set('lender', this.query.lender);
    search.set('sort', this.query.sort);
    search.set('dir', this.query.dir);
    const result = await api<{ objects: ObjectRecord[] }>(
      'GET', `/api/objects?${search.toString()}`, undefined, { staffId: this.staffId }
    );
    // Only the latest query's response is ever shown.
    if (token !== this.searchToken) return;
    if (isApiError(result)) {
      this.results = [];
      return;
    }
    this.results = (result.body as { objects: ObjectRecord[] }).objects;
  }

  render(): void {
    this.staffId = getStaffId();
    this.unit = getUnit();
    const page = el('div', {});
    page.append(skipLink());
    const banners = el('div', { class: 'banner-stack' });
    if (this.dbDown) banners.append(banner('database'));
    page.append(banners);

    page.append(renderStaffHeader({
      currentPath: '/records',
      staffList: this.staffList,
      staffId: this.staffId,
      unit: this.unit,
      onStaffChange: () => this.render(),
      onUnitChange: () => this.render(),
    }));

    const main = el('main', { id: 'main', class: 'register-main', tabindex: '-1' });
    main.append(el('h1', { class: 'register-heading', text: 'Loan register' }));

    const controls = el('div', { class: 'register-controls' });
    const search = el('input', {
      type: 'search', 'aria-label': 'Search records', value: this.query.q,
      placeholder: 'Search records',
    }) as HTMLInputElement;
    search.addEventListener('input', () => {
      this.query.q = search.value;
      urlForQuery(this.query, false);
      if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
      const token = ++this.pendingSearch;
      this.debounceTimer = setTimeout(async () => {
        await this.load();
        if (token === this.pendingSearch) this.rerenderList();
      }, 300);
    });
    controls.append(search);

    const lenderSelect = el('select', { 'aria-label': 'Lender filter' }) as HTMLSelectElement;
    lenderSelect.append(el('option', { value: '', text: 'All lenders' }));
    lenderSelect.append(el('option', { value: 'collection', text: 'Ashgrove collection' }));
    for (const lender of this.lenders) {
      const option = el('option', { value: lender.id, text: lender.name });
      if (lender.id === this.query.lender) option.setAttribute('selected', 'selected');
      lenderSelect.append(option);
    }
    lenderSelect.addEventListener('change', () => {
      this.query.lender = lenderSelect.value;
      urlForQuery(this.query, true);
      void this.load().then(() => this.rerenderList());
    });
    controls.append(lenderSelect);

    const sortSelect = el('select', { 'aria-label': 'Sort by' }) as HTMLSelectElement;
    for (const [value, label] of [
      ['number', 'Object number'], ['title', 'Title'], ['lender', 'Lender'], ['lux', 'Lux limit'],
    ] as [RegisterQuery['sort'], string][]) {
      const option = el('option', { value, text: label });
      if (value === this.query.sort) option.setAttribute('selected', 'selected');
      sortSelect.append(option);
    }
    sortSelect.addEventListener('change', () => {
      this.query.sort = sortSelect.value as RegisterQuery['sort'];
      urlForQuery(this.query, true);
      void this.load().then(() => this.rerenderList());
    });
    controls.append(sortSelect);

    const order = el('div', { role: 'radiogroup', 'aria-label': 'Order' });
    for (const [value, label] of [['asc', 'Ascending'], ['desc', 'Descending']] as const) {
      const radio = el('input', { type: 'radio', name: 'order', id: `order-${value}`, value }) as HTMLInputElement;
      radio.addEventListener('change', () => {
        this.query.dir = value;
        urlForQuery(this.query, true);
        void this.load().then(() => this.rerenderList());
      });
      if (this.query.dir === value) radio.setAttribute('checked', 'checked');
      order.append(radio, el('label', { for: `order-${value}`, text: label }));
    }
    controls.append(order);

    const role = this.staffList.find((s) => s.id === this.staffId)?.role;
    if (role === 'registrar') {
      const addButton = el('button', { class: 'primary', text: 'Add object' });
      addButton.addEventListener('click', () => this.openAddDialog());
      controls.append(addButton);
    }
    main.append(controls);

    const count = el('p', { class: 'records-count', role: 'status', 'aria-label': 'Records count', 'data-register-count': 'true' });
    main.append(count);
    const list = el('div', { 'data-register-list': 'true' });
    main.append(list);

    main.append(
      el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-label': 'Announcements', 'data-region': 'announcements', text: this.announcementText }),
    );
    page.append(main);
    this.root.replaceChildren(page);
    this.rerenderList();
  }

  private rerenderList(): void {
    const count = this.root.querySelector('[data-register-count]');
    const list = this.root.querySelector('[data-register-list]');
    if (count === null || list === null) return;
    count.textContent = this.results.length === 1 ? '1 record' : `${this.results.length} records`;
    list.replaceChildren(this.renderRecords());
  }

  private renderRecords(): HTMLElement {
    if (this.results.length === 0) {
      return el('p', { class: 'no-matches', text: 'No records match.' });
    }
    if (window.innerWidth >= 1024) {
      const table = el('table', { class: 'register', 'aria-label': 'Loan register' });
      const head = el('thead', {});
      const row = el('tr', {});
      for (const column of ['Object number', 'Title', 'Lender', 'Dimensions', 'Lux limit', 'Lux-hour budget', 'Insurance value', 'Condition', 'Placement']) {
        row.append(el('th', { scope: 'col', text: column }));
      }
      head.append(row);
      table.append(head);
      const body = el('tbody', {});
      for (const o of this.results) {
        const tr = el('tr', {});
        tr.append(
          el('td', { text: o.objectNumber }),
          el('td', {}, el('a', { href: `/records/${o.id}`, text: o.title })),
          el('td', { text: o.lenderName ?? 'Ashgrove collection' }),
          el('td', { class: 'num', text: `${formatLength(o.widthMm, this.unit)} × ${formatLength(o.heightMm, this.unit)}` }),
          el('td', { class: 'num', text: `${formatLux(o.luxLimit)} lux` }),
          el('td', { class: 'num', text: formatLuxHours(o.luxHourBudget) }),
          el('td', { class: 'num', text: `£${o.insuranceValueGbp.toLocaleString('en-GB')}` }),
          el('td', { text: photoCountText(o.photos.length) }),
          el('td', { text: objectStatusText(o) }),
        );
        body.append(tr);
      }
      table.append(body);
      return table;
    }
    const list = el('ul', { class: 'register-cards', 'aria-label': 'Loan register' });
    for (const o of this.results) {
      const li = el('li', {});
      const card = el('article', { class: 'register-card' });
      card.append(el('h3', {}, el('a', { href: `/records/${o.id}`, text: o.title })));
      const dl = el('dl', {});
      const add = (label: string, value: string): void => {
        dl.append(el('dt', { text: label }), el('dd', { class: 'num', text: value }));
      };
      add('Object number', o.objectNumber);
      add('Lender', o.lenderName ?? 'Ashgrove collection');
      add('Dimensions', `${formatLength(o.widthMm, this.unit)} × ${formatLength(o.heightMm, this.unit)}`);
      add('Lux limit', `${formatLux(o.luxLimit)} lux`);
      add('Lux-hour budget', formatLuxHours(o.luxHourBudget));
      add('Insurance value', `£${o.insuranceValueGbp.toLocaleString('en-GB')}`);
      add('Condition', photoCountText(o.photos.length));
      add('Placement', objectStatusText(o));
      card.append(dl);
      li.append(card);
      list.append(li);
    }
    return list;
  }

  private announce(message: string): void {
    this.announcementText = message;
    const region = this.root.querySelector('[data-region="announcements"]');
    if (region !== null) region.textContent = message;
  }

  private openAddDialog(): void {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Add object');
    const body = el('div', { class: 'dialog-body' });
    body.append(el('h2', { text: 'Add object' }));
    const summary = el('div', { class: 'error-summary', role: 'alert', tabindex: '-1', hidden: 'hidden' });
    summary.append(el('p', { text: 'Fix these to continue:' }), el('ul', {}));

    const fields: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    const makeInput = (label: string, key: string, type = 'text'): HTMLElement => {
      const input = el('input', { type, 'aria-label': label }) as HTMLInputElement;
      fields[key] = input;
      const wrap = el('div', { class: 'field' });
      wrap.append(el('label', { text: label }), input);
      if (key === 'width' || key === 'height') {
        wrap.append(el('span', { class: 'unit-suffix', text: this.unit === 'cm' ? 'cm' : 'in' }));
      }
      return wrap;
    };
    const form = el('form', {});
    form.append(summary);
    form.append(
      makeInput('Title', 'title'),
      makeInput('Object number', 'objectNumber'),
    );
    const lenderSelect = el('select', { 'aria-label': 'Lender' }) as HTMLSelectElement;
    lenderSelect.append(el('option', { value: '', text: 'Ashgrove collection' }));
    for (const lender of this.lenders) {
      lenderSelect.append(el('option', { value: lender.id, text: lender.name }));
    }
    fields['lenderId'] = lenderSelect;
    const lenderField = el('div', { class: 'field' });
    lenderField.append(el('label', { text: 'Lender' }), lenderSelect);
    form.append(
      lenderField,
      makeInput('Medium', 'medium'),
      makeInput('Width', 'width'),
      makeInput('Height', 'height'),
      makeInput('Lux limit', 'luxLimit', 'number'),
      makeInput('Lux-hour budget', 'luxHourBudget', 'number'),
      makeInput('Insurance value', 'insuranceValueGbp', 'number'),
      makeInput('Registrar note', 'registrarNote'),
    );
    const actions = el('div', { class: 'dialog-actions' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    cancel.addEventListener('click', () => dialog.close());
    const save = el('button', { class: 'primary', type: 'submit', text: 'Save object' });
    actions.append(cancel, save);
    form.append(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        title: fields['title']!.value,
        objectNumber: fields['objectNumber']!.value,
        lenderId: fields['lenderId']!.value === '' ? null : fields['lenderId']!.value,
        medium: fields['medium']!.value,
        width: Number(fields['width']!.value),
        height: Number(fields['height']!.value),
        unit: this.unit,
        luxLimit: Number(fields['luxLimit']!.value),
        luxHourBudget: Number(fields['luxHourBudget']!.value),
        insuranceValueGbp: Number(fields['insuranceValueGbp']!.value),
        registrarNote: fields['registrarNote']!.value,
      };
      const result = await api<{ object: ObjectRecord; seq: number }>(
        'POST', '/api/objects', payload, { staffId: this.staffId }
      );
      if (isApiError(result)) {
        const body = errorBody(result);
        const fieldErrors = body.error.fields ?? {};
        summary.innerHTML = '';
        summary.append(el('p', { text: 'Fix these to continue:' }));
        const list = el('ul', {});
        for (const [key, message] of Object.entries(fieldErrors)) {
          const target = fields[key];
          const link = el('a', { href: '#', text: message });
          link.addEventListener('click', (ev) => {
            ev.preventDefault();
            target?.focus();
          });
          list.append(el('li', {}, link));
        }
        summary.append(list);
        summary.removeAttribute('hidden');
        summary.focus();
        return;
      }
      const object = (result.body as { object: ObjectRecord }).object;
      dialog.close();
      this.announce(`${object.title} saved.`);
      requestHeadingFocus();
      navigateTo(`/records/${object.id}`);
    });

    body.append(form);
    dialog.append(body);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
    (fields['title'] as HTMLElement).focus();
  }
}

export function mountLoanRegister(root: HTMLElement): void {
  const register = new LoanRegister(root);
  void register.start();
}
