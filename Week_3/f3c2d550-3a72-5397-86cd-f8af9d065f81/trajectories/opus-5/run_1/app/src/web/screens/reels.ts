import { DECK_STATUS, SCREEN_STATES } from '../../shared/copy.js';
import { ApiCallError, api } from '../api.js';
import { openDialog } from '../dialog.js';
import { clear, element } from '../dom.js';
import { startRefetch, type Screen, type ScreenContext } from './screen.js';

/** The list of reels. */
export function renderReels({ shell, navigate }: ScreenContext): Screen {
  const heading = element('h1', {}, ['Reels']);
  const newReel = element('button', { type: 'button', class: 'action primary' }, ['New reel']);
  const list = element('ul', { class: 'reel-list' });
  shell.main.append(heading, newReel, list);
  shell.field.showMessage(SCREEN_STATES.loading);
  let destroyed = false;

  async function load(): Promise<void> {
    const answer = await api.reels().catch(() => null);
    if (!answer || destroyed) return;
    clear(list);
    for (const reel of answer.reels) {
      list.append(
        element('li', { class: 'reel-row' }, [
          element('a', { href: `/reels/${reel.id}` }, [reel.name]),
          element('p', { class: 'row-maker' }, [
            `${reel.stop_count} ${reel.stop_count === 1 ? 'stop' : 'stops'}`,
          ]),
        ]),
      );
    }
    shell.field.showMessage(
      answer.reels.length === 0 ? 'No reels yet. Make one to start a sequence.' : 'Open a reel to play it.',
    );
  }

  newReel.addEventListener('click', () => {
    openDialog({
      label: 'New reel',
      opener: newReel,
      build: (close) => {
        const input = element('input', {
          type: 'text',
          id: 'new-reel-name',
          'aria-label': 'Reel name',
        });
        const create = element('button', { type: 'button', class: 'action primary' }, [
          'Create reel',
        ]);
        const error = element('p', { class: 'field-error', hidden: true });
        create.addEventListener('click', () => {
          void api
            .createReel(input.value)
            .then((reel) => {
              close();
              shell.setDeckStatus(DECK_STATUS.reelCreated);
              navigate(`/reels/${reel.id}`);
            })
            .catch((failure: unknown) => {
              if (failure instanceof ApiCallError && failure.status === 422) {
                error.hidden = false;
                error.textContent = failure.fields.name ?? DECK_STATUS.validationFailure;
                shell.setDeckStatus(DECK_STATUS.validationFailure);
                input.setAttribute('aria-invalid', 'true');
                input.focus();
                return;
              }
              shell.setDeckStatus(DECK_STATUS.genericFailure);
            });
        });
        return [
          element('label', { for: 'new-reel-name' }, ['Reel name']),
          input,
          error,
          create,
        ];
      },
    });
  });

  void load();
  const stopRefetch = startRefetch(() => void load());

  return {
    destroy() {
      destroyed = true;
      stopRefetch();
    },
  };
}
