// The browser app: owner pages in English and Polish, operator pages in English.
import { STRINGS, OWNER_REFUSALS, FIELD_ERRORS, formatMoney, formatDate, stateLabel, type Language, type Strings } from './strings.js';
import { createFan, type FanModel, type FanPart } from './fan.js';
import { renderWorkspace, renderImportsPage, renderEditionsPage } from './workspace.js';

export { STRINGS };
export { createFan };
export type { FanModel, FanPart };

import type { ApiErrorShape, ShareView, ClaimView, ModelSummary, ModelDetail } from './types.js';
export type { ApiErrorShape, ShareView, ClaimView, ModelSummary, ModelDetail };

export function getLanguage(): Language {
  const match = /(^|;\s*)lang=(en-GB|pl-PL)/.exec(document.cookie);
  if (match) return match[2] as Language;
  return 'en-GB';
}

export function setLanguage(lang: Language): void {
  document.cookie = `lang=${lang}; path=/; max-age=31536000; samesite=strict`;
  document.documentElement.lang = lang === 'pl-PL' ? 'pl-PL' : 'en-GB';
}

export function strings(): Strings {
  return STRINGS[getLanguage()];
}

export function ownerRefusalText(code: string, lang: Language, params?: { file?: string; number?: string }): string {
  const entry = OWNER_REFUSALS[code];
  if (entry === undefined) return code;
  const raw = entry[lang];
  return raw.replace('{file}', params?.file ?? '').replace('{number}', params?.number ?? '');
}

