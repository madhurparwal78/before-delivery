import { M22, M26 } from '../../shared/messages.ts';
import { h, replaceChildren } from '../lib/dom.ts';
import { alertText } from '../lib/live.ts';

/** The closed panel replaces the page; `whileOpen` is true when the form closed while it was open on the screen. */
export function showClosed(host: HTMLElement, formTitle: string, text: string, whileOpen: boolean): void {
  const heading = h('h1', { tabindex: '-1' }, M22);
  const panel = h('section', { id: 'closed-panel' }, heading, h('p', {}, text), whileOpen ? h('p', {}, M26) : null);
  replaceChildren(host, panel);
  document.title = `${M22} - ${formTitle}`;
  heading.focus();
  if (whileOpen) alertText(M26);
}
