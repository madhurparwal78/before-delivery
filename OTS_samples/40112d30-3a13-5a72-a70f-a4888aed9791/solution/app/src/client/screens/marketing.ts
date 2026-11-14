import { h } from '../lib/dom.ts';
import { frame, ready } from '../lib/shell.ts';
import { pageMapThumbnail } from '../owner/marketing/page-map-thumbnail.ts';
import { CAPABILITIES, SAMPLE_FORMS } from '../owner/marketing/sample-forms.ts';

// `/`: a text band on seven columns, a third of a screen of empty ground, then the sheet of seven page-map thumbnails.

function band(): HTMLElement {
  return h('div', { class: 'band' },
    h('h1', { class: 'name' }, 'Nightform'),
    h('p', { class: 'status' }, 'Open for new workspaces'),
    h('ul', { class: 'capabilities' }, CAPABILITIES.map((capability) => h('li', {}, capability))),
    h('ul', { class: 'samples' }, SAMPLE_FORMS.map((form) => h('li', {}, form.name))),
    h('div', { class: 'entry' },
      h('a', { href: '/signin' }, 'Sign in'),
      h('a', { href: '/signup', class: 'button primary' }, 'Start a form')));
}

function sheet(): HTMLElement {
  return h('ul', { class: 'sheet' }, SAMPLE_FORMS.map((form) => h('li', {}, h('p', { class: 'thumbnail-title' }, form.name), pageMapThumbnail(form))));
}

export async function render(): Promise<void> {
  const main = frame();
  main.classList.add('marketing');
  ready(main, 'Nightform');
  main.append(band(), sheet());
}
