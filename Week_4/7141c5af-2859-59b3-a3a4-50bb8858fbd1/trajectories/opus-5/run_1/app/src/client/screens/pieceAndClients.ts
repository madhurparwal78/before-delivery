/**
 * A piece's own screen, the Clients list and a client's screen.
 */
import { EMPTY, F } from '../../shared/feedback.ts';
import {
  LANGUAGE_OPTIONS,
  PIECE_STATE_KEYS,
  PIECE_STATE_NAMES,
  TOWN_NAMES_EN,
} from '../../shared/deskLinks.ts';
import { api, ApiError } from '../ui/api.ts';
import { el, find, need, patchList, setHidden, setText } from '../ui/dom.ts';
import { announce, showProblems, withPending } from '../ui/shell.ts';
import { field, openModal } from '../ui/dialog.ts';
import { body, pieceId, setRefresher, wireMainAction } from './deskShell.ts';
import { navigate } from '../router.ts';

interface Piece {
  id: string;
  title: string;
  clientId: string;
  maker: string | null;
  year: string | null;
  stampNumber: string | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  weightKg: number | null;
  dueDate: string | null;
  notes: string | null;
  state: string;
}

interface Client {
  id: string;
  name: string;
  town?: string;
  language?: string;
  email?: string | null;
  state: string;
  closesAt?: string | null;
}

interface Hold {
  id: string;
  code: string;
  lot: string;
  quantity: string;
  label: string;
}

const SUB_SCREENS = [
  ['condition', 'Condition'],
  ['photographs', 'Photographs'],
  ['hide', 'Hide'],
  ['estimate', 'Estimate'],
  ['collection', 'Collection'],
  ['dossier', 'Dossier'],
] as const;

function accordion(name: string, build: (panel: HTMLElement) => void): HTMLElement {
  const panel = el('div', { class: 'accordion-panel', hidden: true });
  const button = el('button', { type: 'button', class: 'accordion-head', 'aria-expanded': 'false', text: name });
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', open ? 'false' : 'true');
    panel.hidden = open;
  });
  build(panel);
  return el('div', { class: 'accordion' }, [button, panel]);
}

