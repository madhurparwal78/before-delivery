import { api, isApiError, errorBody, getStaffId, getUnit } from './api.js';
import type { ObjectRecord, Staff, Lender } from './types.js';
import { formatLength, formatLux, formatLuxHours, objectStatusText, photoCountText } from './types.js';
import { el, banner, skipLink } from './ui.js';
import { consumeHeadingFocus } from './navigation.js';
import { renderStaffHeader, fetchStaff } from './header.js';

export class RecordPage {
  private staffList: Staff[] = [];
  private staffId = getStaffId();
  private unit = getUnit();
  private lenders: Lender[] = [];
  private dbDown = false;
  private announcementText = '';

  constructor(private root: HTMLElement, private objectId: string) {}

  async start(): Promise<void> {
    this.staffList = await fetchStaff();
    const exhibition = await api<{ lenders: Lender[] }>('GET', '/api/exhibition', undefined, { staffId: this.staffId });
    if (!isApiError(exhibition)) {
      this.lenders = (exhibition.body as { lenders: Lender[] }).lenders;
    }
    await this.render();
    setInterval(() => { void this.checkStatus(); }, 5000);
  }

  private async checkStatus(): Promise<void> {
    const status = await api<{ services: { database: string } }>('GET', '/api/status');
    if (!isApiError(status)) {
      const down = (status.body as { services: { database: string } }).services.database === 'down';
      if (down !== this.dbDown) {
        this.dbDown = down;
        await this.render();
      }
    }
  }

  async render(): Promise<void> {
    this.staffId = getStaffId();
    this.unit = getUnit();
    const result = await api<{ object: ObjectRecord }>('GET', `/api/objects/${this.objectId}`, undefined, { staffId: this.staffId });
    const page = el('div', {});
    page.append(skipLink());
    const banners = el('div', { class: 'banner-stack' });
    if (this.dbDown) banners.append(banner('database'));
    page.append(banners);

    page.append(renderStaffHeader({
      currentPath: `/records/${this.objectId}`,
      staffList: this.staffList,
      staffId: this.staffId,
      unit: this.unit,
      onStaffChange: () => { void this.render(); },
      onUnitChange: () => { void this.render(); },
    }));

    const main = el('main', { id: 'main', class: 'record-main', tabindex: '-1' });
    if (isApiError(result) && errorBody(result).error.code === 'not_found') {
      main.append(el('h1', { class: 'not-found-heading', text: `That record doesn't exist.` }));
      page.append(main);
      this.root.replaceChildren(page);
      main.focus();
      return;
    }
    if (isApiError(result)) {
      main.append(el('h1', { class: 'not-found-heading', text: `That record doesn't exist.` }));
      page.append(main);
      this.root.replaceChildren(page);
      main.focus();
      return;
    }
    const object = (result.body as { object: ObjectRecord }).object;
    const heading = el('h1', { class: 'record-heading', text: object.title, tabindex: '-1' });
    main.append(heading);
    const focusHeading = consumeHeadingFocus();

    const grid = el('div', { class: 'record-grid' });
    const dl = el('dl', {});
    const add = (label: string, value: string): void => {
      dl.append(el('dt', { text: label }), el('dd', { class: 'num', text: value }));
    };
    add('Object number', object.objectNumber);
    add('Lender', object.lenderName ?? 'Ashgrove collection');
    add('Medium', object.medium);
    add('Dimensions', `${formatLength(object.widthMm, this.unit)} × ${formatLength(object.heightMm, this.unit)}`);
    add('Lux limit', `${formatLux(object.luxLimit)} lux`);
    add('Lux-hour budget', formatLuxHours(object.luxHourBudget));
    add('Insurance value', `£${object.insuranceValueGbp.toLocaleString('en-GB')}`);
    add('Registrar note', object.registrarNote === '' ? '—' : object.registrarNote);
    add('Condition photos', photoCountText(object.photos.length));
    add('Placement', objectStatusText(object));
    grid.append(dl);
    main.append(grid);

    const role = this.staffList.find((s) => s.id === this.staffId)?.role;
    if (role === 'registrar') {
      const editButton = el('button', { text: 'Edit record' });
      editButton.addEventListener('click', () => this.openEditDialog(object));
      main.append(editButton);
    }
    main.append(el('p', {}, el('a', { href: '/records', text: 'Back to the Loan register' })));

    main.append(
      el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-label': 'Announcements', 'data-region': 'announcements', text: this.announcementText }),
    );
    page.append(main);
    this.root.replaceChildren(page);
    if (focusHeading) heading.focus();
  }

  private announce(message: string): void {
    this.announcementText = message;
    const region = this.root.querySelector('[data-region="announcements"]');
    if (region !== null) region.textContent = message;
  }

