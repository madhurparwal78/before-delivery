import { route } from './lib/router'
import { mountTitle } from './pages/title'
import { mountConfirm, mountSignin, mountSignup } from './pages/auth'
import { mountPlay } from './pages/play'
import { mountHallEditor } from './pages/hall-editor'
import { mountHallVisit } from './pages/hall-visit'
import { mountNoticeBoard } from './pages/notice-board'
import { mountRanger } from './pages/ranger'
import { mountChallengeBoard } from './pages/challenge-board'
import { mountPostcard } from './pages/postcard'
import { mountTextWorld } from './pages/text-world'
import { mountNotFound } from './pages/not-found'

/** The last route is the fallback for any other path. */
export function registerRoutes(): void {
  route(/^\/$/, false, mountTitle)
  route(/^\/signup$/, false, mountSignup)
  route(/^\/signin$/, false, mountSignin)
  route(/^\/confirm$/, true, mountConfirm)
  route(/^\/play$/, true, mountPlay)
  route(/^\/hall$/, true, mountHallEditor)
  route(/^\/hall\/([^/]+)$/, false, mountHallVisit)
  route(/^\/board$/, true, mountNoticeBoard)
  route(/^\/ranger$/, true, mountRanger)
  route(/^\/boards\/(\d+)$/, true, mountChallengeBoard)
  route(/^\/postcards\/([^/]+)$/, false, mountPostcard)
  route(/^\/text-world$/, false, mountTextWorld)
  route(/^/, false, mountNotFound)
}
