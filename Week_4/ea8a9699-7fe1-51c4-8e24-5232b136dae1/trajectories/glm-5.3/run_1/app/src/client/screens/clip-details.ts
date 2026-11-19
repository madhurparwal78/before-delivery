// The clip details dialog shown when uploading a clip.

import type { Reference } from '../../shared/types.js';
import { api, announce, el } from '../lib.js';
import { clearInvalid, errorSummary, formField, markInvalid } from './signin.js';
import type { WallState } from './wall.js';

export class ClipDetailsDialog {
  private state: WallState;
  private file: File;
  private dialog: HTMLDialogElement;
  private title: HTMLInputElement;
  private rate: HTMLInputElement;
  private duration: HTMLInputElement;
  private submit: HTMLButtonElement;

  constructor(state: WallState, file: File) {
    this.state = state;
    this.file = file;
    this.dialog = el('dialog', { class: 'dialog', 'aria-label': 'Clip details' }) as HTMLDialogElement;
    this.dialog.append(el('h2', {}, 'Clip details'));
    this.title = el('input', { type: 'text', id: 'clip-title' }) as HTMLInputElement;
    this.title.setAttribute('aria-label', 'Title');
    this.title.value = this.file.name.replace(/\.[^.]+$/, '');
    this.rate = el('input', { type: 'radio', name: 'frame-rate', id: 'rate-25', value: '25' }) as HTMLInputElement;
    this.rate.checked = true;
    this.duration = el('input', { type: 'number', id: 'clip-duration', min: '1', max: '3600000', value: '2000' }) as HTMLInputElement;
    this.duration.setAttribute('aria-label', 'Duration');

    const radios = el('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Frame rate' });
    radios.append(el('label', {}, 'Frame rate'));
    for (const value of ['24', '25', '30']) {
      const id = `rate-${value}`;
      const radio = el('input', { type: 'radio', name: 'frame-rate', id, value }) as HTMLInputElement;
      if (value === '25') radio.checked = true;
      const label = el('label', { for: id }, value);
      radios.append(el('span', { class: 'row' }, radio, label));
    }
    this.dialog.append(radios);

    const form = el('form', { novalidate: true }) as HTMLFormElement;
    form.append(
      formField('Title', this.title),
      radios,
      el('div', {}, el('button', { type: 'submit', class: 'btn btn-primary', id: 'clip-upload' }, 'Upload clip')),
      el('button', { type: 'button', class: 'btn btn-ghost', id: 'clip-cancel' }, 'Cancel'),
    );
    this.submit = form.querySelector('#clip-upload') as HTMLButtonElement;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearInvalid(this.dialog);
      const rateValue = Number((this.dialog.querySelector('input[name="frame-rate"]:checked') as HTMLInputElement)?.value ?? '25');
      this.submit.disabled = true;
      const body = new FormData();
      body.append('file', this.file, this.file.name);
      body.append('title', this.title.value);
      body.append('frameRate', String(rateValue));
      body.append('durationMs', this.duration.value || '2000');
      const r = await api<Reference>('POST', `/api/workspaces/${this.state.slug}/references`, body);
      this.submit.disabled = false;
      if (r.ok && r.data) {
        this.state.references.unshift(r.data);
        const list = document.getElementById('references-list');
        if (list) list.prepend(el('li', {}, windowWallCard(r.data)));
        announce('wall-announcements', `Uploaded ${r.data.title}.`);
        this.close();
        return;
      }
      const errors = r.error?.errors ?? {};
      if (Object.keys(errors).length > 0) {
        this.dialog.prepend(errorSummary(errors, { title: 'clip-title', frameRate: 'rate-25', durationMs: 'clip-duration' }));
        document.getElementById('error-summary')?.focus();
        if (errors.title) markInvalid(this.title, errors.title);
        if (errors.durationMs) markInvalid(this.duration, errors.durationMs);
      } else {
        const message = r.error?.message ?? 'The clip was not uploaded.';
        this.dialog.prepend(errorSummary({ title: message }, { title: 'clip-title' }));
        document.getElementById('error-summary')?.focus();
      }
    });

    (form.querySelector('#clip-cancel') as HTMLButtonElement).addEventListener('click', () => this.close());
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
    const btn = document.getElementById('upload-btn');
    btn?.focus();
  }
}

function windowWallCard(ref: Reference): HTMLElement {
  // A slim inline card used when a clip uploads (avoids a circular import).
  const card = el('article', { class: 'ref-card' });
  const video = el('video', { src: ref.mediaUrl, preload: 'metadata', muted: true });
  card.append(video, el('div', { class: 'ref-title-full' }, ref.title));
  return card;
}