export async function startPiece(): Promise<void> {
  const screen = body();
  const id = pieceId();

  const facts = el('dl', { class: 'facts', id: 'piece-facts' });
  const stateSelect = el('select', { 'aria-label': 'State', id: 'piece-state' });
  for (const key of PIECE_STATE_KEYS) {
    stateSelect.append(el('option', { value: key, text: PIECE_STATE_NAMES[key] }));
  }
  const links = el('nav', { class: 'sub-screens', 'aria-label': 'This piece' });
  for (const [path, label] of SUB_SCREENS) {
    links.append(el('a', { href: `/pieces/${id}/${path}`, text: label }));
  }
  const holdsList = el('ul', { class: 'hold-list', id: 'hold-list' });
  const clientPageInfo = el('div', { id: 'client-page-info' });
  const answers = el('div', { id: 'answers' });
  const sendPage = el('button', { type: 'button', class: 'button-primary', text: 'Send client page', id: 'send-client-page' });
  const endPage = el('button', { type: 'button', text: 'End this page', id: 'end-client-page' });
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Days to due' }),
    el('p', { class: 'figure', id: 'days-to-due', text: '\u2014' }),
  ]);

  screen.textContent = '';
  screen.append(
    mint,
    el('div', { class: 'tile tile-large' }, [el('h2', { text: 'Facts' }), facts, el('p', { class: 'field' }, [el('label', { for: 'piece-state', text: 'State' }), stateSelect])]),
    el('div', { class: 'tile' }, [links]),
    el('div', { class: 'tile' }, [
      accordion('Holds', (panel) => panel.append(holdsList, el('p', { class: 'tile-empty', id: 'hold-empty', text: EMPTY.holds, hidden: true }))),
      accordion('Client page', (panel) => panel.append(clientPageInfo)),
      accordion('Answers', (panel) => panel.append(answers)),
    ]),
    el('p', { class: 'screen-action' }, [sendPage, endPage]),
  );

  let piece: Piece | null = null;

  stateSelect.addEventListener('change', () => {
    void withPending(stateSelect, async () => {
      const state = stateSelect.value;
      await api.patch(`/api/pieces/${id}`, { state });
      announce(
        state === 'archived'
          ? F.pieceArchived(piece!.title)
          : F.pieceState(piece!.title, PIECE_STATE_NAMES[state as 'received']),
      );
      await load();
    });
  });

  const send = (button: HTMLElement): void => {
    void withPending(button, async () => {
      try {
        await api.post(`/api/pieces/${id}/client-page`, {});
        const client = (await api.get(`/api/clients/${piece!.clientId}`)) as { client: Client };
        announce(F.clientPageSent(client.client.email ?? ''));
        await load();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        announce(error.failure.message);
      }
    });
  };
  sendPage.addEventListener('click', () => send(sendPage));
  wireMainAction((button) => send(button));

  endPage.addEventListener('click', () => {
    void withPending(endPage, async () => {
      await api.remove(`/api/pieces/${id}/client-page`);
      announce(F.clientPageEnded);
      await load();
    });
  });

  async function load(): Promise<void> {
    const answer = (await api.get(`/api/pieces/${id}`)) as { piece: Piece };
    piece = answer.piece;
    const client = (await api.get(`/api/clients/${piece.clientId}`)) as { client: Client };

    facts.textContent = '';
    const rows: [string, string][] = [
      ['Client', client.client.name],
      ['Maker', piece.maker ?? ''],
      ['Year', piece.year ?? ''],
      ['Stamp number', piece.stampNumber ?? ''],
      ['Width in cm', piece.widthCm === null ? '' : String(piece.widthCm)],
      ['Depth in cm', piece.depthCm === null ? '' : String(piece.depthCm)],
      ['Height in cm', piece.heightCm === null ? '' : String(piece.heightCm)],
      ['Weight in kg', piece.weightKg === null ? '' : String(piece.weightKg)],
      ['Due date', piece.dueDate ?? ''],
      ['Notes', piece.notes ?? ''],
    ];
    for (const [label, value] of rows) facts.append(el('dt', { text: label }), el('dd', { text: value }));
    if (stateSelect.value !== piece.state) stateSelect.value = piece.state;

    const session = (await api.get('/api/session')) as { session: { today: string } };
    const days =
      piece.dueDate === null
        ? '\u2014'
        : String(
            Math.round(
              (Date.parse(`${piece.dueDate}T00:00:00Z`) - Date.parse(`${session.session.today}T00:00:00Z`)) /
                86_400_000,
            ),
          );
    setText(need('#days-to-due'), days);

    const holds = (await api.get(`/api/pieces/${id}/holds`)) as { holds: Hold[] };
    patchList(
      holdsList,
      holds.holds,
      (hold) => hold.id,
      () => el('li', {}),
      (node, hold) => setText(node, `${hold.code} ${hold.lot} \u00b7 ${hold.quantity} \u00b7 ${hold.label}`),
    );
    setHidden(need<HTMLElement>('#hold-empty'), holds.holds.length > 0);

    const page = (await api.get(`/api/pieces/${id}/client-page`)) as {
      clientPage: {
        address: string | null;
        state: string;
        answer: { seatHeightCm: string; typed: string } | null;
        signOff: { typedName: string; at: string } | null;
      } | null;
    };
    clientPageInfo.textContent = '';
    answers.textContent = '';
    if (page.clientPage) {
      clientPageInfo.append(el('p', { text: `State: ${page.clientPage.state}` }));
      if (page.clientPage.address) {
        clientPageInfo.append(el('p', {}, [el('a', { href: page.clientPage.address, text: page.clientPage.address })]));
      }
      if (page.clientPage.answer) {
        answers.append(
          el('p', { text: `Seat height: ${page.clientPage.answer.seatHeightCm} cm (typed ${page.clientPage.answer.typed})` }),
        );
      }
      if (page.clientPage.signOff) {
        answers.append(el('p', { text: `Approved by ${page.clientPage.signOff.typedName}` }));
      }
    } else {
      clientPageInfo.append(el('p', { text: 'No client page yet.' }));
    }
    if (answers.childElementCount === 0) answers.append(el('p', { text: 'No answers yet.' }));
  }

  await load();
  setRefresher(load);
}

// ------------------------------------------------------------------- clients

