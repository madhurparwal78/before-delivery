import type { GameJson } from '../../shared/types.ts'
import { ApiFailure, api } from '../api.ts'
import { navigate } from '../navigation.ts'
import { ensurePlayer } from '../session.ts'
import { loadingTiles, messageTile } from '../view.ts'
import type { View } from '../view.ts'

/** Opens a game link: joins with the next free colour, then opens the room. */
export async function renderJoin(view: View): Promise<void> {
  const { main, params } = view
  loadingTiles(main, ['c12 r2'])
  await ensurePlayer()
  try {
    const game = await api<GameJson>('POST', `/api/links/${params[0]}/join`, {})
    if (view.current()) navigate(`/games/${game.id}`, true)
  } catch (failure) {
    if (!view.current()) return
    main.replaceChildren()
    main.removeAttribute('aria-busy')
    if (!(failure instanceof ApiFailure)) throw failure
    if (failure.status === 410) view.band(failure.message)
    else messageTile(main, failure.message)
  }
}
