import { clear, el } from '../dom.js';
import {
  announce,
  ApiFailure,
  get,
  setLiveHandler,
  write,
  type LiveMessage,
} from '../state.js';
import { emptyBand, loadFailed, openDialog, showFormError } from '../widgets.js';

type CaseRow = { number: number; title: string; status: string };

type CaseItem = {
  kind: string;
  rule?: string;
  rule_name?: string;
  group?: string;
  text?: string;
  trace_id?: string;
};

type CaseDetail = { number: number; title: string; status: string; items: CaseItem[] };

const NEXT: Record<string, string[]> = {
  open: ['investigating'],
  investigating: ['resolved'],
  resolved: ['closed', 'investigating'],
  closed: [],
};

export async function renderCases(main: HTMLElement): Promise<void> {
  let data: { cases: CaseRow[] };
  try {
    data = await get<{ cases: CaseRow[] }>('/api/cases');
  } catch {
    main.append(loadFailed(() => void renderCases(main)));
    return;
  }
  const newCase = el('button', {
    type: 'button',
    'aria-label': 'New case',
    text: 'New case',
    class: 'primary',
  });
  newCase.addEventListener('click', () => {
    openDialog({
      label: 'New case',
      opener: newCase,
      content: (dialog) => {
        const title = el('input', { type: 'text', 'aria-label': 'Case title', 'data-field': 'title' });
        const create = el('button', {
          type: 'button',
          'aria-label': 'Create case',
          text: 'Create case',
          class: 'primary',
        });
        const host = el('div', {});
        create.addEventListener('click', () => {
          void (async () => {
            try {
              const created = await write<{ number: number }>('POST', '/api/cases', { title: title.value });
              dialog.close();
              announce(`Case ${created.number} created.`);
              clear(main);
              await renderCases(main);
            } catch (cause) {
              if (cause instanceof ApiFailure) showFormError(host, cause);
            }
          })();
        });
        return [el('h2', { text: 'New case' }), host, title, create];
      },
    });
  });
  main.append(el('h1', { class: 'view-title', text: 'Cases' }), newCase);
  if (data.cases.length === 0) {
    main.append(emptyBand('No cases yet.', newCase));
    return;
  }
  main.append(
    el('table', { 'aria-label': 'Cases', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Case' }),
          el('th', { scope: 'col', text: 'Title' }),
          el('th', { scope: 'col', text: 'Status' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        data.cases.map((row) =>
          el('tr', { 'aria-label': `Case ${row.number}: ${row.title}, ${row.status}` }, [
            el('td', { class: 'mono' }, [el('a', { href: `/cases/${row.number}`, text: String(row.number) })]),
            el('td', { text: row.title }),
            el('td', { class: 'mono', text: row.status }),
          ]),
        ),
      ),
    ]),
  );
  setLiveHandler((message: LiveMessage) => {
    if (message.type !== 'case') return;
    void (async () => {
      clear(main);
      await renderCases(main);
    })();
  });
}

export async function renderCase(main: HTMLElement, params: Record<string, string>): Promise<void> {
  const number = params.number;
  let detail: CaseDetail;
  try {
    detail = await get<CaseDetail>(`/api/cases/${encodeURIComponent(number)}`);
  } catch (cause) {
    if (cause instanceof ApiFailure && cause.status === 404) {
      main.append(el('h1', { class: 'view-title', text: 'Page not found.' }));
      return;
    }
    main.append(loadFailed(() => void renderCase(main, params)));
    return;
  }
  const statusSelect = el('select', { 'aria-label': 'Case status' });
  const itemsHost = el('ul', { role: 'list', 'aria-label': 'Case items', class: 'case-items' });
  const host = el('div', {});

  const fillStatuses = (): void => {
    clear(statusSelect);
    for (const next of NEXT[detail.status] ?? []) {
      statusSelect.append(el('option', { value: next, text: next }));
    }
  };

  const renderItems = (): void => {
    clear(itemsHost);
    for (const item of detail.items) {
      if (item.kind === 'group') {
        itemsHost.append(
          el('li', { class: 'mono', text: `Group ${item.group} on rule ${item.rule_name ?? item.rule}` }),
        );
        continue;
      }
      if (item.kind === 'inbox') {
        itemsHost.append(el('li', { text: `Inbox item: ${item.text ?? ''}` }));
        continue;
      }
      itemsHost.append(
        el('li', {}, [
          el('a', {
            href: `/traces/${item.trace_id}`,
            text: `Trace ${item.trace_id}`,
            'aria-label': `Trace ${item.trace_id}`,
          }),
        ]),
      );
    }
  };

  const update = el('button', {
    type: 'button',
    'aria-label': 'Update status',
    text: 'Update status',
    class: 'primary',
  });
  update.addEventListener('click', () => {
    update.setAttribute('aria-busy', 'true');
    void (async () => {
      try {
        detail = await write<CaseDetail>('PATCH', `/api/cases/${number}`, { status: statusSelect.value });
        announce(`Case ${detail.number} is now ${detail.status}`);
        fillStatuses();
        renderItems();
        title.textContent = `Case ${detail.number}: ${detail.title}, ${detail.status}`;
      } catch (cause) {
        if (cause instanceof ApiFailure) showFormError(host, cause);
      } finally {
        update.removeAttribute('aria-busy');
      }
    })();
  });

  const traceId = el('input', { type: 'text', 'aria-label': 'Trace id', 'data-field': 'trace_id' });
  const linkTrace = el('button', { type: 'button', 'aria-label': 'Link trace', text: 'Link trace' });
  linkTrace.addEventListener('click', () => {
    void (async () => {
      try {
        detail = await write<CaseDetail>('POST', `/api/cases/${number}/items`, { trace_id: traceId.value });
        renderItems();
        announce(`Added to case ${detail.number}.`);
      } catch (cause) {
        if (cause instanceof ApiFailure) showFormError(host, cause);
      }
    })();
  });

  const title = el('h1', {
    class: 'view-title',
    text: `Case ${detail.number}: ${detail.title}, ${detail.status}`,
  });
  fillStatuses();
  renderItems();
  main.append(
    title,
    host,
    el('div', { class: 'card-actions' }, [statusSelect, update]),
    itemsHost,
    el('div', { class: 'card-actions' }, [traceId, linkTrace]),
  );
  setLiveHandler((message: LiveMessage) => {
    if (message.type !== 'case') return;
    if (Number(message.number) !== detail.number) return;
    void (async () => {
      detail = await get<CaseDetail>(`/api/cases/${encodeURIComponent(number)}`);
      title.textContent = `Case ${detail.number}: ${detail.title}, ${detail.status}`;
      fillStatuses();
      renderItems();
    })();
  });
}
