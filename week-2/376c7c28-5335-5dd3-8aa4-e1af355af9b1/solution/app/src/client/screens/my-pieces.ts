import { get } from '../api.ts';
import type { ScreenRender } from '../app.ts';
import { el, replace } from '../dom.ts';
import { dollars, studioDateLabel } from '../format.ts';
import { onLive } from '../live.ts';
import { PIECE_STATUS_LABELS } from '../../shared/labels.ts';
import type { Passport } from '../types.ts';

export const renderMyPieces: ScreenRender = ({ mount, navigate }) => {
  const list = el('ul', { class: 'piece-grid', 'aria-label': 'My pieces', role: 'list' });
  mount.appendChild(
    el('section', { class: 'panel' }, [
      el('h1', { class: 'heading', text: 'MY PIECES' }),
      list,
    ]),
  );

  const draw = (pieces: readonly Passport[]): void => {
    if (pieces.length === 0) {
      replace(list, [
        el('li', {
          class: 'empty-note muted',
          text: 'No pieces yet. Log a piece to get its quote, then bring it to the intake shelf.',
        }),
      ]);
      return;
    }
    replace(
      list,
      pieces.map((piece) => {
        const link = el('a', {
          href: `/pieces/${piece.id}`,
          class: 'piece-title',
          text: piece.title,
        });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          navigate(`/pieces/${piece.id}`);
        });
        return el('li', { class: 'piece-card' }, [
          link,
          el('p', { class: 'label', text: PIECE_STATUS_LABELS[piece.status] }),
          el('p', { class: 'mono', text: `BISQUE $${dollars(piece.quote.bisque.fee_cents)}` }),
          el('p', { class: 'mono', text: `GLAZE $${dollars(piece.quote.glaze.fee_cents)}` }),
          piece.pickup_deadline
            ? el('p', {
                class: 'mono accent',
                text: `COLLECT BY ${studioDateLabel(piece.pickup_deadline)}`,
              })
            : null,
        ]);
      }),
    );
  };

  const load = async (): Promise<void> => {
    const pieces = await get<Passport[]>('/api/pieces').catch(() => null);
    if (pieces) draw(pieces);
  };

  void load();
  return onLive((message) => {
    if (message.kind === 'piece' || message.kind === 'charge') void load();
  });
};
