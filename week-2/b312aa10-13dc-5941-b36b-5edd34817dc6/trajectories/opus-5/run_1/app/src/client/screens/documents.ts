import { documentStatusWord, documentTypeLabel, type DocumentStatus, type DocumentType } from '../../shared/format.js';
import { AbandonedError, ApiError, NetworkError, networkCopy, get, post, request } from '../api.js';
import { el, fieldError, labelled, on, replace, setFieldError } from '../dom.js';
import type { Screen, ScreenContext } from '../screen.js';

type DocumentRow = {
  id: string;
  memberId: string;
  businessName: string;
  type: DocumentType;
  expiryDate: string;
  status: DocumentStatus;
  current: boolean;
  fileName: string;
  version: number;
};

const columns = ['Business', 'Type', 'Status', 'Version', 'File', 'Expires'];

export function documentsScreen(context: ScreenContext): Screen {
  const role = context.session!.user.role;
  const isMember = role === 'member';
  const isOperator = role === 'operator';

  let rows: DocumentRow[] = [];
  const pending = new Set<string>();
  let destroyed = false;

  const holder = el('div', { class: 'documents-holder' });
  const element = el('div', { class: 'documents-screen' }, holder);

  if (isMember) {
    const select = el('select', {}, [
      el('option', { value: 'insurance_certificate', text: 'Insurance certificate' }),
      el('option', { value: 'food_handler_card', text: 'Food-handler card' }),
    ]);
    select.setAttribute('aria-label', 'Document type');
    const expiry = el('input', { type: 'text' });
    const file = el('input', { type: 'file' });
    const expiryError = fieldError();
    const fileError = fieldError();
    const typeError = fieldError();
    const uploadButton = el('button', { type: 'button', text: 'Upload' });

    element.insertBefore(
      el('div', { class: 'upload-form' }, [
        labelled('Document type', select, typeError),
        labelled('Expiry date', expiry, expiryError),
        labelled('File', file, fileError),
        uploadButton,
      ]),
      holder,
    );

    on(uploadButton, 'click', () => {
      void (async () => {
        setFieldError(expiry, expiryError, null);
        setFieldError(file, fileError, null);
        setFieldError(select, typeError, null);
        const chosen = file.files?.[0] ?? null;
        const form = new FormData();
        form.set('type', select.value);
        form.set('expiryDate', expiry.value.trim());
        if (chosen) form.set('file', chosen, chosen.name);
        uploadButton.setAttribute('disabled', '');
        uploadButton.setAttribute('aria-busy', 'true');
        context.announce(`Uploading ${chosen?.name ?? ''}\u2026`);
        try {
          await request('/api/documents', { method: 'POST', form });
          context.announce('Uploaded. Waiting for approval.');
          expiry.value = '';
          file.value = '';
          await load();
        } catch (error) {
          if (error instanceof AbandonedError) return;
          if (error instanceof ApiError) {
            const fields = error.fieldErrors();
            if (fields['expiryDate']) setFieldError(expiry, expiryError, fields['expiryDate']);
            if (fields['file']) setFieldError(file, fileError, fields['file']);
            if (fields['type']) setFieldError(select, typeError, fields['type']);
            context.showAlert(error.status === 422 ? error.firstFieldMessage() ?? error.copy : error.copy);
          } else if (error instanceof NetworkError) {
            context.showAlert(networkCopy);
          }
        } finally {
          uploadButton.removeAttribute('disabled');
          uploadButton.removeAttribute('aria-busy');
        }
      })();
    });
  }

  async function load(): Promise<void> {
    try {
      const result = await get<{ documents: DocumentRow[] }>('/api/documents');
      if (destroyed) return;
      rows = result.body.documents;
      drawRows();
    } catch (error) {
      if (error instanceof AbandonedError) return;
      if (error instanceof NetworkError) context.showAlert(networkCopy);
    }
  }

  function downloadLink(row: DocumentRow): HTMLElement {
    return el('a', {
      href: `/api/documents/${row.id}/file`,
      text: `Download ${documentTypeLabel(row.type)}`,
      'aria-label': `Download ${documentTypeLabel(row.type)}`,
    });
  }

  function approveButton(row: DocumentRow): HTMLElement | null {
    if (!isOperator || row.status !== 'submitted') return null;
    const name = `Approve ${row.businessName} ${documentTypeLabel(row.type)}`;
    const button = el('button', { type: 'button', text: 'Approve', 'aria-label': name });
    if (pending.has(row.id)) {
      button.setAttribute('disabled', '');
      button.setAttribute('aria-busy', 'true');
    }
    on(button, 'click', () => void approve(row, button));
    return button;
  }

  async function approve(row: DocumentRow, button: HTMLElement): Promise<void> {
    pending.add(row.id);
    button.setAttribute('disabled', '');
    button.setAttribute('aria-busy', 'true');
    context.announce('Approving\u2026');
    try {
      await post(`/api/documents/${row.id}/approve`, { version: row.version });
      pending.delete(row.id);
      context.announce(`Approved ${row.businessName} ${documentTypeLabel(row.type)}.`);
      await load();
    } catch (error) {
      pending.delete(row.id);
      if (error instanceof AbandonedError) return;
      if (error instanceof ApiError) {
        const current = error.body['current'] as DocumentRow | undefined;
        if (current) {
          rows = rows.map((candidate) => (candidate.id === current.id ? current : candidate));
          drawRows();
        }
        context.showAlert(error.copy);
      } else if (error instanceof NetworkError) {
        context.showAlert(networkCopy);
      }
    }
  }

  function values(row: DocumentRow): string[] {
    return [
      row.businessName,
      documentTypeLabel(row.type),
      documentStatusWord(row.status),
      String(row.version),
      row.fileName,
      row.expiryDate,
    ];
  }

  /** Below 768 pixels a list of labelled cards; from 768 up the published table. */
  function drawRows(): void {
    const focusedName = (document.activeElement as HTMLElement | null)?.getAttribute('aria-label');
    if (window.innerWidth < 768) {
      const items = rows.map((row) => {
        const pairs = values(row).map((value, index) =>
          el('div', { class: 'pair' }, [
            el('span', { class: 'pair-label', text: columns[index]! }),
            el('span', { class: 'pair-value', text: value }),
          ]),
        );
        const actions = [downloadLink(row), approveButton(row)];
        return el('li', { role: 'listitem', class: 'doc-card' }, [...pairs, ...actions]);
      });
      replace(
        holder,
        el('ul', { role: 'list', 'aria-label': 'Documents', class: 'doc-list' }, items),
      );
    } else {
      const head = el(
        'tr',
        {},
        [...columns, 'Actions'].map((column) => el('th', { scope: 'col', text: column })),
      );
      const body = rows.map((row) =>
        el('tr', {}, [
          ...values(row).map((value) => el('td', { text: value })),
          el('td', {}, [downloadLink(row), approveButton(row)]),
        ]),
      );
      replace(
        holder,
        el('table', { 'aria-label': 'Documents' }, [
          el('thead', {}, head),
          el('tbody', {}, body),
        ]),
      );
    }
    if (focusedName) {
      const match = holder.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focusedName)}"]`);
      match?.focus();
    }
  }

  const resizeHandler = (): void => drawRows();
  window.addEventListener('resize', resizeHandler);

  void load();
  context.setHourBank(null);

  return {
    element,
    onResize: resizeHandler,
    destroy: () => {
      destroyed = true;
      window.removeEventListener('resize', resizeHandler);
    },
  };
}
