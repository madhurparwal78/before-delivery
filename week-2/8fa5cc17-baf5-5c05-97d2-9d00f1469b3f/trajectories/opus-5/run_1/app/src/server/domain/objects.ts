import { Tx } from '../db/pool';
import { LiveEvent } from '../events';
import { TypeRecord, FieldRecord, checkPropertyValue, MESSAGES } from './types';
import { validationError } from '../http/core';

export type ObjectRow = {
  id: string;
  type_id: string;
  title: string;
  daily_date: string | null;
  share_visibility: string;
  backlinks: number;
  created_at: Date;
  updated_at: Date;
};

export type BlockRow = {
  id: string;
  object_id: string;
  kind: string;
  position: number;
  body: string | null;
  version: number;
  origin_block_id: string | null;
  attachment_id: string | null;
};

export const OBJECT_COLUMNS =
  'id, type_id, title, to_char(daily_date, \'YYYY-MM-DD\') as daily_date, share_visibility, backlinks, created_at, updated_at';
export const BLOCK_COLUMNS = 'id, object_id, kind, position, body, version, origin_block_id, attachment_id';

export async function loadObject(tx: Tx, id: string): Promise<ObjectRow | null> {
  return tx.one<ObjectRow>(`select ${OBJECT_COLUMNS} from object_note where id = $1`, [id]);
}

export async function touchObject(tx: Tx, id: string): Promise<void> {
  await tx.query('update object_note set updated_at = now() where id = $1', [id]);
}

export async function collectionIdsOf(tx: Tx, objectId: string): Promise<string[]> {
  const rows = await tx.query<{ collection_id: string }>(
    'select collection_id from collection_member where object_id = $1 order by collection_id',
    [objectId],
  );
  return rows.map((row) => row.collection_id);
}

export type AttachmentRow = {
  id: string;
  object_id: string;
  filename: string;
  content_type: string;
  size_bytes: string;
  storage_key: string;
};

export async function blockJsonList(tx: Tx, objectId: string): Promise<Record<string, unknown>[]> {
  const blocks = await tx.query<BlockRow>(
    `select ${BLOCK_COLUMNS} from block where object_id = $1 order by position asc`,
    [objectId],
  );
  const out: Record<string, unknown>[] = [];
  for (const block of blocks) out.push(await blockJson(tx, block));
  return out;
}

export async function blockJson(tx: Tx, block: BlockRow): Promise<Record<string, unknown>> {
  let body = block.body;
  let version = block.version;
  let origin: Record<string, unknown> | null = null;
  if (block.kind === 'quote' && block.origin_block_id !== null) {
    const originBlock = await tx.one<BlockRow & { object_title: string; object_backlinks: number }>(
      `select b.id, b.object_id, b.kind, b.position, b.body, b.version, b.origin_block_id, b.attachment_id,
              o.title as object_title, o.backlinks as object_backlinks
         from block b join object_note o on o.id = b.object_id where b.id = $1`,
      [block.origin_block_id],
    );
    if (originBlock !== null) {
      body = originBlock.body;
      version = originBlock.version;
      origin = {
        block_id: originBlock.id,
        object_id: originBlock.object_id,
        object_title: originBlock.object_title,
        backlinks: originBlock.object_backlinks,
      };
    }
  }
  let attachment: Record<string, unknown> | null = null;
  if (block.attachment_id !== null) {
    const row = await tx.one<AttachmentRow>(
      'select id, object_id, filename, content_type, size_bytes::text as size_bytes, storage_key from attachment where id = $1',
      [block.attachment_id],
    );
    if (row !== null) {
      attachment = {
        id: row.id,
        filename: row.filename,
        content_type: row.content_type,
        size_bytes: Number(row.size_bytes),
      };
    }
  }
  return {
    id: block.id,
    object_id: block.object_id,
    kind: block.kind,
    position: block.position,
    body: block.kind === 'attachment' ? null : body,
    version,
    origin,
    attachment,
  };
}

export async function propertiesJson(
  tx: Tx,
  objectId: string,
  type: TypeRecord,
): Promise<Record<string, unknown>> {
  const rows = await tx.query<{ field_id: string; value: unknown }>(
    'select field_id, value from property_value where object_id = $1',
    [objectId],
  );
  const out: Record<string, unknown> = {};
  for (const field of type.fields) {
    const hit = rows.find((row) => row.field_id === field.id);
    out[field.name] = hit === undefined || hit.value === null ? null : hit.value;
  }
  return out;
}

