/** Who is signed in, for the header and the guards. */
import { ApiFailure, get } from './api'
import type { Me } from '../../shared/types'

export const session: { me: Me | null } = { me: null }

/** The shell's own copy of `/api/me`, used once, for the first screen; later screens read `/api/me` afresh. */
let embedded: { me: Me | null } | null = (() => {
  const text = document.getElementById('session')?.textContent ?? ''
  return text === '' ? null : { me: JSON.parse(text) as Me | null }
})()

/** The first call answers from the shell without waiting; every later call reads `/api/me`. */
export function takeEmbeddedSession(): { me: Me | null } | null {
  const taken = embedded
  embedded = null
  if (taken) session.me = taken.me
  return taken
}

/** Reads `/api/me`; null when signed out. */
export async function loadSession(): Promise<Me | null> {
  try {
    session.me = await get<Me>('/api/me')
  } catch (error) {
    if (!(error instanceof ApiFailure) || error.status !== 401) throw error
    session.me = null
  }
  return session.me
}

/** A local path starts with a single `/`; anything else lands on /play. */
export function localPath(next: string | null): string {
  return next !== null && /^\/(?!\/)/.test(next) && !next.includes('\\') ? next : '/play'
}
