import { api, el, escapeHtml, isApiError, formatMoneyMinor, formatUtcDate, formatUtcTime, MILESTONE_LABELS, trapDialog } from '../shell';
import type { Engagement, Invoice } from './account';
import { formatBytes } from './account';

interface Service {
  code: string;
  title: string;
  list_price_pence: number;
  sort: number;
}
interface CaseStudy {
  slug: string;
  title: string;
  client: string;
  published: boolean;
  sort: number;
}
interface StudioEngagement extends Engagement {
  stills: { id: string; shot_code: string; milestone: string }[];
  review_link: { expires_at: string } | null;
}

export function mountStudio(): void {
  const main = document.querySelector('main') as HTMLElement;
  main.innerHTML = '';
  main.id = 'main';
  const section = el('section', 'page-section');
  const card = el('div', 'form-card');
  card.style.maxWidth = '420px';
  const heading = el('h1', 'display-2');
  heading.textContent = 'Studio';
  const form = el('form');
  form.setAttribute('aria-label', 'Studio sign-in');
  const field = el('div', 'field');
  const label = el('label');
  label.htmlFor = 'studio-password';
  label.textContent = 'Studio password';
  const input = el('input');
  input.type = 'password';
  input.id = 'studio-password';
  field.append(label, input);
  const submit = el('button', 'button');
  submit.type = 'submit';
  submit.textContent = 'Sign in';
  const errorLine = el('p', 'dialog-error');
  errorLine.hidden = true;
  form.append(field, submit, errorLine);
  card.append(heading, form);
  section.appendChild(card);
  main.appendChild(section);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.setAttribute('aria-busy', 'true');
    const { status } = await api('POST', '/api/studio/session', { password: input.value });
    submit.removeAttribute('aria-busy');
    if (status === 200) {
      renderDashboard();
      return;
    }
    errorLine.textContent = 'That password is wrong.';
    errorLine.hidden = false;
  });

  // Check for an existing session.
  void api('GET', '/api/studio/engagements').then(({ status }) => {
    if (status === 200) {
      renderDashboard();
    }
  });

  const renderDashboard = (): void => {
    main.innerHTML = '';
    const headingSection = el('section', 'page-section');
    const headingText = el('h1', 'display-2');
    headingText.textContent = 'Studio';
    headingSection.appendChild(headingText);
    main.appendChild(headingSection);

    const health = el('section', 'page-section');
    health.id = 'service-health';
    const healthHeading = el('h2', 'display-4');
    healthHeading.textContent = 'Service health';
    const healthGrid = el('div', 'studio-health');
    healthGrid.setAttribute('role', 'region');
    healthGrid.setAttribute('aria-label', 'Service health');
    health.append(healthHeading, healthGrid);
    main.appendChild(health);
    void loadHealth(healthGrid);

    const engagementsSection = el('section', 'page-section');
    const engagementsHeading = el('h2', 'display-4');
    engagementsHeading.textContent = 'Engagements';
    const table = el('table', 'data-table');
    const caption = el('caption', 'visually-hidden');
    caption.textContent = 'Engagements';
    table.appendChild(caption);
    const thead = el('thead');
    const headRow = el('tr');
    for (const column of ['Reference', 'Brand', 'Title', 'State']) {
      const th = el('th');
      th.textContent = column;
      th.scope = 'col';
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el('tbody');
    table.appendChild(tbody);
    engagementsSection.append(engagementsHeading, table);
    main.appendChild(engagementsSection);
    void loadEngagements(tbody);

    const workSection = el('section', 'page-section');
    const workHeading = el('h2', 'display-4');
    workHeading.textContent = 'Case studies';
    const workList = el('ul');
    workList.setAttribute('aria-label', 'Studio case studies');
    workSection.append(workHeading, workList);
    main.appendChild(workSection);
    void loadWork(workList);

    const servicesSection = el('section', 'page-section');
    const servicesHeading = el('h2', 'display-4');
    servicesHeading.textContent = 'Shot titles and prices';
    const servicesForm = el('form');
    servicesForm.setAttribute('aria-label', 'Service editor');
    servicesSection.append(servicesHeading, servicesForm);
    main.appendChild(servicesSection);
    void loadServices(servicesForm);

    const ratesSection = el('section', 'page-section');
    const ratesHeading = el('h2', 'display-4');
    ratesHeading.textContent = 'Exchange rates';
    const ratesTable = el('table', 'data-table');
    const ratesCaption = el('caption', 'visually-hidden');
    ratesCaption.textContent = 'Exchange rates';
    ratesTable.appendChild(ratesCaption);
    const ratesHead = el('thead');
    const ratesHeadRow = el('tr');
    for (const column of ['Currency', 'Rate', 'Effective from', 'Status']) {
      const th = el('th');
      th.textContent = column;
      th.scope = 'col';
      ratesHeadRow.appendChild(th);
    }
    ratesHead.appendChild(ratesHeadRow);
    ratesTable.appendChild(ratesHead);
    const ratesBody = el('tbody');
    ratesTable.appendChild(ratesBody);
    const rateForm = el('form');
    rateForm.setAttribute('aria-label', 'Add exchange rate');
    const rateFields = el('div');
    rateFields.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;';
    const currencyInput = el('select');
    for (const code of ['EUR', 'USD', 'JPY']) {
      const option = el('option');
      option.value = code;
      option.textContent = code;
      currencyInput.appendChild(option);
    }
    currencyInput.setAttribute('aria-label', 'Currency');
    const rateInput = el('input');
    rateInput.placeholder = 'Rate';
    rateInput.setAttribute('aria-label', 'Rate');
    const effectiveInput = el('input');
    effectiveInput.type = 'datetime-local';
    effectiveInput.setAttribute('aria-label', 'Effective from');
    const rateSubmit = el('button', 'button');
    rateSubmit.type = 'submit';
    rateSubmit.textContent = 'Save rate';
    const rateStatus = el('p');
    rateStatus.setAttribute('role', 'status');
    rateFields.append(currencyInput, rateInput, effectiveInput, rateSubmit);
    rateForm.append(rateFields, rateStatus);
    ratesSection.append(ratesHeading, ratesTable, rateForm);
    main.appendChild(ratesSection);
    void loadRates(ratesBody);

    rateForm.addEventListener('submit', async event => {
      event.preventDefault();
      rateSubmit.setAttribute('aria-busy', 'true');
      const effective = effectiveInput.value ? new Date(effectiveInput.value).toISOString() : undefined;
      const { status, json } = await api('POST', '/api/studio/fx-rates', {
        currency: currencyInput.value,
        rate: rateInput.value,
        effective_at: effective,
      });
      rateSubmit.removeAttribute('aria-busy');
      if (status === 201) {
        rateStatus.textContent = 'Rate saved.';
        rateInput.value = '';
        void loadRates(ratesBody);
      } else if (isApiError(json)) {
        rateStatus.textContent = json.message;
      }
    });
  };

  const loadHealth = async (grid: HTMLElement): Promise<void> => {
    const { status, json } = await api<Record<string, string>>('GET', '/api/studio/health');
    if (status !== 200 || isApiError(json)) {
      return;
    }
    const health = json as Record<string, string>;
    const labels: Record<string, string> = {
      postgres: 'Postgres', killbill: 'Kill Bill', minio: 'File storage', mailpit: 'Email',
      pocketbase: 'Studio content', rabbitmq: 'Measuring queue', gotenberg: 'Documents',
      meilisearch: 'Search', ntfy: 'Studio alerts',
    };
    grid.innerHTML = '';
    for (const [key, label] of Object.entries(labels)) {
      const value = health[key];
      const row = el('div', 'health-row');
      row.innerHTML = `<span>${escapeHtml(label)}</span><span class="${value}">${value === 'up' ? 'Up' : 'Down'}</span>`;
      grid.appendChild(row);
    }
  };

  const loadEngagements = async (tbody: HTMLElement): Promise<void> => {
    const { status, json } = await api<{ engagements: { id: string; reference: string; title: string; state: string; brand_name: string }[] }>('GET', '/api/studio/engagements');
    if (status !== 200 || isApiError(json)) {
      return;
    }
    const engagements = (json as { engagements: { id: string; reference: string; title: string; state: string; brand_name: string }[] }).engagements;
    tbody.innerHTML = '';
    for (const engagement of engagements) {
      const row = el('tr');
      const referenceCell = el('td');
      const link = el('a');
      link.href = `/studio/engagements/${engagement.id}`;
      link.textContent = engagement.reference;
      referenceCell.appendChild(link);
      const brandCell = el('td');
      brandCell.textContent = engagement.brand_name;
      const titleCell = el('td');
      titleCell.textContent = engagement.title;
      const stateCell = el('td');
      stateCell.textContent = engagement.state.replace(/_/g, ' ');
      row.append(referenceCell, brandCell, titleCell, stateCell);
      tbody.appendChild(row);
    }
  };

  const loadWork = async (list: HTMLElement): Promise<void> => {
    const { status, json } = await api<{ case_studies: CaseStudy[] }>('GET', '/api/studio/work');
    if (status !== 200 || isApiError(json)) {
      return;
    }
    const studies = (json as { case_studies: CaseStudy[] }).case_studies;
    list.innerHTML = '';
    for (const study of studies) {
      const item = el('li');
      item.style.cssText = 'border:1px solid var(--hairline);border-radius:14px;padding:16px 18px;margin-bottom:12px;';
      const meta = el('div');
      meta.style.cssText = 'display:flex;justify-content:space-between;gap:12px;';
      meta.innerHTML = `<strong>${escapeHtml(study.title)}</strong><span class="status-word">${study.published ? 'Published' : 'Draft'}</span>`;
      const clientLine = el('p', 'file-size');
      clientLine.textContent = study.client;
      const toggle = el('button', 'button secondary');
      toggle.textContent = study.published ? 'Unpublish' : 'Publish';
      toggle.addEventListener('click', async () => {
        toggle.setAttribute('aria-busy', 'true');
        const result = await api<CaseStudy>('PATCH', `/api/studio/work/${encodeURIComponent(study.slug)}`, { published: !study.published });
        toggle.removeAttribute('aria-busy');
        if (result.status === 200) {
          void loadWork(list);
        }
      });
      item.append(meta, clientLine, toggle);
      list.appendChild(item);
    }
  };

  const loadServices = async (form: HTMLElement): Promise<void> => {
    const { status, json } = await api<{ services: Service[] }>('GET', '/api/content');
    if (status !== 200 || isApiError(json)) {
      return;
    }
    const services = (json as { services: Service[] }).services;
    form.innerHTML = '';
    for (const service of services) {
      const row = el('div');
      row.style.cssText = 'display:flex;gap:12px;align-items:end;margin-bottom:12px;flex-wrap:wrap;';
      const code = el('span');
      code.textContent = service.code;
      code.style.minWidth = '120px';
      const titleInput = el('input');
      titleInput.value = service.title;
      titleInput.setAttribute('aria-label', `Title for ${service.code}`);
      titleInput.style.width = '220px';
      const priceInput = el('input');
      priceInput.type = 'number';
      priceInput.value = String(service.list_price_pence);
      priceInput.setAttribute('aria-label', `Price for ${service.code}`);
      priceInput.style.width = '140px';
      const save = el('button', 'button secondary');
      save.textContent = 'Save service';
      const note = el('span');
      note.setAttribute('role', 'status');
      save.addEventListener('click', async () => {
        save.setAttribute('aria-busy', 'true');
        const { status: saveStatus, json: saveJson } = await api<Service>('PATCH', `/api/studio/services/${encodeURIComponent(service.code)}`, {
          title: titleInput.value,
          list_price_pence: Number(priceInput.value),
        });
        save.removeAttribute('aria-busy');
        if (saveStatus === 200) {
          note.textContent = 'Service saved.';
        } else if (isApiError(saveJson)) {
          note.textContent = saveJson.message;
        }
      });
      row.append(code, titleInput, priceInput, save, note);
      form.appendChild(row);
    }
  };

  const loadRates = async (tbody: HTMLElement): Promise<void> => {
    const { status, json } = await api<{ rates: { currency: string; rate: string; effective_at: string }[]; scheduled: { currency: string; rate: string; effective_at: string }[] }>('GET', '/api/studio/fx-rates');
    if (status !== 200 || isApiError(json)) {
      return;
    }
    const body = json as { rates: { currency: string; rate: string; effective_at: string }[]; scheduled: { currency: string; rate: string; effective_at: string }[] };
    tbody.innerHTML = '';
    for (const rate of body.rates) {
      const row = el('tr');
      row.innerHTML = `<td>${escapeHtml(rate.currency)}</td><td>${escapeHtml(rate.rate)}</td><td>${escapeHtml(formatUtcDate(rate.effective_at))}</td><td>Current</td>`;
      tbody.appendChild(row);
    }
    for (const rate of body.scheduled) {
      const row = el('tr');
      row.innerHTML = `<td>${escapeHtml(rate.currency)}</td><td>${escapeHtml(rate.rate)}</td><td>${escapeHtml(formatUtcDate(rate.effective_at))}</td><td>Scheduled</td>`;
      tbody.appendChild(row);
    }
  };
}