export async function objectJson(
  tx: Tx,
  object: ObjectRow,
  types: TypeRecord[],
  options: { withBlocks: boolean },
): Promise<Record<string, unknown>> {
  const type = types.find((candidate) => candidate.id === object.type_id);
  const json: Record<string, unknown> = {
    id: object.id,
    type_id: object.type_id,
    type_name: type === undefined ? '' : type.name,
    title: object.title,
    daily_date: object.daily_date,
    properties: type === undefined ? {} : await propertiesJson(tx, object.id, type),
    share_visibility: object.share_visibility,
    collection_ids: await collectionIdsOf(tx, object.id),
    backlinks: object.backlinks,
    created_at: object.created_at.toISOString(),
    updated_at: object.updated_at.toISOString(),
  };
  if (options.withBlocks) json['blocks'] = await blockJsonList(tx, object.id);
  return json;
}

export async function adjustBacklinks(tx: Tx, objectId: string, delta: number): Promise<number> {
  const rows = await tx.query<{ backlinks: number }>(
    'update object_note set backlinks = backlinks + $2 where id = $1 returning backlinks',
    [objectId, delta],
  );
  return rows.length === 0 ? 0 : rows[0].backlinks;
}

export async function backlinkCount(tx: Tx, objectId: string): Promise<number> {
  const row = await tx.one<{ backlinks: number }>('select backlinks from object_note where id = $1', [objectId]);
  return row === null ? 0 : row.backlinks;
}

export async function backlinksJson(tx: Tx, objectId: string): Promise<Record<string, unknown>> {
  const rows = await tx.query<{
    edge_id: string;
    from_object_id: string;
    from_title: string;
    kind: string;
    field_name: string | null;
    block_id: string | null;
  }>(
    `select e.id as edge_id, e.from_object_id, o.title as from_title, e.kind,
            f.name as field_name, e.block_id
       from link_edge e
       join object_note o on o.id = e.from_object_id
       left join type_field f on f.id = e.field_id
      where e.to_object_id = $1
      order by e.created_at desc, e.id desc`,
    [objectId],
  );
  const count = await backlinkCount(tx, objectId);
  return { count, backlinks: rows };
}

/** Write relation link edges for one property change, keeping counts in the same transaction. */
async function syncRelationEdge(
  tx: Tx,
  objectId: string,
  field: FieldRecord,
  value: string | null,
  events: LiveEvent[],
): Promise<void> {
  const existing = await tx.query<{ id: string; to_object_id: string }>(
    `select id, to_object_id from link_edge where from_object_id = $1 and field_id = $2 and kind = 'relation'`,
    [objectId, field.id],
  );
  const current = existing.length === 0 ? null : existing[0];
  if (current !== null && current.to_object_id === value) return;
  if (current !== null) {
    await tx.query('delete from link_edge where id = $1', [current.id]);
    const count = await adjustBacklinks(tx, current.to_object_id, -1);
    events.push({ type: 'backlinks.changed', data: { object_id: current.to_object_id, backlinks: count } });
  }
  if (value !== null) {
    await tx.query(
      `insert into link_edge (id, from_object_id, to_object_id, kind, field_id)
       values (gen_random_uuid(), $1, $2, 'relation', $3)`,
      [objectId, value, field.id],
    );
    const count = await adjustBacklinks(tx, value, 1);
    events.push({ type: 'backlinks.changed', data: { object_id: value, backlinks: count } });
  }
}

