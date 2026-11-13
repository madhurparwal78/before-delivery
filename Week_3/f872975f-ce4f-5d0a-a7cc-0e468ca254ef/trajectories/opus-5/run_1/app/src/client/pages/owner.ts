import { GRADES, SPECIES } from '../../shared/constants';
import { getJson, postJson, putJson } from '../api';
import { clear, el, labelled, setText } from '../dom';
import { formatInstant } from '../fmt';
import { Page } from '../shell';
import { Board, BoardSummary, Rate, StockRow } from '../types';

const STATUS_LABELS: Record<string, string> = { tagged: 'Tagged', graded: 'Graded' };
const STOCK_HEADERS = ['Species', 'Open boards', 'On rack', 'Held', 'Volume (mm³)', 'Board feet'];

interface StockPayload {
  species: StockRow[];
  totals: { open_boards: number; on_rack: number; held: number; volume_mm3: number; board_feet: string };
}

function effectiveAtIso(raw: string): string | null | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text);
  if (match === null) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`;
}

export async function ownerPage(): Promise<Page> {
  const rateStatus = el('p', { class: 'live', attrs: { role: 'status', 'aria-label': 'Rate status' } });
  const queue = el('div', { class: 'cards grading-queue' });
  const scheduled = el('ul', { class: 'scheduled', attrs: { role: 'list', 'aria-label': 'Scheduled rates' } });
  const rateCells = new Map<string, HTMLInputElement>();
  const stockBody = el('tbody');

  async function loadQueue(): Promise<void> {
    const result = await getJson<{ boards: BoardSummary[] }>('/api/boards?status=tagged&status=graded');
    clear(queue);
    const boards = result.data?.boards ?? [];
    if (boards.length === 0) {
      queue.appendChild(el('p', { class: 'muted', text: 'Nothing waiting to be graded.' }));
      return;
    }
    for (const board of boards) {
      const select = el(
        'select',
        {},
        GRADES.map((grade) => el('option', { text: grade, attrs: { value: grade } }))
      );
      if (board.grade !== null) select.value = board.grade;
      const save = el('button', { text: `Save grade for ${board.tag}`, attrs: { type: 'button' } });
      const list = el('button', { class: 'primary', text: `List ${board.tag} on the rack`, attrs: { type: 'button' } });
      save.addEventListener('click', () => void saveGrade(board.tag, select.value));
      list.addEventListener('click', () => void listBoard(board.tag));
      const card = el('article', { class: 'card grading-card' }, [
        el('span', { class: 'tag mono', text: board.tag }),
        el('span', { class: 'badge', text: STATUS_LABELS[board.status] ?? board.status }),
        el('span', { text: board.species }),
        labelled(`Grade for ${board.tag}`, select),
        save,
        list
      ]);
      queue.appendChild(card);
      void addThumbnail(card, board.tag);
    }
  }

  async function addThumbnail(card: HTMLElement, tag: string): Promise<void> {
    const result = await getJson<{ board: Board }>(`/api/boards/${tag}`);
    const photo = result.data?.board.photos[0];
    if (photo === undefined) return;
    card.insertBefore(
      el('img', { class: 'thumb', attrs: { src: photo.thumb_url, alt: `Thumbnail of ${tag}`, width: 80, height: 80 } }),
      card.firstChild
    );
  }

  async function saveGrade(tag: string, grade: string): Promise<void> {
    const result = await postJson(`/api/boards/${tag}/grade`, { grade });
    setText(rateStatus, result.ok ? 'Saved.' : 'Not saved.');
    await Promise.all([loadQueue(), loadStock()]);
  }

  async function listBoard(tag: string): Promise<void> {
    const result = await postJson(`/api/boards/${tag}/list`, {});
    setText(rateStatus, result.ok ? 'Saved.' : 'Not saved.');
    await Promise.all([loadQueue(), loadStock()]);
  }

  function rateKey(species: string, grade: string): string {
    return `${species}|${grade}`;
  }

  const rateTable = el('table', { class: 'rates mono', attrs: { 'aria-label': 'Grade rates' } }, [
    el('thead', {}, [el('tr', {}, [el('th', { text: 'Species' }), ...GRADES.map((grade) => el('th', { text: grade }))])]),
    el(
      'tbody',
      {},
      SPECIES.map((species) =>
        el('tr', {}, [
          el('th', { attrs: { scope: 'row' }, text: species }),
          ...GRADES.map((grade) => {
            const rate = el('input', { attrs: { type: 'text', inputmode: 'numeric' } });
            const from = el('input', { attrs: { type: 'text', placeholder: 'YYYY-MM-DD HH:MM' } });
            rateCells.set(rateKey(species, grade), rate);
            const save = (): void => void saveRate(species, grade, rate.value, from.value);
            rate.addEventListener('keydown', (event) => {
              if ((event as KeyboardEvent).key === 'Enter') {
                event.preventDefault();
                save();
              }
            });
            from.addEventListener('keydown', (event) => {
              if ((event as KeyboardEvent).key === 'Enter') {
                event.preventDefault();
                save();
              }
            });
            return el('td', {}, [
              labelled(`Rate for ${species} ${grade}`, rate),
              labelled(`Effective from for ${species} ${grade}`, from)
            ]);
          })
        ])
      )
    )
  ]);

  async function saveRate(species: string, grade: string, rawRate: string, rawFrom: string): Promise<void> {
    const cents = Number(rawRate.trim());
    const effective = effectiveAtIso(rawFrom);
    if (!Number.isInteger(cents) || cents < 1 || effective === null) {
      setText(rateStatus, 'Not saved.');
      return;
    }
    const body: Record<string, unknown> = { species, grade, rate_cents: cents };
    if (effective !== undefined) body.effective_at = effective;
    const result = await putJson('/api/rates', body);
    setText(rateStatus, result.ok ? 'Rate saved' : 'Not saved.');
    await Promise.all([loadRates(), loadStock()]);
  }

  async function loadRates(): Promise<void> {
    const result = await getJson<{ rates: Rate[]; scheduled: Rate[] }>('/api/rates');
    for (const rate of result.data?.rates ?? []) {
      const cell = rateCells.get(rateKey(rate.species, rate.grade));
      if (cell !== undefined) cell.value = String(rate.rate_cents);
    }
    clear(scheduled);
    for (const rate of result.data?.scheduled ?? []) {
      scheduled.appendChild(
        el('li', {
          attrs: { role: 'listitem' },
          class: 'mono',
          text: `${rate.species} ${rate.grade} ${rate.rate_cents} ¢/bd ft from ${formatInstant(rate.effective_at)}`
        })
      );
    }
  }

  async function loadStock(): Promise<void> {
    const result = await getJson<StockPayload>('/api/stock');
    if (!result.ok || result.data === null) return;
    const rows = [
      ...result.data.species.map((row) => [
        row.species,
        row.open_boards,
        row.on_rack,
        row.held,
        row.volume_mm3,
        row.board_feet
      ]),
      [
        'All species',
        result.data.totals.open_boards,
        result.data.totals.on_rack,
        result.data.totals.held,
        result.data.totals.volume_mm3,
        result.data.totals.board_feet
      ]
    ];
    clear(stockBody);
    for (const row of rows) {
      const [head, ...rest] = row;
      stockBody.appendChild(
        el('tr', {}, [
          el('th', { attrs: { scope: 'row' }, text: String(head) }),
          ...rest.map((value) => el('td', { class: 'mono', text: String(value) }))
        ])
      );
    }
  }

  const element = el('section', { class: 'page owner' }, [
    el('h1', { class: 'page-title', text: 'Owner' }),
    rateStatus,
    el('h2', { text: 'Grading queue' }),
    queue,
    el('h2', { text: 'Grade rates' }),
    rateTable,
    el('h3', { text: 'Scheduled rates' }),
    scheduled,
    el('h2', { text: 'Stock on hand' }),
    el('table', { class: 'stock', attrs: { 'aria-label': 'Stock on hand' } }, [
      el('thead', {}, [el('tr', {}, STOCK_HEADERS.map((head) => el('th', { attrs: { scope: 'col' }, text: head })))]),
      stockBody
    ])
  ]);

  await Promise.all([loadQueue(), loadRates(), loadStock()]);
  const poll = window.setInterval(() => void loadStock(), 8000);

  return {
    element,
    banners: [],
    destroy: () => window.clearInterval(poll)
  };
}
