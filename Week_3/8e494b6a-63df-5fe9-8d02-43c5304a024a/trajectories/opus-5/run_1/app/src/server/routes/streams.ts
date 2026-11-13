import { createHash } from 'node:crypto';
import { nowMs } from '../clock.js';
import { patternMatches } from '../auth.js';
import { one, query, transaction } from '../db.js';
import { fail } from '../errors.js';
import { route, type Ctx, type ResolvedResource } from '../http.js';
import { currentSeq, publish } from '../live.js';
import { isStorageDown, putObject, uploadKey } from '../storage.js';
import {
  countFailures,
  countStreamEvents,
  eventByIdAnywhere,
  generationsOf,
  indexEventFields,
  listStreams,
  loadRange,
  mappingRows,
  spaceTotals,
  streamByName,
  writeGenerationOf,
  type StreamRow,
} from '../store.js';
import { serializeGeneration } from '../domain/lifecycle.js';
import { flattenEvent, inferType, valueFits, typeOfValue, type FieldType } from '../domain/mapping.js';
import { fileKindAccepted, ingestLines, lastNameOf, readMultipart, type PipelineChoice } from '../ingest.js';
import type { Processor } from '../domain/pipeline.js';

const STREAM_NAME = /^[a-z0-9-]{1,40}$/;
const FIELD_TYPES: FieldType[] = ['number', 'date', 'boolean', 'text', 'keyword'];

/** The route's stream, resolved in the one ordering point before any role check. */
export function streamOf(ctx: Ctx): StreamRow {
  return ctx.resource?.value as StreamRow;
}

export async function streamFromParam(
  space: { id: number },
  params: Record<string, string>,
): Promise<ResolvedResource | null> {
  const stream = await streamByName(space.id, params.stream);
  return stream === null ? null : { streamName: stream.name, value: stream };
}

export async function streamFromQuery(
  space: { id: number },
  _params: Record<string, string>,
  url: URL,
): Promise<ResolvedResource | null> {
  const stream = await streamByName(space.id, url.searchParams.get('stream') ?? '');
  return stream === null ? null : { streamName: stream.name, value: stream };
}

export async function pipelineChoice(
  spaceId: number,
  name: string | null,
): Promise<PipelineChoice> {
  if (!name || name === '' || name === 'None') return null;
  const row = await one(`select name, version, processors from pipelines where space_id = $1 and name = $2`, [
    spaceId,
    name,
  ]);
  if (!row) throw fail.unknownPipeline(name);
  return {
    name: String(row.name),
    version: Number(row.version),
    processors: row.processors as Processor[],
  };
}

