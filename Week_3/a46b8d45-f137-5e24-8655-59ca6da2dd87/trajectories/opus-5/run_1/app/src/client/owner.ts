/**
 * The owner's screens in the browser: the claim form, the sent page, confirmation, find my
 * claim and the share page.
 */

import {
  ApiRefusal,
  callApi,
  clearAlert,
  clearStatus,
  deskData,
  find,
  findAll,
  language,
  pendingText,
  refusalText,
  fieldErrorText,
  showAlert,
  showStatus,
  whilePressed,
} from './dom';
import { estimateShown, linkLifetimeLine, partLine, partNumberLine, SENT_PAGE_ALREADY_CONFIRMED } from '../shared/copy';
import { FittingFan } from './fan';
import { renderFan, type FanPart } from '../shared/fan-view';
import type { Language } from '../shared/format';

interface ModelDetail {
  slug: string;
  name: string;
  axis: 'x' | 'y' | 'iso' | null;
  diagram: boolean;
  parts: { booklet_number: number; part_number: string; name: string; status: 'active' | 'withdrawn' }[];
}

function clearFieldErrors(): void {
  for (const holder of findAll<HTMLElement>('[data-field-error]')) holder.textContent = '';
}

function showFieldError(field: string): void {
  // The model and the booklet number share the claim form's one part message.
  const name = field === 'booklet_number' ? 'model' : field;
  const holder = find<HTMLElement>(`[data-field-error="${name}"]`);
  if (holder !== null) holder.textContent = fieldErrorText(field);
}

/* ----------------------------------------------------------------------- claim form */

export function wireClaimForm(): void {
  const form = find<HTMLFormElement>('#claim-form');
  if (form === null) return;

  const modelSelect = find<HTMLSelectElement>('#model');
  const fanHolder = find<HTMLElement>('.fan');
  let fan = fanHolder === null ? null : new FittingFan(fanHolder);
  let chosenPart: FanPart | null = null;

  const showChosenPart = (booklet: number, parts: ModelDetail['parts']): void => {
    const part = parts.find((candidate) => candidate.booklet_number === booklet);
    if (part === undefined) return;
    chosenPart = { bookletNumber: part.booklet_number, name: part.name, status: part.status };
    const holder = find<HTMLElement>('#selected-part');
    if (holder === null) return;
    const lines = (code: Language): string =>
      `${partLine(part.booklet_number, part.name, code)} · ${partNumberLine(part.part_number, code)}`;
    holder.setAttribute('data-en', lines('en-GB'));
    holder.setAttribute('data-pl', lines('pl-PL'));
    holder.textContent = lines(language());
    holder.classList.add('mono');
  };

  let parts: ModelDetail['parts'] = [];

  /** Choosing a model draws its fan. */
  const drawModel = async (slug: string): Promise<void> => {
    const detail = await callApi<ModelDetail>(`/api/models/${encodeURIComponent(slug)}`);
    parts = detail.parts;
    const markup = renderFan({
      parts: detail.parts.map((part) => ({
        bookletNumber: part.booklet_number,
        name: part.name,
        status: part.status,
      })),
      axis: detail.axis,
      language: language(),
      selected: null,
      value: 0,
      readOnly: false,
    });
    const current = find<HTMLElement>('.fan');
    if (current === null) return;
    current.outerHTML = markup;
    const fresh = find<HTMLElement>('.fan');
    fan = fresh === null ? null : new FittingFan(fresh);
    chosenPart = null;
    const holder = find<HTMLElement>('#selected-part');
    if (holder !== null) holder.textContent = '';
    fan?.whenSelected((booklet) => showChosenPart(booklet, parts));
  };

  if (modelSelect !== null) {
    void drawModel(modelSelect.value);
    modelSelect.addEventListener('change', () => void drawModel(modelSelect.value));
  }
  fan?.whenSelected((booklet) => showChosenPart(booklet, parts));

  wireEstimate(() => ({ model: modelSelect?.value ?? '', booklet: chosenPart?.bookletNumber ?? null }));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void startClaim();
  });

  const startClaim = async (): Promise<void> => {
    const button = find<HTMLButtonElement>('#start-claim');
    clearFieldErrors();
    clearAlert();
    showStatus(pendingText('claimStart'));

    const body = new FormData();
    body.set('name', find<HTMLInputElement>('#name')?.value ?? '');
    body.set('email', find<HTMLInputElement>('#email')?.value ?? '');
    body.set('postcode', find<HTMLInputElement>('#postcode')?.value ?? '');
    body.set('model', modelSelect?.value ?? '');
    body.set('booklet_number', chosenPart === null ? '' : String(chosenPart.bookletNumber));
    body.set('quantity', find<HTMLInputElement>('#quantity')?.value ?? '');
    body.set('purchase_date', find<HTMLInputElement>('#purchase_date')?.value ?? '');
    body.set('description', find<HTMLTextAreaElement>('#description')?.value ?? '');
    body.set('language', language());

    const chooser = find<HTMLInputElement>('#photos');
    const files = Array.from(chooser?.files ?? []);
    for (const file of files) body.append('photos', file);

    try {
      const result = await whilePressed(button, () =>
        callApi<{ reference: string }>('/api/claims', { method: 'POST', form: body }),
      );
      clearStatus();
      // The address bar moves to the sent page on its own.
      window.location.assign(`/claim/${result.reference}/sent`);
    } catch (error) {
      clearStatus();
      if (!(error instanceof ApiRefusal)) throw error;
      reportClaimRefusal(error, files);
    }
  };
}