export function fieldErrorText(field: string, lang: Language): string {
  const entry = FIELD_ERRORS[field];
  return entry === undefined ? field : entry[lang];
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T | ApiErrorShape }> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    credentials: 'same-origin',
  });
  const text = await res.text();
  let body: T | ApiErrorShape;
  try {
    body = JSON.parse(text) as T | ApiErrorShape;
  } catch {
    body = { error: { code: 'bad_json', message: text } } as ApiErrorShape;
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Shared page scaffolding
// ---------------------------------------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}

export function text(node: HTMLElement, value: string): void {
  node.textContent = value;
}

function brandHeading(): HTMLHeadingElement {
  const h = el('h1', 'brand');
  text(h, 'Holmgarth Aftercare');
  return h;
}

// A success message stays in the status region until the next action. A
// re-render after an action keeps the message by carrying it across.
let pendingStatus: string | null = null;

export function setPendingStatus(message: string | null): void {
  pendingStatus = message;
}

export function takePendingStatus(): string | null {
  const value = pendingStatus;
  pendingStatus = null;
  return value;
}

function skipLink(target: 'owner' | 'operator'): HTMLAnchorElement {
  const a = el('a', 'skip-link');
  a.href = '#main';
  text(a, target === 'owner' ? strings().skipLink : 'Skip to claim workspace');
  return a;
}

/** The language switch, on every owner page. Choosing the other radio swaps
 * every owner string in place without a reload. */
function languageSwitch(): HTMLElement {
  const group = el('fieldset', 'language-switch');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Language · Język');
  const legend = el('legend', 'visually-hidden');
  text(legend, 'Language · Język');
  group.appendChild(legend);
  for (const code of ['en-GB', 'pl-PL'] as const) {
    const radio = el('input', 'language-radio');
    radio.type = 'radio';
    radio.name = 'language';
    radio.id = `lang-${code}`;
    radio.value = code;
    radio.checked = getLanguage() === code;
    const label = el('label', 'language-label');
    label.htmlFor = `lang-${code}`;
    text(label, code === 'en-GB' ? 'English' : 'Polski');
    group.appendChild(radio);
    group.appendChild(label);
  }
  group.addEventListener('change', () => {
    const chosen = (group.querySelector('input:checked') as HTMLInputElement | null)?.value as Language | undefined;
    if (chosen === undefined) return;
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    setLanguage(chosen);
    render();
    window.scrollTo(scrollX, scrollY);
  });
  return group;
}

function ownerHeader(): HTMLElement {
  const header = el('header', 'page-header');
  header.appendChild(brandHeading());
  header.appendChild(languageSwitch());
  return header;
}

/** Every page has exactly one general status region and one alert region. */
function liveRegions(): { status: HTMLElement; alert: HTMLElement } {
  const statusRegion = el('div');
  statusRegion.setAttribute('role', 'status');
  statusRegion.className = 'status-region';
  const alertRegion = el('div');
  alertRegion.setAttribute('role', 'alert');
  alertRegion.className = 'alert-region';
  alertRegion.tabIndex = -1;
  return { status: statusRegion, alert: alertRegion };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

let rootElement: HTMLElement | null = null;

export function mount(root: HTMLElement): void {
  rootElement = root;
  document.documentElement.lang = getLanguage() === 'pl-PL' ? 'pl-PL' : 'en-GB';
  window.addEventListener('popstate', render);
  render();
}

export function navigate(path: string): void {
  history.pushState(null, '', path);
  render();
}

export function render(): void {
  if (rootElement === null) return;
  const path = window.location.pathname;
  const body = document.body;
  body.innerHTML = '';
  const frame = el('div', 'page');
  body.appendChild(frame);
  rootElement = frame;

  if (path.startsWith('/ops')) {
    void renderOperatorPage(frame, path);
  } else {
    void renderOwnerPage(frame, path);
  }
}

// ---------------------------------------------------------------------------
// Owner pages
// ---------------------------------------------------------------------------

async function renderOwnerPage(frame: HTMLElement, path: string): Promise<void> {
  const { status: statusRegion, alert: alertRegion } = liveRegions();

  if (path === '/' || path === '') {
    frame.appendChild(skipLink('owner'));
    frame.appendChild(ownerHeader());
    const main = el('main', 'home');
    main.id = 'main';
    const tagline = el('p', 'tagline');
    text(tagline, strings().homeTagline);
    main.appendChild(tagline);
    const start = el('a', 'button primary');
    start.href = '/claim/new';
    text(start, strings().startClaim);
    const find = el('a', 'button');
    find.href = '/find';
    text(find, strings().findClaim);
    main.appendChild(start);
    main.appendChild(find);
    frame.appendChild(main);
    return;
  }

  if (path === '/claim/new') {
    frame.appendChild(skipLink('owner'));
    frame.appendChild(ownerHeader());
    const main = el('main', 'claim-page');
    main.id = 'main';
    frame.appendChild(main);
    await renderClaimForm(main, alertRegion, statusRegion);
    return;
  }

  const sentMatch = /^\/claim\/([^/]+)\/sent$/.exec(path);
  if (sentMatch) {
    frame.appendChild(skipLink('owner'));
    frame.appendChild(ownerHeader());
    const main = el('main', 'sent-page');
    main.id = 'main';
    frame.appendChild(main);
    await renderSentPage(main, sentMatch[1] ?? '', alertRegion);
    return;
  }

  const confirmMatch = /^\/confirm\/([^/]+)$/.exec(path);
  if (confirmMatch) {
    frame.appendChild(skipLink('owner'));
    frame.appendChild(ownerHeader());
    const main = el('main', 'confirm-page');
    main.id = 'main';
    frame.appendChild(main);
    renderConfirmPage(main, confirmMatch[1] ?? '', alertRegion, statusRegion);
    return;
  }

  const shareMatch = /^\/s\/([^/]+)$/.exec(path);
  if (shareMatch) {
    frame.appendChild(skipLink('owner'));
    frame.appendChild(ownerHeader());
    const main = el('main', 'share-page');
    main.id = 'main';
    frame.appendChild(main);
    await renderSharePage(main, shareMatch[1] ?? '', alertRegion);
    return;
  }

  if (path === '/find') {
    frame.appendChild(skipLink('owner'));
    frame.appendChild(ownerHeader());
    const main = el('main', 'find-page');
    main.id = 'main';
    frame.appendChild(main);
    renderFindPage(main, alertRegion, statusRegion);
    return;
  }

  frame.appendChild(skipLink('owner'));
  frame.appendChild(ownerHeader());
  const main = el('main');
  main.id = 'main';
  text(main, 'Not found');
  frame.appendChild(main);
}

// --- Claim form ------------------------------------------------------------

async function renderClaimForm(
  main: HTMLElement, alertRegion: HTMLElement, statusRegion: HTMLElement,
): Promise<void> {
  const heading = el('h2', 'page-heading');
  text(heading, strings().claimHeading);
  main.appendChild(heading);
  main.appendChild(alertRegion);
  main.appendChild(statusRegion);

  const layout = el('div', 'claim-layout');
  const fanPane = el('div', 'claim-fan');
  const formPane = el('div', 'claim-form-pane');
  layout.appendChild(fanPane);
  layout.appendChild(formPane);
  main.appendChild(layout);

  // Model combobox, listing every catalogue model by name.
  const modelsResult = await apiJson<{ models: ModelSummary[] }>('/api/models');
  const models = (modelsResult.body as { models: ModelSummary[] }).models;

  const form = el('form', 'claim-form') as HTMLFormElement;
  formPane.appendChild(form);
  form.noValidate = true;

  let selectedModel: ModelDetail | null = null;
  let selectedPart: number | null = null;
  let fan: ReturnType<typeof createFan> | null = null;
  let estimateSeq = 0;
  let estimatePending = false;

  const fieldErrorNodes: Record<string, HTMLElement> = {};

  const makeField = (labelText: string, input: HTMLElement, fieldKey: string): HTMLElement => {
    const wrap = el('div', 'field');
    const label = el('label', 'field-label');
    text(label, labelText);
    wrap.appendChild(label);
    wrap.appendChild(input);
    const errorNode = el('p', 'field-error');
    errorNode.id = `error-${fieldKey}`;
    wrap.appendChild(errorNode);
    fieldErrorNodes[fieldKey] = errorNode;
    return wrap;
  };

  const nameInput = el('input', 'textbox') as HTMLInputElement;
  nameInput.type = 'text';
  nameInput.id = 'claim-name';
  (nameInput as HTMLInputElement).setAttribute('aria-label', strings().yourName);
  nameInput.required = false;

  const emailInput = el('input', 'textbox') as HTMLInputElement;
  emailInput.type = 'email';
  emailInput.id = 'claim-email';
  emailInput.setAttribute('aria-label', strings().email);

  const postcodeInput = el('input', 'textbox') as HTMLInputElement;
  postcodeInput.type = 'text';
  postcodeInput.id = 'claim-postcode';
  postcodeInput.setAttribute('aria-label', strings().postcode);

  const modelSelect = el('select', 'combobox') as HTMLSelectElement;
  modelSelect.id = 'claim-model';
  modelSelect.setAttribute('aria-label', strings().model);
  const placeholderOption = el('option') as HTMLOptionElement;
  placeholderOption.value = '';
  text(placeholderOption, '—');
  modelSelect.appendChild(placeholderOption);
  for (const m of models) {
    const option = el('option') as HTMLOptionElement;
    option.value = m.slug;
    text(option, m.name);
    modelSelect.appendChild(option);
  }

  const purchaseInput = el('input', 'date-input') as HTMLInputElement;
  purchaseInput.type = 'date';
  purchaseInput.id = 'claim-purchase';
  purchaseInput.setAttribute('aria-label', strings().dateOfPurchase);

  const quantityInput = el('input', 'spinbutton') as HTMLInputElement;
  quantityInput.type = 'number';
  quantityInput.min = '1';
  quantityInput.max = '20';
  quantityInput.value = '1';
  quantityInput.id = 'claim-quantity';
  quantityInput.setAttribute('aria-label', strings().quantity);

  const descriptionInput = el('textarea', 'textbox multiline') as HTMLTextAreaElement;
  descriptionInput.id = 'claim-description';
  descriptionInput.setAttribute('aria-label', strings().whatHappened);

  const photoInput = el('input', 'file-input') as HTMLInputElement;
  photoInput.type = 'file';
  photoInput.accept = 'image/jpeg,image/png,image/webp';
  photoInput.multiple = true;
  photoInput.id = 'claim-photos';
  photoInput.setAttribute('aria-label', strings().damagePhotos);

  form.appendChild(makeField(strings().yourName, nameInput, 'name'));
  form.appendChild(makeField(strings().email, emailInput, 'email'));
  form.appendChild(makeField(strings().postcode, postcodeInput, 'postcode'));
  form.appendChild(makeField(strings().model, modelSelect, 'model'));
  form.appendChild(makeField(strings().dateOfPurchase, purchaseInput, 'purchase_date'));
  form.appendChild(makeField(strings().quantity, quantityInput, 'quantity'));
  form.appendChild(makeField(strings().whatHappened, descriptionInput, 'description'));
  form.appendChild(makeField(strings().damagePhotos, photoInput, 'photos'));

  const partLine = el('p', 'part-line mono');
  text(partLine, '');
  const estimateRegion = el('div', 'estimate-region');
  estimateRegion.setAttribute('role', 'region');
  estimateRegion.setAttribute('aria-label', strings().estimateCarriage);
  const estimateContent = el('p', 'estimate-content');
  const estimateButton = el('button', 'button secondary');
  estimateButton.type = 'button';
  text(estimateButton, strings().estimateCarriage);
  estimateRegion.appendChild(estimateContent);
  estimateRegion.appendChild(estimateButton);
  formPane.appendChild(partLine);
  formPane.appendChild(estimateRegion);

  const startButton = el('button', 'button primary');
  startButton.type = 'submit';
  text(startButton, strings().startButton);
  form.appendChild(startButton);

  const drawFan = async (): Promise<void> => {
    if (fan !== null) {
      fan.teardown();
      fanPane.innerHTML = '';
    }
    if (selectedModel === null) {
      const empty = el('p', 'fan-empty');
      text(empty, strings().model);
      fanPane.appendChild(empty);
      return;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const parts: FanPart[] = selectedModel.parts.map((p) => ({
      bookletNumber: p.booklet_number,
      name: p.name,
      partNumber: p.part_number,
      status: p.status,
    }));
    const fanModel: FanModel = {
      slug: selectedModel.slug,
      name: selectedModel.name,
      axis: selectedModel.axis,
    };
    fan = createFan({
      model: fanModel,
      parts,
      selected: selectedPart,
      locked: false,
      initialSeparation: reducedMotion ? 100 : 0,
      reducedMotion,
      strings: () => ({
        separateParts: strings().separateParts,
        fanHeading: strings().fanHeading,
        diagramUnavailable: strings().diagramUnavailable,
        partsList: strings().partsList,
        partButton: (n, name) => (getLanguage() === 'pl-PL' ? `Część ${n}: ${name}` : `Part ${n}: ${name}`),
      }),
      onSelect: (bookletNumber) => {
        selectedPart = bookletNumber;
        fan?.setSelected(bookletNumber);
        const part = selectedModel?.parts.find((p) => p.booklet_number === bookletNumber);
        if (part) {
          text(partLine, getLanguage() === 'pl-PL'
            ? `Część ${part.booklet_number}: ${part.name} — ${part.part_number}`
            : `Part ${part.booklet_number}: ${part.name} — ${part.part_number}`);
        }
      },
    });
    fan.root.setAttribute('aria-label', strings().fanHeading);
    fanPane.appendChild(fan.root);
  };

  modelSelect.addEventListener('change', async () => {
    selectedPart = null;
    const slug = modelSelect.value;
    if (slug === '') {
      selectedModel = null;
      await drawFan();
      return;
    }
    const detail = await apiJson<ModelDetail>(`/api/models/${encodeURIComponent(slug)}`);
    if (detail.status === 200) {
      selectedModel = detail.body as ModelDetail;
    } else {
      selectedModel = null;
    }
    await drawFan();
  });

  estimateButton.addEventListener('click', () => {
    // Each estimate press is answered on its own; only the newest press's
    // answer is ever shown, whatever order the answers arrive in.
    const seq = ++estimateSeq;
    const slug = modelSelect.value;
    const postcode = postcodeInput.value;
    const quantity = quantityInput.value;
    if (selectedPart === null) {
      text(estimateContent, ownerRefusalText('part_withdrawn', getLanguage(), { number: '' }));
      return;
    }
    estimatePending = true;
    text(statusRegion, strings().askingCarrier);
    const url = `/api/carriage-estimate?model=${encodeURIComponent(slug)}&part=${selectedPart}&quantity=${encodeURIComponent(quantity)}&postcode=${encodeURIComponent(postcode)}`;
    void apiJson<{ band: string; charge_minor: number }>(url).then(({ status, body }) => {
      if (seq !== estimateSeq) return; // an older answer: dropped
      estimatePending = false;
      if (status !== 200) {
        const err = body as ApiErrorShape;
        text(estimateContent, ownerRefusalText(err.error.code, getLanguage()));
        return;
      }
      const ok = body as { band: string; charge_minor: number };
      const lang = getLanguage();
      text(estimateContent, (lang === 'pl-PL' ? `Strefa ${ok.band} · ` : `Band ${ok.band} · `) + formatMoney(ok.charge_minor, lang));
      text(statusRegion, '');
    });
  });
  void estimatePending;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    startButton.disabled = true;
    text(statusRegion, strings().sendingClaim);
    text(alertRegion, '');
    for (const node of Object.values(fieldErrorNodes)) text(node, '');

    const formData = new FormData();
    formData.append('name', nameInput.value);
    formData.append('email', emailInput.value);
    formData.append('postcode', postcodeInput.value);
    formData.append('model', modelSelect.value);
    formData.append('booklet_number', selectedPart === null ? '' : String(selectedPart));
    formData.append('quantity', quantityInput.value);
    formData.append('purchase_date', purchaseInput.value);
    formData.append('description', descriptionInput.value);
    formData.append('language', getLanguage());
    const files = photoInput.files;
    if (files !== null) {
      for (const file of Array.from(files)) formData.append('photos', file, file.name);
    }

    void fetch('/api/claims', { method: 'POST', body: formData, credentials: 'same-origin' })
      .then(async (res) => {
        const textBody = await res.text();
        let body: { reference?: string } | ApiErrorShape;
        try {
          body = JSON.parse(textBody) as { reference?: string } | ApiErrorShape;
        } catch {
          body = { error: { code: 'bad_json', message: textBody } };
        }
        startButton.disabled = false;
        if (res.status === 201 && 'reference' in body && typeof body.reference === 'string') {
          navigate(`/claim/${body.reference}/sent`);
          return;
        }
        const err = (body as ApiErrorShape).error;
        text(statusRegion, '');
        if (err.fields !== undefined) {
          for (const [field, code] of Object.entries(err.fields)) {
            if (field.startsWith('photos.')) {
              const index = Number(field.split('.')[1] ?? '0');
              const file = files !== null ? (files[index - 1] ?? null) : null;
              const fileName = file ? file.name : '';
              const node = fieldErrorNodes[field];
              if (node) {
                text(node, ownerRefusalText(code, getLanguage(), { file: fileName.split(/[\\/]/).pop() ?? '' }));
              }
              continue;
            }
            const node = fieldErrorNodes[field];
            if (node) {
              // The photo-count refusal is published copy, not a field error.
              text(node, field === 'photos'
                ? ownerRefusalText('photo_count', getLanguage())
                : fieldErrorText(field, getLanguage()));
            }
          }
        }
        const firstField = err.fields !== undefined ? Object.keys(err.fields)[0] : undefined;
        let refusal: string;
        if (err.code === 'not_found') {
          refusal = fieldErrorText('model', getLanguage());
        } else if (err.code === 'part_withdrawn') {
          refusal = ownerRefusalText('part_withdrawn', getLanguage(), { number: selectedPart === null ? '' : String(selectedPart) });
        } else if (err.fields !== undefined && firstField !== undefined && firstField.startsWith('photos.')) {
          const code = err.fields[firstField] ?? '';
          const index = Number(firstField.split('.')[1] ?? '0');
          const file = files !== null ? (files[index - 1] ?? null) : null;
          refusal = ownerRefusalText(code, getLanguage(), { file: file ? (file.name.split(/[\\/]/).pop() ?? '') : '' });
        } else if (err.fields !== undefined && firstField !== undefined && firstField === 'photos') {
          refusal = ownerRefusalText('photo_count', getLanguage());
        } else if (err.code === 'request_too_large') {
          refusal = ownerRefusalText('request_too_large', getLanguage());
        } else if (err.fields !== undefined && firstField !== undefined) {
          refusal = firstField === 'photos'
            ? ownerRefusalText('photo_count', getLanguage())
            : fieldErrorText(firstField, getLanguage());
        } else {
          refusal = ownerRefusalText(err.code, getLanguage());
        }
        text(alertRegion, refusal);
        alertRegion.focus();
      });
  });

  await drawFan();
}

// --- Sent page -------------------------------------------------------------

async function renderSentPage(main: HTMLElement, reference: string, alertRegion: HTMLElement): Promise<void> {
  const heading = el('h2', 'page-heading');
  text(heading, strings().sentHeading);
  main.appendChild(heading);
  main.appendChild(alertRegion);

  const line = el('p', 'sent-line');
  const lang = getLanguage();
  const refText = reference;
  text(line, lang === 'pl-PL'
    ? `Wysłaliśmy e-mailem link do potwierdzenia zgłoszenia ${refText}. Otwórz go na dowolnym urządzeniu.`
    : `We've emailed a link to confirm claim ${refText}. Open it on any device.`);
  main.appendChild(line);

  // The sent page reads the confirmation status from the server. It never
  // compares the closing time with the browser's clock.
  const result = await apiJson<{ reference: string; link_state: string; confirm_by: string | null }>(
    `/api/claims/${encodeURIComponent(reference)}/confirmation`,
  );
  const lifetime = el('p', 'link-lifetime mono');
  main.appendChild(lifetime);
  if (result.status !== 200) {
    text(lifetime, ownerRefusalText((result.body as ApiErrorShape).error.code, lang));
    return;
  }
  const info = result.body as { reference: string; link_state: string; confirm_by: string | null };
  if (info.link_state === 'live' && info.confirm_by !== null) {
    const date = info.confirm_by.slice(0, 10);
    const hh = info.confirm_by.slice(11, 13);
    const mm = info.confirm_by.slice(14, 16);
    const shownDate = formatDate(date, lang);
    const shownTime = `${hh}:${mm}`;
    if (lang === 'pl-PL') {
      text(lifetime, `Link działa do ${shownTime} dnia ${shownDate} (czas brytyjski).`);
    } else {
      text(lifetime, `This link works until ${shownTime} on ${shownDate} (UK time).`);
    }
  } else if (info.link_state === 'used') {
    if (lang === 'pl-PL') {
      text(lifetime, 'To zgłoszenie jest już potwierdzone. Śledź je przez swój link.');
    } else {
      text(lifetime, 'This claim is already confirmed. Follow it through your share link.');
    }
  } else {
    text(lifetime, ownerRefusalText('link_lapsed', lang));
  }
}

// --- Confirmation page -----------------------------------------------------

function renderConfirmPage(
  main: HTMLElement, token: string, alertRegion: HTMLElement, statusRegion: HTMLElement,
): void {
  const heading = el('h2', 'page-heading');
  text(heading, strings().confirmHeading);
  main.appendChild(heading);
  main.appendChild(alertRegion);
  main.appendChild(statusRegion);

  const button = el('button', 'button primary confirm-button');
  button.type = 'button';
  text(button, strings().confirmButton);
  // Confirm my claim is enabled whenever its page is open and no confirm
  // request is pending. Nothing on the page judges the link's lifetime.
  main.appendChild(button);

  let pending = false;
  button.addEventListener('click', () => {
    if (pending) return;
    pending = true;
    button.disabled = true;
    text(statusRegion, strings().confirming);
    text(alertRegion, '');
    void apiJson<{ reference: string; state: string; share_url: string }>('/api/claims/confirm', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }).then(({ status, body }) => {
      pending = false;
      button.disabled = false;
      text(statusRegion, '');
      if (status === 200) {
        const ok = body as { share_url: string };
        navigate(ok.share_url);
        return;
      }
      text(alertRegion, ownerRefusalText((body as ApiErrorShape).error.code, getLanguage()));
    });
  });
}

