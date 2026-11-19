import { useEffect } from 'react'
import { closeSheet, issuePacket, pollGotenberg, sessionPath } from '../actions'
import { apiGet } from '../api'
import { COPY, packetFailureCopy } from '../copy'
import { canRun, useSelector } from '../state'
import { Button, EmptyState, Sheet } from '../ui/primitives'
import { Skeleton } from './skeleton'
import { useLoad } from './use-load'
import type { CrewPacket, PacketPreview } from '../../../shared/domain'

const GOTENBERG_POLL_MS = 5000
const STREAM_POLL_MS = 3000

export function PacketsSheet() {
  const revision = useSelector(s => s.session?.revision)
  const role = useSelector(s => s.role)
  const streamDown = useSelector(s => s.streamDown)
  const gotenbergDown = useSelector(s => s.gotenbergDown)
  const list = useLoad(() => apiGet<{ packets: CrewPacket[] }>(`${sessionPath()}/packets`), [revision])
  const preview = useLoad(() => apiGet<PacketPreview>(`${sessionPath()}/packets/preview`), [revision])

  useEffect(() => {
    void pollGotenberg()
    const timer = window.setInterval(() => void pollGotenberg(), GOTENBERG_POLL_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!streamDown) return undefined
    const timer = window.setInterval(list.reload, STREAM_POLL_MS)
    return () => window.clearInterval(timer)
  }, [streamDown, list.reload])

  async function issue(): Promise<void> {
    await issuePacket()
    list.reload()
    void pollGotenberg()
  }

  const packets = list.data === null ? null : [...list.data.packets].reverse()
  const content = preview.data?.content

  return (
    <Sheet title="Crew packets" testId="sheet-crew-packets" onClose={closeSheet}>
      {gotenbergDown ? <p className="notice">{COPY.gotenbergDown}</p> : null}
      {canRun(role) ? (
        <div className="sheet-actions">
          <Button onClick={() => void issue()}>Issue packet</Button>
        </div>
      ) : null}
      {packets === null ? <Skeleton /> : packets.length === 0 ? <EmptyState /> : (
        <ul className="rows">
          {packets.map(packet => (
            <li key={packet.id} className="row" data-testid={`packet-row-${packet.id}`}>
              <div className="row-main">
                <div className="row-title-line">
                  <span className="state-word">{packet.state}</span>
                  <span className="row-title">{`Packet for session version ${packet.session_version}`}</span>
                </div>
                {packet.content_hash === '' ? null : <span className="hash">{packet.content_hash.slice(0, 12)}</span>}
                {packet.state === 'Failed' ? <span className="row-meta">{packetFailureCopy(packet.failure)}</span> : null}
              </div>
              {packet.byte_length === null ? null : (
                <div className="row-actions">
                  <a className="btn btn-small" href={`${sessionPath()}/packets/${packet.id}/pdf`}>Download PDF</a>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="preview" data-testid="next-packet-preview">
        <h3>Next packet preview</h3>
        {content === undefined || preview.data === null ? <Skeleton /> : (
          <>
            <p className="row-meta">{`Preview for session version ${preview.data.session_version}`}</p>
            <ul>
              {content.timetable.map(row => <li key={row.entry_id}>{`${row.time} Train ${row.train_number} at ${row.station}`}</li>)}
            </ul>
            {content.train_orders.map(line => <p key={line}>{line}</p>)}
            <ul>
              {content.block_table.map(block => <li key={block.number}>{`Block ${block.number} ${block.name}, ${block.kind}, ${block.length_mm} mm`}</li>)}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  )
}
