import { get, post, RequestFailed } from '../api.ts';
import type { ScreenRender } from '../app.ts';
import { el, replace } from '../dom.ts';
import { failureCopy, Region, withPending } from '../feedback.ts';
import { onLive } from '../live.ts';
import type { Ticket } from '../types.ts';

interface Column {
  readonly label: string;
  readonly status: 'logged' | 'bisqued' | 'ready_for_pickup';
  readonly listLabel: string;
}

const COLUMNS: readonly Column[] = [
  { label: 'LOGGED', status: 'logged', listLabel: 'Logged pieces' },
  { label: 'BISQUED', status: 'bisqued', listLabel: 'Bisqued pieces' },
  { label: 'READY FOR PICKUP', status: 'ready_for_pickup', listLabel: 'Ready for pickup' },
];

function thumbnail(piece: Ticket): HTMLElement {
  if (!piece.photo_url) return el('div', { class: 'thumb empty' });
  const image = el('img', {
    class: 'thumb',
    src: piece.photo_url,
    alt: `Intake photo of ${piece.title}`,
  });
  image.addEventListener('error', () => image.classList.add('empty'));
  return image;
}

export const renderIntake: ScreenRender = ({ mount, user }) => {
  const region = new Region('Intake status');
  const lists = new Map<string, HTMLElement>();
  const columns = COLUMNS.map((column) => {
    const list = el('ul', { class: 'intake-list', role: 'list', 'aria-label': column.listLabel });
    lists.set(column.status, list);
    return el('section', { class: 'panel' }, [
      el('h2', { class: 'heading small', text: column.label }),
      list,
    ]);
  });
  mount.appendChild(
    el('div', { class: 'stack' }, [
      el('section', { class: 'panel bare' }, [
        el('h1', { class: 'heading', text: 'INTAKE' }),
        region.node,
      ]),
      el('div', { class: 'intake-grid' }, columns),
    ]),
  );

  const act = (
    piece: Ticket,
    path: string,
    button: HTMLButtonElement,
    pending: string,
    success: string,
    copy: Record<string, string>,
  ): void => {
    void withPending(region, button, pending, async () => {
      try {
        await post(`/api/pieces/${piece.id}/${path}`);
        button.closest('li')?.remove();
        region.say(success);
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        region.say(failureCopy(error.failure, copy));
      }
    });
  };

  const rowFor = (column: Column, piece: Ticket): HTMLElement => {
    const actions: HTMLElement[] = [];
    if (column.status === 'logged') {
      const button = el('button', {
        type: 'button',
        class: 'btn primary',
        'aria-label': `Check in ${piece.title}`,
        text: 'CHECK IN',
      });
      button.addEventListener('click', () =>
        act(piece, 'check-in', button, 'Checking in…', `${piece.title} is on the waiting for bisque rack.`, {
          photo_required: `${piece.title} needs an intake photo before check-in.`,
          illegal_transition: `${piece.title} can't be checked in now.`,
          member_inactive: `${piece.title} belongs to an inactive member.`,
        }),
      );
      actions.push(button);
    } else if (column.status === 'bisqued') {
      const button = el('button', {
        type: 'button',
        class: 'btn primary',
        'aria-label': `Check in for glaze ${piece.title}`,
        text: 'CHECK IN FOR GLAZE',
      });
      button.addEventListener('click', () =>
        act(piece, 'check-in', button, 'Checking in…', `${piece.title} is on the waiting for glaze rack.`, {
          photo_required: `${piece.title} needs an intake photo before check-in.`,
          illegal_transition: `${piece.title} can't be checked in now.`,
          member_inactive: `${piece.title} belongs to an inactive member.`,
        }),
      );
      actions.push(button);
    } else {
      const collected = el('button', {
        type: 'button',
        class: 'btn primary',
        'aria-label': `Mark collected ${piece.title}`,
        text: 'MARK COLLECTED',
      });
      collected.addEventListener('click', () =>
        act(piece, 'collect', collected, 'Saving…', `${piece.title} collected.`, {
          illegal_transition: `${piece.title} can't be collected now.`,
        }),
      );
      actions.push(collected);
      if (user?.role === 'owner') {
        const uncollected = el('button', {
          type: 'button',
          class: 'btn ghost',
          'aria-label': `Mark uncollected ${piece.title}`,
          text: 'MARK UNCOLLECTED',
        });
        uncollected.addEventListener('click', () =>
          act(
            piece,
            'mark-uncollected',
            uncollected,
            'Saving…',
            `${piece.title} marked uncollected.`,
            { illegal_transition: `${piece.title} can't be marked uncollected now.` },
          ),
        );
        actions.push(uncollected);
      }
    }
    return el('li', { class: 'intake-row' }, [
      thumbnail(piece),
      el('div', { class: 'stack tight' }, [
        el('span', { class: 'piece-title', text: piece.title }),
        el('span', { class: 'muted', text: piece.owner_handle }),
        el('span', {
          class: 'mono',
          text: `${piece.length_in} × ${piece.width_in} × ${piece.height_in} IN`,
        }),
      ]),
      el('div', { class: 'row' }, actions),
    ]);
  };

  const load = async (): Promise<void> => {
    for (const column of COLUMNS) {
      const pieces = await get<Ticket[]>(`/api/pieces?status=${column.status}`).catch(() => null);
      if (!pieces) continue;
      replace(
        lists.get(column.status) as HTMLElement,
        pieces.map((piece) => rowFor(column, piece)),
      );
    }
  };

  void load();
  return onLive((message) => {
    if (message.kind === 'piece' || message.kind === 'member') void load();
  });
};