// --- Share page ------------------------------------------------------------

async function renderSharePage(main: HTMLElement, token: string, alertRegion: HTMLElement): Promise<void> {
  const heading = el('h2', 'page-heading');
  main.appendChild(heading);
  main.appendChild(alertRegion);

  const layout = el('div', 'share-layout');
  const fanPane = el('div', 'share-fan');
  const slipPane = el('div', 'share-slip');
  layout.appendChild(fanPane);
  layout.appendChild(slipPane);
  main.appendChild(layout);

  let historyOpen = false;
  let lastScrollY = window.scrollY;
  const activeElement = document.activeElement;

  const load = async (initial: boolean): Promise<boolean> => {
    const result = await apiJson<ShareView>(`/api/share/${encodeURIComponent(token)}`);
    if (result.status === 410 || result.status === 404) {
      // The link has ended: the claim content is removed and the owner refusal
      // for that code shows.
      const err = (result.body as ApiErrorShape).error;
      layout.innerHTML = '';
      text(heading, `Zgłoszenie`); // replaced below by the refusal
      text(heading, ownerRefusalText(err.code, getLanguage()));
      text(alertRegion, ownerRefusalText(err.code, getLanguage()));
      return false;
    }
    if (result.status !== 200) {
      if (!initial) {
        // A refresh that answers 503 keeps the last loaded content.
        text(alertRegion, ownerRefusalText((result.body as ApiErrorShape).error.code, getLanguage()));
        return true;
      }
      const err = (result.body as ApiErrorShape).error;
      layout.innerHTML = '';
      text(heading, ownerRefusalText(err.code, getLanguage()));
      return false;
    }
    const view = result.body as ShareView;
    if (initial) text(alertRegion, '');
    const redraw = (): void => {
      void drawShareView(heading, fanPane, slipPane, view, () => {
        historyOpen = !historyOpen;
        redraw();
      }, historyOpen);
    };
    redraw();
    return true;
  };

  const ok = await load(true);
  if (ok) {
    window.scrollTo(0, lastScrollY);
    // Refresh in place every 30 seconds, without a page load. The scroll
    // position stays within 1 px and focus stays where it was.
    const timer = window.setInterval(() => {
      void load(false).then((keep) => {
        if (!keep) window.clearInterval(timer);
        window.scrollTo(0, lastScrollY);
      });
      lastScrollY = window.scrollY;
    }, 30_000);
  }
  void activeElement;
}


