import { el } from '../dom.js';
import { header } from '../components/header.js';
import { footer } from '../components/footer.js';
import * as router from '../router.js';

export const PARTNER_LINE =
  'Tallwind is a financial technology company, not a bank. Deposit accounts are held by our partner banks, Harbor Financial and Keystone N.A., each a Member FDIC.';

// Every marketing page: fixed frosted header, one main landmark, the footer.
export function marketingPage(children, { status = false } = {}) {
  const chrome = header();
  router.onCleanup(() => chrome.cleanup && chrome.cleanup());
  const main = el('main', { class: 'site-main', id: 'main-content' }, [
    status
      ? el('div', { class: 'wrap' }, [
          el('div', {
            class: 'status-region',
            role: 'status',
            'aria-live': 'polite',
            'data-status-region': 'true',
          }),
        ])
      : null,
    ...(Array.isArray(children) ? children : [children]),
  ]);
  return el('div', {}, [chrome, main, footer()]);
}

export function hero({ title, lede, email = true, actions = [], legal = true }) {
  const form = email
    ? el('form', { class: 'hero-form', onsubmit: (event) => {
        event.preventDefault();
        router.navigate('/signup');
      } }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'hero-email', text: 'Enter your email' }),
          el('input', { id: 'hero-email', type: 'email', name: 'email', autocomplete: 'email' }),
        ]),
        el('button', { class: 'pill', type: 'submit', text: 'Open account' }),
      ])
    : null;
  return el('section', { class: 'hero' }, [
    el('div', { class: 'wrap' }, [
      el('h1', { text: title }),
      lede ? el('p', { class: 'lede', text: lede }) : null,
      form,
      actions.length ? el('div', { class: 'hero-actions' }, actions) : null,
      legal ? el('p', { class: 'legal-line', text: PARTNER_LINE }) : null,
    ]),
  ]);
}

export function section(title, children, { lede, id } = {}) {
  return el('section', { class: 'section', id }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'section-head' }, [
        title ? el('h2', { text: title }) : null,
        lede ? el('p', { text: lede }) : null,
      ]),
      ...(Array.isArray(children) ? children : [children]),
    ]),
  ]);
}

export function cards(items) {
  return el(
    'div',
    { class: 'grid-3' },
    items.map((item) =>
      el('div', { class: 'card' }, [
        el('h3', { text: item.title }),
        el('p', { text: item.body }),
      ])
    )
  );
}

export function featureList(items) {
  return el(
    'ul',
    { class: 'checklist' },
    items.map((item) =>
      el('li', {}, [
        el('span', {}, [el('strong', { text: item.title }), item.body ? el('p', { text: item.body }) : null]),
        item.state ? el('span', { class: 'state-chip', text: item.state }) : null,
      ])
    )
  );
}

export function faq(title, entries) {
  return section(title, [
    el(
      'dl',
      { class: 'faq' },
      entries.flatMap(([question, answer]) => [
        el('dt', { text: question }),
        el('dd', { text: answer }),
      ])
    ),
  ]);
}

export function dataTable(headers, rows, { caption } = {}) {
  return el('div', { class: 'table-scroll' }, [
    el('table', { class: 'data' }, [
      caption ? el('caption', { text: caption }) : null,
      el('thead', {}, [el('tr', {}, headers.map((head) => el('th', { scope: 'col', text: head })))]),
      el(
        'tbody',
        {},
        rows.map((row) => el('tr', {}, row.map((cell, index) => el(index === 0 ? 'th' : 'td', index === 0 ? { scope: 'row', text: cell } : { text: cell }))))
      ),
    ]),
  ]);
}
