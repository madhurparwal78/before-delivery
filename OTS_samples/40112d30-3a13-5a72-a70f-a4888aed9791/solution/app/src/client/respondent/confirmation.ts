import { M14, M27, M28 } from '../../shared/messages.ts';
import { h, replaceChildren } from '../lib/dom.ts';

export interface Submitted {
  id: string;
  reference: string;
  submitted_at: string;
  edition: number;
  copy: 'sent' | 'queued' | 'none';
  replayed: boolean;
}

export function showConfirmation(host: HTMLElement, formTitle: string, submitted: Submitted): void {
  const heading = h('h1', { tabindex: '-1' }, M27);
  replaceChildren(host,
    h('p', { class: 'form-title' }, formTitle),
    heading,
    h('p', { class: 'figures' }, M28(submitted.reference)),
    submitted.copy === 'queued' ? h('p', {}, M14) : null);
  document.title = `${M27} - ${formTitle}`;
  heading.focus();
}
