import { ApiFailure, api } from '../api';
import { COPY, importedAnnouncement, importingAnnouncement } from '../../shared/copy';
import { announce, el, field, openPanel } from '../dom';
import type { ImportRecord } from '../../shared/types';
import { keepForSignIn } from './sessionGate';

/** The last path segment, control characters removed, cut to 70, as the server does. */
export function displayFileName(raw: string): string {
  const lastSlash = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  const segment = lastSlash === -1 ? raw : raw.slice(lastSlash + 1);
  let cleaned = '';
  for (const char of segment) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    cleaned += char;
  }
  return cleaned.slice(0, 70);
}

const ERROR_COPY: Record<string, string> = {
  file_too_large: COPY.importTooLarge,
  payload_too_large: COPY.importTooLarge,
  unsupported_file_type: COPY.importWrongType,
  unsafe_file: COPY.importUnsafe,
  invalid_model: COPY.importInvalidModel,
};

export function openImportDialog(options: {
  diagramId: string;
  onImported(record: ImportRecord): void;
  onStorageError(): void;
}): void {
  const fileInput = el('input', { type: 'file', accept: '.xml,.svg,text/xml,image/svg+xml' });
  const importButton = el('button', { type: 'button', class: 'primary', text: 'Import file' });
  const errorNode = el('div', { class: 'field-error', id: 'import-error' });
  const fileField = field('Diagram file', fileInput, { id: 'import-file' });
  fileField.append(errorNode);
  const content = el('div', {}, [
    el('h2', { text: 'Import diagram file' }),
    fileField,
    el('div', { class: 'dialog-actions' }, [importButton]),
  ]);
  const panel = openPanel(content, { labelledBy: 'Import diagram file', initialFocus: () => fileInput });

  fileInput.addEventListener('change', () => {
    errorNode.textContent = '';
    fileInput.removeAttribute('aria-describedby');
  });

  const showError = (message: string): void => {
    errorNode.textContent = message;
    fileInput.setAttribute('aria-describedby', 'import-error');
    announce(message);
    fileInput.focus();
  };

  importButton.addEventListener('click', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      showError(COPY.importWrongType);
      return;
    }
    const name = displayFileName(file.name);
    importButton.disabled = true;
    importButton.textContent = 'Importing...';
    announce(importingAnnouncement(name));
    void keepForSignIn(() => {
      const form = new FormData();
      form.append('file', file, file.name);
      return api.upload<{ import: ImportRecord }>(`/api/diagrams/${options.diagramId}/imports`, form);
    })
      .then((body) => {
        panel.close();
        options.onImported(body.import);
        announce(importedAnnouncement(body.import.fileName));
      })
      .catch((error: unknown) => {
        importButton.disabled = false;
        importButton.textContent = 'Import file';
        if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
          options.onStorageError();
          return;
        }
        const code = error instanceof ApiFailure ? error.code : 'invalid_model';
        showError(ERROR_COPY[code] ?? COPY.genericFailure);
      });
  });
}