async function drawShareView(
  heading: HTMLElement, fanPane: HTMLElement, slipPane: HTMLElement,
  view: ShareView, toggleHistory: () => void, historyOpen: boolean,
): Promise<void> {
  const lang = (view.language === 'pl-PL' ? 'pl-PL' : 'en-GB') as Language;
  text(heading, lang === 'pl-PL' ? `Zgłoszenie ${view.reference}` : `Claim ${view.reference}`);

  // The fan shows the model's parts with the claimed part selected; the
  // owner cannot change the selection.
  fanPane.innerHTML = '';
  if (view.model !== null && view.part !== null) {
    let modelDetail: ModelDetail | null = null;
    const detail = await apiJson<ModelDetail>(`/api/models/${encodeURIComponent(view.model.name)}`);
    void detail;
    // The share view names the model; the public list maps names to slugs.
    const models = await apiJson<{ models: ModelSummary[] }>('/api/models');
    const slug = (models.body as { models: ModelSummary[] }).models.find((m) => m.name === view.model?.name)?.slug ?? '';
    if (slug !== '') {
      const res = await apiJson<ModelDetail>(`/api/models/${encodeURIComponent(slug)}`);
      if (res.status === 200) modelDetail = res.body as ModelDetail;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fan = createFan({
      model: { slug, name: view.model.name, axis: modelDetail ? modelDetail.axis : null },
      parts: modelDetail ? modelDetail.parts.map((p) => ({
        bookletNumber: p.booklet_number,
        name: p.name,
        partNumber: p.part_number,
        status: p.status,
      })) : [{
        bookletNumber: view.part.booklet_number,
        name: view.part.name,
        partNumber: view.part.part_number,
        status: 'active',
      }],
      selected: view.part.booklet_number,
      locked: true,
      // The share page starts at 100 when a part is already selected.
      initialSeparation: 100,
      reducedMotion,
      strings: () => ({
        separateParts: STRINGS[lang].separateParts,
        fanHeading: STRINGS[lang].fanHeading,
        diagramUnavailable: STRINGS[lang].diagramUnavailable,
        partsList: STRINGS[lang].partsList,
        partButton: (n, name) => (lang === 'pl-PL' ? `Część ${n}: ${name}` : `Part ${n}: ${name}`),
      }),
      onSelect: () => { /* read-only */ },
    });
    fan.root.setAttribute('aria-label', STRINGS[lang].fanHeading);
    fanPane.appendChild(fan.root);
  }

  // The claim slip.
  slipPane.innerHTML = '';
  const slip = el('section', 'slip');
  slip.setAttribute('role', 'region');
  slip.setAttribute('aria-label', STRINGS[lang].claimSlip);
  slipPane.appendChild(slip);

  const stateLine = el('p', 'slip-state');
  text(stateLine, stateLabel(view.state, lang));
  slip.appendChild(stateLine);

  if (view.part !== null && view.model !== null) {
    const partLine = el('p', 'slip-part');
    text(partLine, lang === 'pl-PL'
      ? `Część ${view.part.booklet_number}: ${view.part.name}`
      : `Part ${view.part.booklet_number}: ${view.part.name}`);
    slip.appendChild(partLine);
    const partNumber = el('p', 'slip-part-number mono');
    text(partNumber, lang === 'pl-PL'
      ? `Numer części ${view.part.part_number}`
      : `Part number ${view.part.part_number}`);
    slip.appendChild(partNumber);
  }

  if (view.ruling !== null) {
    const rulingLine = el('p', 'slip-ruling');
    text(rulingLine, view.ruling.inside ? STRINGS[lang].inside : STRINGS[lang].outside);
    slip.appendChild(rulingLine);
    const coverLine = el('p', 'slip-cover');
    const coverDate = view.ruling.cover_ends_on;
    const coverTime = view.ruling.cover_ends_at.slice(11, 13) + ':' + view.ruling.cover_ends_at.slice(14, 16);
    text(coverLine, lang === 'pl-PL'
      ? `Ochrona do ${coverTime} dnia ${formatDate(coverDate, lang)}`
      : `Cover until ${coverTime} on ${formatDate(coverDate, lang)}`);
    slip.appendChild(coverLine);
    const editionLine = el('p', 'slip-edition mono');
    text(editionLine, lang === 'pl-PL'
      ? `Rozstrzygnięto wg edycji ${view.ruling.edition}`
      : `Ruled by edition ${view.ruling.edition}`);
    slip.appendChild(editionLine);
    const editionCaption = el('p', 'source-caption mono');
    text(editionCaption, STRINGS[lang].editionSource);
    slip.appendChild(editionCaption);
  } else if (view.state === 'identified' || view.state === 'quoted' || view.state === 'dispatched') {
    const notRuled = el('p', 'slip-ruling');
    text(notRuled, STRINGS[lang].notYetRuled);
    slip.appendChild(notRuled);
  }

  if (view.quote !== null) {
    const revisionHeading = el('h3', 'slip-revision-heading mono');
    text(revisionHeading, lang === 'pl-PL'
      ? `Wycena nr ${view.quote.revision}`
      : `Quote revision ${view.quote.revision}`);
    slip.appendChild(revisionHeading);

    const partAmount = el('p', 'slip-line');
    text(partAmount, `${STRINGS[lang].partLine} ${formatMoney(view.quote.part_line_minor, lang)}`);
    slip.appendChild(partAmount);
    const partCaption = el('p', 'source-caption mono');
    text(partCaption, STRINGS[lang].billingSource);
    slip.appendChild(partCaption);

    const carriageLine = el('p', 'slip-line');
    text(carriageLine, lang === 'pl-PL'
      ? `Przesyłka, strefa ${view.quote.band} ${formatMoney(view.quote.carriage_minor, lang)}`
      : `Carriage, band ${view.quote.band} ${formatMoney(view.quote.carriage_minor, lang)}`);
    slip.appendChild(carriageLine);
    const carriageCaption = el('p', 'source-caption mono');
    text(carriageCaption, STRINGS[lang].carrierSource);
    slip.appendChild(carriageCaption);

    const totalLine = el('p', 'slip-line slip-total');
    text(totalLine, `${STRINGS[lang].total} ${formatMoney(view.quote.total_minor, lang)}`);
    slip.appendChild(totalLine);
    const totalCaption = el('p', 'source-caption mono');
    text(totalCaption, STRINGS[lang].billingSource);
    slip.appendChild(totalCaption);

    const promiseLine = el('p', 'slip-promise');
    const promiseDate = view.quote.promise.date;
    if (view.quote.promise.kind === 'same_day') {
      text(promiseLine, lang === 'pl-PL'
        ? `Wysyłka tego samego dnia roboczego: część wyjdzie z warsztatu ${formatDate(promiseDate, lang)}`
        : `Same-working-day dispatch: leaves the workshop on ${formatDate(promiseDate, lang)}`);
    } else {
      text(promiseLine, lang === 'pl-PL'
        ? `Część wyjdzie z warsztatu najpóźniej ${formatDate(promiseDate, lang)}`
        : `Leaves the workshop by ${formatDate(promiseDate, lang)}`);
    }
    slip.appendChild(promiseLine);
  }

  if (view.paid_minor !== null) {
    const paidLine = el('p', 'slip-paid');
    text(paidLine, lang === 'pl-PL'
      ? `Zapłacono ${formatMoney(view.paid_minor, lang)}`
      : `Paid ${formatMoney(view.paid_minor, lang)}`);
    slip.appendChild(paidLine);
    const paidCaption = el('p', 'source-caption mono');
    text(paidCaption, STRINGS[lang].billingSource);
    slip.appendChild(paidCaption);
  }

  if (view.decline !== null) {
    const declineLine = el('p', 'slip-decline');
    if (view.decline.refunded_minor > 0) {
      text(declineLine, lang === 'pl-PL'
        ? `Zwrócono ${formatMoney(view.decline.refunded_minor, lang)}`
        : `Refunded ${formatMoney(view.decline.refunded_minor, lang)}`);
    } else {
      text(declineLine, STRINGS[lang].declineNothing);
    }
    slip.appendChild(declineLine);
    const declineCaption = el('p', 'source-caption mono');
    text(declineCaption, STRINGS[lang].billingSource);
    slip.appendChild(declineCaption);
  }

  // Claim history disclosure.
  const historyButton = el('button', 'button ghost disclosure');
  historyButton.type = 'button';
  historyButton.setAttribute('aria-expanded', historyOpen ? 'true' : 'false');
  text(historyButton, STRINGS[lang].claimHistory);
  historyButton.addEventListener('click', toggleHistory);
  slip.appendChild(historyButton);
  if (historyOpen) {
    const list = el('ul', 'history-list');
    for (const entry of view.history) {
      const li = el('li', 'history-entry');
      const date = entry.at.slice(0, 10);
      const time = entry.at.slice(11, 13) + ':' + entry.at.slice(14, 16);
      text(li, lang === 'pl-PL'
        ? `${stateLabel(entry.state, lang)}, ${time} dnia ${formatDate(date, lang)}`
        : `${stateLabel(entry.state, lang)}, ${time} on ${formatDate(date, lang)}`);
      list.appendChild(li);
    }
    slip.appendChild(list);
  }
}

// --- Find page -------------------------------------------------------------

function renderFindPage(main: HTMLElement, alertRegion: HTMLElement, statusRegion: HTMLElement): void {
  const heading = el('h2', 'page-heading');
  text(heading, strings().findHeading);
  main.appendChild(heading);
  main.appendChild(alertRegion);
  main.appendChild(statusRegion);

  const form = el('form', 'find-form') as HTMLFormElement;
  const referenceInput = el('input', 'textbox') as HTMLInputElement;
  referenceInput.type = 'text';
  referenceInput.id = 'find-reference';
  referenceInput.setAttribute('aria-label', strings().claimRef);
  const emailInput = el('input', 'textbox') as HTMLInputElement;
  emailInput.type = 'email';
  emailInput.id = 'find-email';
  emailInput.setAttribute('aria-label', strings().email);

  const refLabel = el('label', 'field-label');
  text(refLabel, strings().claimRef);
  refLabel.htmlFor = 'find-reference';
  const emailLabel = el('label', 'field-label');
  text(emailLabel, strings().email);
  emailLabel.htmlFor = 'find-email';

  const submit = el('button', 'button primary');
  submit.type = 'submit';
  text(submit, strings().findButton);

  form.appendChild(refLabel);
  form.appendChild(referenceInput);
  form.appendChild(emailLabel);
  form.appendChild(emailInput);
  form.appendChild(submit);
  main.appendChild(form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    text(statusRegion, strings().findingClaim);
    text(alertRegion, '');
    void apiJson<{ share_url: string }>('/api/claims/lookup', {
      method: 'POST',
      body: JSON.stringify({ reference: referenceInput.value, email: emailInput.value }),
    }).then(({ status, body }) => {
      submit.disabled = false;
      text(statusRegion, '');
      if (status === 200) {
        navigate((body as { share_url: string }).share_url);
        return;
      }
      text(alertRegion, ownerRefusalText((body as ApiErrorShape).error.code, getLanguage()));
    });
  });
}