export function mountStudioEngagement(path: string): void {
  const engagementId = path.split('/')[3] ?? '';
  const main = document.querySelector('main') as HTMLElement;
  main.innerHTML = '';
  main.id = 'main';
  const section = el('section', 'page-section');
  const heading = el('h1', 'display-2');
  const meta = el('p', 'section-label');
  const filesHeading = el('h2', 'display-4');
  filesHeading.textContent = 'Intake files';
  const filesList = el('ul', 'intake-list');
  filesList.setAttribute('aria-label', 'Intake files');
  const stillsHeading = el('h2', 'display-4');
  stillsHeading.textContent = 'Stills';
  const stillsRegion = el('div');
  const actions = el('div', 'review-actions');
  const sendReview = el('button', 'button');
  sendReview.textContent = 'Send for review';
  const revokeLink = el('button', 'button secondary');
  revokeLink.textContent = 'Revoke review link';
  actions.append(sendReview, revokeLink);
  const invoicesHeading = el('h2', 'display-4');
  invoicesHeading.textContent = 'Invoices';
  const invoicesTable = el('table', 'data-table');
  const invoicesBody = el('tbody');
  invoicesTable.appendChild(invoicesBody);
  const ledgerHeading = el('h2', 'display-4');
  ledgerHeading.textContent = 'Ledger';
  const ledgerList = el('ul');
  const cancelSection = el('div');
  const cancelButton = el('button', 'button secondary');
  cancelButton.textContent = 'Cancel and refund';
  const cancelStatus = el('p');
  cancelStatus.setAttribute('role', 'status');
  cancelSection.append(cancelButton, cancelStatus);
  section.append(heading, meta, filesHeading, filesList, stillsHeading, stillsRegion, actions, invoicesHeading, invoicesTable, ledgerHeading, ledgerList, cancelSection);
  main.appendChild(section);

  const load = async (): Promise<StudioEngagement | null> => {
    const { status, json } = await api<StudioEngagement>('GET', `/api/studio/engagements/${engagementId}`);
    if (status !== 200 || isApiError(json)) {
      void import('./notfound').then(m => {
        main.innerHTML = '';
        m.mountNotFound();
      });
      return null;
    }
    const engagement = json as StudioEngagement;
    heading.textContent = engagement.title;
    meta.textContent = `${engagement.reference} · ${engagement.state.replace(/_/g, ' ')}`;
    renderFiles(filesList, engagement);
    renderStills(stillsRegion, engagement);
    renderInvoices(invoicesBody, engagement);
    renderLedger(ledgerList, engagement);
    return engagement;
  };

  const renderFiles = (list: HTMLElement, engagement: StudioEngagement): void => {
    list.innerHTML = '';
    for (const file of engagement.files) {
      const item = el('li');
      const name = el('span', 'file-name');
      name.textContent = file.name;
      const size = el('span', 'file-size');
      size.textContent = formatBytes(file.size_bytes);
      const status = el('span', 'intake-status');
      status.textContent = file.status === 'received' ? 'Received' : 'Superseded';
      const download = el('a');
      download.href = `/api/studio/engagements/${engagement.id}/files/${file.id}/content`;
      download.textContent = `Download ${file.name}`;
      item.append(name, size, status, download);
      list.appendChild(item);
    }
  };

  const renderStills = (region: HTMLElement, engagement: StudioEngagement): void => {
    region.innerHTML = '';
    const uploadRegion = el('div');
    for (const line of engagement.quote.lines) {
      for (const milestone of ['look_dev', 'final_delivery'] as const) {
        const label = MILESTONE_LABELS[milestone];
        const row = el('div');
        row.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:10px;flex-wrap:wrap;';
        const text = el('span');
        text.textContent = `Upload ${label} still for ${line.title}`;
        const input = el('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg';
        input.setAttribute('aria-label', `Upload ${label} still for ${line.title}`);
        const status = el('span');
        status.setAttribute('role', 'status');
        const existing = engagement.stills.find(still => still.shot_code === line.shot_code && still.milestone === milestone);
        if (existing) {
          status.textContent = `Posted ${formatBytes(0)}`;
          status.textContent = 'Posted';
        }
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) {
            return;
          }
          const buffer = await file.arrayBuffer();
          status.textContent = 'Uploading';
          const { status: uploadStatus, json } = await api('POST', `/api/studio/engagements/${engagement.id}/stills`, {
            shot_code: line.shot_code,
            milestone,
            data: btoa(String.fromCharCode(...new Uint8Array(buffer))),
          });
          if (uploadStatus === 201) {
            status.textContent = 'Posted';
            void load();
          } else if (isApiError(json)) {
            status.textContent = json.message;
          }
        });
        row.append(text, input, status);
        uploadRegion.appendChild(row);
      }
    }
    region.appendChild(uploadRegion);
  };

  const renderInvoices = (tbody: HTMLElement, engagement: StudioEngagement): void => {
    tbody.innerHTML = '';
    for (const invoice of engagement.invoices) {
      const row = el('tr');
      const milestoneCell = el('td');
      milestoneCell.textContent = MILESTONE_LABELS[invoice.milestone] ?? invoice.milestone;
      const numberCell = el('td');
      numberCell.textContent = invoice.number ?? '';
      const amountCell = el('td', 'num');
      const symbol = invoice.currency === 'JPY' ? '¥' : invoice.currency === 'EUR' ? '€' : invoice.currency === 'USD' ? '$' : '£';
      const exponent = invoice.currency === 'JPY' ? 0 : 2;
      amountCell.textContent = formatMoneyMinor(invoice.amount_minor, symbol, exponent);
      const statusCell = el('td');
      statusCell.textContent = invoice.status.replace(/_/g, ' ');
      const actionCell = el('td');
      if (invoice.status === 'draft') {
        const issueButton = el('button', 'button secondary');
        issueButton.textContent = `Issue invoice ${MILESTONE_LABELS[invoice.milestone]}`;
        issueButton.addEventListener('click', async () => {
          issueButton.setAttribute('aria-busy', 'true');
          const { status, json } = await api<Invoice>('POST', `/api/studio/invoices/${invoice.id}/issue`, {});
          issueButton.removeAttribute('aria-busy');
          if (status === 200) {
            void load();
          } else if (isApiError(json)) {
            void load();
            cancelStatus.textContent = json.message;
          }
        });
        actionCell.appendChild(issueButton);
      }
      row.append(milestoneCell, numberCell, amountCell, statusCell, actionCell);
      tbody.appendChild(row);
    }
  };

  const renderLedger = (list: HTMLElement, engagement: StudioEngagement): void => {
    list.innerHTML = '';
    for (const entry of engagement.ledger) {
      const item = el('li');
      const symbol = entry.currency === 'JPY' ? '¥' : entry.currency === 'EUR' ? '€' : entry.currency === 'USD' ? '$' : '£';
      const exponent = entry.currency === 'JPY' ? 0 : 2;
      const kind = entry.kind === 'invoice_payment' ? 'Invoice payment' : entry.kind === 'deposit' ? 'Deposit' : 'Refund';
      item.textContent = `${kind} — ${formatMoneyMinor(entry.amount_minor, symbol, exponent)} — ${entry.created_at.slice(0, 10)}`;
      list.appendChild(item);
    }
  };

  sendReview.addEventListener('click', async () => {
    sendReview.setAttribute('aria-busy', 'true');
    const { status, json } = await api('POST', `/api/studio/engagements/${engagementId}/send-for-review`, {});
    sendReview.removeAttribute('aria-busy');
    if (status === 200 && !isApiError(json)) {
      const result = json as { review_url: string; expires_at: string };
      cancelStatus.textContent = 'Review link created. The reviewer will receive it by email.';
      void result;
      void load();
    } else if (isApiError(json)) {
      cancelStatus.textContent = json.message;
    }
  });

  revokeLink.addEventListener('click', async () => {
    await api('DELETE', `/api/studio/engagements/${engagementId}/review-link`);
    void load();
  });

  cancelButton.addEventListener('click', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Cancel and refund');
    const body = el('div', 'dialog-body');
    const title = el('h2');
    title.textContent = 'Cancel and refund';
    const field = el('div', 'field');
    const label = el('label');
    label.htmlFor = 'refund-amount';
    label.textContent = 'Refund amount (minor units)';
    const input = el('input');
    input.type = 'number';
    input.min = '1';
    input.id = 'refund-amount';
    field.append(label, input);
    const errorLine = el('p', 'dialog-error');
    errorLine.hidden = true;
    const actionsRow = el('div', 'dialog-actions');
    const cancelButtonInner = el('button', 'button secondary');
    cancelButtonInner.textContent = 'Cancel';
    const confirmButton = el('button', 'button');
    confirmButton.textContent = 'Cancel and refund';
    actionsRow.append(cancelButtonInner, confirmButton);
    body.append(title, field, errorLine, actionsRow);
    dialog.appendChild(body);
    document.body.appendChild(dialog);
    trapDialog(dialog, () => {
      dialog.remove();
      cancelButton.focus();
    });
    cancelButtonInner.addEventListener('click', () => {
      dialog.close();
      dialog.remove();
      cancelButton.focus();
    });
    confirmButton.addEventListener('click', async () => {
      confirmButton.setAttribute('aria-busy', 'true');
      const { status, json } = await api('POST', `/api/studio/engagements/${engagementId}/cancel`, {
        refund_minor: Number(input.value),
      });
      confirmButton.removeAttribute('aria-busy');
      if (status === 200 && !isApiError(json)) {
        const result = json as { refunded_minor: number };
        dialog.close();
        dialog.remove();
        cancelStatus.textContent = `Engagement cancelled. Refund of ${result.refunded_minor} recorded.`;
        void load();
        return;
      }
      if (isApiError(json)) {
        const fieldsErrors = json.fields ?? {};
        errorLine.textContent = Object.values(fieldsErrors)[0] ?? json.message;
        errorLine.hidden = false;
        confirmButton.focus();
      }
    });
  });

  void load();
  void formatUtcTime;
}
