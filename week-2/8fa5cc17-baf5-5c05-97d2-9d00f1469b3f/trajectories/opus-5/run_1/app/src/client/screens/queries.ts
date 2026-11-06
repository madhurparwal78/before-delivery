import { api } from '../api';
import { clear, el, prefersReducedMotion } from '../dom';
import { frame } from '../frame';
import { Screen, ScreenParams, navigate } from '../router';
import { QueryResultsDto, QueryRowDto, SavedQueryDto } from '../types';
import { libraryOrder, refreshLibrary, typeById, workspace, homeZone } from '../state';
import { openDialog } from '../components/dialog';
import { onLive } from '../live';
import { animate } from '../anim';
import { RESULTS_FADE_MS, RESULTS_SLIDE_MS, SEARCH_DEBOUNCE_MS } from '../../shared/motion';
import { shortStamp } from '../../shared/homeclock';
import { COPY } from '../../shared/copy';

const SORT_LABELS: [string, string][] = [
  ['Title', '@title'],
  ['Backlinks', '@backlinks'],
  ['Last updated', '@updated'],
];

export function queriesScreen(): Screen {
  let stopLive: (() => void) | null = null;
  let selected: SavedQueryDto | null = null;
  const table = el('table', { className: 'query-results', attrs: { 'aria-label': 'Query results' } });
  const queryList = el('ul', { className: 'saved-queries', attrs: { 'aria-label': 'Saved queries' } });
  const meta = el('div', { className: 'query-meta' });

  function renderQueryList(): void {
    clear(queryList);
    for (const query of workspace().queries) {
      const link = el('a', { text: query.name, attrs: { href: `/queries/${query.id}` } });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        navigate(`/queries/${query.id}`);
      });
      queryList.append(el('li', { children: [link] }));
    }
  }

  function rowNode(row: QueryRowDto): HTMLTableRowElement {
    const link = el('a', { text: row.title, attrs: { href: `/o/${row.id}` } });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(`/o/${row.id}`);
    });
    const node = el('tr', { attrs: { 'data-row': row.id } });
    node.append(
      el('td', { children: [link] }),
      el('td', { text: row.type_name }),
      el('td', {
        children: [
          el('span', {
            className: 'row-count',
            text: String(row.backlinks),
            attrs: { 'data-backlink-count': String(row.backlinks) },
          }),
        ],
      }),
      el('td', { text: shortStamp(new Date(row.updated_at), homeZone()) }),
    );
    return node;
  }

  /** Moved rows slide to their new places, new rows fade in, removed rows fade out. */
  function renderResults(payload: QueryResultsDto): void {
    const before = new Map<string, number>();
    for (const row of table.querySelectorAll<HTMLElement>('tr[data-row]')) {
      before.set(row.getAttribute('data-row') ?? '', row.getBoundingClientRect().top);
    }
    clear(table);
    const head = el('thead');
    head.append(
      el('tr', {
        children: [
          el('th', { text: 'Title' }),
          el('th', { text: 'Type' }),
          el('th', { text: 'Backlinks' }),
          el('th', { text: 'Last updated' }),
        ],
      }),
    );
    table.append(head);
    if (payload.groups !== null) {
      for (const group of payload.groups) {
        const body = el('tbody');
        body.append(
          el('tr', {
            className: 'group-head',
            children: [el('th', { text: `${group.label} (${group.count})`, attrs: { colspan: '4' } })],
          }),
        );
        for (const row of group.results) body.append(rowNode(row));
        table.append(body);
      }
    } else {
      const body = el('tbody');
      for (const row of payload.results) body.append(rowNode(row));
      table.append(body);
    }
    if (prefersReducedMotion()) return;
    for (const row of table.querySelectorAll<HTMLElement>('tr[data-row]')) {
      const id = row.getAttribute('data-row') ?? '';
      const previous = before.get(id);
      const now = row.getBoundingClientRect().top;
      if (previous === undefined) {
        animate(row, [{ opacity: 0 }, { opacity: 1 }], RESULTS_FADE_MS);
        continue;
      }
      const delta = previous - now;
      if (Math.abs(delta) < 1) continue;
      animate(row, [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], RESULTS_SLIDE_MS);
    }
  }

  async function loadResults(): Promise<void> {
    if (selected === null) return;
    const result = await api.get<QueryResultsDto>(`/api/queries/${selected.id}/results`);
    if (result.ok) renderResults(result.data);
  }

  function renderMeta(): void {
    clear(meta);
    if (selected === null) return;
    const sort = selected.sort.map((entry) => `${entry.key} ${entry.dir}`).join(', ');
    meta.append(
      el('p', { className: 'query-text', text: selected.text }),
      el('p', { className: 'query-grouping', text: `Group by: ${selected.group_by ?? 'No grouping'}` }),
      el('p', { className: 'query-sort', text: `Sort: ${sort}` }),
    );
    const remove = el('button', { className: 'delete-query', text: 'Delete query', attrs: { type: 'button' } });
    remove.addEventListener('click', () => {
      void (async () => {
        if (selected === null) return;
        await api.del(`/api/queries/${selected.id}`);
        await refreshLibrary();
        frame().renderRail();
        navigate('/queries');
      })();
    });
    meta.append(remove);
  }

  return {
    async mount(params: ScreenParams): Promise<void> {
      const main = frame().main;
      clear(main);
      clear(frame().margin);
      frame().setTopTitle('Queries');
      main.append(el('h1', { text: 'Queries', attrs: { tabindex: '-1' } }));
      const newQuery = el('button', { className: 'new-query', text: 'New query', attrs: { type: 'button' } });
      newQuery.addEventListener('click', () =>
        openNewQueryDialog(newQuery, async (created) => {
          await refreshLibrary();
          frame().renderRail();
          navigate(`/queries/${created.id}`);
        }),
      );
      renderQueryList();
      main.append(queryList, newQuery, meta, table);
      const id = params.params['id'];
      if (id !== undefined) {
        const result = await api.get<SavedQueryDto>(`/api/queries/${id}`);
        if (!result.ok) {
          clear(main);
          main.append(el('h1', { text: COPY.notFound }));
          return;
        }
        selected = result.data;
        renderMeta();
        await loadResults();
      } else {
        selected = null;
        clear(table);
      }
      stopLive = onLive((type) => {
        if (type === 'backlinks.changed' || type === 'object.saved' || type === 'object.removed') {
          void loadResults();
        }
      });
    },
    unmount(): void {
      if (stopLive !== null) stopLive();
    },
  };
}

