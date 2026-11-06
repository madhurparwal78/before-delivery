import { randomUUID } from 'node:crypto';
import {
  Reply,
  RequestContext,
  Route,
  errorReply,
  isUuid,
  json,
  noContent,
  notFound,
  route,
  validationError,
} from '../http/core';
import { withTransaction, Tx } from '../db/pool';
import { commitWithEvents, loadSettings, todayOnHomeClock } from '../domain/commit';
import { LiveEvent } from '../events';
import {
  FIELD_KINDS,
  MESSAGES,
  TITLE_MAX_CHARS,
  TYPE_NAME_MAX_CHARS,
  TypeRecord,
  loadTypes,
  typeJson,
} from '../domain/types';
import {
  ObjectRow,
  backlinksJson,
  blockJson,
  deleteObjectCascade,
  loadObject,
  objectJson,
  writeProperties,
} from '../domain/objects';
import {
  BLOCK_MESSAGES,
  TIMELINE_EXCERPT_CHARS,
  createBlock,
  createQuote,
  deleteBlock,
  editBlockWithOps,
  loadBlock,
  moveBlock,
  opsMessage,
  presenceToCurrent,
  replaceBlockBody,
  resolveTextBlock,
  restoreRevision,
  revisionBody,
  revisionsJson,
  searchTextBlocks,
} from '../domain/blocks';
import { parseOps, Op } from '../../shared/ops';
import { editTextOf, plainTextOf } from '../../shared/richtext';
import { wordDiff } from '../../shared/worddiff';
import { SEARCH_TEXT_MAX_CHARS } from '../../shared/search';
import { isRealDate } from '../../shared/query';
import { isEditId } from '../../shared/rules';
import { dateInZone, todayInZone } from '../../shared/homeclock';
import { publishPresence } from '../events';
import { deleteObjectEventually } from '../storage/s3';
import { deleteShareCacheForObject } from '../domain/share';

function bodyObject(context: RequestContext): Record<string, unknown> {
  if (context.json === null || typeof context.json !== 'object' || Array.isArray(context.json)) {
    return {};
  }
  return context.json as Record<string, unknown>;
}

function optionalId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && isUuid(value) ? value : null;
}

async function requireObject(tx: Tx, id: string): Promise<ObjectRow> {
  if (!isUuid(id)) throw notFound();
  const object = await loadObject(tx, id);
  if (object === null) throw notFound();
  return object;
}

async function typeOf(tx: Tx, object: ObjectRow): Promise<{ types: TypeRecord[]; type: TypeRecord }> {
  const types = await loadTypes(tx);
  const type = types.find((candidate) => candidate.id === object.type_id);
  if (type === undefined) throw notFound();
  return { types, type };
}

type FieldInput = {
  name: unknown;
  kind: unknown;
  required: unknown;
  options: unknown;
  target_type_id: unknown;
};

function checkFieldInput(
  field: FieldInput,
  prefix: string,
  existingNames: string[],
  typeIds: string[],
  errors: Record<string, string>,
): void {
  const name = typeof field.name === 'string' ? field.name.trim() : '';
  if (name === '') errors[`${prefix}name`] = MESSAGES.fieldName;
  else if (existingNames.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
    errors[`${prefix}name`] = MESSAGES.fieldNameDuplicate;
  }
  const kind = typeof field.kind === 'string' ? field.kind : '';
  if (!(FIELD_KINDS as string[]).includes(kind)) errors[`${prefix}kind`] = MESSAGES.fieldKind;
  if (kind === 'select') {
    const options = Array.isArray(field.options)
      ? field.options.filter((option): option is string => typeof option === 'string' && option.trim() !== '')
      : [];
    if (options.length === 0) errors[`${prefix}options`] = MESSAGES.fieldOptions;
  }
  if (kind === 'relation') {
    const target = typeof field.target_type_id === 'string' ? field.target_type_id : '';
    if (!typeIds.includes(target)) errors[`${prefix}target_type_id`] = MESSAGES.fieldTarget;
  }
}

