import { clear, el } from '../dom.js';
import { type Route } from '../router.js';
import { notFoundSheet, titleBlock, type ModuleContext, type ModuleHandle } from '../shell.js';
import { state } from '../store.js';
import { passwordForm } from './settings.js';

export function accountModule(context: ModuleContext): ModuleHandle {
  const row = el('div', { class: 'row', text: state.person?.name ?? '' });
  context.list.append(el('div', { class: 'rows account-list' }, [row]));
  const sheet = el('div', { class: 'sheet account-sheet' }, [
      titleBlock('Account', state.person?.role ?? '', ''),
      el('h1', { class: 'display', 'data-detail-title': 'true', text: 'Account' }),
      el('p', { class: 'mono', text: state.person?.email ?? '' }),
    passwordForm(),
  ]);
  context.detail.append(sheet);

  return {
    id: 'account',
    firstPane: 'detail',
    route(route: Route) {
      if (!context.detail.contains(sheet)) {
        clear(context.detail);
        context.detail.append(sheet);
      }
      if (route.segments.length > 1) {
        clear(context.detail);
        context.detail.append(notFoundSheet());
        return;
      }
      // The account sheet holds only the password form.
    },
    destroy() {
      clear(context.list);
      clear(context.detail);
    },
  };
}
