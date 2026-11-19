// The command palette: cockpit pages matched in the page, active recipients
// from the server's search, with the latest answer always winning.

import { el, clear } from '../dom.js';
import * as router from '../router.js';
import { openDialog, dialogIsOpen } from './dialog.js';
import { createSearcher, literalMatch, MIN_QUERY } from './search.js';

const PAGES = [
  ['Approvals', '/approvals'],
  ['Send payment', '/payments/new'],
  ['Recipients', '/payments/recipients'],
  ['Payments', '/payments'],
  ['Invoicing', '/invoices'],
  ['Loans', '/loans'],
];

export function openPalette() {
  if (dialogIsOpen()) return;

  const input = el('input', { type: 'text', id: 'palette-input', autocomplete: 'off' });
  const list = el('ul', { class: 'palette-list', role: 'listbox', 'aria-label': 'Matches' });
  const content = el('div', { class: 'palette' }, [
    el('div', { class: 'field' }, [
      el('label', { for: 'palette-input', text: 'Search commands' }),
      input,
    ]),
    list,
  ]);

  let options = [];
  let highlighted = 0;

  function paint(recipients, text) {
    clear(list);
    options = [];
    const pageMatches = text ? PAGES.filter(([name]) => literalMatch(name, text)) : PAGES;
    if (recipients.length > 0) {
      list.append(el('li', { class: 'palette-group-label', role: 'presentation', text: 'Recipients' }));
      for (const recipient of recipients) {
        const option = el('li', {
          class: 'palette-option',
          role: 'option',
          text: recipient.display_name,
        });
        option.dataset.href = `/payments/new?recipient=${recipient.id}`;
        option.addEventListener('click', () => choose(option));
        list.append(option);
        options.push(option);
      }
    }
    if (pageMatches.length > 0) {
      list.append(el('li', { class: 'palette-group-label', role: 'presentation', text: 'Pages' }));
      for (const [name, href] of pageMatches) {
        const option = el('li', { class: 'palette-option', role: 'option', text: name });
        option.dataset.href = href;
        option.addEventListener('click', () => choose(option));
        list.append(option);
        options.push(option);
      }
    }
    highlighted = 0;
    highlight();
  }

  function highlight() {
    options.forEach((option, index) => {
      option.setAttribute('aria-selected', index === highlighted ? 'true' : 'false');
      if (index === highlighted) input.setAttribute('aria-activedescendant', option.id || '');
    });
  }

  function choose(option) {
    const href = option && option.dataset.href;
    handle.close({ restoreFocus: false });
    if (href) router.navigate(href);
  }

  const searcher = createSearcher(({ text, result }) => {
    // While the answer for the current text is pending, no earlier recipient shows.
    const recipients =
      result && [...text].length >= MIN_QUERY
        ? result.recipients.filter((recipient) => recipient.status === 'active')
        : [];
    paint(recipients, text);
  });

  input.addEventListener('input', () => searcher.run(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (options.length) {
        highlighted = (highlighted + 1) % options.length;
        highlight();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length) {
        highlighted = (highlighted - 1 + options.length) % options.length;
        highlight();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (options[highlighted]) choose(options[highlighted]);
    }
  });

  const handle = openDialog({
    label: 'Command palette',
    content,
    initialFocus: input,
    onClose: () => searcher.cancel(),
  });
  paint([], '');
  return handle;
}