export async function startClients(): Promise<void> {
  const screen = body();

  const table = el('table', { class: 'desk-table' });
  table.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Client' }),
        el('th', { scope: 'col', text: 'Town' }),
        el('th', { scope: 'col', text: 'State' }),
      ]),
    ]),
  );
  const tbody = el('tbody', {});
  table.append(tbody);
  const frame = el('div', { class: 'frame', role: 'region', 'aria-label': 'Clients table', tabindex: '0' }, [table]);
  const empty = el('p', { class: 'tile tile-empty', id: 'clients-empty', text: EMPTY.clients, hidden: true });
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Clients' }),
    el('p', { class: 'figure', id: 'client-count', text: '0' }),
  ]);
  const newClient = el('button', { type: 'button', class: 'button-primary', text: 'New client', id: 'new-client' });

  screen.textContent = '';
  screen.append(mint, el('div', { class: 'tile tile-large' }, [frame]), empty, el('p', { class: 'screen-action' }, [newClient]));

  const openNew = (): void => {
    openModal({
      name: 'New client',
      opener: newClient,
      build(dialogBody, handle) {
        const name = el('input', { type: 'text', name: 'name', autocomplete: 'name' });
        const town = el('select', { name: 'town' });
        for (const option of TOWN_NAMES_EN) town.append(el('option', { value: option, text: option }));
        const language = el('select', { name: 'language' });
        for (const option of LANGUAGE_OPTIONS) {
          language.append(el('option', { value: option.value, text: option.label }));
        }
        const email = el('input', { type: 'email', name: 'email', autocomplete: 'email' });
        const save = el('button', { type: 'button', class: 'button-primary', text: 'Save client' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(
          field('nc-name', 'Name', name),
          field('nc-town', 'Town', town),
          field('nc-language', 'Language', language),
          field('nc-email', 'Email', email),
          el('p', { class: 'dialog-actions' }, [save, close]),
        );
        close.addEventListener('click', () => handle.close());
        save.addEventListener('click', () => {
          void withPending(save, async () => {
            try {
              const answer = (await api.post('/api/clients', {
                name: name.value,
                town: town.value,
                language: language.value,
                email: email.value === '' ? null : email.value,
              })) as { client: Client };
              handle.close();
              announce(F.clientSaved(answer.client.name));
              await load();
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              const problems = Object.entries(error.failure.fields).map(([key, message]) => ({
                field: key,
                message,
              }));
              showProblems(
                handle.problems,
                problems.length > 0 ? problems : [{ field: 'name', message: error.failure.message }],
                (key) => (key === 'email' ? email : key === 'town' ? town : key === 'language' ? language : name),
                'Problems',
              );
            }
          });
        });
      },
    });
  };
  newClient.addEventListener('click', openNew);
  wireMainAction(openNew);

  async function load(): Promise<void> {
    const answer = (await api.get('/api/clients')) as { clients: Client[] };
    patchList(
      tbody,
      answer.clients,
      (client) => client.id,
      () =>
        el('tr', {}, [
          el('td', { class: 'cell-name' }),
          el('td', { class: 'cell-town' }),
          el('td', { class: 'cell-state' }),
        ]),
      (row, client) => {
        const cell = need('.cell-name', row);
        if (client.state === 'erased') {
          setText(cell, client.name);
        } else {
          let link = find<HTMLAnchorElement>('a', cell);
          if (!link) {
            cell.textContent = '';
            link = el('a', { href: `/clients/${client.id}` });
            cell.append(link);
          }
          link.href = `/clients/${client.id}`;
          setText(link, client.name);
        }
        setText(need('.cell-town', row), client.town ?? '');
        setText(
          need('.cell-state', row),
          client.state === 'erasing' ? F.erasing : client.state === 'erased' ? F.erased : client.state,
        );
      },
    );
    setHidden(need<HTMLElement>('#clients-empty'), answer.clients.length > 0);
    setText(need('#client-count'), String(answer.clients.filter((client) => client.state !== 'erased').length));
  }

  await load();
  setRefresher(load);
}

// -------------------------------------------------------------- one client

export async function startClient(): Promise<void> {
  const screen = body();
  const id = window.location.pathname.split('/')[2] ?? '';

  const facts = el('dl', { class: 'facts', id: 'client-facts' });
  const pieces = el('ul', { class: 'client-pieces', id: 'client-pieces' });
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Pieces' }),
    el('p', { class: 'figure', id: 'client-piece-count', text: '0' }),
  ]);
  const rename = el('button', { type: 'button', class: 'button-primary', text: 'Rename client', id: 'rename-client' });
  const closeClient = el('button', { type: 'button', text: 'Close client', id: 'close-client' });
  const bringBack = el('button', { type: 'button', text: 'Bring back', id: 'bring-back', hidden: true });
  const deleteClient = el('button', { type: 'button', text: 'Delete client', id: 'delete-client' });

  screen.textContent = '';
  screen.append(
    mint,
    el('div', { class: 'tile tile-large' }, [el('h2', { text: 'Client' }), facts]),
    el('div', { class: 'tile' }, [el('h2', { text: 'Pieces' }), pieces]),
    el('p', { class: 'screen-action' }, [rename, closeClient, bringBack, deleteClient]),
  );

  let client: Client | null = null;

  const openRename = (): void => {
    openModal({
      name: 'Rename client',
      opener: rename,
      build(dialogBody, handle) {
        const name = el('input', { type: 'text', name: 'name', value: client?.name ?? '', autocomplete: 'name' });
        const save = el('button', { type: 'button', class: 'button-primary', text: 'Save client' });
        const close = el('button', { type: 'button', text: 'Close' });
        dialogBody.append(field('rn-name', 'Name', name), el('p', { class: 'dialog-actions' }, [save, close]));
        close.addEventListener('click', () => handle.close());
        save.addEventListener('click', () => {
          void withPending(save, async () => {
            try {
              const answer = (await api.patch(`/api/clients/${id}`, { name: name.value })) as { client: Client };
              handle.close();
              announce(F.clientSaved(answer.client.name));
              await load();
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              showProblems(
                handle.problems,
                [{ field: 'name', message: error.failure.message }],
                () => name,
                'Problems',
              );
            }
          });
        });
      },
    });
  };
  rename.addEventListener('click', openRename);
  wireMainAction(openRename);

  closeClient.addEventListener('click', () => {
    openModal({
      name: 'Close this client',
      opener: closeClient,
      build(dialogBody, handle) {
        const run = el('button', { type: 'button', class: 'button-primary', text: 'Close client' });
        const keep = el('button', { type: 'button', text: 'Keep client' });
        dialogBody.append(
          el('p', { text: 'A closed client can be brought back until the wait ends.' }),
          el('p', { class: 'dialog-actions' }, [run, keep]),
        );
        keep.addEventListener('click', () => handle.close());
        run.addEventListener('click', () => {
          void withPending(run, async () => {
            const answer = (await api.post(`/api/clients/${id}/close`, {})) as { client: Client };
            handle.close();
            const until = answer.client.closesAt ?? '';
            announce(F.clientClosing(answer.client.name, until.slice(0, 10)));
            await load();
          });
        });
      },
    });
  });

  bringBack.addEventListener('click', () => {
    void withPending(bringBack, async () => {
      try {
        const answer = (await api.post(`/api/clients/${id}/bring-back`, {})) as { client: Client };
        announce(F.clientBack(answer.client.name));
        await load();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        announce(error.failure.message);
      }
    });
  });

  deleteClient.addEventListener('click', () => {
    void withPending(deleteClient, async () => {
      try {
        const name = client?.name ?? '';
        await api.remove(`/api/clients/${id}`);
        announce(F.clientDeleted(name));
        await navigate('/clients');
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        announce(error.failure.message);
      }
    });
  });

  async function load(): Promise<void> {
    const answer = (await api.get(`/api/clients/${id}`)) as { client: Client };
    client = answer.client;
    facts.textContent = '';
    for (const [label, value] of [
      ['Name', client.name],
      ['Town', client.town ?? ''],
      ['Language', client.language ?? ''],
      ['Email', client.email ?? ''],
      ['State', client.state],
    ] as [string, string][]) {
      facts.append(el('dt', { text: label }), el('dd', { text: value }));
    }
    setHidden(bringBack, client.state !== 'closing');
    setHidden(closeClient, client.state !== 'active');

    const owned = (await api.get(`/api/pieces?client=${id}`)) as { pieces: { id: string; title: string }[] };
    patchList(
      pieces,
      owned.pieces,
      (item) => item.id,
      () => el('li', {}, [el('a', { href: '#' })]),
      (node, item) => {
        const link = need<HTMLAnchorElement>('a', node);
        link.href = `/pieces/${item.id}`;
        setText(link, item.title);
      },
    );
    setText(need('#client-piece-count'), String(owned.pieces.length));
  }

  await load();
  setRefresher(load);
}