export function registerStreamRoutes(): void {
  route({
    method: 'GET',
    path: '/api/streams',
    auth: 'any',
    space: true,
    role: 'viewer',
    keyAction: 'read',
    body: 'none',
    handler: async (ctx) => {
      const streams = await listStreams(ctx.space.id);
      const visible =
        ctx.caller.kind === 'key'
          ? streams.filter((stream) => patternMatches(ctx.caller.kind === 'key' ? ctx.caller.pattern : '*', stream.name))
          : streams;
      const body = [];
      for (const stream of visible) {
        body.push({
          name: stream.name,
          write_generation: stream.writeGeneration,
          events: await countStreamEvents(stream.id),
          failures: await countFailures(stream.id),
        });
      }
      return { status: 200, body: { streams: body } };
    },
  });

  route({
    method: 'POST',
    path: '/api/streams',
    auth: 'any',
    space: true,
    role: 'admin',
    keyAction: 'manage',
    body: 'json',
    handler: async (ctx) => {
      const name = String(ctx.body.name ?? '');
      if (!STREAM_NAME.test(name)) {
        throw fail.invalid({ name: 'Use 1 to 40 characters: a-z, 0-9 or -.' });
      }
      if (
        ctx.caller.kind === 'key' &&
        (!patternMatches(ctx.caller.pattern, name) || !ctx.caller.actions.includes('manage'))
      ) {
        throw fail.keyScope('manage', name);
      }
      const taken = await streamByName(ctx.space.id, name);
      if (taken) throw fail.nameTaken({ name: 'That name is already used.' });
      const created = await one<{ id: number }>(
        `insert into streams (space_id, name) values ($1, $2) returning id`,
        [ctx.space.id, name],
      );
      await query(
        `insert into generations (stream_id, number, phase, created_ms, became_write_ms)
         values ($1, 1, 'hot', $2, $2)`,
        [Number(created?.id), nowMs()],
      );
      return {
        status: 201,
        body: { name, write_generation: 1, seq: await currentSeq(ctx.space.id) },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/streams/:stream',
    auth: 'any',
    resource: streamFromParam,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    body: 'none',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const generations = await generationsOf(stream.id);
      return {
        status: 200,
        body: {
          name: stream.name,
          mapping: await mappingRows(stream.id),
          generations: generations.map((generation) =>
            serializeGeneration(stream, generation, ctx.zone),
          ),
        },
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/streams/:stream/mappings',
    auth: 'any',
    resource: streamFromParam,
    space: true,
    role: 'admin',
    keyAction: 'manage',
    body: 'json',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const field = String(ctx.body.field ?? '');
      const type = String(ctx.body.type ?? '') as FieldType;
      const generation = await writeGenerationOf(stream);
      const existing = await one(`select 1 from mappings where generation_id = $1 and field = $2`, [
        generation.id,
        field,
      ]);
      if (existing) throw fail.mappingExists(field, generation.number);
      const fields: Record<string, string> = {};
      if (field === '') fields.field = 'Enter a field name.';
      if (!FIELD_TYPES.includes(type)) fields.type = 'Choose a field type.';
      if (Object.keys(fields).length > 0) throw fail.invalid(fields);
      await query(
        `insert into mappings (generation_id, field, type, explicit) values ($1, $2, $3, true)`,
        [generation.id, field, type],
      );
      return {
        status: 201,
        body: {
          field,
          type,
          generation: generation.number,
          seq: await currentSeq(ctx.space.id),
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/streams/:stream/generations',
    auth: 'any',
    resource: streamFromParam,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    body: 'none',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const generations = await generationsOf(stream.id);
      return {
        status: 200,
        body: {
          generations: generations.map((generation) => serializeGeneration(stream, generation, ctx.zone)),
        },
      };
    },
  });

  route({
    method: 'PUT',
    path: '/api/streams/:stream/lifecycle',
    auth: 'any',
    resource: streamFromParam,
    space: true,
    role: 'admin',
    keyAction: 'manage',
    body: 'json',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const names = [
        'rollover_max_age_ms',
        'rollover_max_events',
        'warm_after_ms',
        'archive_after_ms',
        'delete_after_ms',
      ] as const;
      const fields: Record<string, string> = {};
      const values: (number | null)[] = [];
      for (const name of names) {
        const raw = ctx.body[name];
        if (raw === null || raw === undefined || raw === '') {
          values.push(null);
          continue;
        }
        const numeric = Number(raw);
        if (!Number.isInteger(numeric) || numeric < 0) {
          fields[name] = 'Enter a whole number of milliseconds, or leave it empty.';
          values.push(null);
          continue;
        }
        values.push(numeric);
      }
      if (Object.keys(fields).length > 0) throw fail.invalid(fields);
      await query(
        `update streams set rollover_max_age_ms = $2, rollover_max_events = $3,
           warm_after_ms = $4, archive_after_ms = $5, delete_after_ms = $6 where id = $1`,
        [stream.id, ...values],
      );
      return {
        status: 200,
        body: {
          policy: {
            rollover_max_age_ms: values[0],
            rollover_max_events: values[1],
            warm_after_ms: values[2],
            archive_after_ms: values[3],
            delete_after_ms: values[4],
          },
          message: 'Policy saved. It applies from the next step, and no generation moves backward.',
          seq: await currentSeq(ctx.space.id),
        },
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/streams/:stream/bulk',
    auth: 'any',
    resource: streamFromParam,
    space: true,
    role: 'editor',
    keyAction: 'upload',
    rate: 'upload',
    body: 'ndjson',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const pipeline = await pipelineChoice(ctx.space.id, ctx.url.searchParams.get('pipeline'));
      const outcome = await ingestLines({
        spaceId: ctx.space.id,
        spaceSlug: ctx.space.slug,
        stream,
        text: ctx.rawBody.toString('utf8'),
        pipeline,
      });
      return {
        status: 200,
        body: {
          created: outcome.created,
          duplicates: outcome.duplicates,
          dropped: outcome.dropped,
          failed: outcome.failed,
          lines: outcome.lines,
          seq: await currentSeq(ctx.space.id),
        },
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/streams/:stream/uploads',
    auth: 'any',
    resource: streamFromParam,
    space: true,
    role: 'editor',
    keyAction: 'upload',
    rate: 'upload',
    body: 'upload',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const parts = readMultipart(ctx.rawBody, String(ctx.req.headers['content-type'] ?? ''));
      const filePart = parts.find((part) => part.name === 'file');
      const pipelinePart = parts.find((part) => part.name === 'pipeline');
      if (!filePart || filePart.filename === undefined) throw fail.uploadKind();
      const filename = lastNameOf(filePart.filename);
      if (!fileKindAccepted(filename, filePart.value)) throw fail.uploadKind();
      const pipeline = await pipelineChoice(
        ctx.space.id,
        pipelinePart ? pipelinePart.value.toString('utf8') : null,
      );
      const sha256 = createHash('sha256').update(filePart.value).digest('hex');
      try {
        await putObject(uploadKey(ctx.space.slug, sha256), filePart.value);
      } catch (cause) {
        if (isStorageDown(cause)) throw fail.storageUnavailable();
        throw cause;
      }
      const text = filePart.value.toString('utf8');
      const totalLines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
      const upload = await one<{ id: number }>(
        `insert into uploads (space_id, stream_id, file, bytes, sha256, status, total_lines, at_ms)
         values ($1, $2, $3, $4, $5, 'kept', $6, $7) returning id`,
        [ctx.space.id, stream.id, filename, filePart.value.length, sha256, totalLines, nowMs()],
      );
      const uploadId = Number(upload?.id);
      const totals = await spaceTotals(ctx.space.id);
      await publish(ctx.space.id, 'upload', {
        upload: uploadId,
        status: 'kept',
        file: filename,
        done_lines: 0,
        total_lines: totalLines,
        created: 0,
        duplicates: 0,
        dropped: 0,
        failed: 0,
        ended: false,
        stored_total: totals.stored,
        failure_total: totals.failed,
      });
      void (async () => {
        await query(`update uploads set status = 'parsing' where id = $1`, [uploadId]);
        await publish(ctx.space.id, 'upload', {
          upload: uploadId,
          status: 'parsing',
          file: filename,
          done_lines: 0,
          total_lines: totalLines,
          created: 0,
          duplicates: 0,
          dropped: 0,
          failed: 0,
          ended: false,
          stored_total: totals.stored,
          failure_total: totals.failed,
        });
        await ingestLines({
          spaceId: ctx.space.id,
          spaceSlug: ctx.space.slug,
          stream,
          text,
          pipeline,
          uploadId,
        });
      })().catch((cause: unknown) => {
        process.stderr.write(`upload parse failed: ${String(cause)}\n`);
      });
      return {
        status: 202,
        body: {
          id: uploadId,
          file: filename,
          bytes: filePart.value.length,
          sha256,
          status: 'kept',
          seq: await currentSeq(ctx.space.id),
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/streams/:stream/uploads',
    auth: 'any',
    resource: streamFromParam,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    body: 'none',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const rows = await query(
        `select * from uploads where stream_id = $1 order by id desc`,
        [stream.id],
      );
      return {
        status: 200,
        body: {
          uploads: rows.map((row) => ({
            id: Number(row.id),
            file: String(row.file),
            bytes: Number(row.bytes),
            sha256: String(row.sha256),
            status: String(row.status),
            done_lines: Number(row.done_lines),
            total_lines: Number(row.total_lines),
            created: Number(row.created),
            duplicates: Number(row.duplicates),
            dropped: Number(row.dropped),
            failed: Number(row.failed),
          })),
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/streams/:stream/failures',
    auth: 'any',
    resource: streamFromParam,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    body: 'none',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const rows = await query(
        `select id, reason, raw, at_ms from failures where stream_id = $1 order by at_ms desc, id desc`,
        [stream.id],
      );
      return {
        status: 200,
        body: {
          failures: rows.map((row) => ({
            id: Number(row.id),
            reason: String(row.reason),
            raw: String(row.raw),
            at: new Date(Number(row.at_ms)).toISOString(),
          })),
        },
      };
    },
  });

  route({
    method: 'PATCH',
    path: '/api/streams/:stream/events/:id',
    auth: 'session',
    resource: streamFromParam,
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const found = await eventByIdAnywhere(stream, ctx.params.id);
      if (!found) throw fail.notFound();
      const generations = await generationsOf(stream.id);
      const generation = generations.find((item) => item.number === found.event.generation);
      if (!generation) throw fail.notFound();
      if (generation.phase !== 'hot') {
        throw fail.generationReadOnly(generation.number, generation.phase);
      }
      const patch = ctx.body.fields;
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw fail.invalid({ fields: 'Send an object of fields.' });
      }
      const raw = { ...found.event.raw, ...(patch as Record<string, unknown>) };
      const fields = flattenEvent(raw);
      const mapped = await query(`select field, type from mappings where generation_id = $1`, [
        generation.id,
      ]);
      const types = new Map<string, FieldType>(
        mapped.map((row) => [String(row.field), String(row.type) as FieldType]),
      );
      const invalid: Record<string, string> = {};
      const additions: [string, FieldType][] = [];
      for (const [field, value] of Object.entries(fields)) {
        const known = types.get(field);
        if (known === undefined) {
          const guessed = inferType(value);
          types.set(field, guessed);
          additions.push([field, guessed]);
          continue;
        }
        if (!valueFits(value, known)) {
          invalid[`fields.${field}`] = `Field ${field} expects ${known}, got ${typeOfValue(value)}.`;
        }
      }
      if (Object.keys(invalid).length > 0) throw fail.invalid(invalid);
      const timestamp = Date.parse(String(raw['@timestamp']));
      await transaction(async (client) => {
        await client.query(
          `update events set fields = $2, raw = $3, ts_ms = $4 where stream_id = $5 and event_id = $1`,
          [ctx.params.id, JSON.stringify(fields), JSON.stringify(raw), timestamp, stream.id],
        );
        for (const [field, type] of additions) {
          await client.query(
            `insert into mappings (generation_id, field, type, explicit) values ($1, $2, $3, false)
             on conflict (generation_id, field) do nothing`,
            [generation.id, field, type],
          );
        }
        await indexEventFields(client, {
          eventRow: found.event.row,
          streamId: stream.id,
          generationId: generation.id,
          fields,
          types,
        });
      });
      return {
        status: 200,
        body: {
          _id: ctx.params.id,
          '@timestamp': new Date(timestamp).toISOString(),
          _generation: generation.number,
          _phase: generation.phase,
          _pipeline: found.event.pipeline,
          _score: null,
          fields,
          highlights: {},
          seq: await currentSeq(ctx.space.id),
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/streams/:stream/events/:id/surrounding',
    auth: 'any',
    resource: streamFromParam,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    body: 'none',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const generations = await generationsOf(stream.id);
      const load = await loadRange(stream, 0, 8640000000000000, generations);
      const ordered = load.events.sort((left, right) => {
        if (left.tsMs !== right.tsMs) return left.tsMs - right.tsMs;
        return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
      });
      const index = ordered.findIndex((event) => event.eventId === ctx.params.id);
      if (index < 0) throw fail.notFound();
      const serialize = (event: (typeof ordered)[number]): Record<string, unknown> => ({
        _id: event.eventId,
        '@timestamp': new Date(event.tsMs).toISOString(),
        _generation: event.generation,
        _phase: event.phase,
        _pipeline: event.pipeline,
        _score: null,
        fields: event.fields,
        highlights: {},
      });
      return {
        status: 200,
        body: {
          before: ordered.slice(Math.max(0, index - 5), index).map(serialize),
          event: serialize(ordered[index]),
          after: ordered.slice(index + 1, index + 6).map(serialize),
        },
      };
    },
  });
}
