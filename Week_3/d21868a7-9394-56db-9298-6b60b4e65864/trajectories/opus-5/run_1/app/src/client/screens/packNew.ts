import { api, failureOf } from '../api.ts';
import { copy } from '../copy.ts';
import { districtCounters } from '../counters.ts';
import { el, setText } from '../dom.ts';
import { navigate } from '../navigation.ts';
import type { Screen } from '../screen.ts';
import type { PackRecord } from '../types.ts';

/** Preview a pack for a period, sign it, and submit exactly those bytes. */

export async function packNewScreen(): Promise<Screen> {
  const counters = districtCounters();
  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Pack status', 'aria-live': 'polite' },
  });

  const from = el('input', { class: 'input', attrs: { type: 'text', id: 'pack-from', 'aria-label': 'From', placeholder: 'YYYY-MM-DD', autocomplete: 'off' } });
  const to = el('input', { class: 'input', attrs: { type: 'text', id: 'pack-to', 'aria-label': 'To', placeholder: 'YYYY-MM-DD', autocomplete: 'off' } });
  const signatory = el('input', { class: 'input', attrs: { type: 'text', id: 'pack-signatory', 'aria-label': 'Signatory', autocomplete: 'off' } });
  const fromError = el('p', { class: 'field-error' });
  const toError = el('p', { class: 'field-error' });
  const signatoryError = el('p', { class: 'field-error' });

  const previewText = el('pre', { class: 'preview-text' });
  const preview = el('div', {
    class: 'preview',
    attrs: { role: 'region', 'aria-label': 'Pack preview' },
    children: [previewText],
  });

  const previewButton = el('button', { class: 'button', text: 'Preview pack', attrs: { type: 'button' } });
  const submitButton = el('button', {
    class: 'button button-primary',
    text: 'Sign and submit pack',
    attrs: { type: 'button' },
  });

  const form = el('form', {
    class: 'card form',
    attrs: { 'aria-label': 'New pack', novalidate: true },
    children: [
      el('label', { class: 'label', text: 'From', attrs: { for: 'pack-from' } }),
      from,
      fromError,
      el('label', { class: 'label', text: 'To', attrs: { for: 'pack-to' } }),
      to,
      toError,
      el('label', { class: 'label', text: 'Signatory', attrs: { for: 'pack-signatory' } }),
      signatory,
      signatoryError,
      previewButton,
      preview,
      submitButton,
      status,
    ],
  });

  const element = el('main', {
    class: 'page page-form',
    children: [counters.element, el('h1', { text: 'New pack' }), form],
  });

  let document_ = '';

  const clearErrors = (): void => {
    setText(fromError, '');
    setText(toError, '');
    setText(signatoryError, '');
  };

  const showErrors = (errors: Record<string, string>): void => {
    setText(fromError, errors.from ?? '');
    setText(toError, errors.to ?? '');
    setText(signatoryError, errors.signatory ?? errors.document ?? '');
  };

  previewButton.addEventListener('click', () => {
    clearErrors();
    void (async () => {
      const parameters = new URLSearchParams({
        from: from.value.trim(),
        to: to.value.trim(),
        signatory: signatory.value.trim(),
      });
      try {
        document_ = await api.text(`/api/packs/preview?${parameters.toString()}`);
        setText(previewText, document_);
        setText(status, '');
      } catch (cause) {
        const failure = failureOf(cause);
        document_ = '';
        setText(previewText, '');
        if (failure?.status === 422) showErrors(failure.errors ?? {});
        else setText(status, failure?.message ?? '');
      }
    })();
  });

  submitButton.addEventListener('click', () => {
    if (document_ === '') return;
    clearErrors();
    setText(status, copy.storingAndMailing);
    void (async () => {
      try {
        const reply = await api.post<{ pack: PackRecord }>('/api/packs', {
          from: from.value.trim(),
          to: to.value.trim(),
          signatory: signatory.value.trim(),
          document: document_,
        });
        navigate(`/packs/${reply.pack.number}`);
      } catch (cause) {
        const failure = failureOf(cause);
        if (failure?.code === 'pack_stale') {
          setText(status, copy.packStale);
          return;
        }
        if (failure?.status === 422) {
          showErrors(failure.errors ?? {});
          setText(status, '');
          return;
        }
        setText(status, failure?.message ?? '');
      }
    })();
  });

  const refresh = async (): Promise<void> => {
    await counters.refresh();
  };

  await refresh();
  return { element, refresh };
}