/** Field errors sit next to their fields, each refused photo is named, and the alert takes focus. */
function reportClaimRefusal(error: ApiRefusal, files: readonly File[]): void {
  const fields = error.failure.fields ?? {};
  const messages: string[] = [];

  for (const [field, code] of Object.entries(fields)) {
    const photo = /^photos\.(\d+)$/.exec(field);
    if (photo !== null) {
      const position = Number(photo[1]);
      const file = files[position - 1];
      const name = file === undefined ? '' : file.name.split(/[/\\]/).pop() ?? '';
      messages.push(refusalText(code, { file: name }));
      continue;
    }
    if (field === 'photos') {
      messages.push(refusalText('photo_count'));
      continue;
    }
    showFieldError(field);
    messages.push(fieldErrorText(field));
  }

  if (messages.length === 0) messages.push(refusalText(error.failure.code));
  listPhotoRefusals(messages);
  // The alert region carries the first refusal message and takes focus.
  showAlert(messages[0] ?? '', true);
}

function listPhotoRefusals(messages: readonly string[]): void {
  const holder = find<HTMLElement>('[data-field-error="photos"]');
  if (holder !== null) holder.textContent = messages.join(' ');
}

/* ----------------------------------------------------------------- carriage estimate */

/**
 * The estimate region always shows the answer to the newest press. An answer to an earlier
 * press that arrives later is thrown away and never shown, even for a moment.
 */
function wireEstimate(selection: () => { model: string; booklet: number | null }): void {
  const button = find<HTMLButtonElement>('#estimate-carriage');
  const region = find<HTMLElement>('#estimate-value');
  if (button === null || region === null) return;

  let newestPress = 0;
  // The button stays enabled while an estimate is pending, so the postcode can change.
  button.addEventListener('click', () => {
    const press = ++newestPress;
    const { model, booklet } = selection();
    const quantity = find<HTMLInputElement>('#quantity')?.value ?? '';
    const postcode = find<HTMLInputElement>('#postcode')?.value ?? '';

    showStatus(pendingText('estimate'));
    const query = new URLSearchParams({
      model,
      part: booklet === null ? '' : String(booklet),
      quantity,
      postcode,
    });

    void callApi<{ band: string; charge_minor: number }>(`/api/carriage-estimate?${query.toString()}`)
      .then((answer) => {
        if (press !== newestPress) return;
        clearStatus();
        clearAlert();
        const shown = (code: Language): string => estimateShown(answer.band, answer.charge_minor, code);
        region.setAttribute('data-en', shown('en-GB'));
        region.setAttribute('data-pl', shown('pl-PL'));
        region.textContent = shown(language());
      })
      .catch((error: unknown) => {
        if (press !== newestPress) return;
        clearStatus();
        region.textContent = '';
        region.removeAttribute('data-en');
        region.removeAttribute('data-pl');
        // Failing to get an estimate never disables Start claim.
        if (error instanceof ApiRefusal) showAlert(refusalText(error.failure.code));
      });
  });
}