export async function writeProperties(
  tx: Tx,
  object: ObjectRow,
  type: TypeRecord,
  incoming: Record<string, unknown>,
  types: TypeRecord[],
  events: LiveEvent[],
  options: { creating: boolean },
): Promise<void> {
  const errors: Record<string, string> = {};
  const accepted: { field: FieldRecord; value: unknown }[] = [];
  for (const [name, raw] of Object.entries(incoming)) {
    const field = type.fields.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (field === undefined) {
      errors[`properties.${name}`] = MESSAGES.unknownField;
      continue;
    }
    const targetType =
      field.targetTypeId === null ? null : types.find((candidate) => candidate.id === field.targetTypeId) ?? null;
    const targetIds =
      field.kind === 'relation' && targetType !== null
        ? (
            await tx.query<{ id: string }>('select id from object_note where type_id = $1', [targetType.id])
          ).map((row) => row.id)
        : [];
    const check = checkPropertyValue(field, raw, {
      objectId: object.id,
      targetTypeName: targetType === null ? null : targetType.name,
      targetExists: (id) => targetIds.includes(id),
    });
    if (!check.ok) {
      errors[`properties.${field.name}`] = check.message;
      continue;
    }
    accepted.push({ field, value: check.value });
  }
  if (options.creating) {
    for (const field of type.fields) {
      if (!field.required) continue;
      const given = accepted.find((entry) => entry.field.id === field.id);
      if (given === undefined || given.value === null) {
        errors[`properties.${field.name}`] = MESSAGES.requiredField;
      }
    }
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);

  for (const entry of accepted) {
    if (entry.value === null) {
      await tx.query('delete from property_value where object_id = $1 and field_id = $2', [
        object.id,
        entry.field.id,
      ]);
    } else {
      await tx.query(
        `insert into property_value (object_id, field_id, value) values ($1, $2, $3)
         on conflict (object_id, field_id) do update set value = excluded.value`,
        [object.id, entry.field.id, JSON.stringify(entry.value)],
      );
    }
    if (entry.field.kind === 'relation') {
      await syncRelationEdge(
        tx,
        object.id,
        entry.field,
        typeof entry.value === 'string' ? entry.value : null,
        events,
      );
    }
  }
}

/** Delete an object and everything that depends on it, all in one transaction. */
export async function deleteObjectCascade(
  tx: Tx,
  objectId: string,
): Promise<{ events: LiveEvent[]; attachmentKeys: string[]; quoteHosts: string[] }> {
  const events: LiveEvent[] = [];
  const attachments = await tx.query<{ storage_key: string }>(
    'select storage_key from attachment where object_id = $1',
    [objectId],
  );
  const blocks = await tx.query<{ id: string }>('select id from block where object_id = $1', [objectId]);
  const blockIds = blocks.map((row) => row.id);
  const quoteHosts: string[] = [];
  if (blockIds.length > 0) {
    const quotes = await tx.query<{ id: string; object_id: string }>(
      'select id, object_id from block where kind = $1 and origin_block_id = any($2::uuid[])',
      ['quote', blockIds],
    );
    for (const quote of quotes) {
      await tx.query('delete from link_edge where block_id = $1', [quote.id]);
      await tx.query('delete from block where id = $1', [quote.id]);
      events.push({ type: 'block.removed', data: { object_id: quote.object_id, block_id: quote.id } });
      quoteHosts.push(quote.object_id);
    }
  }
  const incomingRelations = await tx.query<{ from_object_id: string; field_id: string }>(
    `select from_object_id, field_id from link_edge where to_object_id = $1 and kind = 'relation'`,
    [objectId],
  );
  for (const relation of incomingRelations) {
    await tx.query('delete from property_value where object_id = $1 and field_id = $2', [
      relation.from_object_id,
      relation.field_id,
    ]);
    events.push({ type: 'object.saved', data: { object_id: relation.from_object_id } });
  }
  const outgoing = await tx.query<{ to_object_id: string }>(
    'select to_object_id from link_edge where from_object_id = $1',
    [objectId],
  );
  await tx.query('delete from link_edge where from_object_id = $1 or to_object_id = $1', [objectId]);
  for (const edge of outgoing) {
    if (edge.to_object_id === objectId) continue;
    const count = await adjustBacklinks(tx, edge.to_object_id, -1);
    events.push({ type: 'backlinks.changed', data: { object_id: edge.to_object_id, backlinks: count } });
  }
  await tx.query('delete from board_position where object_id = $1', [objectId]);
  await tx.query('delete from object_note where id = $1', [objectId]);
  events.push({ type: 'object.removed', data: { object_id: objectId } });
  for (const host of new Set(quoteHosts)) {
    events.push({ type: 'object.saved', data: { object_id: host } });
  }
  return { events, attachmentKeys: attachments.map((row) => row.storage_key), quoteHosts };
}

export async function renumberBlocks(tx: Tx, objectId: string): Promise<void> {
  await tx.query(
    `with ordered as (
       select id, row_number() over (order by position asc, created_at asc) as rank
         from block where object_id = $1
     )
     update block set position = ordered.rank from ordered where block.id = ordered.id`,
    [objectId],
  );
}
