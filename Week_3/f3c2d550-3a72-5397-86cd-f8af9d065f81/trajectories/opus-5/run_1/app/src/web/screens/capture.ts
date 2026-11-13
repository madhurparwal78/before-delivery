import { DECK_STATUS } from '../../shared/copy.js';
import { ApiCallError, api, newIdempotencyKey } from '../api.js';
import { element } from '../dom.js';
import { openEyedropper } from '../eyedropper.js';
import { buildFactsForm } from '../factsForm.js';
import type { Screen, ScreenContext } from './screen.js';

const NO_PHOTO_YET = 'Choose a photograph to see it here.';

/** Capture: a photograph, the facts and one save. */
export function renderCapture({ shell, navigate }: ScreenContext): Screen {
  let photoUrl: string | null = null;
  let swatchPoint: { x: number; y: number } | null = null;
  let pending = false;
  let idempotencyKey = newIdempotencyKey();

  const form = buildFactsForm({
    includePhoto: true,
    unit: shell.sizeUnit,
    onPhotoChosen: (file) => showChosenPhoto(file),
  });

  const save = element('button', { type: 'button', class: 'action primary' }, ['Save to deck']);
  const heading = element('h1', {}, ['Capture an object']);
  // Screen heading, primary action, then the form, as the published layout orders them.
  shell.main.append(heading, save, form.root);

  shell.field.showMessage(NO_PHOTO_YET);

  function showChosenPhoto(file: File | null): void {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = file ? URL.createObjectURL(file) : null;
    swatchPoint = null;
    if (!photoUrl) {
      shell.field.showMessage(NO_PHOTO_YET);
      return;
    }
    shell.field.showSingle(
      {
        key: 'capture',
        title: form.values().title || 'New reference',
        maker: null,
        year: null,
        sizeLine: '',
        swatch: '#2a1620',
        photoUrl,
      },
      { wholePhoto: true },
    );
  }

  form.pickSwatch.addEventListener('click', () => {
    if (!photoUrl) return;
    openEyedropper({
      photo: shell.field.photoElement,
      container: shell.field.tileElement,
      opener: form.pickSwatch,
      initial: swatchPoint,
      onPick: (x, y) => {
        swatchPoint = { x, y };
      },
      onClose: () => undefined,
    });
  });

  async function submit(): Promise<void> {
    if (pending) return;
    pending = true;
    save.setAttribute('aria-disabled', 'true');
    shell.setDeckStatus(DECK_STATUS.capturePending);
    form.clearErrors();

    const body = new FormData();
    for (const [name, value] of Object.entries(form.values())) body.set(name, value);
    const file = form.photoInput?.files?.[0];
    if (file) body.set('photo', file, file.name);
    if (swatchPoint) {
      body.set('swatch_x', String(swatchPoint.x));
      body.set('swatch_y', String(swatchPoint.y));
    }

    try {
      await api.capture(body, idempotencyKey);
      form.clear();
      if (form.photoInput) form.photoInput.value = '';
      swatchPoint = null;
      idempotencyKey = newIdempotencyKey();
      navigate('/library');
      shell.setDeckStatus(DECK_STATUS.captureSuccess);
      return;
    } catch (error) {
      reportFailure(error);
    } finally {
      pending = false;
      save.removeAttribute('aria-disabled');
    }
  }

  function reportFailure(error: unknown): void {
    if (!(error instanceof ApiCallError)) {
      shell.setDeckStatus(DECK_STATUS.genericFailure);
      return;
    }
    if (error.status === 422) {
      shell.setDeckStatus(DECK_STATUS.validationFailure);
      form.showErrors(error.fields);
      return;
    }
    if (error.code === 'idempotency_in_flight') {
      shell.setDeckStatus(DECK_STATUS.idempotencyInFlight);
      save.focus();
      return;
    }
    if (error.status === 503) {
      shell.setDeckStatus(DECK_STATUS.storageFailure);
      save.focus();
      return;
    }
    shell.setDeckStatus(DECK_STATUS.genericFailure);
  }

  save.addEventListener('click', () => void submit());

  return {
    destroy() {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
  };
}
