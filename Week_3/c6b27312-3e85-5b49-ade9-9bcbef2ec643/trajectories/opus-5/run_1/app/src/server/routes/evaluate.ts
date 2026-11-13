import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { query } from '../db';
import { ApiError, invalid, notFound } from '../errors';
import { Ctx, sendJson } from '../http';
import { claimPreflightReport, releasePreflightClaim } from '../bus';
import { headRevisionOf, loadRevision, programOfSource, sourceOfRef } from '../records';
import { EvaluationRow, cancelViewerEvaluation, evaluationJson, runEvaluation } from '../evaluations';
import { buildManifest, sourceDefaults } from '../../tine/manifest';
import { buildTape, evaluateProgram } from '../../tine/evaluate';
import { geometryDigest } from '../../tine/digest';
import { findProcess, runPreflight } from '../../tine/preflight';
import { Solid } from '../../tine/solid';
import { checkNumberGrammar, validateValues, valuesFrom } from '../values';
import { readablePart, withDownloadStorage } from './helpers';
import { getObject, storageKeys } from '../storage';
import { compareSolids } from '../compare';

async function programAndValues(
  ctx: Ctx,
  slug: string,
  revisionId: unknown,
): Promise<{ program: ReturnType<typeof programOfSource>; values: Record<string, unknown> }> {
  const part = await readablePart(ctx, slug);
  let revision = await headRevisionOf(part.slug);
  if (typeof revisionId === 'string') {
    const named = await loadRevision(revisionId);
    if (!named || named.part_slug !== part.slug) throw notFound();
    revision = named;
  }
  if (!revision) throw notFound();
  const source = await sourceOfRef(revision.source_ref);
  return { program: programOfSource(source), values: valuesFrom(ctx.body) };
}

export async function postEvaluation(ctx: Ctx): Promise<void> {
  const slug = typeof ctx.body.partSlug === 'string' ? ctx.body.partSlug : '';
  const { program, values } = await programAndValues(ctx, slug, ctx.body.revisionId);
  const manifest = buildManifest(program, {});
  checkNumberGrammar(ctx.raw, manifest);
  const checked = validateValues(manifest, values);
  const seq = typeof ctx.body.seq === 'number' ? ctx.body.seq : 1;
  const viewerId = typeof ctx.body.viewerId === 'string' ? ctx.body.viewerId : randomUUID();
  const row = await runEvaluation({
    partSlug: slug,
    program,
    values: checked,
    seq,
    viewerId,
    requestSignal: ctx.signal,
  });
  sendJson(ctx, 200, evaluationJson(row));
}

export async function cancelEvaluation(ctx: Ctx): Promise<void> {
  const viewerId = typeof ctx.body.viewerId === 'string' ? ctx.body.viewerId : '';
  await cancelViewerEvaluation(viewerId);
  ctx.res.writeHead(204).end();
}

export async function getEvaluation(ctx: Ctx): Promise<void> {
  const result = await query<EvaluationRow>('select * from evaluations where id = $1', [ctx.params.id]);
  const row = result.rows[0];
  if (!row) throw notFound();
  sendJson(ctx, 200, evaluationJson(row));
}

