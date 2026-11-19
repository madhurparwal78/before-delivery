import { copy } from '../shared/copy.js';
import { announce, api, bootstrap, closePanel, need, openPanel, topPanel } from './dom.js';
import { connectLive } from './live.js';

type Entry = {
  rank: number;
  player: string;
  handle: string;
  creature: string;
  creature_name: string;
  total: number;
  tick: number;
  photo: string;
};

const FILTER_DELAY_MS = 250;

export function startBoards(): void {
  const data = bootstrap<{ island: number; entries: Entry[]; total: number }>();
  const body = need('board-body');
  const filter = need<HTMLInputElement>('filter-players');
  const dialog = need('enter-photo-dialog');
  let debounce: number | null = null;
  let latest = 0;

  announce('board-status', copy.boardEntries(data.total));

  function renderRows(entries: Entry[]): void {
    if (entries.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.textContent = copy.emptyBoard;
      row.append(cell);
      body.replaceChildren(row);
      return;
    }
    body.replaceChildren(
      ...entries.map((entry) => {
        const row = document.createElement('tr');
        row.dataset.handle = entry.handle;
        for (const value of [String(entry.rank), entry.player, entry.creature_name, String(entry.total)]) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        return row;
      }),
    );
  }

  async function load(text: string, announceResult: boolean): Promise<boolean> {
    const token = (latest += 1);
    const path = text.length > 0 ? `/api/boards/${data.island}?player=${encodeURIComponent(text)}` : `/api/boards/${data.island}`;
    const answer = await api<{ entries: Entry[]; total: number; shown: number }>(path);
    if (token !== latest) return false;
    if (!answer.ok) {
      announce('board-status', copy.boardFailed);
      return false;
    }
    renderRows(answer.body.entries);
    if (announceResult)
      announce(
        'board-status',
        text.length > 0
          ? copy.boardFiltered(answer.body.shown, answer.body.total, text)
          : copy.boardEntries(answer.body.total),
      );
    return true;
  }

  filter.addEventListener('input', () => {
    if (debounce !== null) window.clearTimeout(debounce);
    const text = filter.value;
    debounce = window.setTimeout(() => {
      debounce = null;
      void load(text, true);
    }, FILTER_DELAY_MS);
  });

  need('open-enter-photo').addEventListener('click', (event) => openPanel(dialog, event.currentTarget as HTMLElement));
  need('enter-photo').addEventListener('click', () => void enter());

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || topPanel() !== dialog) return;
    closePanel(dialog);
    event.preventDefault();
  });

  async function enter(): Promise<void> {
    const chosen = document.querySelector('input[name="board-photo"]:checked') as HTMLInputElement | null;
    if (!chosen) return;
    const answer = await api<{ entry: Entry }>(`/api/boards/${data.island}/entries`, {
      method: 'POST',
      body: { photo: chosen.value },
    });
    if (!answer.ok) {
      announce('board-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    closePanel(dialog);
    announce('board-status', copy.boardEntered(answer.body.entry.creature_name));
    await load(filter.value, false);
  }

  connectLive((message) => {
    if (message.kind !== 'board' || Number(message.island) !== data.island) return;
    void load(filter.value, false).then((loaded) => {
      if (loaded) announce('board-status', copy.boardUpdated(String(message.player_name), Number(message.rank)));
    });
  });
}