async function insertField(
  tx: Tx,
  typeId: string,
  field: FieldInput,
  position: number,
): Promise<void> {
  const kind = field.kind as string;
  const options =
    kind === 'select' && Array.isArray(field.options)
      ? field.options.filter((option): option is string => typeof option === 'string' && option.trim() !== '')
      : null;
  await tx.query(
    `insert into type_field (id, type_id, name, kind, required, options, target_type_id, position)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      typeId,
      (field.name as string).trim(),
      kind,
      field.required === true,
      options === null ? null : JSON.stringify(options),
      kind === 'relation' ? (field.target_type_id as string) : null,
      position,
    ],
  );
}

export const contentRoutes: Route[] = [
  route('GET', '/api/types', async (): Promise<Reply> => {
    const types = await withTransaction((tx) => loadTypes(tx));
    return json({ types: types.map(typeJson) });
  }),

  route('POST', '/api/types', async (context: RequestContext): Promise<Reply> => {
    const body = bodyObject(context);
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    const fields = Array.isArray(body['fields']) ? (body['fields'] as FieldInput[]) : [];
    const created = await commitWithEvents(async (tx) => {
      const types = await loadTypes(tx);
      const errors: Record<string, string> = {};
      if (name === '' || Array.from(name).length > TYPE_NAME_MAX_CHARS) errors['name'] = MESSAGES.typeName;
      else if (types.some((type) => type.name.toLowerCase() === name.toLowerCase())) {
        errors['name'] = MESSAGES.typeNameTaken;
      }
      const seen: string[] = [];
      fields.forEach((field, index) => {
        checkFieldInput(
          field ?? ({} as FieldInput),
          `fields.${index}.`,
          seen,
          types.map((type) => type.id),
          errors,
        );
        if (typeof field?.name === 'string' && field.name.trim() !== '') seen.push(field.name.trim());
      });
      if (Object.keys(errors).length > 0) throw validationError(errors);
      const rank = await tx.one<{ next: number }>(
        'select coalesce(max(library_rank), -1) + 1 as next from object_type',
      );
      const id = randomUUID();
      await tx.query('insert into object_type (id, name, builtin, library_rank) values ($1, $2, false, $3)', [
        id,
        name,
        rank === null ? 0 : rank.next,
      ]);
      for (let index = 0; index < fields.length; index += 1) {
        await insertField(tx, id, fields[index], index);
      }
      const refreshed = await loadTypes(tx);
      const type = refreshed.find((candidate) => candidate.id === id) as TypeRecord;
      return { result: typeJson(type), events: [] as LiveEvent[] };
    });
    return json(created, 201);
  }),

  route('POST', '/api/types/:id/fields', async (context: RequestContext): Promise<Reply> => {
    const field = bodyObject(context) as FieldInput;
    const typeId = context.params['id'];
    if (!isUuid(typeId)) throw notFound();
    const result = await commitWithEvents(async (tx) => {
      const types = await loadTypes(tx);
      const type = types.find((candidate) => candidate.id === typeId);
      if (type === undefined) throw notFound();
      if (type.name === 'Daily note') throw errorReply(409, 'builtin_type');
      const errors: Record<string, string> = {};
      checkFieldInput(
        field,
        '',
        type.fields.map((existing) => existing.name),
        types.map((candidate) => candidate.id),
        errors,
      );
      if (Object.keys(errors).length > 0) throw validationError(errors);
      await insertField(tx, typeId, field, type.fields.length);
      const refreshed = await loadTypes(tx);
      const updated = refreshed.find((candidate) => candidate.id === typeId) as TypeRecord;
      return { result: typeJson(updated), events: [] as LiveEvent[] };
    });
    return json(result, 201);
  }),

  route('DELETE', '/api/types/:id', async (context: RequestContext): Promise<Reply> => {
    const typeId = context.params['id'];
    if (!isUuid(typeId)) throw notFound();
    await commitWithEvents(async (tx) => {
      const types = await loadTypes(tx);
      const type = types.find((candidate) => candidate.id === typeId);
      if (type === undefined) throw notFound();
      if (type.builtin) throw errorReply(409, 'builtin_type');
      const used = await tx.one<{ count: string }>(
        'select count(*)::text as count from object_note where type_id = $1',
        [typeId],
      );
      if (used !== null && Number(used.count) > 0) throw errorReply(409, 'type_in_use');
      await tx.query('delete from object_type where id = $1', [typeId]);
      return { result: null, events: [] as LiveEvent[] };
    });
    return noContent();
  }),

  route('GET', '/api/objects', async (context: RequestContext): Promise<Reply> => {
    const typeId = context.url.searchParams.get('type_id');
    const objects = await withTransaction(async (tx) => {
      const types = await loadTypes(tx);
      const rows = await tx.query<ObjectRow>(
        `select id, type_id, title, to_char(daily_date, 'YYYY-MM-DD') as daily_date, share_visibility,
                backlinks, created_at, updated_at
           from object_note
          where ($1::uuid is null or type_id = $1::uuid)
          order by lower(title) asc, id asc`,
        [typeId !== null && isUuid(typeId) ? typeId : null],
      );
      const out: Record<string, unknown>[] = [];
      for (const row of rows) out.push(await objectJson(tx, row, types, { withBlocks: false }));
      return out;
    });
    return json({ objects });
  }),

  route('POST', '/api/objects', async (context: RequestContext): Promise<Reply> => {
    const body = bodyObject(context);
    const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
    const typeId = typeof body['type_id'] === 'string' ? body['type_id'] : '';
    const properties =
      body['properties'] !== null && typeof body['properties'] === 'object' && !Array.isArray(body['properties'])
        ? (body['properties'] as Record<string, unknown>)
        : {};
    const created = await commitWithEvents(async (tx) => {
      const types = await loadTypes(tx);
      const type = types.find((candidate) => candidate.id === typeId);
      const errors: Record<string, string> = {};
      if (type === undefined) errors['type_id'] = MESSAGES.fieldTarget;
      else if (type.name === 'Daily note') errors['type_id'] = MESSAGES.dailyType;
      if (title === '' || Array.from(title).length > TITLE_MAX_CHARS) errors['title'] = MESSAGES.title;
      if (Object.keys(errors).length > 0) throw validationError(errors);
      const id = randomUUID();
      const rows = await tx.query<ObjectRow>(
        `insert into object_note (id, type_id, title) values ($1, $2, $3)
         returning id, type_id, title, to_char(daily_date, 'YYYY-MM-DD') as daily_date, share_visibility,
                   backlinks, created_at, updated_at`,
        [id, typeId, title],
      );
      const events: LiveEvent[] = [];
      await writeProperties(tx, rows[0], type as TypeRecord, properties, types, events, { creating: true });
      const fresh = (await loadObject(tx, id)) as ObjectRow;
      events.unshift({ type: 'object.saved', data: { object_id: id } });
      return { result: await objectJson(tx, fresh, types, { withBlocks: true }), events };
    });
    return json(created, 201);
  }),

  route('GET', '/api/objects/:id', async (context: RequestContext): Promise<Reply> => {
    const result = await withTransaction(async (tx) => {
      const object = await requireObject(tx, context.params['id']);
      const types = await loadTypes(tx);
      return objectJson(tx, object, types, { withBlocks: true });
    });
    return json(result);
  }),

  route('PATCH', '/api/objects/:id', async (context: RequestContext): Promise<Reply> => {
    const body = bodyObject(context);
    const outcome = await commitWithEvents(async (tx) => {
      const object = await requireObject(tx, context.params['id']);
      const { types, type } = await typeOf(tx, object);
      const events: LiveEvent[] = [];
      let scopeChanged = false;
      if (typeof body['title'] === 'string') {
        const title = body['title'].trim();
        if (title === '' || Array.from(title).length > TITLE_MAX_CHARS) {
          throw validationError({ title: MESSAGES.title });
        }
        await tx.query('update object_note set title = $2, updated_at = now() where id = $1', [object.id, title]);
      }
      if (body['share_visibility'] !== undefined) {
        const visibility = body['share_visibility'];
        if (visibility !== 'follow' && visibility !== 'never') {
          throw validationError({ share_visibility: MESSAGES.shareVisibility });
        }
        if (visibility !== object.share_visibility) scopeChanged = true;
        await tx.query('update object_note set share_visibility = $2, updated_at = now() where id = $1', [
          object.id,
          visibility,
        ]);
      }
      if (body['properties'] !== undefined) {
        const properties =
          body['properties'] !== null &&
          typeof body['properties'] === 'object' &&
          !Array.isArray(body['properties'])
            ? (body['properties'] as Record<string, unknown>)
            : {};
        await writeProperties(tx, object, type, properties, types, events, { creating: false });
        await tx.query('update object_note set updated_at = now() where id = $1', [object.id]);
      }
      const fresh = (await loadObject(tx, object.id)) as ObjectRow;
      events.unshift({ type: 'object.saved', data: { object_id: object.id } });
      return {
        result: { json: await objectJson(tx, fresh, types, { withBlocks: true }), scopeChanged },
        events,
      };
    });
    if (outcome.scopeChanged) void deleteShareCacheForObject(context.params['id']);
    return json(outcome.json);
  }),

  route('DELETE', '/api/objects/:id', async (context: RequestContext): Promise<Reply> => {
    const outcome = await commitWithEvents(async (tx) => {
      const object = await requireObject(tx, context.params['id']);
      const result = await deleteObjectCascade(tx, object.id);
      return { result, events: result.events };
    });
    for (const key of outcome.attachmentKeys) void deleteObjectEventually(key);
    void deleteShareCacheForObject(context.params['id']);
    return noContent();
  }),

  route('GET', '/api/objects/:id/backlinks', async (context: RequestContext): Promise<Reply> => {
    const result = await withTransaction(async (tx) => {
      const object = await requireObject(tx, context.params['id']);
      return backlinksJson(tx, object.id);
    });
    return json(result);
  }),

  route('POST', '/api/objects/:id/blocks', async (context: RequestContext): Promise<Reply> => {
    const body = bodyObject(context);
    const label = (context.session as { label: string }).label;
    const created = await commitWithEvents(async (tx) => {
      const object = await requireObject(tx, context.params['id']);
      const { block, events } = await createBlock(
        tx,
        object.id,
        typeof body['body'] === 'string' ? body['body'] : '',
        optionalId(body['after_block_id']),
        label,
      );
      return { result: await blockJson(tx, block), events };
    });
    return json(created, 201);
  }),

  route('GET', '/api/blocks/search', async (context: RequestContext): Promise<Reply> => {
    const q = context.url.searchParams.get('q') ?? '';
    if (Array.from(q.trim()).length > SEARCH_TEXT_MAX_CHARS) {
      throw validationError({ q: BLOCK_MESSAGES.searchQuery });
    }
    const exclude = context.url.searchParams.get('exclude_object_id');
    const results = await withTransaction((tx) =>
      searchTextBlocks(tx, q, exclude !== null && isUuid(exclude) ? exclude : null),
    );
    return json({ results });
  }),

  route('PATCH', '/api/blocks/:id', async (context: RequestContext): Promise<Reply> => {
    const body = bodyObject(context);
    const label = (context.session as { label: string }).label;
    const editIdRaw = body['edit_id'];
    if (editIdRaw !== undefined && editIdRaw !== null) {
      if (typeof editIdRaw !== 'string' || !isEditId(editIdRaw)) {
        throw validationError({ edit_id: BLOCK_MESSAGES.editId });
      }
    }
    const editId = typeof editIdRaw === 'string' ? editIdRaw : null;
    const baseVersion = body['base_version'];
    if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1) {
      throw validationError({ base_version: BLOCK_MESSAGES.baseVersion });
    }
    const result = await commitWithEvents(async (tx) => {
      const id = context.params['id'];
      if (!isUuid(id)) throw notFound();
      const found = await loadBlock(tx, id);
      if (found === null) throw notFound();
      if (found.kind === 'attachment') throw errorReply(409, 'not_editable');
      const target = await resolveTextBlock(tx, found);
      if (target === null) throw notFound();
      if (body['ops'] !== undefined) {
        const ops = parseOps(body['ops']);
        if (ops === null) throw validationError({ ops: opsMessage(baseVersion) });
        const outcome = await editBlockWithOps(tx, target, ops as Op[], baseVersion, label, editId);
        return { result: await blockJson(tx, outcome.block), events: outcome.events };
      }
      if (typeof body['body'] !== 'string') throw validationError({ body: BLOCK_MESSAGES.body });
      const outcome = await replaceBlockBody(tx, target, body['body'], baseVersion, label, editId);
      return { result: await blockJson(tx, outcome.block), events: outcome.events };
    });
    return json(result);
  }),

  route('DELETE', '/api/blocks/:id', async (context: RequestContext): Promise<Reply> => {
    const outcome = await commitWithEvents(async (tx) => {
      const id = context.params['id'];
      if (!isUuid(id)) throw notFound();
      const block = await loadBlock(tx, id);
      if (block === null) throw notFound();
      const result = await deleteBlock(tx, block);
      return { result, events: result.events };
    });
    if (outcome.attachmentKey !== null) void deleteObjectEventually(outcome.attachmentKey);
    if (outcome.quoteResult !== null) return json(outcome.quoteResult);
    return noContent();
  }),

  route('POST', '/api/blocks/:id/move', async (context: RequestContext): Promise<Reply> => {
    const body = bodyObject(context);
    const targetId = typeof body['object_id'] === 'string' ? body['object_id'] : '';
    const result = await commitWithEvents(async (tx) => {
      const id = context.params['id'];
      if (!isUuid(id)) throw notFound();
      const block = await loadBlock(tx, id);
      if (block === null) throw notFound();
      if (!isUuid(targetId)) throw validationError({ object_id: BLOCK_MESSAGES.moveMissingObject });
      const outcome = await moveBlock(tx, block, targetId, optionalId(body['after_block_id']));
      return { result: await blockJson(tx, outcome.block), events: outcome.events };
    });
    return json(result);
  }),

  route('POST', '/api/blocks/:id/presence', async (context: RequestContext): Promise<Reply> => {
    const body = bodyObject(context);
    const session = context.session as { id: string; label: string };
    const payload = await withTransaction(async (tx) => {
      const id = context.params['id'];
      if (!isUuid(id)) throw notFound();
      const found = await loadBlock(tx, id);
      if (found === null) throw notFound();
      if (found.kind === 'attachment') throw errorReply(409, 'not_editable');
      const target = await resolveTextBlock(tx, found);
      if (target === null) throw notFound();
      const version = body['version'];
      const anchor = body['anchor'];
      const head = body['head'];
      const kept = await revisionBody(tx, target.id, typeof version === 'number' ? version : -1);
      if (typeof version !== 'number' || kept === null) {
        throw validationError({ head: BLOCK_MESSAGES.presenceOffsets });
      }
      const length = editTextOf(kept).length;
      const valid = (value: unknown): boolean =>
        typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= length;
      const errors: Record<string, string> = {};
      if (!valid(anchor)) errors['anchor'] = BLOCK_MESSAGES.presenceOffsets;
      if (!valid(head)) errors['head'] = BLOCK_MESSAGES.presenceOffsets;
      if (Object.keys(errors).length > 0) throw validationError(errors);
      const moved = await presenceToCurrent(tx, target.id, version, anchor as number, head as number);
      await tx.query(
        `insert into presence (session_id, block_id, anchor, head, version, label, updated_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (session_id, block_id) do update
           set anchor = excluded.anchor, head = excluded.head, version = excluded.version, updated_at = now()`,
        [session.id, target.id, moved.anchor, moved.head, version, session.label],
      );
      return {
        block_id: target.id,
        session_id: session.id,
        label: session.label,
        anchor: moved.anchor,
        head: moved.head,
      };
    });
    publishPresence(payload);
    return noContent();
  }),

  route('DELETE', '/api/blocks/:id/presence', async (context: RequestContext): Promise<Reply> => {
    const session = context.session as { id: string; label: string };
    const id = context.params['id'];
    if (!isUuid(id)) throw notFound();
    const targetId = await withTransaction(async (tx) => {
      const found = await loadBlock(tx, id);
      if (found === null) return null;
      const target = await resolveTextBlock(tx, found);
      if (target === null) return null;
      await tx.query('delete from presence where session_id = $1 and block_id = $2', [session.id, target.id]);
      return target.id;
    });
    if (targetId !== null) {
      publishPresence({
        block_id: targetId,
        session_id: session.id,
        label: session.label,
        anchor: null,
        head: null,
      });
    }
    return noContent();
  }),

  route('GET', '/api/blocks/:id/revisions', async (context: RequestContext): Promise<Reply> => {
    const result = await withTransaction(async (tx) => {
      const id = context.params['id'];
      if (!isUuid(id)) throw notFound();
      const found = await loadBlock(tx, id);
      if (found === null) throw notFound();
      const target = await resolveTextBlock(tx, found);
      if (target === null) throw notFound();
      return revisionsJson(tx, target.id);
    });
    return json({ revisions: result });
  }),

  route('GET', '/api/blocks/:id/diff', async (context: RequestContext): Promise<Reply> => {
    const fromRaw = context.url.searchParams.get('from');
    const toRaw = context.url.searchParams.get('to');
    const result = await withTransaction(async (tx) => {
      const id = context.params['id'];
      if (!isUuid(id)) throw notFound();
      const found = await loadBlock(tx, id);
      if (found === null) throw notFound();
      const target = await resolveTextBlock(tx, found);
      if (target === null) throw notFound();
      const errors: Record<string, string> = {};
      const from = Number(fromRaw);
      const to = Number(toRaw);
      const fromBody =
        fromRaw !== null && Number.isInteger(from) ? await revisionBody(tx, target.id, from) : null;
      const toBody = toRaw !== null && Number.isInteger(to) ? await revisionBody(tx, target.id, to) : null;
      if (fromBody === null) errors['from'] = BLOCK_MESSAGES.versionNotKept;
      if (toBody === null) errors['to'] = BLOCK_MESSAGES.versionNotKept;
      if (Object.keys(errors).length > 0) throw validationError(errors);
      return {
        from,
        to,
        ops: wordDiff(plainTextOf(fromBody as string), plainTextOf(toBody as string)),
      };
    });
    return json(result);
  }),

  route('POST', '/api/blocks/:id/restore', async (context: RequestContext): Promise<Reply> => {
    const body = bodyObject(context);
    const label = (context.session as { label: string }).label;
    const version = body['version'];
    const baseVersion = body['base_version'];
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      throw validationError({ version: BLOCK_MESSAGES.versionNotKept });
    }
    if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion)) {
      throw validationError({ base_version: BLOCK_MESSAGES.baseVersion });
    }
    const result = await commitWithEvents(async (tx) => {
      const id = context.params['id'];
      if (!isUuid(id)) throw notFound();
      const found = await loadBlock(tx, id);
      if (found === null) throw notFound();
      const target = await resolveTextBlock(tx, found);
      if (target === null) throw notFound();
      const outcome = await restoreRevision(tx, target, version, baseVersion, label);
      return { result: await blockJson(tx, outcome.block), events: outcome.events };
    });
    return json(result);
  }),

  route('POST', '/api/objects/:id/quotes', async (context: RequestContext): Promise<Reply> => {
    const body = bodyObject(context);
    const label = (context.session as { label: string }).label;
    const originId = typeof body['origin_block_id'] === 'string' ? body['origin_block_id'] : '';
    const result = await commitWithEvents(async (tx) => {
      const object = await requireObject(tx, context.params['id']);
      if (!isUuid(originId)) throw validationError({ origin_block_id: BLOCK_MESSAGES.originMissing });
      const outcome = await createQuote(tx, object.id, originId, optionalId(body['after_block_id']), label);
      return {
        result: {
          block: await blockJson(tx, outcome.block),
          origin_backlinks: outcome.originBacklinks,
        },
        events: outcome.events,
      };
    });
    return json(result, 201);
  }),

  route('POST', '/api/daily/today', async (): Promise<Reply> => {
    const { date } = await todayOnHomeClock();
    const outcome = await commitWithEvents(async (tx) => {
      const found = await ensureDailyNote(tx, date);
      const types = await loadTypes(tx);
      const object = (await loadObject(tx, found.objectId)) as ObjectRow;
      return {
        result: {
          created: found.created,
          body: { date, object: await objectJson(tx, object, types, { withBlocks: true }) },
        },
        events: found.created
          ? ([{ type: 'object.saved', data: { object_id: found.objectId } }] as LiveEvent[])
          : [],
      };
    });
    return json(outcome.body, outcome.created ? 201 : 200);
  }),

  route('POST', '/api/daily/today/blocks', async (context: RequestContext): Promise<Reply> => {
    const body = bodyObject(context);
    const label = (context.session as { label: string }).label;
    const { date } = await todayOnHomeClock();
    const result = await commitWithEvents(async (tx) => {
      const found = await ensureDailyNote(tx, date);
      const events: LiveEvent[] = found.created
        ? [{ type: 'object.saved', data: { object_id: found.objectId } }]
        : [];
      const afterId = optionalId(body['after_block_id']);
      const inNote =
        afterId === null
          ? null
          : await tx.one<{ id: string }>('select id from block where id = $1 and object_id = $2', [
              afterId,
              found.objectId,
            ]);
      const { block, events: blockEvents } = await createBlock(
        tx,
        found.objectId,
        typeof body['body'] === 'string' ? body['body'] : '',
        inNote === null ? null : afterId,
        label,
      );
      return {
        result: { date, object_id: found.objectId, block: await blockJson(tx, block) },
        events: [...events, ...blockEvents],
      };
    });
    return json(result, 201);
  }),

  route('GET', '/api/daily', async (context: RequestContext): Promise<Reply> => {
    const date = context.url.searchParams.get('date') ?? '';
    if (!isRealDate(date)) throw validationError({ date: 'Use YYYY-MM-DD.' });
    const result = await withTransaction(async (tx) => {
      const row = await tx.one<ObjectRow>(
        `select id, type_id, title, to_char(daily_date, 'YYYY-MM-DD') as daily_date, share_visibility,
                backlinks, created_at, updated_at
           from object_note where daily_date = $1::date`,
        [date],
      );
      if (row === null) throw notFound();
      const types = await loadTypes(tx);
      return objectJson(tx, row, types, { withBlocks: true });
    });
    return json(result);
  }),

  route('GET', '/api/daily/recent', async (): Promise<Reply> => {
    const notes = await withTransaction(async (tx) =>
      tx.query<{ date: string; object_id: string }>(
        `select to_char(daily_date, 'YYYY-MM-DD') as date, id as object_id
           from object_note where daily_date is not null order by daily_date desc limit 7`,
      ),
    );
    return json({ notes });
  }),

  route('GET', '/api/timeline', async (): Promise<Reply> => {
    const settings = await loadSettings();
    const today = todayInZone(settings.homeTimeZone);
    const result = await withTransaction(async (tx) => {
      const notes = await tx.query<{ date: string; object_id: string }>(
        `select to_char(daily_date, 'YYYY-MM-DD') as date, id as object_id
           from object_note where daily_date is not null order by daily_date asc`,
      );
      const earliest = notes.length === 0 ? today : notes[0].date;
      const days: Record<string, unknown>[] = [];
      let cursor = earliest <= today ? earliest : today;
      for (let guard = 0; guard < 4000; guard += 1) {
        const note = notes.find((candidate) => candidate.date === cursor);
        const blocks: Record<string, unknown>[] = [];
        let blockCount = 0;
        if (note !== undefined) {
          const rows = await tx.query<{
            id: string;
            kind: string;
            body: string | null;
            origin_block_id: string | null;
            attachment_id: string | null;
          }>(
            `select id, kind, body, origin_block_id, attachment_id from block where object_id = $1 order by position asc`,
            [note.object_id],
          );
          blockCount = rows.length;
          for (const row of rows) {
            let text = plainTextOf(row.body ?? '');
            if (row.kind === 'quote' && row.origin_block_id !== null) {
              const origin = await tx.one<{ body: string | null }>('select body from block where id = $1', [
                row.origin_block_id,
              ]);
              text = plainTextOf(origin?.body ?? '');
            }
            if (row.kind === 'attachment' && row.attachment_id !== null) {
              const attachment = await tx.one<{ filename: string }>(
                'select filename from attachment where id = $1',
                [row.attachment_id],
              );
              text = attachment === null ? '' : attachment.filename;
            }
            blocks.push({
              id: row.id,
              kind: row.kind,
              excerpt: text.length <= TIMELINE_EXCERPT_CHARS ? text : text.slice(0, TIMELINE_EXCERPT_CHARS),
              movable: row.kind !== 'attachment',
            });
          }
        }
        days.push({
          date: cursor,
          object_id: note === undefined ? null : note.object_id,
          block_count: blockCount,
          blocks,
        });
        if (cursor === today) break;
        cursor = dateInZone(new Date(Date.parse(`${cursor}T12:00:00Z`) + 86_400_000), 'UTC');
      }
      return { today, days };
    });
    return json(result);
  }),
];

export async function ensureDailyNote(
  tx: Tx,
  date: string,
): Promise<{ objectId: string; created: boolean }> {
  const existing = await tx.one<{ id: string }>('select id from object_note where daily_date = $1::date', [date]);
  if (existing !== null) return { objectId: existing.id, created: false };
  const types = await loadTypes(tx);
  const dailyType = types.find((type) => type.name === 'Daily note');
  if (dailyType === undefined) throw notFound();
  const id = randomUUID();
  await tx.query(
    'insert into object_note (id, type_id, title, daily_date) values ($1, $2, $3, $4::date)',
    [id, dailyType.id, date, date],
  );
  return { objectId: id, created: true };
}