/** Pre-flight evaluates the part from its PostgreSQL source and needs no stored object. */
export async function postPreflight(ctx: Ctx): Promise<void> {
  const slug = typeof ctx.body.partSlug === 'string' ? ctx.body.partSlug : '';
  const { program, values } = await programAndValues(ctx, slug, ctx.body.revisionId);

  let claimed = false;
  if (!ctx.user) {
    const claim = await claimPreflightReport(ctx.visitorId, config.preflightSignedOutLimit);
    if (!claim.allowed) {
      throw new ApiError(
        429,
        { error: 'preflight_limit', message: 'Sign in to run more pre-flight reports.' },
        { 'Retry-After': String(claim.retryAfterSeconds) },
      );
    }
    claimed = true;
  }

  try {
    const manifest = buildManifest(program, {});
    checkNumberGrammar(ctx.raw, manifest);
    const checked = validateValues(manifest, values);
    const process = findProcess(typeof ctx.body.process === 'string' ? ctx.body.process : '');
    if (!process) {
      throw invalid({ process: 'Choose one of fdm-04, mill-3, laser-sheet.' });
    }
    const result = evaluateProgram(program, checked);
    if (!result.ok) {
      throw new ApiError(422, {
        error: 'evaluation_failed',
        message: result.diagnostic.message,
        diagnostics: [result.diagnostic],
      });
    }
    const tape = buildTape(program, checked);
    const report = runPreflight(program, result.ops, result.measures, tape, process);
    const id = randomUUID();
    const digest = geometryDigest(result.solid);
    const createdAt = new Date();
    await query(
      `insert into preflight_reports (id, part_slug, revision_id, viewer_id, process, values_json,
         geometry_digest, status, message, findings, cost_bands, confidence, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        slug,
        typeof ctx.body.revisionId === 'string' ? ctx.body.revisionId : null,
        ctx.user ? ctx.user.id : ctx.visitorId,
        process.id,
        JSON.stringify(checked),
        digest,
        report.status,
        report.message,
        JSON.stringify(report.findings),
        JSON.stringify(report.costBands),
        report.confidence,
        createdAt,
      ],
    );
    sendJson(ctx, 201, {
      id,
      partSlug: slug,
      process: process.id,
      values: checked,
      geometryDigest: digest,
      status: report.status,
      message: report.message,
      findings: report.findings,
      costBands: report.costBands,
      confidence: report.confidence,
      createdAt: createdAt.toISOString(),
    });
    claimed = false;
  } finally {
    if (claimed) await releasePreflightClaim(ctx.visitorId);
  }
}

export async function getCompare(ctx: Ctx): Promise<void> {
  const baseId = ctx.url.searchParams.get('base') ?? '';
  const headId = ctx.url.searchParams.get('head') ?? '';
  const base = await loadRevision(baseId);
  const head = await loadRevision(headId);
  if (!base || !head || base.part_slug !== head.part_slug) throw notFound();
  await readablePart(ctx, base.part_slug);

  const source = await sourceOfRef(head.source_ref);
  const program = programOfSource(source);
  const defaults = sourceDefaults(program);
  const manifest = buildManifest(program, head.values_json);
  const parameterChanges = manifest
    .filter((entry) => !entry.derived)
    .map((entry) => {
      const baseValue = Object.prototype.hasOwnProperty.call(base.values_json, entry.name)
        ? base.values_json[entry.name]
        : defaults[entry.name];
      const headValue = Object.prototype.hasOwnProperty.call(head.values_json, entry.name)
        ? head.values_json[entry.name]
        : defaults[entry.name];
      return {
        name: entry.name,
        label: entry.label,
        base: baseValue,
        head: headValue,
        unit: entry.unit,
      };
    })
    .filter((change) => change.base !== change.head);

  if (base.geometry_digest === head.geometry_digest) {
    sendJson(ctx, 200, {
      base: base.id,
      head: head.id,
      identical: true,
      added: 0,
      removed: 0,
      unchanged: 0,
      hunks: [],
      parameterChanges,
    });
    return;
  }

  const result = await withDownloadStorage(async () => {
    const [baseBytes, headBytes] = await Promise.all([
      getObject(storageKeys.solid(base.geometry_digest)),
      getObject(storageKeys.solid(head.geometry_digest)),
    ]);
    if (!baseBytes || !headBytes) throw notFound();
    return compareSolids(
      JSON.parse(baseBytes.toString('utf8')) as Solid,
      JSON.parse(headBytes.toString('utf8')) as Solid,
    );
  });

  sendJson(ctx, 200, {
    base: base.id,
    head: head.id,
    identical: result.identical,
    added: result.added,
    removed: result.removed,
    unchanged: result.unchanged,
    hunks: result.hunks,
    parameterChanges,
  });
}
