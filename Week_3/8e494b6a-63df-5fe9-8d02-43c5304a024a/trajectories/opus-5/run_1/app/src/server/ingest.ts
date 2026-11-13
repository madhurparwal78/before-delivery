import { randomUUID } from 'node:crypto';
import { query, transaction } from './db.js';
import { settings } from './env.js';
import { publish, publishTailLine } from './live.js';
import {
  addFailure,
  countStreamEvents,
  spaceTotals,
  STREAM_MAX_EVENTS,
  writeEvent,
  writeGenerationOf,
  type GenerationRow,
  type StreamRow,
} from './store.js';
import { arrayMixesTypes, flattenEvent, isIsoDateString } from './domain/mapping.js';
import { runPipeline, type Processor } from './domain/pipeline.js';

export type LineResult = {
  line: number;
  status: 'created' | 'duplicate' | 'dropped' | 'failed';
  id?: string;
  error?: string;
};

export type IngestCounts = {
  created: number;
  duplicates: number;
  dropped: number;
  failed: number;
};

export type IngestOutcome = IngestCounts & { lines: LineResult[]; totalLines: number };

export type PipelineChoice = { name: string; version: number; processors: Processor[] } | null;

export async function ingestLines(input: {
  spaceId: number;
  spaceSlug: string;
  stream: StreamRow;
  text: string;
  pipeline: PipelineChoice;
  uploadId?: number;
}): Promise<IngestOutcome> {
  const lines = input.text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const counts: IngestCounts = { created: 0, duplicates: 0, dropped: 0, failed: 0 };
  const results: LineResult[] = [];
  let done = 0;
  const generation = await writeGenerationOf(input.stream);
  const batch = { stored: await countStreamEvents(input.stream.id), generation };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const text = lines[index];
    done += 1;
    if (text.trim() === '') {
      await maybeProgress(input, done, lines.length, counts);
      continue;
    }
    const result = await ingestOneLine({
      spaceId: input.spaceId,
      stream: input.stream,
      pipeline: input.pipeline,
      lineNumber,
      text,
      batch,
    });
    results.push(result);
    if (result.status === 'created') {
      counts.created += 1;
      batch.stored += 1;
    }
    else if (result.status === 'duplicate') counts.duplicates += 1;
    else if (result.status === 'dropped') counts.dropped += 1;
    else counts.failed += 1;
    await maybeProgress(input, done, lines.length, counts);
  }

  if (input.uploadId !== undefined) {
    await query(
      `update uploads set status = 'done', done_lines = $2, total_lines = $3,
         created = $4, duplicates = $5, dropped = $6, failed = $7 where id = $1`,
      [
        input.uploadId,
        lines.length,
        lines.length,
        counts.created,
        counts.duplicates,
        counts.dropped,
        counts.failed,
      ],
    );
  }
  await publishUpload(input, lines.length, lines.length, counts, true);
  return { ...counts, lines: results, totalLines: lines.length };
}

async function maybeProgress(
  input: { spaceId: number; uploadId?: number },
  done: number,
  total: number,
  counts: IngestCounts,
): Promise<void> {
  if (input.uploadId === undefined) return;
  if (done % settings.uploadProgressLines !== 0) return;
  await query(`update uploads set done_lines = $2, total_lines = $3 where id = $1`, [
    input.uploadId,
    done,
    total,
  ]);
  await publishUpload(input, done, total, counts, false);
}

async function publishUpload(
  input: { spaceId: number; uploadId?: number },
  done: number,
  total: number,
  counts: IngestCounts,
  ended: boolean,
): Promise<void> {
  const totals = await spaceTotals(input.spaceId);
  await publish(input.spaceId, 'upload', {
    upload: input.uploadId ?? null,
    done_lines: done,
    total_lines: total,
    created: counts.created,
    duplicates: counts.duplicates,
    dropped: counts.dropped,
    failed: counts.failed,
    ended,
    stored_total: totals.stored,
    failure_total: totals.failed,
  });
}