// ---------------------------------------------------------------------------
// Operator pages
// ---------------------------------------------------------------------------

async function renderOperatorPage(frame: HTMLElement, path: string): Promise<void> {
  const { status: statusRegion, alert: alertRegion } = liveRegions();
  const carried = takePendingStatus();

  const sessionCheck = await fetch('/api/ops/stats', { credentials: 'same-origin' });
  if (sessionCheck.status === 401) {
    // Opening any operator address without a live session goes to sign-in.
    if (path !== '/ops/sign-in') {
      history.replaceState(null, '', '/ops/sign-in');
    }
    renderSignIn(frame, alertRegion, statusRegion);
    return;
  }

  if (path === '/ops/sign-in') {
    history.replaceState(null, '', '/ops/claims');
  }

  if (path === '/ops/claims' || path === '/ops/claims/') {
    await renderQueuePage(frame, alertRegion, statusRegion);
    if (carried !== null) text(statusRegion, carried);
    return;
  }

  const workspaceMatch = /^\/ops\/claims\/([^/]+)(\/.*)?$/.exec(path);
  if (workspaceMatch) {
    const reference = workspaceMatch[1] ?? '';
    await renderWorkspace(frame, reference, alertRegion, statusRegion, workspaceMatch[2] ?? '');
    if (carried !== null) text(statusRegion, carried);
    return;
  }

  if (path === '/ops/imports') {
    await renderImportsPage(frame, alertRegion, statusRegion);
    if (carried !== null) text(statusRegion, carried);
    return;
  }

  if (path === '/ops/editions') {
    await renderEditionsPage(frame, alertRegion, statusRegion);
    if (carried !== null) text(statusRegion, carried);
    return;
  }

  const main = el('main');
  text(main, 'Not found');
  frame.appendChild(main);
}