  private openEditDialog(object: ObjectRecord): void {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Edit object');
    const body = el('div', { class: 'dialog-body' });
    body.append(el('h2', { text: 'Edit object' }));
    const summary = el('div', { class: 'error-summary', role: 'alert', tabindex: '-1', hidden: 'hidden' });

    const fields: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    const makeInput = (label: string, key: string, value: string, type = 'text'): HTMLElement => {
      const input = el('input', { type, 'aria-label': label, value }) as HTMLInputElement;
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
    const unit = this.unit;
    form.append(
      makeInput('Title', 'title', object.title),
      makeInput('Object number', 'objectNumber', object.objectNumber),
    );
    const lenderSelect = el('select', { 'aria-label': 'Lender' }) as HTMLSelectElement;
    lenderSelect.append(el('option', { value: '', text: 'Ashgrove collection' }));
    for (const lender of this.lenders) {
      const option = el('option', { value: lender.id, text: lender.name });
      if (lender.id === object.lenderId) option.setAttribute('selected', 'selected');
      lenderSelect.append(option);
    }
    fields['lenderId'] = lenderSelect;
    const lenderField = el('div', { class: 'field' });
    lenderField.append(el('label', { text: 'Lender' }), lenderSelect);
    form.append(
      lenderField,
      makeInput('Medium', 'medium', object.medium),
      makeInput('Width', 'width', unit === 'cm' ? (object.widthMm / 10).toFixed(1) : (Math.round(object.widthMm / 25.4 * 10) / 10).toFixed(1)),
      makeInput('Height', 'height', unit === 'cm' ? (object.heightMm / 10).toFixed(1) : (Math.round(object.heightMm / 25.4 * 10) / 10).toFixed(1)),
      makeInput('Lux limit', 'luxLimit', String(object.luxLimit), 'number'),
      makeInput('Lux-hour budget', 'luxHourBudget', String(object.luxHourBudget), 'number'),
      makeInput('Insurance value', 'insuranceValueGbp', String(object.insuranceValueGbp), 'number'),
      makeInput('Registrar note', 'registrarNote', object.registrarNote),
    );
    const actions = el('div', { class: 'dialog-actions' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    cancel.addEventListener('click', () => dialog.close());
    const save = el('button', { class: 'primary', type: 'submit', text: 'Save object' });
    actions.append(cancel, save);
    form.append(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Only send changed fields; width and height also need the unit, and a
      // placed work refuses dimension changes.
      const payload: Record<string, unknown> = {};
      if (fields['title']!.value !== object.title) payload['title'] = fields['title']!.value;
      if (fields['objectNumber']!.value !== object.objectNumber) payload['objectNumber'] = fields['objectNumber']!.value;
      const nextLender = fields['lenderId']!.value === '' ? null : fields['lenderId']!.value;
      if (nextLender !== object.lenderId) payload['lenderId'] = nextLender;
      if (fields['medium']!.value !== object.medium) payload['medium'] = fields['medium']!.value;
      const nextWidth = Number(fields['width']!.value);
      const nextHeight = Number(fields['height']!.value);
      if (nextWidth !== object.widthMm / (this.unit === 'cm' ? 10 : 25.4)) {
        payload['width'] = nextWidth;
        payload['unit'] = this.unit;
      }
      if (nextHeight !== object.heightMm / (this.unit === 'cm' ? 10 : 25.4)) {
        payload['height'] = nextHeight;
        payload['unit'] = this.unit;
      }
      if (Number(fields['luxLimit']!.value) !== object.luxLimit) payload['luxLimit'] = Number(fields['luxLimit']!.value);
      if (Number(fields['luxHourBudget']!.value) !== object.luxHourBudget) payload['luxHourBudget'] = Number(fields['luxHourBudget']!.value);
      if (Number(fields['insuranceValueGbp']!.value) !== object.insuranceValueGbp) payload['insuranceValueGbp'] = Number(fields['insuranceValueGbp']!.value);
      if (fields['registrarNote']!.value !== object.registrarNote) payload['registrarNote'] = fields['registrarNote']!.value;
      const result = await api('PATCH', `/api/objects/${object.id}`, payload, { staffId: this.staffId });
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
      dialog.close();
      this.announce(`${object.title} saved.`);
      await this.render();
      const heading = this.root.querySelector('.record-heading') as HTMLElement | null;
      heading?.focus();
    });

    body.append(form);
    dialog.append(body);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
    (fields['title'] as HTMLElement).focus();
  }
}

export function mountRecordPage(root: HTMLElement, objectId: string): void {
  const page = new RecordPage(root, objectId);
  void page.start();
}
