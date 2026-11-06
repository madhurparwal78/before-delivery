import { upload } from './api.js';
import { copy } from './copy.js';
import { el } from './dom.js';
import { state, subscribe } from './store.js';
import type { Attachment } from '../shared/types.js';

function codePoints(value: string): number {
  return [...value].length;
}

export type UploadReport = { status: HTMLElement; progress: HTMLElement };

/** Attach file follows the storage state in place, wherever a button sits. */
function applyStorageState(button: HTMLElement): void {
  button.dataset.attach = 'true';
  button.setAttribute('aria-disabled', state.status.storage === 'unavailable' ? 'true' : 'false');
}

subscribe((keys) => {
  if (!keys.has('status')) return;
  for (const button of document.querySelectorAll<HTMLElement>('[data-attach]')) applyStorageState(button);
});

/** The one upload status and progress bar a sheet shares. */
export function uploadReport(): UploadReport {
  return {
    status: el('p', {
      class: 'upload-status',
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Upload status',
    }),
    progress: el('div', {
      class: 'progress',
      role: 'progressbar',
      'aria-label': 'Upload progress',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '0',
    }),
  };
}

/** Attach file, its progress and its result, with the published copy. */
export function attachmentsPanel(options: {
  parentPath: string;
  attachments: Attachment[];
  report?: UploadReport;
  onAttached?: (attachment: Attachment) => void;
}): HTMLElement {
  const shared = options.report;
  const own = shared ?? uploadReport();
  const status = own.status;
  const progress = own.progress;
  const button = el('button', { type: 'button', text: 'Attach file' });
  const input = el('input', { type: 'file', class: 'hidden-file', tabindex: '-1', 'aria-hidden': 'true' });
  const list = el('ul', { class: 'attachments' });

  for (const attachment of options.attachments) {
    list.append(
      el('li', {}, [
        el('a', { href: `/api/attachments/${attachment.id}`, download: '', text: attachment.filename }),
      ]),
    );
  }

  applyStorageState(button);
  const panel = el(
    'div',
    { class: 'attach-panel' },
    shared === undefined ? [button, input, progress, status, list] : [button, input, list],
  );

  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'true') {
      status.textContent = copy.noticeStorage;
      return;
    }
    input.click();
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    status.textContent = copy.uploading(file.name);
    progress.setAttribute('aria-valuenow', '0');
    void upload(options.parentPath, file, (fraction) => {
      progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    })
      .then((result) => {
        if (result.status === 201) {
          status.textContent = copy.uploaded(file.name);
          const attachment = result.body as unknown as Attachment;
          list.append(
            el('li', {}, [
              el('a', { href: `/api/attachments/${attachment.id}`, download: '', text: attachment.filename }),
            ]),
          );
          options.onAttached?.(attachment);
          return;
        }
        if (result.status === 413) status.textContent = copy.uploadTooLarge(file.name);
        else if (result.status === 503) status.textContent = copy.uploadStorageDown;
        else if (result.status === 422 && codePoints(file.name) > 255) status.textContent = copy.uploadNameTooLong;
        else if (result.status === 422) status.textContent = copy.uploadEmpty(file.name);
        else status.textContent = copy.uploadStorageDown;
      })
      .catch(() => {
        status.textContent = copy.uploadStorageDown;
      })
      .finally(() => {
        input.value = '';
      });
  });

  return panel;
}
