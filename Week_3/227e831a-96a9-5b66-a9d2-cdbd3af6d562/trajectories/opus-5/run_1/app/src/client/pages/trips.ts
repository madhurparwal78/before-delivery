import type { ListSummary, TripList } from '../../shared/types.js';
import { api } from '../api.js';
import type { AppContext } from '../app.js';
import { button, el, focusFirstField, openDialog } from '../dom.js';
import { cache, saveCache } from '../store.js';

export function mountTrips(root: HTMLElement, context: AppContext): void {
  const heading = el('h1', { tabindex: '-1' }, ['Trips']);
  const rows = el('tbody');
  const live = el('div', { class: 'live', role: 'status', 'aria-label': 'Trips' });
  const newList = button('New trip list', { class: 'primary' }, (event) => {
    createDialog(event.currentTarget as HTMLElement);
  });
  root.append(
    el('div', { class: 'sheet' }, [
      heading,
      el('div', { class: 'row-actions' }, [newList]),
      live,
      el('table', { class: 'ledger' }, [el('caption', {}, ['Trip lists']), rows]),
    ]),
  );

  function paint(): void {
    rows.replaceChildren(
      ...cache.lists.map((list) => {
        const link = el('a', { href: `/lists/${list.id}`, class: 'list-link' }, [list.name]);
        link.addEventListener('click', (event) => {
          event.preventDefault();
          context.navigate(`/lists/${list.id}`);
        });
        return el('tr', { class: 'ledger-row' }, [
          el('td', {}, [link]),
          el('td', { class: 'state' }, [list.state]),
          el('td', { class: 'weight figure' }, [list.totals.display.base]),
        ]);
      }),
    );
  }

  function load(): void {
    void api<{ lists: ListSummary[] }>('GET', '/api/lists').then((result) => {
      if (result.ok) {
        cache.lists = result.data.lists;
        saveCache();
        context.setOffline(false);
      } else if (result.offline) {
        context.setOffline(true);
      } else if (result.status === 401) {
        context.signedOut();
        return;
      }
      paint();
    });
  }

  function createDialog(opener: HTMLElement): void {
    const handle = openDialog({ name: 'New trip list', opener });
    const name = el('input', { type: 'text', id: 'list-name', class: 'field' });
    const error = el('p', { class: 'field-error' });
    const form = el('form', { class: 'gear-form' }, [
      el('div', { class: 'form-row' }, [
        el('label', { for: 'list-name' }, ['List name']),
        name,
        error,
      ]),
      el('div', { class: 'form-actions' }, [
        el('button', { type: 'submit', class: 'primary' }, ['Create list']),
        button('Cancel', { class: 'secondary' }, () => {
          handle.close();
        }),
      ]),
    ]);
    handle.body.append(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void api<{ list: TripList }>('POST', '/api/lists', { body: { name: name.value } }).then(
        (result) => {
          if (result.ok) {
            handle.close({ restoreFocus: false });
            cache.lists = [
              { id: result.data.list.id, name: result.data.list.name, state: 'planning', totals: result.data.list.totals },
              ...cache.lists,
            ];
            cache.listsById[result.data.list.id] = result.data.list;
            saveCache();
            context.navigate(`/lists/${result.data.list.id}`);
            return;
          }
          if (result.status === 422) {
            error.textContent = result.fields['name'] ?? result.message;
            name.focus();
            return;
          }
          if (result.status === 401) {
            context.signedOut();
            return;
          }
          error.textContent = result.message;
          name.focus();
        },
      );
    });
    focusFirstField(handle);
  }

  paint();
  load();
}
