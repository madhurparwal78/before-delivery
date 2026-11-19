import type { Pen } from '../../shared/api';
import { copy } from '../../shared/copy';
import { h, say, status, trapFocus } from '../dom';

const TABS = [
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'js', label: 'JS' },
  { value: 'result', label: 'Result' },
] as const;

export interface ShareDialog {
  element: HTMLElement;
  open: () => void;
}

export const embedLink = (penId: string, tab: string): string =>
  `${window.location.origin}/embed/${penId}?tab=${tab}`;

export const embedCode = (penId: string, title: string, tab: string): string =>
  `<iframe src="${embedLink(penId, tab)}" title="${title} on Ashlar" width="100%" height="400"></iframe>`;

export const shareDialog = (options: { pen: () => Pen; trigger: HTMLElement }): ShareDialog => {
  const shareStatus = status('Share status');
  const link = h('input', { type: 'text', 'aria-label': 'Embed link', readonly: true, class: 'field mono' });
  const code = h('input', { type: 'text', 'aria-label': 'Embed code', readonly: true, class: 'field mono' });
  const privateNote = h('p', { class: 'note', text: copy.sharePrivate, hidden: true });

  const radios = TABS.map((tab) =>
    h('input', { type: 'radio', name: 'starting-tab', value: tab.value, class: 'radio' }),
  );
  const group = h(
    'div',
    { role: 'radiogroup', 'aria-label': 'Starting tab', class: 'radios' },
    TABS.map((tab, index) =>
      h('label', { class: 'radio-row' }, [radios[index]!, h('span', { text: tab.label })]),
    ),
  );

  const paint = (): void => {
    const pen = options.pen();
    const chosen = TABS[radios.findIndex((radio) => radio.checked)] ?? TABS[3];
    link.value = embedLink(pen.id, chosen.value);
    code.value = embedCode(pen.id, pen.title, chosen.value);
    privateNote.hidden = pen.visibility !== 'private';
  };

  for (const radio of radios) radio.addEventListener('change', paint);

  const copyButton = h('button', {
    type: 'button',
    class: 'action accent',
    text: 'Copy link',
    onclick: async () => {
      await navigator.clipboard.writeText(link.value);
      say(shareStatus, copy.linkCopied);
    },
  });
  const closeButton = h('button', { type: 'button', class: 'ghost', text: 'Close' });

  const element = h(
    'div',
    { role: 'dialog', 'aria-label': 'Share', class: 'dialog panel', hidden: true },
    [group, privateNote, link, code, copyButton, closeButton, shareStatus],
  );

  const close = (): void => {
    element.hidden = true;
    options.trigger.focus();
  };
  closeButton.addEventListener('click', close);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(element)(event);
  });

  radios[3]!.checked = true;
  paint();

  return {
    element,
    open: () => {
      paint();
      element.hidden = false;
      (radios.find((radio) => radio.checked) ?? radios[3]!).focus();
    },
  };
};
