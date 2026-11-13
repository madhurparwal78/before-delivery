import { useState, type ReactNode } from 'react'
import { holdPending } from '../api'
import { useApp } from '../state'

/** A full-width black band announcing a storage outage. */
export function OutageBand({ text }: { text: string | null }) {
  return text ? <div role="alert" className="outage on-black">{text}</div> : null
}

/** Fetches a stored file and hands it to the browser as a download; reports whether storage answered. */
async function download(href: string, name: string): Promise<boolean> {
  const release = holdPending()
  try {
    const response = await fetch(href, { credentials: 'same-origin' })
    if (!response.ok) return false
    const url = URL.createObjectURL(await response.blob())
    const anchor = Object.assign(document.createElement('a'), { href: url, download: name })
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return true
  } finally {
    release()
  }
}

/** A link that downloads a stored document; a storage outage shows `storage.doc` in the black band. */
export function DocumentLink({ href, name, className = '', children }: { href: string; name: string; className?: string; children: ReactNode }) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const open = async (): Promise<void> => {
    setBusy(true)
    setFailed(!(await download(href, name)))
    setBusy(false)
  }
  return (
    <>
      <a
        href={href} download={name} className={`doc-link no-print ${className}`} aria-busy={busy ? 'true' : undefined} aria-disabled={busy ? 'true' : undefined}
        onClick={(event) => {
          event.preventDefault()
          if (!busy) void open()
        }}
      >
        {children}
      </a>
      <OutageBand text={failed ? app.t('storage.doc') : null} />
    </>
  )
}
