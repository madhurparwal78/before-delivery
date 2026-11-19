import { newIdempotencyKey, sendMultipart, getJson } from '../shared/api.ts';
import { el } from '../shared/dom.ts';
import { monthLabel } from '../../shared/dates.ts';
import { checkReferenceFile, REFERENCE_SIZE_LIMIT } from './wavCheck.ts';

const RETRY_DELAY_MS = 3_000;
const MAX_AUTOMATIC_RETRIES = 5;
const MONTH_POLL_MS = 2_000;

const COPY = {
  pending: 'Sending your brief\u2026',
  fieldErrors: 'Check the highlighted fields.',
  tooLarge: `That file is too large. The limit is ${REFERENCE_SIZE_LIMIT.toLocaleString('en-US')} bytes.`,
  unsupported: 'That file type isn\u2019t accepted. Send WAV, OGG, MP3 or PDF.',
  storage:
    'Reference files can\u2019t be stored right now. Send the brief without the file, or try again later.',
  wavFormat: 'That WAV isn\u2019t PCM or float audio. Send WAV, OGG, MP3 or PDF.',
  wavChannels: 'That WAV must have one or two channels. Send a mono or stereo file.',
  wavSampleRate: 'That WAV\u2019s sample rate isn\u2019t accepted. Use 22,050 to 96,000 Hz.',
  wavDecode: 'That WAV can\u2019t be decoded. Send another file.',
  connectionLost: 'Connection lost. Retrying your brief\u2026',
  couldNotConfirm:
    "We couldn't confirm your brief was received. Press Send brief to try again. It won't be sent twice.",
  other: 'Something went wrong. Your brief was not sent.',
} as const;

function waitCopy(retryAfterSeconds: number): string {
  if (retryAfterSeconds < 120) return `${retryAfterSeconds} seconds`;
  return `${Math.ceil(retryAfterSeconds / 60)} minutes`;
}

type Fields = {
  name: HTMLInputElement;
  email: HTMLInputElement;
  studio: HTMLInputElement;
  brief: HTMLTextAreaElement;
  month: HTMLSelectElement;
  file: HTMLInputElement;
};

export type BriefFormOptions = {
  listenToken: string | null;
  currentStationSlug: () => string | null;
};

export type BriefForm = {
  element: HTMLFormElement;
  status: HTMLElement;
  stop: () => void;
};

function labelledField(
  id: string,
  label: string,
  control: HTMLElement,
): { wrapper: HTMLElement; error: HTMLElement } {
  const error = el('p', { class: 'field-error', id: `${id}-error`, role: 'presentation' });
  const wrapper = el('div', { class: 'field' }, [
    el('label', { for: id, text: label }),
    control,
    error,
  ]);
  return { wrapper, error };
}

