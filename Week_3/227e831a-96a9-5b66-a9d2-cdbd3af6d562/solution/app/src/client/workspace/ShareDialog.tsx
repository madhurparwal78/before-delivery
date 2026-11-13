import { useEffect, useRef, useState } from 'react'
import type { Share } from '../../shared/api-types'
import { expiredNotice } from '../../shared/share'
import { api, ApiError } from '../api'
import { Dialog, FieldError } from '../ui'

interface Props {
  listId: string
  onClose: () => void
  announce: (text: string) => void
}

export function ShareDialog({ listId, onClose, announce }: Props) {
  const [share, setShare] = useState<Share | null>(null)
  const [expiresOn, setExpiresOn] = useState('')
  const [message, setMessage] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const expiresField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    api.share(listId).then((loaded) => { if (live) setShare(loaded) }, () => undefined)
    return () => { live = false }
  }, [listId])

  const link = share ? `${window.location.origin}${share.url}` : ''

  async function create() {
    if (busy) return
    setBusy(true)
    try {
      const created = await api.createShare(listId, expiresOn.trim() === '' ? null : expiresOn.trim())
      setShare(created)
      setMessage(undefined)
      announce('Share link created.')
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      setMessage(error.fields.expiresOn ?? error.message)
      expiresField.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!share || busy) return
    setBusy(true)
    try {
      await api.revokeShare(listId)
      setShare(null)
      announce('Share link revoked.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!share) return
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      document.querySelector<HTMLInputElement>('#share-link')?.select()
    }
  }

  return (
    <Dialog name="Share list" onClose={onClose}>
      <h2>Share list</h2>
      <div className="stack">
        <div className="field">
          <label htmlFor="share-expires">Expires on</label>
          <input id="share-expires" ref={expiresField} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" autoComplete="off"
            value={expiresOn} aria-invalid={message ? true : undefined} aria-describedby={message ? 'share-expires-error' : undefined}
            onChange={(event) => { setExpiresOn(event.target.value); setMessage(undefined) }} />
          <FieldError id="share-expires-error" message={message} />
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={() => void create()}>{share ? 'Create new link' : 'Create link'}</button>
        </div>
        {share?.expired && share.expiresOn && <p className="notice">{expiredNotice(share.expiresOn)}</p>}
        <div className="field">
          <label htmlFor="share-link">Share link</label>
          <input id="share-link" type="text" readOnly value={link} />
        </div>
        <div className="actions">
          <button type="button" onClick={() => void copy()}>Copy link</button>
          <button type="button" aria-disabled={share ? undefined : true} onClick={() => void revoke()}>Revoke link</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </Dialog>
  )
}