async function ingestOneLine(input: {
  spaceId: number;
  stream: StreamRow;
  pipeline: PipelineChoice;
  lineNumber: number;
  text: string;
  batch: { stored: number; generation: GenerationRow };
}): Promise<LineResult> {
  const { lineNumber, text } = input;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return await failLine(input, `Line ${lineNumber}: not valid JSON.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return await failLine(input, `Line ${lineNumber}: not an object.`);
  }
  let event = parsed as Record<string, unknown>;
  let pipelineStamp: string | null = null;
  if (input.pipeline) {
    const run = runPipeline(input.pipeline.name, input.pipeline.processors, event);
    if (run.outcome === 'dropped') {
      return { line: lineNumber, status: 'dropped' };
    }
    if (run.outcome === 'failed') {
      return await failLine(input, run.error ?? 'Pipeline failed.');
    }
    event = run.event;
    pipelineStamp = `${input.pipeline.name}@${input.pipeline.version}`;
  }
  const timestamp = event['@timestamp'];
  if (timestamp === undefined || timestamp === null) {
    return await failLine(input, `Line ${lineNumber}: @timestamp is missing.`);
  }
  if (!isIsoDateString(timestamp)) {
    return await failLine(input, `Line ${lineNumber}: @timestamp is not a date.`);
  }
  const eventId = typeof event._id === 'string' && event._id !== '' ? event._id : randomUUID();
  const existing = await query(`select 1 from events where stream_id = $1 and event_id = $2`, [
    input.stream.id,
    eventId,
  ]);
  if (existing.length > 0) return { line: lineNumber, status: 'duplicate' };
  const fields = flattenEvent(event);
  for (const [field, value] of Object.entries(fields)) {
    if (arrayMixesTypes(value)) {
      return await failLine(input, `Line ${lineNumber}: field ${field} mixes types in one array.`);
    }
  }
  if (input.batch.stored >= STREAM_MAX_EVENTS) {
    return await failLine(
      input,
      `Line ${lineNumber}: stream ${input.stream.name} is full at ${STREAM_MAX_EVENTS} events.`,
    );
  }
  const generation = input.batch.generation;
  const outcome = await transaction((client) =>
    writeEvent(client, {
      spaceId: input.spaceId,
      stream: input.stream,
      generation,
      eventId,
      tsMs: Date.parse(String(timestamp)),
      raw: { ...event, '@timestamp': new Date(Date.parse(String(timestamp))).toISOString() },
      pipeline: pipelineStamp,
    }),
  );
  if (outcome.status === 'duplicate') return { line: lineNumber, status: 'duplicate' };
  if (outcome.status === 'failed') {
    return await failLine(input, `Line ${lineNumber}: ${outcome.reason}.`);
  }
  publishTailLine(input.stream.id, {
    _id: eventId,
    '@timestamp': new Date(Date.parse(String(timestamp))).toISOString(),
    _generation: generation.number,
    _phase: 'hot',
    _pipeline: pipelineStamp,
    fields,
  });
  return { line: lineNumber, status: 'created', id: eventId };
}

async function failLine(
  input: { spaceId: number; stream: StreamRow; text: string; lineNumber: number },
  reason: string,
): Promise<LineResult> {
  await addFailure(input.spaceId, input.stream.id, reason, input.text);
  return { line: input.lineNumber, status: 'failed', error: reason };
}

export type FilePart = { name: string; filename?: string; value: Buffer };

/** A small multipart/form-data reader; the app takes one file part and one pipeline part. */
export function readMultipart(body: Buffer, contentType: string): FilePart[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return [];
  const boundary = `--${match[1] ?? match[2]}`;
  const parts: FilePart[] = [];
  let cursor = body.indexOf(boundary);
  if (cursor < 0) return [];
  cursor += boundary.length;
  for (;;) {
    if (body.slice(cursor, cursor + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', cursor);
    if (headerEnd < 0) break;
    const headers = body.slice(cursor, headerEnd).toString('utf8');
    const next = body.indexOf(boundary, headerEnd);
    if (next < 0) break;
    const value = body.slice(headerEnd + 4, next - 2);
    const nameMatch = /name="([^"]*)"/i.exec(headers);
    const fileMatch = /filename="([^"]*)"/i.exec(headers);
    parts.push({
      name: nameMatch?.[1] ?? '',
      filename: fileMatch?.[1],
      value,
    });
    cursor = next + boundary.length;
  }
  return parts;
}

/** Rule B: the file kind is judged before anything is stored. */
export function fileKindAccepted(filename: string, body: Buffer): boolean {
  if (!/\.ndjson$/i.test(filename)) return false;
  if (body.includes(0)) return false;
  const text = body.toString('utf8');
  if (Buffer.from(text, 'utf8').length !== body.length) return false;
  const firstVisible = text.trimStart()[0];
  return firstVisible === '{';
}

export function lastNameOf(filename: string): string {
  const parts = filename.split(/[\\/]/);
  return parts[parts.length - 1];
}