export function createBriefForm(options: BriefFormOptions): BriefForm {
  const fields: Fields = {
    name: el('input', { id: 'brief-name', type: 'text', name: 'name', autocomplete: 'name' }),
    email: el('input', { id: 'brief-email', type: 'email', name: 'email', autocomplete: 'email' }),
    studio: el('input', { id: 'brief-studio', type: 'text', name: 'studio', autocomplete: 'organization' }),
    brief: el('textarea', { id: 'brief-brief', name: 'brief', rows: 6 }),
    month: el('select', { id: 'brief-month', name: 'preferred_month' }),
    file: el('input', { id: 'brief-file', type: 'file', name: 'attachment' }),
  };
  fields.month.append(el('option', { value: '', text: 'No preference' }));

  const status = el('p', { class: 'status-line', role: 'status', 'aria-label': 'Brief status' });
  const progress = el('div', {
    class: 'upload-progress',
    role: 'progressbar',
    'aria-label': 'Reference upload',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': 0,
  });
  const progressBar = el('span', { class: 'upload-progress-bar' });
  const progressText = el('span', { class: 'upload-progress-text', text: '0%' });
  progress.append(progressBar, progressText);

  const submit = el('button', { type: 'submit', class: 'primary', text: 'Send brief' });

  const nameField = labelledField('brief-name', 'Your name', fields.name);
  const emailField = labelledField('brief-email', 'Email', fields.email);
  const studioField = labelledField('brief-studio', 'Studio', fields.studio);
  const briefField = labelledField('brief-brief', 'Brief', fields.brief);
  const monthField = labelledField('brief-month', 'Preferred production month', fields.month);
  const fileField = labelledField('brief-file', 'Reference file (optional)', fields.file);

  const form = el('form', { class: 'brief-form', 'aria-label': 'Send a brief', novalidate: true }, [
    el('h2', { class: 'section-heading', text: 'Send a brief' }),
    nameField.wrapper,
    emailField.wrapper,
    studioField.wrapper,
    briefField.wrapper,
    monthField.wrapper,
    fileField.wrapper,
    submit,
    status,
  ]);

  const errorFor: Record<string, { control: HTMLElement; error: HTMLElement }> = {
    name: { control: fields.name, error: nameField.error },
    email: { control: fields.email, error: emailField.error },
    studio: { control: fields.studio, error: studioField.error },
    brief: { control: fields.brief, error: briefField.error },
    preferred_month: { control: fields.month, error: monthField.error },
    attachment: { control: fields.file, error: fileField.error },
  };

  const clearErrors = (): void => {
    for (const entry of Object.values(errorFor)) {
      entry.error.textContent = '';
      entry.control.removeAttribute('aria-invalid');
    }
  };

  const showFieldErrors = (errors: Record<string, string>): void => {
    clearErrors();
    let firstInvalid: HTMLElement | null = null;
    for (const [field, message] of Object.entries(errors)) {
      const entry = errorFor[field];
      if (entry === undefined) continue;
      entry.error.textContent = message;
      entry.control.setAttribute('aria-invalid', 'true');
      firstInvalid ??= entry.control;
    }
    status.textContent = COPY.fieldErrors;
    firstInvalid?.focus();
  };

  let heldKey: string | null = null;
  let lastSignature: string | null = null;
  let sending = false;
  let retryTimer: number | null = null;
  let knownMonths: string[] = [];

  const signature = (): string => {
    const file = fields.file.files?.[0] ?? null;
    return JSON.stringify([
      fields.name.value,
      fields.email.value,
      fields.studio.value,
      fields.brief.value,
      fields.month.value,
      file === null ? null : [file.name, file.size, file.lastModified],
    ]);
  };

  const setSending = (active: boolean): void => {
    sending = active;
    submit.disabled = active;
    submit.textContent = active ? 'Sending\u2026' : 'Send brief';
  };

  const showProgress = (shown: boolean): void => {
    if (shown && progress.parentElement === null) submit.before(progress);
    if (!shown) progress.remove();
  };

  const buildForm = (): FormData => {
    const body = new FormData();
    body.set('name', fields.name.value);
    body.set('email', fields.email.value);
    body.set('studio', fields.studio.value);
    body.set('brief', fields.brief.value);
    if (fields.month.value !== '') body.set('preferred_month', fields.month.value);
    if (options.listenToken !== null) body.set('listen_token', options.listenToken);
    else {
      const slug = options.currentStationSlug();
      if (slug !== null) body.set('project_slug', slug);
    }
    const file = fields.file.files?.[0];
    if (file !== undefined) body.set('attachment', file, file.name);
    return body;
  };

  const onSuccess = (reference: string): void => {
    heldKey = null;
    lastSignature = null;
    form.reset();
    fields.month.value = '';
    clearErrors();
    status.textContent = `Brief ${reference} received. A receipt will follow by email.`;
  };

  const attempt = async (key: string, attemptsLeft: number): Promise<void> => {
    const hasFile = (fields.file.files?.length ?? 0) > 0;
    if (hasFile) {
      progress.setAttribute('aria-valuenow', '0');
      progressText.textContent = '0%';
      progressBar.style.width = '0%';
      showProgress(true);
    }
    const result = await sendMultipart<{ reference: string }>('/api/enquiries', buildForm(), {
      headers: { 'Idempotency-Key': key },
      onProgress: (sent, total) => {
        const percent = total === 0 ? 0 : Math.floor((sent / total) * 100);
        progress.setAttribute('aria-valuenow', String(percent));
        progressText.textContent = `${percent}%`;
        progressBar.style.width = `${percent}%`;
      },
    });
    showProgress(false);

    if (result.ok) {
      setSending(false);
      onSuccess(result.data.reference);
      return;
    }
    if (result.status === 0 || result.code === 'request_in_progress') {
      if (attemptsLeft > 0) {
        status.textContent = COPY.connectionLost;
        retryTimer = window.setTimeout(() => void attempt(key, attemptsLeft - 1), RETRY_DELAY_MS);
        return;
      }
      setSending(false);
      status.textContent = COPY.couldNotConfirm;
      return;
    }

    setSending(false);
    if (result.status === 422) {
      showFieldErrors(result.errors);
      return;
    }
    if (result.status === 429) {
      const seconds = Number(result.body.retry_after_seconds ?? 1);
      status.textContent = `You have sent several briefs in a short time. Try again in ${waitCopy(seconds)}.`;
      return;
    }
    if (result.status === 413) {
      status.textContent = COPY.tooLarge;
      return;
    }
    if (result.status === 415) {
      status.textContent = COPY.unsupported;
      return;
    }
    if (result.status === 503) {
      status.textContent = COPY.storage;
      return;
    }
    status.textContent = COPY.other;
  };

  const rejectionCopy = {
    size: COPY.tooLarge,
    format: COPY.wavFormat,
    channels: COPY.wavChannels,
    'sample-rate': COPY.wavSampleRate,
    decode: COPY.wavDecode,
  } as const;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (sending) return;
    void (async () => {
      const file = fields.file.files?.[0] ?? null;
      if (file !== null) {
        const checked = await checkReferenceFile(file);
        if (checked.outcome === 'rejected') {
          status.textContent = rejectionCopy[checked.reason];
          fields.file.focus();
          return;
        }
      }
      const current = signature();
      if (heldKey === null || lastSignature !== current) heldKey = newIdempotencyKey();
      lastSignature = current;
      clearErrors();
      setSending(true);
      status.textContent = COPY.pending;
      await attempt(heldKey, MAX_AUTOMATIC_RETRIES);
    })();
  });

  for (const control of [fields.name, fields.email, fields.studio]) {
    control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        form.requestSubmit();
      }
    });
  }

  const refreshMonths = async (): Promise<void> => {
    const result = await getJson<{ months: Array<{ month: string; label: string }> }>('/api/months');
    if (!result.ok) return;
    const months = result.data.months;
    const keys = months.map((month) => month.month);
    if (keys.join(',') === knownMonths.join(',')) return;
    const selected = fields.month.value;
    knownMonths = keys;
    while (fields.month.options.length > 1) fields.month.remove(1);
    for (const month of months) {
      fields.month.append(el('option', { value: month.month, text: month.label }));
    }
    if (selected !== '' && !keys.includes(selected)) {
      fields.month.value = '';
      status.textContent = `${monthLabel(selected)} is now fully booked. Choose another month or No preference.`;
    } else {
      fields.month.value = selected;
    }
  };

  fields.month.addEventListener('focus', () => void refreshMonths());
  void refreshMonths();
  const poll = window.setInterval(() => void refreshMonths(), MONTH_POLL_MS);

  return {
    element: form,
    status,
    stop: () => {
      window.clearInterval(poll);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    },
  };
}