function renderSignIn(frame: HTMLElement, alertRegion: HTMLElement, statusRegion: HTMLElement): void {
  frame.appendChild(skipLink('operator'));
  const header = el('header', 'page-header');
  const h = el('h1', 'brand');
  text(h, 'Holmgarth Aftercare');
  header.appendChild(h);
  frame.appendChild(header);

  const main = el('main', 'sign-in-page');
  main.id = 'main';
  const heading = el('h2', 'page-heading');
  text(heading, 'Operator sign-in');
  main.appendChild(heading);
  main.appendChild(alertRegion);
  main.appendChild(statusRegion);

  const form = el('form', 'sign-in-form') as HTMLFormElement;
  const emailInput = el('input', 'textbox') as HTMLInputElement;
  emailInput.type = 'email';
  emailInput.id = 'ops-email';
  emailInput.setAttribute('aria-label', 'Email');
  const emailLabel = el('label', 'field-label');
  text(emailLabel, 'Email');
  emailLabel.htmlFor = 'ops-email';
  const passwordInput = el('input', 'textbox') as HTMLInputElement;
  passwordInput.type = 'password';
  passwordInput.id = 'ops-password';
  passwordInput.setAttribute('aria-label', 'Password');
  const passwordLabel = el('label', 'field-label');
  text(passwordLabel, 'Password');
  passwordLabel.htmlFor = 'ops-password';
  const submit = el('button', 'button primary');
  submit.type = 'submit';
  text(submit, 'Sign in');

  form.appendChild(emailLabel);
  form.appendChild(emailInput);
  form.appendChild(passwordLabel);
  form.appendChild(passwordInput);
  form.appendChild(submit);
  main.appendChild(form);
  frame.appendChild(main);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    text(statusRegion, 'Working…');
    void apiJson<unknown>('/api/ops/session', {
      method: 'POST',
      body: JSON.stringify({ email: emailInput.value, password: passwordInput.value }),
    }).then(({ status, body }) => {
      submit.disabled = false;
      text(statusRegion, '');
      if (status === 204 || status === 200) {
        navigate('/ops/claims');
        return;
      }
      const err = (body as ApiErrorShape).error;
      text(alertRegion, err.message);
    });
  });
}

