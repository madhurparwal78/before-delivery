import { DECK_STATUS, SCREEN_STATES, trashCountdown } from '../../shared/copy.js';
import type { TrashItemJson } from '../../shared/types.js';
import { ApiCallError, api } from '../api.js';
import { element, setText } from '../dom.js';
import { measureRows, slideRowOut, slideRowsFrom } from '../motion.js';
import { startRefetch, type Screen, type ScreenContext } from './screen.js';

/** The trash, with each reference's countdown as the server reports it. */
export function renderTrash({ shell }: ScreenContext): Screen {
  const heading = element('h1', { tabindex: '-1' }, ['Trash']);
  const list = element('ul', { class: 'trash-list', role: 'list', 'aria-label': 'Trashed references' });
  shell.main.append(heading, list);
  shell.field.showMessage(SCREEN_STATES.loading);

  let destroyed = false;
  const countdowns = new Map<string, { node: HTMLElement; secondsLeft: number; readAt: number }>();

  function paint(items: TrashItemJson[]): void {
    list.replaceChildren();
    countdowns.clear();
    for (const item of items) {
      const countdown = element('p', { class: 'row-countdown' }, [
        `Restorable for ${trashCountdown(item.seconds_left)}`,
      ]);
      const restore = element('button', { type: 'button', class: 'action quiet' }, [
        `Restore ${item.title}`,
      ]);
      restore.addEventListener('click', () => void restoreItem(item, restore));
      const row = element('li', { class: 'trash-row' }, [
        element('p', { class: 'row-name' }, [item.title]),
        element('p', { class: 'row-maker' }, [item.maker ?? '']),
        countdown,
        restore,
      ]);
      row.dataset.referenceId = item.id;
      list.append(row);
      countdowns.set(item.id, {
        node: countdown,
        secondsLeft: item.seconds_left,
        readAt: performance.now(),
      });
    }
    shell.field.showMessage(
      items.length === 0 ? SCREEN_STATES.trashEmpty : 'Restore a reference to put it back.',
    );
  }

  /** Focus moves to the next Restore button, or to the Trash heading when none is left. */
  async function restoreItem(item: TrashItemJson, button: HTMLButtonElement): Promise<void> {
    const row = button.closest<HTMLElement>('.trash-row');
    try {
      await api.restore(item.id);
    } catch (error) {
      if (error instanceof ApiCallError && error.status === 410) {
        shell.setDeckStatus(DECK_STATUS.restoreWindowClosed);
        void load();
        return;
      }
      shell.setDeckStatus(DECK_STATUS.genericFailure);
      return;
    }
    shell.setDeckStatus(`Restored ${item.title}.`);
    if (!row) {
      void load();
      return;
    }
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('button')];
    const position = buttons.indexOf(button);
    const next = buttons[position + 1] ?? buttons[position - 1] ?? null;
    (next ?? heading).focus();
    const below = [...list.children].filter((child) => child !== row);
    const before = measureRows(below);
    slideRowOut(row, () => {
      row.remove();
      countdowns.delete(item.id);
      slideRowsFrom(before);
      if (list.children.length === 0) shell.field.showMessage(SCREEN_STATES.trashEmpty);
    });
  }

  async function load(): Promise<void> {
    const answer = await api.trashList().catch(() => null);
    if (!answer || destroyed) return;
    paint(answer.items);
  }

  /** Between fetches the countdown runs on elapsed time, never on the device's date. */
  const tick = window.setInterval(() => {
    for (const entry of countdowns.values()) {
      const elapsed = (performance.now() - entry.readAt) / 1000;
      setText(entry.node, `Restorable for ${trashCountdown(entry.secondsLeft - elapsed)}`);
    }
  }, 1_000);

  void load();
  const stopRefetch = startRefetch(() => void load());

  return {
    destroy() {
      destroyed = true;
      window.clearInterval(tick);
      stopRefetch();
    },
  };
}
