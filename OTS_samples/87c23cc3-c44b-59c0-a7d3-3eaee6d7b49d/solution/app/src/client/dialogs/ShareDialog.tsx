import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { MemberJson, ShareAccess, ShareJson } from '../../shared/domain.ts'
import { useAlerts } from '../alerts.tsx'
import { useAnnounce } from '../announce.tsx'
import { ApiFailure, api, fieldErrors } from '../api.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { FieldError, FormErrors } from '../ui/FormErrors.tsx'

const IDS = { access: 'share-access', email: 'share-email' }
const mailDown = (email: string): string => `The invitation to ${email} could not be sent because mail is down. The link works; send it again later.`
const word = (access: ShareAccess): string => (access === 'view' ? 'View' : 'Edit')

export function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { say } = useAnnounce()
  const { raise } = useAlerts()
  const [access, setAccess] = useState<ShareAccess>('view')
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [shares, setShares] = useState<ShareJson[] | null>(null)
  const [members, setMembers] = useState<MemberJson[]>([])
  const base = `/api/projects/${projectId}`

  const reload = useCallback(async (): Promise<void> => {
    const [shared, people] = await Promise.all([
      api<{ shares: ShareJson[] }>('GET', `${base}/shares`),
      api<{ members: MemberJson[] }>('GET', `${base}/members`),
    ])
    setShares(shared.shares)
    setMembers(people.members)
  }, [base])

  useEffect(() => {
    reload().catch(() => setShares([]))
  }, [reload])

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const invited = email.trim()
    const label = invited ? 'Sending invitation...' : 'Creating link...'
    setPending(label)
    say('studio', label)
    setErrors({})
    try {
      const share = await api<ShareJson>('POST', `${base}/shares`, { access, email: invited || undefined })
      say('studio', `${word(share.access)} link created.`)
      if (share.invitation?.status === 'sent') say('studio', `Invitation sent to ${share.email}.`)
      if (share.invitation?.status === 'failed') raise(mailDown(share.email ?? invited))
      setEmail('')
      await reload()
    } catch (error) {
      setErrors(fieldErrors(error))
      say('studio', '')
    }
    setPending(null)
  }

  const act = async (work: () => Promise<string | null>): Promise<void> => {
    try {
      const message = await work()
      if (message) say('studio', message)
      await reload()
    } catch (error) {
      if (error instanceof ApiFailure) raise(error.message)
    }
  }

  const resend = (share: ShareJson): Promise<void> => {
    const email = share.email ?? ''
    say('studio', 'Sending invitation...')
    return act(async () => {
      try {
        await api<ShareJson>('POST', `${base}/shares/${share.id}/invitation`)
        return `Invitation sent to ${email}.`
      } catch (error) {
        if (error instanceof ApiFailure && error.body.error === 'mail_unavailable') {
          say('studio', '')
          raise(mailDown(email))
          return null
        }
        throw error
      }
    })
  }

  const active = (shares ?? []).filter((share) => share.status === 'active')
  const retired = (shares ?? []).filter((share) => share.status !== 'active')

  return (
    <Dialog name="Share project" onClose={onClose} className="dialog-wide share">
      <form onSubmit={(event) => void create(event)} noValidate>
        <FormErrors errors={errors} ids={{ access: IDS.access, email: IDS.email }} />
        <div className="field">
          <span className="field-label" id="share-access-label">
            Access
          </span>
          <div role="radiogroup" aria-labelledby="share-access-label" className="radio-row" id={IDS.access} tabIndex={-1}>
            <label>
              <input type="radio" name="share-access" checked={access === 'view'} onChange={() => setAccess('view')} />
              Can view
            </label>
            <label>
              <input type="radio" name="share-access" checked={access === 'edit'} onChange={() => setAccess('edit')} />
              Can edit
            </label>
          </div>
          <FieldError id="share-access-error" message={errors.access} />
        </div>
        <div className="field">
          <label htmlFor={IDS.email}>Invite by email (optional)</label>
          <input
            id={IDS.email}
            type="email"
            className="input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'share-email-error' : undefined}
            autoComplete="off"
          />
          <FieldError id="share-email-error" message={errors.email} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending !== null}>
          {pending ?? 'Create link'}
        </button>
      </form>

      <h3 className="share-heading">Links</h3>
      <ul className="share-list" aria-label="Links">
        {shares !== null && !shares.length ? <li className="share-empty">No links yet.</li> : null}
        {[...active, ...retired].map((share) => (
          <li key={share.id} className="share-item">
            <div className="share-info">
              <strong>{share.access === 'view' ? 'View link' : 'Edit link'}</strong>
              {share.status !== 'active' ? <span className="badge">{share.status}</span> : null}
              {share.email ? <span className="share-email">{share.email}</span> : null}
              {share.invitation ? (
                <span className="share-state">{`Invitation ${share.invitation.status}`}</span>
              ) : null}
            </div>
            {share.status === 'active' ? (
              <div className="share-actions">
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}${share.url}`).catch(() => undefined)}
                >
                  {`Copy ${share.access} link`}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() =>
                    void act(async () => {
                      await api<ShareJson>('POST', `${base}/shares/${share.id}/rotate`)
                      return 'Link rotated. The old address no longer works.'
                    })
                  }
                >
                  {`Rotate ${share.access} link`}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() =>
                    void act(async () => {
                      await api<ShareJson>('POST', `${base}/shares/${share.id}/revoke`)
                      return 'Link turned off.'
                    })
                  }
                >
                  {`Turn off ${share.access} link`}
                </button>
                {share.invitation?.status === 'failed' ? (
                  <button type="button" className="btn btn-quiet" onClick={() => void resend(share)}>
                    Send again
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <h3 className="share-heading">People with access</h3>
      <ul className="share-list" aria-label="People with access">
        {members.map((member) => (
          <li key={member.userId} className="share-item" aria-label={`${member.displayName}, ${member.role}`}>
            <div className="share-info">
              <strong>{member.displayName}</strong>
              <span className="share-email">{member.email}</span>
            </div>
            <div className="share-actions">
              <select
                className="input share-role"
                aria-label={`Access for ${member.displayName}`}
                value={member.role}
                onChange={(event) => {
                  const role = event.target.value === 'viewer' ? 'viewer' : 'editor'
                  setMembers((list) => list.map((entry) => (entry.userId === member.userId ? { ...entry, role } : entry)))
                  void act(async () => {
                    await api<MemberJson>('PATCH', `${base}/members/${member.userId}`, { role })
                    return role === 'viewer' ? `${member.displayName} can now only view.` : `${member.displayName} can now edit.`
                  })
                }}
              >
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() =>
                  void act(async () => {
                    await api<void>('DELETE', `${base}/members/${member.userId}`)
                    return `${member.displayName} no longer has access.`
                  })
                }
              >
                {`Remove ${member.displayName}`}
              </button>
            </div>
          </li>
        ))}
        {!members.length ? <li className="share-empty">Nobody else has access yet.</li> : null}
      </ul>

      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}
