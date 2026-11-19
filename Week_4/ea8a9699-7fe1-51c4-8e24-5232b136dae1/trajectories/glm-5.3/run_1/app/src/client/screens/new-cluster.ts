// The New cluster dialog.

import type { Cluster } from '../../shared/types.js';
import { api, el, navigate } from '../lib.js';
import { clearInvalid, errorSummary, formField, markInvalid } from './signin.js';
import type { WallState } from './wall.js';

export class NewClusterDialog {
  private state: WallState;
  private opener: HTMLElement | null;
  private dialog: HTMLDialogElement;
  private title: HTMLInputElement;
  private publicDescription: HTMLTextAreaElement;
  private internalNote: HTMLTextAreaElement;
  private submit: HTMLButtonElement;

  constructor(state: WallState, opener: HTMLElement | null) {
    this.state = state;
    this.opener = opener;
    this.dialog = el('dialog', { class: 'dialog', 'aria-label': 'New cluster' }) as HTMLDialogElement;
    this.dialog.append(el('h2', {}, `New cluster in ${state.workspace?.name ?? ''}`));
    this.title = el('input', { type: 'text', id: 'nc-title' }) as HTMLInputElement;
    this.title.setAttribute('aria-label', 'Title');
    this.publicDescription = el('textarea', { id: 'nc-public' }) as HTMLTextAreaElement;
    this.publicDescription.setAttribute('aria-label', 'Public description');
    this.internalNote = el('textarea', { id: 'nc-note' }) as HTMLTextAreaElement;
    this.internalNote.setAttribute('aria-label', 'Internal note');

    const form = el('form', { novalidate: true }) as HTMLFormElement;
    form.append(
      formField('Title', this.title),
      formField('Public description', this.publicDescription),
      formField('Internal note', this.internalNote),
      el('div', { class: 'row' },
        el('button', { type: 'submit', class: 'btn btn-primary', id: 'nc-create' }, 'Create cluster'),
        el('button', { type: 'button', class: 'btn btn-ghost', id: 'nc-cancel' }, 'Cancel'),
      ),
    );
    this.submit = form.querySelector('#nc-create') as HTMLButtonElement;
    this.title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearInvalid(this.dialog);
      this.submit.disabled = true;
      const r = await api<Cluster>('POST', `/api/workspaces/${this.state.slug}/clusters`, {
        title: this.title.value,
        publicDescription: this.publicDescription.value,
        internalNote: this.internalNote.value,
      });
      this.submit.disabled = false;
      if (r.ok && r.data) {
        try {
          window.sessionStorage.setItem('rushes.createdCluster', r.data.id);
        } catch {
          // private mode: the announcement is skipped
        }
        this.close();
        navigate(`/w/${this.state.slug}/clusters/${r.data.id}`);
        return;
      }
      const errors = r.error?.errors ?? {};
      this.dialog.prepend(errorSummary(errors, { title: 'nc-title', publicDescription: 'nc-public', internalNote: 'nc-note' }));
      document.getElementById('error-summary')?.focus();
      for (const [field, message] of Object.entries(errors)) {
        if (field === 'title') markInvalid(this.title, message);
        if (field === 'publicDescription') markInvalid(this.publicDescription, message);
        if (field === 'internalNote') markInvalid(this.internalNote, message);
      }
    });
    (form.querySelector('#nc-cancel') as HTMLButtonElement).addEventListener('click', () => this.close());
    this.dialog.append(form);
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.close();
    });
  }

  open(): void {
    document.body.append(this.dialog);
    this.dialog.showModal();
    this.title.focus();
  }

  close(): void {
    this.dialog.close();
    this.dialog.remove();
    this.opener?.focus();
  }
}