async function renderQueuePage(frame: HTMLElement, alertRegion: HTMLElement, statusRegion: HTMLElement): Promise<void> {
  frame.appendChild(skipLink('operator'));
  const header = el('header', 'page-header');
  const h = el('h1', 'brand');
  text(h, 'Holmgarth Aftercare');
  header.appendChild(h);
  frame.appendChild(header);

  const main = el('main', 'queue-page');
  main.id = 'main';
  const heading = el('h2', 'page-heading');
  text(heading, 'Claims');
  main.appendChild(heading);

  // The queue page has its own named status region for the decided count.
  const decidedStatus = el('div', 'decided-status');
  decidedStatus.setAttribute('role', 'status');
  decidedStatus.setAttribute('aria-label', 'Decided claims');
  main.appendChild(decidedStatus);
  main.appendChild(alertRegion);
  main.appendChild(statusRegion);

  const models = await apiJson<{ models: ModelSummary[] }>('/api/models');

  const tableRegion = el('div', 'table-region');
  tableRegion.setAttribute('role', 'region');
  tableRegion.setAttribute('aria-label', 'Claims');
  const table = el('table', 'claims-table');
  table.setAttribute('aria-label', 'Claims');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Reference', 'State', 'Model', 'Confirmed']) {
    const th = el('th');
    text(th, label);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el('tbody');
  table.appendChild(tbody);
  tableRegion.appendChild(table);
  main.appendChild(tableRegion);
  frame.appendChild(main);

  const list = await apiJson<{ claims: Array<{ reference: string; state: string; model: string | null; confirmed_at: string | null }> }>('/api/ops/claims');
  const stats = await apiJson<{ decided_claims: number; decided_inside: number; decided_outside: number }>('/api/ops/stats');

  if (list.status === 200 && stats.status === 200) {
    const claims = (list.body as { claims: Array<{ reference: string; state: string; model: string | null; confirmed_at: string | null }> }).claims;
    const stat = stats.body as { decided_claims: number; decided_inside: number; decided_outside: number };
    for (const claim of claims) {
      const tr = el('tr');
      const refCell = el('td');
      const link = el('a', 'claim-link mono');
      link.href = `/ops/claims/${claim.reference}`;
      text(link, claim.reference);
      refCell.appendChild(link);
      tr.appendChild(refCell);
      const stateCell = el('td');
      text(stateCell, claim.state);
      tr.appendChild(stateCell);
      const modelCell = el('td');
      const modelSummary = (models.body as { models: ModelSummary[] }).models.find((m) => m.slug === claim.model);
      text(modelCell, modelSummary ? modelSummary.name : (claim.model ?? ''));
      tr.appendChild(modelCell);
      const confirmedCell = el('td');
      text(confirmedCell, claim.confirmed_at === null ? '' : claim.confirmed_at.slice(0, 10));
      tr.appendChild(confirmedCell);
      tbody.appendChild(tr);
    }
    text(decidedStatus, `Decided claims: ${stat.decided_claims} (inside ${stat.decided_inside}, outside ${stat.decided_outside})`);
  } else {
    text(alertRegion, (list.body as ApiErrorShape).error.message);
  }
}

export { formatMoney, formatDate, stateLabel };
export type { Language, Strings };
