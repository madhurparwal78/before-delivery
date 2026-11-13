import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ListSummary } from '../shared/api-types'
import { api, ApiError } from './api'
import { cache } from './cache'
import { navigate } from './router'
import { settleWrites } from './writes'
import { Dialog, FieldError, Link } from './ui'

function NewListDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState<string | undefined>()
  const field = useRef<HTMLInputElement>(null)

  async function create(event: FormEvent) {
    event.preventDefault()
    try {
      const list = await api.createList(name)
      navigate(`/lists/${list.id}`, { arrivedByCreate: true })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      setMessage(error.fields.name ?? error.message)
      field.current?.focus()
    }
  }

  return (
    <Dialog name="New trip list" onClose={onClose}>
      <h2>New trip list</h2>
      <form onSubmit={create} className="stack" noValidate>
        <div className="field">
          <label htmlFor="list-name">List name</label>
          <input id="list-name" ref={field} type="text" value={name} aria-invalid={message ? true : undefined}
            aria-describedby={message ? 'list-name-error' : undefined} onChange={(e) => { setName(e.target.value); setMessage(undefined) }} />
          <FieldError id="list-name-error" message={message} />
        </div>
        <div className="actions">
          <button type="submit" className="primary">Create list</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}

export function Trips() {
  const [lists, setLists] = useState<ListSummary[] | null>(cache.lists.get())
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let live = true
    void settleWrites().then(() => api.lists()).then(
      (loaded) => { cache.lists.set(loaded); if (live) setLists(loaded) },
      () => undefined,
    )
    return () => { live = false }
  }, [])

  return (
    <main className="page">
      <div className="page-head">
        <h1 tabIndex={-1}>Trips</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)}>New trip list</button>
      </div>
      {lists === null ? <p className="hint">Loading trips…</p> : lists.length === 0 ? (
        <p className="empty">No trip lists yet. Create one to start packing.</p>
      ) : (
        <table className="ledger" aria-label="Trip lists" role="table">
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">List</th><th role="columnheader" scope="col">State</th><th role="columnheader" scope="col" className="weight">Base weight</th></tr></thead>
          <tbody role="rowgroup">
            {lists.map((list) => (
              <tr key={list.id} role="row">
                <td role="cell"><Link to={`/lists/${list.id}`}>{list.name}</Link></td>
                <td role="cell" className="state">{list.state}</td>
                <td role="cell" className="weight">{list.totals.display.base}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && <NewListDialog onClose={() => setCreating(false)} />}
    </main>
  )
}
