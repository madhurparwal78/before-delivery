import { copy } from '../../shared/copy';
import { api, ApiFailure } from '../api';
import { el } from '../dom';
import { navigate, sentenceTile } from '../main';

export async function mountJoin(container: HTMLElement, code: string): Promise<void> {
  try {
    const game = await api.join(code);
    navigate(`/games/${game.id}`);
  } catch (failure) {
    if (!(failure instanceof ApiFailure)) throw failure;
    if (failure.status === 410) {
      container.append(
        el('div', { class: 'band ink', role: 'alert', text: failure.body.message }),
      );
      return;
    }
    if (failure.body.error === 'game_full') {
      container.append(sentenceTile(copy.gameFull));
      return;
    }
    if (failure.body.error === 'game_solved') {
      container.append(sentenceTile(copy.alreadySolved));
      return;
    }
    container.append(sentenceTile(copy.unknownGame));
  }
}
