// Fairline browser app: routes for the landing page, seat links, invitations and the workspace.

import { StrictMode, useCallback, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Collaborator } from '../shared/protocol.js'
import { api, ApiFailure, keepSeatToken } from './api.js'
import { INVITE_MESSAGES } from '../shared/invites.js'
import { StaveMark } from './ui.js'
import { SeatInvalid, Workspace } from './workspace.js'
import './styles.css'

function Landing(): ReactNode {
  return (
    <main className="centred">
      <div className="card">
        <StaveMark />
        <h1>Fairline</h1>
        <p>Open the seat link your composer sent you.</p>
      </div>
    </main>
  )
}

/** Checks the token with the API, keeps it for this tab and opens the workspace. */
function SeatLink({ token, navigate }: { token: string; navigate: (path: string, replace?: boolean) => void }): ReactNode {
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    api<{ collaborator: Collaborator; score: { id: string } }>('GET', '/api/me', undefined, { token }).then(
      (me) => {
        keepSeatToken(token)
        navigate(`/score/${me.score.id}`, true)
      },
      () => setInvalid(true),
    )
  }, [token, navigate])
  return invalid ? <SeatInvalid /> : <main className="centred"><div className="card"><h1>Fairline</h1><p>Opening your seat…</p></div></main>
}

interface Invite { name: string; role: Collaborator['role']; status: string; scoreTitle: string }

function Join({ token, navigate }: { token: string; navigate: (path: string, replace?: boolean) => void }): ReactNode {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    api<{ invite: Invite }>('GET', `/api/invites/${token}`, undefined, { token: null }).then(
      (r) => {
        setInvite(r.invite)
        if (r.invite.status === 'removed') setMessage(INVITE_MESSAGES.withdrawn)
        else if (r.invite.status === 'active') setMessage(INVITE_MESSAGES.used)
      },
      () => setMessage('This invite link is not valid.'),
    )
  }, [token])
  const join = (): void => {
    setPending(true)
    api<{ seatToken: string; collaborator: Collaborator }>('POST', `/api/invites/${token}/accept`, {}, { token: null }).then(
      async (r) => {
        keepSeatToken(r.seatToken)
        const me = await api<{ score: { id: string } }>('GET', '/api/me')
        navigate(`/score/${me.score.id}`, true)
      },
      (error: unknown) => {
        setPending(false)
        setMessage(error instanceof ApiFailure ? error.body.message : 'The server could not be reached.')
      },
    )
  }
  if (!invite && !message) return <main className="centred"><div className="card"><h1>Fairline</h1><p>Opening your invitation…</p></div></main>
  return (
    <main className="centred">
      <div className="card">
        {invite ? <h1>{`Join ${invite.scoreTitle}`}</h1> : <h1>Fairline</h1>}
        {invite && <p className="meta">{`${invite.name} · ${invite.role === 'player' ? 'Section player' : 'Copyist'}`}</p>}
        {message ? <p role="alert">{message}</p> : invite && <button type="button" className="btn" disabled={pending} onClick={join}>{pending ? `Join as ${invite.name}…` : `Join as ${invite.name}`}</button>}
      </div>
    </main>
  )
}

function App(): ReactNode {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const onPop = (): void => setPath(location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((next: string, replace = false) => {
    if (replace) history.replaceState(null, '', next)
    else history.pushState(null, '', next)
    setPath(next)
  }, [])
  const seat = /^\/s\/([^/]+)$/.exec(path)
  const invite = /^\/i\/([^/]+)$/.exec(path)
  const workspace = /^\/score\/([^/]+)(?:\/parts\/([^/]+))?$/.exec(path)
  if (seat) return <SeatLink token={decodeURIComponent(seat[1] as string)} navigate={navigate} />
  if (invite) return <Join token={decodeURIComponent(invite[1] as string)} navigate={navigate} />
  if (workspace) return <Workspace key={workspace[1]} partId={workspace[2] ? decodeURIComponent(workspace[2]) : null} navigate={navigate} />
  return <Landing />
}

/** The faces the first screen draws with. Rendering waits for them (at most FONT_WAIT_MS) so the text never reflows when they arrive. */
const FIRST_SCREEN_FONTS = ['500 1em "Fraunces"', '400 1em "IBM Plex Sans"', '600 1em "IBM Plex Sans"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"']
const FONT_WAIT_MS = 2500

const fontsReady = Promise.race([
  Promise.all(FIRST_SCREEN_FONTS.map((face) => document.fonts.load(face))).then(() => undefined, () => undefined),
  new Promise<void>((resolve) => window.setTimeout(resolve, FONT_WAIT_MS)),
])

void fontsReady.then(() => createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App /></StrictMode>))

