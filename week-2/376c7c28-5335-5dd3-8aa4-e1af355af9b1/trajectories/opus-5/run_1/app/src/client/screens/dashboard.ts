import { get } from '../api.ts';
import type { ScreenRender } from '../app.ts';
import { el, replace } from '../dom.ts';
import { money } from '../format.ts';
import { onLive } from '../live.ts';
import { PIECE_STATUS_LABELS, type PieceStatus } from '../../shared/labels.ts';
import type { Dashboard } from '../types.ts';

const TILES: readonly { key: PieceStatus; caption: string; name: string }[] = [
  { key: 'logged', caption: 'LOGGED', name: 'Logged' },
  { key: 'waiting_bisque', caption: 'WAITING FOR BISQUE', name: 'Waiting for bisque' },
  { key: 'bisqued', caption: 'BISQUED', name: 'Bisqued' },
  { key: 'waiting_glaze', caption: 'WAITING FOR GLAZE', name: 'Waiting for glaze' },
  { key: 'ready_for_pickup', caption: 'READY FOR PICKUP', name: 'Ready for pickup' },
];

function tile(caption: string, name: string): { node: HTMLElement; figure: HTMLElement } {
  const figure = el('span', { class: 'mono big' });
  const node = el('div', { class: 'tile', role: 'group', 'aria-label': name }, [
    el('span', { class: 'label', text: caption }),
    figure,
  ]);
  return { node, figure };
}

export const renderDashboard: ScreenRender = ({ mount }) => {
  const backlogTiles = TILES.map((entry) => ({ entry, ...tile(entry.caption, entry.name) }));
  const pendingTile = tile('PENDING CHARGES', 'Pending charges');
  const revenueTile = tile('MONTH REVENUE', 'Month revenue');
  const waitingBody = el('tbody');

  mount.appendChild(
    el('div', { class: 'stack' }, [
      el('section', { class: 'panel bare' }, [el('h1', { class: 'heading', text: 'DASHBOARD' })]),
      el('section', {
        class: 'panel',
        role: 'region',
        'aria-label': 'Backlog',
      }, [el('div', { class: 'tiles' }, backlogTiles.map((item) => item.node))]),
      el('section', { class: 'panel' }, [
        el('div', { class: 'tiles two' }, [pendingTile.node, revenueTile.node]),
      ]),
      el('section', { class: 'panel' }, [
        el('table', { class: 'table', 'aria-label': 'Longest waiting' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Piece' }),
              el('th', { scope: 'col', text: 'Owner' }),
              el('th', { scope: 'col', text: 'State' }),
              el('th', { scope: 'col', text: 'Days waiting' }),
            ]),
          ]),
          waitingBody,
        ]),
      ]),
    ]),
  );

  const draw = (view: Dashboard): void => {
    for (const item of backlogTiles) {
      item.figure.textContent = String(view.counts[item.entry.key] ?? 0);
    }
    pendingTile.figure.textContent = String(view.pending_charges);
    revenueTile.figure.textContent = money(view.month_revenue_cents);
    replace(
      waitingBody,
      view.longest_waiting.map((piece) =>
        el('tr', {}, [
          el('td', { text: piece.title }),
          el('td', { text: piece.owner_handle }),
          el('td', { text: PIECE_STATUS_LABELS[piece.status] }),
          el('td', { class: 'mono', text: `${piece.days_waiting} DAYS` }),
        ]),
      ),
    );
  };

  const load = async (): Promise<void> => {
    const view = await get<Dashboard>('/api/dashboard').catch(() => null);
    if (view) draw(view);
  };

  void load();
  return onLive(() => void load());
};
