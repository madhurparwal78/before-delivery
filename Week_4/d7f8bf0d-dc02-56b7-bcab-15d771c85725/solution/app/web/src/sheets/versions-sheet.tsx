import { useState } from 'react'
import { act, closeSheet, layoutPath, refreshLayout, saveVersion } from '../actions'
import { apiGet, apiWrite } from '../api'
import { COPY } from '../copy'
import { canBuild, canManage, say, store, useSelector } from '../state'
import { Button, EmptyState, Sheet } from '../ui/primitives'
import { Skeleton } from './skeleton'
import { useLoad } from './use-load'
import type { Finding, LayoutVersion } from '../../../shared/domain'

export function VersionsSheet() {
  const revision = useSelector(s => s.layout?.revision)
  const role = useSelector(s => s.role)
  const { data, reload } = useLoad(() => apiGet<{ versions: LayoutVersion[] }>(`${layoutPath()}/versions`), [revision])
  const [findings, setFindings] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const versions = data === null ? null : [...data.versions].sort((a, b) => b.number - a.number)

  async function settle(): Promise<void> {
    reload()
    await refreshLayout().catch(() => undefined)
  }

  async function validate(version: LayoutVersion): Promise<void> {
    setBusy(version.id)
    const done = await act({
      pending: COPY.validating(version.number),
      run: () => apiWrite('POST', `${layoutPath()}/versions/${version.id}/validate`, { revision: version.revision }),
      success: () => COPY.validated(version.number),
    })
    if (!done.ok && done.error.code === 'validation_failed') {
      const found = (done.error.body?.findings ?? []) as Finding[]
      setFindings(current => ({ ...current, [version.id]: found.map(finding => finding.message) }))
      say(COPY.versionFindings(version.number, found.length))
    } else if (done.ok) {
      setFindings(current => ({ ...current, [version.id]: [] }))
    }
    setBusy(null)
    await settle()
  }

  async function publish(version: LayoutVersion): Promise<void> {
    setBusy(version.id)
    await act({
      pending: COPY.publishing(version.number),
      run: () => apiWrite('POST', `${layoutPath()}/versions/${version.id}/publish`, { revision: version.revision }),
      success: () => COPY.published(version.number),
    })
    setBusy(null)
    await settle()
  }

  async function restore(version: LayoutVersion): Promise<void> {
    setBusy(version.id)
    await act({
      pending: COPY.restoring(version.number),
      run: () => apiWrite<{ version: LayoutVersion }>('POST', `${layoutPath()}/versions/${version.id}/restore`, { revision: store.get().layout?.revision ?? 0 }),
      success: answer => COPY.restored(answer.version.number),
    })
    setBusy(null)
    await settle()
  }

  return (
    <Sheet title="Versions" testId="sheet-versions" onClose={closeSheet}>
      {canBuild(role) ? (
        <div className="sheet-actions">
          <Button onClick={() => void saveVersion()}>Save version</Button>
        </div>
      ) : null}
      {versions === null ? <Skeleton /> : versions.length === 0 ? <EmptyState /> : (
        <ul className="rows">
          {versions.map(version => (
            <li key={version.id} className="row" data-testid={`version-row-${version.number}`}>
              <div className="row-main">
                <div className="row-title-line">
                  <span className="row-title">{`Version ${version.number}`}</span>
                  <span className="state-word">{version.state}</span>
                </div>
                <span className="row-meta">{version.label}</span>
                <span className="hash">{version.canonical_hash.slice(0, 12)}</span>
                {(findings[version.id] ?? []).length > 0 ? (
                  <ul className="findings">
                    {(findings[version.id] ?? []).map(message => <li key={message}>{message}</li>)}
                  </ul>
                ) : null}
              </div>
              <div className="row-actions">
                {version.state === 'Draft' && canBuild(role) ? (
                  <Button className="btn-small" busy={busy === version.id} disabled={busy !== null} onClick={() => void validate(version)}>Validate</Button>
                ) : null}
                {version.state === 'Validated' && canManage(role) ? (
                  <Button className="btn-small" busy={busy === version.id} disabled={busy !== null} onClick={() => void publish(version)}>Publish</Button>
                ) : null}
                {canManage(role) ? (
                  <Button className="btn-small btn-ghost" busy={busy === version.id} disabled={busy !== null} onClick={() => void restore(version)}>Restore</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
