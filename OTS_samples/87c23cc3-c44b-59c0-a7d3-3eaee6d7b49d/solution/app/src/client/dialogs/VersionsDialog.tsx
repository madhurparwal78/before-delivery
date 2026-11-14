import { useCallback, useEffect, useState } from 'react'
import type { Comparison, ProjectJson, VersionJson } from '../../shared/domain.ts'
import { useAnnounce } from '../announce.tsx'
import { ApiFailure, api } from '../api.ts'
import { businessTime } from '../format.ts'
import { Dialog } from '../ui/Dialog.tsx'

interface VersionsDialogProps {
  /** '/api/projects/<id>' or '/api/shared/<token>'. */
  base: string
  canRestore: boolean
  onClose: () => void
  onRestored: (project: ProjectJson) => void
}

function comparisonLines(result: Comparison): string[] {
  const { from, to, added, removed, changed } = result
  if (!added.length && !removed.length && !changed.length) return [`No entity changes between version ${from} and version ${to}.`]
  return [
    `Version ${from} to version ${to}: ${added.length} added, ${removed.length} removed, ${changed.length} changed`,
    ...added.map((name) => `Added entity ${name}`),
    ...removed.map((name) => `Removed entity ${name}`),
    ...changed.map((name) => `Changed entity ${name}`),
  ]
}

function RestoreConfirm({ number, onConfirm, onCancel }: { number: number; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog name={`Restore version ${number}?`} role="alertdialog" onClose={onCancel}>
      <p className="dialog-note">Its text, positions and colours come back as a new numbered version. Every earlier version stays.</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          Restore
        </button>
      </div>
    </Dialog>
  )
}

export function VersionsDialog({ base, canRestore, onClose, onRestored }: VersionsDialogProps) {
  const { say } = useAnnounce()
  const [versions, setVersions] = useState<VersionJson[] | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [comparison, setComparison] = useState<string[]>([])
  const [restoring, setRestoring] = useState<number | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const answer = await api<{ versions: VersionJson[] }>('GET', `${base}/versions`)
    setVersions(answer.versions)
    const numbers = answer.versions.map((version) => String(version.number))
    setFrom((current) => (numbers.includes(current) ? current : (numbers[numbers.length - 1] ?? '')))
    setTo((current) => (numbers.includes(current) ? current : (numbers[0] ?? '')))
  }, [base])

  useEffect(() => {
    load().catch(() => setVersions([]))
  }, [load])

  const compare = async (): Promise<void> => {
    try {
      setComparison(comparisonLines(await api<Comparison>('GET', `${base}/versions/compare?from=${from}&to=${to}`)))
    } catch (error) {
      setComparison([error instanceof ApiFailure ? error.message : 'The versions could not be compared.'])
    }
  }

  const restore = async (number: number): Promise<void> => {
    setRestoring(null)
    say('studio', `Restoring version ${number}...`)
    try {
      const answer = await api<{ version: VersionJson; project: ProjectJson }>('POST', `${base}/versions/${number}/restore`)
      say('studio', `Restored version ${number} as version ${answer.version.number}.`)
      onRestored(answer.project)
      await load()
    } catch (error) {
      say('studio', error instanceof ApiFailure ? error.message : 'The version could not be restored.')
    }
  }

  return (
    <>
      <Dialog name="Versions" onClose={onClose} className="dialog-wide versions">
        {versions === null ? <p className="dialog-note">Loading...</p> : null}
        {versions?.length === 0 ? <p className="dialog-note">No versions yet. Save one to keep this moment.</p> : null}
        <ul className="versions-list" aria-label="Version history">
          {(versions ?? []).map((version) => (
            <li key={version.number}>
              <div className="versions-text">
                <strong>{`Version ${version.number}: ${version.name}`}</strong>
                <span className="versions-meta">{businessTime(version.createdAt)}</span>
                <span className="versions-meta">{`by ${version.createdBy.displayName}`}</span>
              </div>
              {canRestore ? (
                <button type="button" className="btn btn-quiet" onClick={() => setRestoring(version.number)}>
                  {`Restore version ${version.number}`}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {versions && versions.length > 0 ? (
          <div className="versions-compare">
            <div className="versions-pickers">
              <div className="field">
                <label htmlFor="versions-from">From version</label>
                <select id="versions-from" className="input" value={from} onChange={(event) => setFrom(event.target.value)}>
                  {versions.map((version) => (
                    <option key={version.number} value={version.number}>{`Version ${version.number}`}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="versions-to">To version</label>
                <select id="versions-to" className="input" value={to} onChange={(event) => setTo(event.target.value)}>
                  {versions.map((version) => (
                    <option key={version.number} value={version.number}>{`Version ${version.number}`}</option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn btn-quiet versions-compare-button" onClick={() => void compare()}>
                Compare versions
              </button>
            </div>
            <section aria-label="Comparison" className="versions-result">
              {comparison.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </section>
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </Dialog>
      {restoring !== null ? (
        <div onKeyDown={(event) => event.stopPropagation()}>
          <RestoreConfirm number={restoring} onConfirm={() => void restore(restoring)} onCancel={() => setRestoring(null)} />
        </div>
      ) : null}
    </>
  )
}
