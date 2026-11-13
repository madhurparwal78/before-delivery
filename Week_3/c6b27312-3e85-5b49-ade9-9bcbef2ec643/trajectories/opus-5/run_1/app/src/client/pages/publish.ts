import { ApiCallError, KeyedAction, NoAnswerError, send } from '../api';
import { el, on } from '../dom';
import { fieldError, labelledField, markStorageDependent, pageAlert, storageIsDown } from '../ui';

const CATEGORIES: [string, string][] = [
  ['hardware', 'Hardware'],
  ['organisers', 'Organisers'],
  ['brackets', 'Brackets'],
  ['plumbing', 'Plumbing'],
  ['enclosure-parts', 'Enclosure parts'],
  ['jigs', 'Jigs'],
];

export function mountPublish(host: HTMLElement): void {
  const title = labelledField('Title');
  const category = el('select', { 'aria-label': 'Category', class: 'enum-select' });
  for (const [slug, name] of CATEGORIES) category.append(el('option', { value: slug }, [name]));
  const visibility = el('div', { role: 'radiogroup', 'aria-label': 'Visibility', class: 'radio-row' });
  const publicRadio = el(
    'button',
    { type: 'button', role: 'radio', 'aria-checked': 'true', tabindex: '0', class: 'radio-option' },
    ['Public'],
  );
  const privateRadio = el(
    'button',
    { type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', class: 'radio-option' },
    ['Private'],
  );
  visibility.append(publicRadio, privateRadio);
  for (const [radio, other] of [
    [publicRadio, privateRadio],
    [privateRadio, publicRadio],
  ]) {
    on(radio, 'click', () => {
      radio.setAttribute('aria-checked', 'true');
      radio.setAttribute('tabindex', '0');
      other.setAttribute('aria-checked', 'false');
      other.setAttribute('tabindex', '-1');
    });
  }
  const source = labelledField('Source', { rows: '14' }, 'textarea');
  const publish = el('button', { type: 'button', class: 'button-primary' }, ['Publish']);
  markStorageDependent(publish);

  host.append(
    el('div', { class: 'publish-form' }, [
      title.row,
      el('div', { class: 'form-row' }, [el('span', { class: 'rail-label' }, ['Category']), category]),
      el('div', { class: 'form-row' }, [el('span', { class: 'rail-label' }, ['Visibility']), visibility]),
      source.row,
      publish,
    ]),
  );

  const action = new KeyedAction();

  on(publish, 'click', async () => {
    if (storageIsDown()) {
      pageAlert(
        'Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.',
      );
      return;
    }
    const body = {
      title: title.input.value,
      category: category.value,
      visibility: publicRadio.getAttribute('aria-checked') === 'true' ? 'public' : 'private',
      source: source.input.value,
    };
    fieldError(title.row, null);
    fieldError(source.row, null);
    try {
      const result = await send<{ slug: string }>('/api/parts', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': action.keyFor(body) },
      });
      action.settled();
      window.location.assign(`/parts/${result.data.slug}`);
    } catch (error) {
      if (error instanceof NoAnswerError) return;
      action.settled();
      if (!(error instanceof ApiCallError)) return;
      if (error.failure.code === 'storage_unavailable') {
        pageAlert(error.failure.message);
        return;
      }
      fieldError(title.row, error.failure.errors?.title ?? null);
      fieldError(source.row, error.failure.errors?.source ?? null);
    }
  });
}
