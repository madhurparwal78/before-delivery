import type pg from 'pg';
import type { SessionRecord } from '../domain/session.js';
import { commitSession } from './sessionStore.js';

const COLUMNS = `id, workspace_id, layout_id, name, status, hold_reason, ratio,
  revision::int as revision, control_revision::int as control_revision,
  session_version, tick::int as tick, layout_version_id, layout_version_number,
  timetable_version, state`;

/** A rename reaches every non-Ended session of the layout, in the same commit. */
export async function propagateRename(
  client: pg.PoolClient,
  layoutId: string,
  kind: 'block' | 'station',
  objectId: string,
  name: string,
): Promise<void> {
  const { rows } = await client.query<SessionRecord>(
    `select ${COLUMNS} from sessions where layout_id = $1 and status <> 'Ended' for update`,
    [layoutId],
  );

  for (const record of rows) {
    const list =
      kind === 'block' ? record.state.content.blocks : record.state.content.stations;
    const target = list.find((entry) => entry.id === objectId);
    if (!target) continue;
    target.name = name;
    await commitSession(client, record, 'name.changed', {
      kind,
      object_id: objectId,
      name,
    });
    await supersedeReadyPackets(client, record);
  }
}

export async function supersedeReadyPackets(
  client: pg.PoolClient,
  record: SessionRecord,
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `update crew_packets set state = 'Superseded' where session_id = $1 and state = 'Ready'
     returning id`,
    [record.id],
  );
  for (const row of rows) {
    await commitSession(client, record, 'packet.changed', {
      packet_id: row.id,
      state: 'Superseded',
    });
  }
}
