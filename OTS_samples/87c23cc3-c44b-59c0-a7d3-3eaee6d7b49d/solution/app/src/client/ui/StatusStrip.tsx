import { useSession } from '../session.tsx'

const COPY = {
  running: 'All studio services are running.',
  storage: 'Storage is down: exports and imports are paused. Editing still saves.',
  mail: 'Mail is down: sign-in codes and invitations are paused. Links still work.',
  both: 'Storage and mail are down: exports, imports, codes and invitations are paused. Editing still saves.',
} as const

/** The pinned live studio status strip: a pill and the message for what the server's probes found. */
export function StatusStrip() {
  const { status } = useSession()
  const storageDown = status?.storage === 'down'
  const mailDown = status?.mail === 'down'
  const message = !status ? '' : storageDown && mailDown ? COPY.both : storageDown ? COPY.storage : mailDown ? COPY.mail : COPY.running
  return (
    <div role="status" aria-label="Studio status" className="studio-strip">
      <span className="live-pill">Live</span>
      {message && <span className="strip-message">{message}</span>}
    </div>
  )
}
