import type { ErrorItem } from '../../shared/types.ts';
import { M01, M02 } from '../../shared/messages.ts';
import { h } from '../lib/dom.ts';
import { alertText } from '../lib/live.ts';
import type { PageView } from './page.ts';
import { controlId } from './question/shell.ts';

/** Takes focus to the question's field and scrolls it into view; the summary stays as it is. */
function reveal(view: PageView, key: string): void {
  const target = view.fields.get(key)?.focusTarget();
  if (!target) return;
  target.focus();
  target.scrollIntoView({ block: 'center' });
}

function summaryFor(view: PageView, items: ErrorItem[]): HTMLElement {
  const links = items.map((item) => h('li', {},
    h('a', {
      href: `#${controlId(item.key)}`,
      onclick: (event) => {
        event.preventDefault();
        reveal(view, item.key);
      },
    }, item.message)));
  return h('section', { id: 'error-summary', tabindex: '-1', 'aria-labelledby': 'error-summary-title' },
    h('h2', { id: 'error-summary-title' }, M01),
    h('ul', {}, links));
}

/** A failed Next or Submit: the focused summary, the inline messages, the title prefix and the alert. */
export function showErrors(view: PageView, items: ErrorItem[]): void {
  for (const field of view.fields.values()) field.clearError();
  for (const item of items) view.fields.get(item.key)?.showError(item.message);
  const summary = summaryFor(view, items);
  view.setSummary(summary);
  view.markErrors(true);
  alertText(M02(items.length));
  summary.focus();
}