/* ------------------------------------------------------------------------ sent page */

interface ConfirmationStatus {
  reference: string;
  link_state: 'live' | 'lapsed' | 'used';
  confirm_by: string;
}

/** The link-lifetime line is the server's closing time; the browser never judges it. */
export function wireSentPage(): void {
  const holder = find<HTMLElement>('.sent-page');
  const line = find<HTMLElement>('#link-lifetime');
  if (holder === null || line === null) return;
  const reference = holder.dataset['reference'] ?? '';

  const setLine = (texts: { 'en-GB': string; 'pl-PL': string }): void => {
    line.setAttribute('data-en', texts['en-GB']);
    line.setAttribute('data-pl', texts['pl-PL']);
    line.textContent = texts[language()];
  };

  void callApi<ConfirmationStatus>(`/api/claims/${encodeURIComponent(reference)}/confirmation`)
    .then((status) => {
      if (status.link_state === 'live') {
        setLine({
          'en-GB': linkLifetimeLine(status.confirm_by, 'en-GB'),
          'pl-PL': linkLifetimeLine(status.confirm_by, 'pl-PL'),
        });
        return;
      }
      if (status.link_state === 'used') {
        setLine(SENT_PAGE_ALREADY_CONFIRMED);
        return;
      }
      // A lapsed link shows its refusal in place of the link-lifetime line.
      const lapsed = deskData().copy.refusals['link_lapsed'];
      if (lapsed !== undefined) setLine(lapsed);
    })
    .catch((error: unknown) => {
      if (!(error instanceof ApiRefusal)) return;
      const pair = deskData().copy.refusals[error.failure.code];
      if (pair !== undefined) setLine(pair);
    });
}

/* ---------------------------------------------------------------- confirmation page */

export function wireConfirmPage(): void {
  const button = find<HTMLButtonElement>('#confirm-claim');
  if (button === null) return;
  const token = deskData().confirmToken ?? '';

  button.addEventListener('click', () => {
    clearAlert();
    showStatus(pendingText('confirm'));
    void whilePressed(button, () =>
      callApi<{ share_url: string }>('/api/claims/confirm', { method: 'POST', body: { token } }),
    )
      .then((answer) => {
        clearStatus();
        window.location.assign(answer.share_url);
      })
      .catch((error: unknown) => {
        clearStatus();
        if (error instanceof ApiRefusal) showAlert(refusalText(error.failure.code));
      });
  });
}

/* ------------------------------------------------------------------------ find page */

export function wireFindPage(): void {
  const form = find<HTMLFormElement>('#find-form');
  if (form === null) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = find<HTMLButtonElement>('#find-claim');
    clearAlert();
    showStatus(pendingText('find'));
    void whilePressed(button, () =>
      callApi<{ share_url: string }>('/api/claims/lookup', {
        method: 'POST',
        body: {
          reference: find<HTMLInputElement>('#reference')?.value ?? '',
          email: find<HTMLInputElement>('#email')?.value ?? '',
        },
      }),
    )
      .then((answer) => {
        clearStatus();
        window.location.assign(answer.share_url);
      })
      .catch((error: unknown) => {
        clearStatus();
        if (error instanceof ApiRefusal) showAlert(refusalText(error.failure.code));
      });
  });
}