/** Dialog `New query`: the published query language, checked as the owner types. */
export function openNewQueryDialog(
  opener: HTMLElement,
  onSaved: (query: SavedQueryDto) => Promise<void>,
): void {
  openDialog({
    label: 'New query',
    className: 'new-query-dialog',
    opener,
    content: (handle) => {
      const name = el('input', { attrs: { type: 'text', 'aria-label': 'Query name' } });
      const nameError = el('div', { className: 'field-error' });
      const typeSelect = el('select', { attrs: { 'aria-label': 'Type' } });
      for (const type of libraryOrder(workspace().types)) {
        typeSelect.append(el('option', { text: type.name, attrs: { value: type.id } }));
      }
      const text = el('input', {
        attrs: { type: 'text', 'aria-label': 'Query', 'aria-describedby': 'query-check' },
      });
      const checkResult = el('div', { className: 'field-error', attrs: { id: 'query-check' } });
      const groupBy = el('select', { attrs: { 'aria-label': 'Group by' } });
      const sortRows: { key: HTMLSelectElement; dir: HTMLSelectElement }[] = [];
      const sortHost = el('div', { className: 'sort-rows' });

      const fillFieldOptions = (): void => {
        const type = typeById(typeSelect.value);
        clear(groupBy);
        groupBy.append(el('option', { text: 'No grouping', attrs: { value: '' } }));
        for (const field of type?.fields ?? []) {
          if (!['select', 'relation', 'date', 'text'].includes(field.kind)) continue;
          groupBy.append(el('option', { text: field.name, attrs: { value: field.name } }));
        }
        sortRows.forEach((row, index) => {
          const keep = row.key.value;
          clear(row.key);
          if (index > 0) row.key.append(el('option', { text: 'None', attrs: { value: '' } }));
          for (const [label, value] of SORT_LABELS) {
            row.key.append(el('option', { text: label, attrs: { value } }));
          }
          for (const field of type?.fields ?? []) {
            row.key.append(el('option', { text: field.name, attrs: { value: field.name } }));
          }
          row.key.value = index > 0 ? '' : keep === '' ? '@title' : keep;
        });
      };

      for (let index = 0; index < 3; index += 1) {
        const key = el('select', { attrs: { 'aria-label': `Sort key ${index + 1}` } });
        const dir = el('select', { attrs: { 'aria-label': `Direction ${index + 1}` } });
        dir.append(
          el('option', { text: 'Ascending', attrs: { value: 'asc' } }),
          el('option', { text: 'Descending', attrs: { value: 'desc' } }),
        );
        sortRows.push({ key, dir });
        sortHost.append(el('div', { className: 'sort-row', children: [key, dir] }));
      }
      typeSelect.addEventListener('change', fillFieldOptions);
      fillFieldOptions();

      let timer = 0;
      let sequence = 0;
      let answered = -1;
      text.addEventListener('input', () => {
        if (timer !== 0) window.clearTimeout(timer);
        const value = text.value;
        timer = window.setTimeout(() => {
          void (async () => {
            const mine = ++sequence;
            const result = await api.post<{ ok: boolean }>('/api/queries/check', {
              type_id: typeSelect.value,
              text: value,
            });
            if (mine < answered || text.value !== value) return;
            answered = mine;
            checkResult.textContent = result.ok ? '' : result.errors?.['text'] ?? '';
          })();
        }, SEARCH_DEBOUNCE_MS);
      });

      const save = el('button', { text: 'Save query', attrs: { type: 'button' } });
      save.addEventListener('click', () => {
        void (async () => {
          const sort = sortRows
            .filter((row) => row.key.value !== '')
            .map((row) => ({ key: row.key.value, dir: row.dir.value as 'asc' | 'desc' }));
          const result = await api.post<SavedQueryDto>('/api/queries', {
            name: name.value,
            type_id: typeSelect.value,
            text: text.value,
            group_by: groupBy.value === '' ? null : groupBy.value,
            sort: sort.length === 0 ? [{ key: '@title', dir: 'asc' }] : sort,
          });
          if (!result.ok) {
            nameError.textContent = result.errors?.['name'] ?? '';
            checkResult.textContent = result.errors?.['text'] ?? '';
            if (nameError.textContent !== '') name.focus();
            else text.focus();
            return;
          }
          handle.close();
          await onSaved(result.data);
        })();
      });

      return [
        el('label', { text: 'Query name' }),
        name,
        nameError,
        el('label', { text: 'Type' }),
        typeSelect,
        el('label', { text: 'Query' }),
        text,
        checkResult,
        el('label', { text: 'Group by' }),
        groupBy,
        sortHost,
        save,
      ];
    },
  });
}
