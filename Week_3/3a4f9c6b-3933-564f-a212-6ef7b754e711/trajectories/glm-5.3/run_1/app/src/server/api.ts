import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import crypto from 'node:crypto';
import { db } from './db.js';
import { ApiErrorBody, forbidden, notFound, validationError } from './errors.js';
import type { GraphEdge, GraphNode, Overrides, Role } from './domain.js';
import {
  breakFreeze, rollbackStage, startPromotion, approvePromotion,
  rejectPromotion, agentReport, approvalRequestedBody, publicUrl,
  queueEvidenceSnapshot, latestStoredSnapshot, evaluateWindowDecision, requestPromotion,
  sendOrQueueNotice,
} from './promotions.js';
import { stageStatus, instantString, policyVersionInForce } from './rules.js';
import { localTimeString, nextOpenings } from './time.js';
import {
  bundleById, findCluster, findProject, findStage, membershipIn,
  newToken, promotionViewById, releaseManagers,
  activePromotionOfStage, currentRevisionOfStage, clusterWindows, freezeVersions,
  inSyncCounter, latestPromotionIntoStage, promotionById, bundleByVersion, findPerson,
  verifyPassword, membershipsOf, approvalLinkToken, bundlesVerifiedInStages,
  projectStages, projectBundles, projectClusters, healthRowsOf,
} from './store.js';
import { SESSION_COOKIE, bodyHash, createSession, destroySession, findRequestKey, isValidRequestKey, readSession, storeRequestKey } from './http.js';
import { bundleKey, putObject } from './storage.js';
import { reachability } from './health.js';

const BUNDLE_BODY_LIMIT = 1_000_000;
const DEFAULT_BODY_LIMIT = 64_000;

export interface KeelsonRequest extends Request {
  session?: { email: string; name: string };
}

// ---------------------------------------------------------------- helpers

async function requireProject(req: KeelsonRequest, slug: string): Promise<{ role: Role; name: string }> {
  const project = await findProject(slug);
  if (!project) throw notFound();
  const role = await membershipIn(req.session!.email, slug);
  if (!role) throw notFound();
  return { role, name: project.name };
}

function requireRole(role: Role, allowed: Role[]): void {
  if (!allowed.includes(role)) throw forbidden();
}

// The keyed-call wrapper: enforces the request key precedence and replays.
async function keyed(req: KeelsonRequest, res: Response, run: () => Promise<{ status: number; body: unknown }>): Promise<void> {
  const rawKey = req.header('Request-Key');
  if (!isValidRequestKey(rawKey)) {
    throw new ApiErrorBody('request_key_required', 'A request key is required.');
  }
  const hash = bodyHash(req.body);
  const stored = await findRequestKey(req.session!.email, req.method, req.originalUrl, rawKey);
  if (stored) {
    if (stored.body_hash !== hash) {
      throw new ApiErrorBody('request_key_reused', 'This request key was used with a different body.');
    }
    if (stored.status === null) {
      // The original call is still running: wait for it by polling briefly.
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const again = await findRequestKey(req.session!.email, req.method, req.originalUrl, rawKey);
        if (again && again.status !== null) {
          res.set('Request-Replayed', 'true');
          res.status(again.status).json(JSON.parse(again.response_body as string));
          return;
        }
      }
      throw new ApiErrorBody('request_key_required', 'The original call is still running.');
    }
    res.set('Request-Replayed', 'true');
    res.status(stored.status).json(JSON.parse(stored.response_body as string));
    return;
  }
  const result = await run();
  if (result.status !== 503) {
    await storeRequestKey(req.session!.email, req.method, req.originalUrl, rawKey, hash, result.status, JSON.stringify(result.body));
  }
  res.status(result.status).json(result.body);
}

// ---------------------------------------------------------------- session

export const sessionRouter: Router = express.Router();

sessionRouter.post('/', async (req: KeelsonRequest, res: Response, next: NextFunction) => {
  try {
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    if (typeof email !== 'string' || typeof password !== 'string' || email.length === 0 || password.length === 0) {
      throw validationError({ email: 'Email and password are required.' });
    }
    const person = await findPerson(email);
    if (!person || !verifyPassword(password, person.password_hash)) {
      throw new ApiErrorBody('invalid_credentials', 'Email or password is wrong.');
    }
    const token = await createSession(email);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
    res.json({ user: { email: person.email, name: person.name }, memberships: await membershipsOf(email) });
  } catch (e) { next(e); }
});

sessionRouter.get('/', async (req: KeelsonRequest, res: Response, next: NextFunction) => {
  try {
    const session = await readSession(req);
    if (!session) throw new ApiErrorBody('unauthenticated', 'Sign in to continue.');
    res.json({ user: { email: session.email, name: session.name }, memberships: await membershipsOf(session.email) });
  } catch (e) { next(e); }
});

sessionRouter.delete('/', async (req: KeelsonRequest, res: Response, next: NextFunction) => {
  try {
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- projects

export async function projectsList(req: KeelsonRequest, res: Response): Promise<void> {
  const memberships = await membershipsOf(req.session!.email);
  const out = [];
  for (const m of memberships) {
    const project = await findProject(m.project);
    if (project) out.push({ slug: project.slug, name: project.name, role: m.role });
  }
  res.json({ projects: out });
}

export async function projectGraph(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  const { role, name } = await requireProject(req, slug);
  const stages = await projectStages(slug);
  const stageIds = new Map(stages.map((s) => [s.id, s]));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const stage of stages) {
    const cluster = await findCluster(stage.cluster_id);
    const active = await activePromotionOfStage(stage.id);
    const current = active ? null : await currentRevisionOfStage(stage.id);
    const revision = active && ['applying', 'health_wait'].includes(active.state) ? active : current;
    const counter = revision ? await inSyncCounter(revision.id) : null;
    const currentPromo = revision ?? null;
    const currentBundle = currentPromo ? await bundleById(currentPromo.bundle_id) : null;
    const activeView = active ? await promotionViewById(active.id) : null;
    nodes.push({
      stage: stage.name,
      cluster: cluster?.name ?? '',
      time_zone: cluster?.time_zone ?? '',
      upstream: stage.upstream_id ? stageIds.get(stage.upstream_id)?.name ?? null : null,
      requires_approval: stage.requires_approval,
      status: stageStatus(
        active ? { state: active.state } : null,
        revision ? { state: revision.state } : null,
      ),
      current: currentBundle ? {
        promotion_id: currentPromo!.id, version: currentBundle.version,
        short_digest: currentBundle.digest.replace(/^sha256:/, '').slice(0, 7),
      } : null,
      counter: counter && counter.total > 0 ? counter : null,
      active_promotion: activeView,
    });
    const latest = await latestPromotionIntoStage(stage.id);
    if (latest) {
      const view = await promotionViewById(latest.id);
      edges.push({
        from: stage.upstream_id ? stageIds.get(stage.upstream_id)!.name : 'bundles',
        to: stage.name,
        phase: view!.phase,
        progress: view!.progress,
        promotion_id: view!.id,
      });
    } else {
      edges.push({
        from: stage.upstream_id ? stageIds.get(stage.upstream_id)!.name : 'bundles',
        to: stage.name,
        phase: 'idle',
        progress: 0,
        promotion_id: null,
      });
    }
  }
  res.json({ project: { slug, name }, role, nodes, edges });
}

// ---------------------------------------------------------------- status

export async function serviceStatus(_req: KeelsonRequest, res: Response): Promise<void> {
  const r = await db.query<{ queued_uploads: string; queued_notices: string }>(
    `SELECT
       (SELECT count(*) FROM evidence_uploads WHERE state = 'queued') + (SELECT count(*) FROM bundle_uploads WHERE state = 'queued') AS queued_uploads,
       (SELECT count(*) FROM notice_queue WHERE state = 'queued') AS queued_notices`,
  );
  const reach = reachability;
  res.json({
    storage: reach.storage ? 'up' : 'down',
    mail: reach.mail ? 'up' : 'down',
    queued_uploads: Number(r.rows[0].queued_uploads),
    queued_notices: Number(r.rows[0].queued_notices),
  });
}

// ---------------------------------------------------------------- bundles

const REF_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const VERSION_RE = /^[A-Za-z0-9.+-]{1,64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

export async function ingestBundle(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  const { role } = await requireProject(req, slug);
  requireRole(role, ['service_developer', 'platform_engineer']);
  const body = req.body as { version?: unknown; source_commit?: unknown; manifests?: unknown };
  const fields: Record<string, string> = {};
  if (typeof body.version !== 'string' || !VERSION_RE.test(body.version)) {
    fields.version = 'Use 1 to 64 letters, digits, dots, plus or minus signs.';
  }
  if (typeof body.source_commit !== 'string' || !COMMIT_RE.test(body.source_commit)) {
    fields.source_commit = 'Use the full 40-character commit.';
  }
  if (!Array.isArray(body.manifests) || body.manifests.length < 1 || body.manifests.length > 200) {
    fields.manifests = 'Each manifest needs apiVersion, kind and metadata.name.';
  } else {
    const refs = new Set<string>();
    for (const m of body.manifests) {
      const manifest = m as Record<string, unknown>;
      const meta = manifest.metadata as Record<string, unknown> | undefined;
      const nameOk = typeof meta?.name === 'string' && REF_RE.test(meta.name);
      if (typeof manifest.apiVersion !== 'string' || typeof manifest.kind !== 'string' || !nameOk) {
        fields.manifests = 'Each manifest needs apiVersion, kind and metadata.name.';
        break;
      }
      const ns = typeof meta?.namespace === 'string' && REF_RE.test(meta.namespace) ? meta.namespace : 'default';
      const ref = `${manifest.kind}/${ns}/${meta!.name}`;
      if (refs.has(ref)) {
        fields.manifests = `Duplicate resource ${ref}.`;
        break;
      }
      refs.add(ref);
    }
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);

  const manifests = body.manifests as Record<string, unknown>[];
  const objectBytes = Buffer.from(JSON.stringify({ version: body.version, source_commit: body.source_commit, manifests }));
  const digestHex = crypto.createHash('sha256').update(objectBytes).digest('hex');
  const digest = `sha256:${digestHex}`;

  const existing = await bundleByVersion(slug, body.version as string);
  if (existing) throw new ApiErrorBody('version_exists', 'A bundle with this version already exists.');

  const resources = manifests.map((m) => {
    const meta = m.metadata as Record<string, unknown>;
    const ns = typeof meta.namespace === 'string' ? meta.namespace : 'default';
    return { ref: `${m.kind}/${ns}/${meta.name}`, kind: m.kind as string, namespace: ns as string, name: meta.name as string };
  });

  // Upload the object before recording the bundle.
  let stored = true;
  try {
    await putObject(bundleKey(slug, digestHex), objectBytes);
  } catch {
    stored = false;
    throw new ApiErrorBody('storage_unavailable', 'Evidence storage is unreachable, so the bundle was not ingested.');
  }
  const ins = await db.query<{ id: string }>(
    `INSERT INTO bundles (project_slug, version, digest, source_commit, resources, ingested_at, ingested_by)
     VALUES ($1,$2,$3,$4,$5,now(),$6) RETURNING id`,
    [slug, body.version, digest, body.source_commit, JSON.stringify(resources), req.session!.email],
  );
  await db.query('INSERT INTO bundle_uploads (bundle_id, object_key, state) VALUES ($1,$2,$3)', [
    ins.rows[0].id, bundleKey(slug, digestHex), stored ? 'stored' : 'queued',
  ]);
  res.status(201).json({
    id: ins.rows[0].id,
    version: body.version,
    digest,
    short_digest: digestHex.slice(0, 7),
    source_commit: body.source_commit,
    resources,
    ingested_at: instantString(new Date()),
    ingested_by: req.session!.email,
    verified_in: [],
  });
}

export async function listBundles(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  await requireProject(req, slug);
  const bundles = await projectBundles(slug);
  const verified = await bundlesVerifiedInStages(bundles.map((b) => b.id));
  const stages = await projectStages(slug);
  const stageNameById = new Map(stages.map((s) => [s.id, s.name]));
  res.json({
    bundles: await Promise.all(bundles.map(async (b) => ({
      id: b.id,
      version: b.version,
      digest: b.digest,
      short_digest: b.digest.replace(/^sha256:/, '').slice(0, 7),
      source_commit: b.source_commit,
      resources: b.resources,
      ingested_at: instantString(b.ingested_at),
      ingested_by: b.ingested_by,
      verified_in: (verified.get(b.id) ?? []).map((id) => stageNameById.get(id) ?? id),
    }))),
  });
}

// ---------------------------------------------------------------- stages

export async function patchStage(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  const { role } = await requireProject(req, slug);
  requireRole(role, ['platform_engineer']);
  const stage = await findStage(slug, String(req.params.s));
  if (!stage) throw notFound();
  const body = req.body as { defaults?: { parameters?: unknown; replicas?: unknown } };
  const parameters = body.defaults?.parameters ?? {};
  const replicas = body.defaults?.replicas ?? {};
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(parameters)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(k) || typeof v !== 'string' || v.length > 1000) {
      fields.parameters = 'Use upper-case keys and text values up to 1,000 characters.';
      break;
    }
  }
  for (const [k, v] of Object.entries(replicas)) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) {
      fields.replicas = 'Use whole numbers from 0 to 100.';
      break;
    }
    if (!/^([A-Za-z]+)\/([a-z0-9.-]+)\/([a-z0-9.-]+)$/.test(k)) {
      fields.replicas = 'Use whole numbers from 0 to 100.';
      break;
    }
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);
  await db.query('UPDATE stages SET defaults = $2 WHERE id = $1', [
    stage.id, JSON.stringify({ parameters, replicas }),
  ]);
  res.json({ stage: stage.name, defaults: { parameters, replicas } });
}

// ------------------------------------------------------------- promotions

export async function requestPromotionRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  const { role } = await requireProject(req, slug);
  requireRole(role, ['service_developer', 'platform_engineer']);
  const stage = await findStage(slug, String(req.params.s));
  if (!stage) throw notFound();
  const body = req.body as { bundle_version?: unknown; overrides?: { parameters?: unknown; replicas?: unknown } };
  if (typeof body.bundle_version !== 'string' || body.bundle_version.length === 0) {
    throw validationError({ bundle_version: 'Unknown bundle version.' });
  }
  const overrides = normaliseOverrides(body.overrides, await bundleResourceRefsOf(slug, body.bundle_version));
  await keyed(req, res, async () => {
    const result = await requestPromotion(slug, stage.name, req.session!, body.bundle_version as string, overrides);
    // Approval-requested notices for prod stages.
    const view = await promotionViewById(result.promotionId);
    if (view && view.approval) {
      const token = (await approvalLinkToken(result.promotionId)) ?? newToken(24);
      const link = `${publicUrl()}/approvals/${token}`;
      await db.query('INSERT INTO approval_links (token, promotion_id) VALUES ($1,$2) ON CONFLICT (token) DO NOTHING', [token, result.promotionId]);
      const managers = await releaseManagers(slug);
      for (const m of managers) {
                await sendOrQueueNotice(slug, result.promotionId, m.email,
          `Approval requested: ${view.bundle.version} to ${view.stage} (${(await findProject(slug))!.name})`,
          approvalRequestedBody(view, link));
      }
    }
    await queueEvidenceSnapshot(result.promotionId, slug);
    const fresh = await promotionViewById(result.promotionId);
    return { status: 201, body: fresh };
  });
}

async function bundleResourceRefsOf(slug: string, version: string): Promise<string[]> {
  const b = await bundleByVersion(slug, version);
  if (!b) return [];
  return b.resources.map((r) => r.ref);
}

function normaliseOverrides(raw: unknown, refs: string[]): Overrides {
  const result: Overrides = { parameters: {}, replicas: {} };
  const fields: Record<string, string> = {};
  const overrides = (raw ?? {}) as { parameters?: Record<string, unknown>; replicas?: Record<string, unknown> };
  for (const [k, v] of Object.entries(overrides.parameters ?? {})) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(k) || typeof v !== 'string' || v.length > 1000) {
      fields.parameters = 'Use upper-case keys and text values up to 1,000 characters.';
      break;
    }
    result.parameters[k] = v;
  }
  const refsSet = new Set(refs);
  for (const [k, v] of Object.entries(overrides.replicas ?? {})) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) {
      fields.replicas = 'Use whole numbers from 0 to 100.';
      break;
    }
    const isDeployLike = /^Deployment\//.test(k) || /^StatefulSet\//.test(k);
    if (!isDeployLike || !refsSet.has(k)) {
      fields.replicas = 'Only Deployments and StatefulSets in this bundle can take replica counts.';
      break;
    }
    result.replicas[k] = v;
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);
  return result;
}

export async function listPromotions(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  await requireProject(req, slug);
  const limitRaw = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) {
    throw validationError({ limit: 'Use a whole number from 1 to 100.' });
  }
  const stageName = typeof req.query.stage === 'string' ? req.query.stage : null;
  let rows: { id: string }[];
  if (stageName) {
    const stage = await findStage(slug, stageName);
    if (!stage) throw notFound();
    rows = (await db.query('SELECT id FROM promotions WHERE stage_id = $1 ORDER BY requested_at DESC LIMIT $2', [stage.id, limitRaw])).rows;
  } else {
    rows = (await db.query('SELECT id FROM promotions WHERE project_slug = $1 ORDER BY requested_at DESC LIMIT $2', [slug, limitRaw])).rows;
  }
  const promotions = [];
  for (const row of rows) {
    const view = await promotionViewById(row.id);
    if (view) promotions.push(view);
  }
  res.json({ promotions });
}

export async function getPromotion(req: KeelsonRequest, res: Response): Promise<void> {
  const view = await promotionViewById(String(req.params.id));
  if (!view) throw notFound();
  const role = await membershipIn(req.session!.email, view.project);
  if (!role) throw notFound();
  res.json(view);
}

async function promotionForAction(req: KeelsonRequest, promotionId: string) {
  const view = await promotionViewById(promotionId);
  if (!view) throw notFound();
  const role = await membershipIn(req.session!.email, view.project);
  if (!role) throw notFound();
  return { view, role };
}

export async function approveRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const { view, role } = await promotionForAction(req, String(req.params.id));
  requireRole(role, ['release_manager']);
  const comment = (req.body as { comment?: unknown }).comment;
  if (comment !== undefined && (typeof comment !== 'string' || comment.length > 500)) {
    throw validationError({ comment: 'Keep the comment to 500 characters.' });
  }
  await keyed(req, res, async () => {
    const fresh = await approvePromotion(view.id, req.session!.email, (comment as string | undefined) ?? null);
    return { status: 200, body: fresh };
  });
}

export async function rejectRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const { view, role } = await promotionForAction(req, String(req.params.id));
  requireRole(role, ['release_manager']);
  const reason = (req.body as { reason?: unknown }).reason;
  if (typeof reason !== 'string' || reason.length < 10 || reason.length > 500) {
    throw validationError({ reason: 'Give a reason of 10 to 500 characters.' });
  }
  await keyed(req, res, async () => {
    const fresh = await rejectPromotion(view.id, req.session!.email, reason);
    return { status: 200, body: fresh };
  });
}

export async function startRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const { view, role } = await promotionForAction(req, String(req.params.id));
  requireRole(role, ['service_developer', 'platform_engineer']);
  await keyed(req, res, async () => {
    const result = await startPromotion(view.id, req.session!.email);
    return { status: 200, body: result.view };
  });
}

export async function retryWindowRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const { view, role } = await promotionForAction(req, String(req.params.id));
  requireRole(role, ['service_developer', 'platform_engineer']);
  await keyed(req, res, async () => {
    const result = await startPromotion(view.id, req.session!.email);
    return { status: 200, body: result.view };
  });
}

export async function breakFreezeRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const { view, role } = await promotionForAction(req, String(req.params.id));
  requireRole(role, ['oncall_sre']);
  const reason = (req.body as { reason?: unknown }).reason;
  if (typeof reason !== 'string' || reason.length < 10 || reason.length > 500) {
    throw validationError({ reason: 'Give a reason of 10 to 500 characters.' });
  }
  await keyed(req, res, async () => {
    const fresh = await breakFreeze(view.id, req.session!.email, reason);
    return { status: 200, body: fresh };
  });
}

export async function rollbackRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  const { role } = await requireProject(req, slug);
  requireRole(role, ['oncall_sre']);
  const stage = await findStage(slug, String(req.params.s));
  if (!stage) throw notFound();
  const reason = (req.body as { reason?: unknown }).reason;
  if (typeof reason !== 'string' || reason.length < 10 || reason.length > 500) {
    throw validationError({ reason: 'Give a reason of 10 to 500 characters.' });
  }
  await keyed(req, res, async () => {
    const fresh = await rollbackStage(slug, stage.name, req.session!.email, reason);
    return { status: 201, body: fresh };
  });
}

// ------------------------------------------------------------- health

export async function stageHealthRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  await requireProject(req, slug);
  const stage = await findStage(slug, String(req.params.s));
  if (!stage) throw notFound();
  const active = await activePromotionOfStage(stage.id);
  const revision = active && ['applying', 'health_wait'].includes(active.state) ? active : await currentRevisionOfStage(stage.id);
  if (!revision) {
    res.json({ revision: null, in_sync: 0, total: 0, resources: [] });
    return;
  }
  const rows = await healthRowsOf(revision.id);
  const counter = await inSyncCounter(revision.id);
  res.json({
    revision: revision.id,
    in_sync: counter.in_sync,
    total: counter.total,
    resources: rows,
  });
}

export async function evidenceRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const view = await promotionViewById(String(req.params.id));
  if (!view) throw notFound();
  const role = await membershipIn(req.session!.email, view.project);
  if (!role) throw notFound();
  const snapshot = await latestStoredSnapshot(view.id);
  if (!snapshot) {
    throw new ApiErrorBody('evidence_pending', 'No evidence snapshot is stored yet.');
  }
  const reach = reachability;
  if (!reach.storage) {
    throw new ApiErrorBody('storage_unavailable', 'Evidence storage is unreachable.');
  }
  const filename = `keelson-evidence-${view.id}-${String(snapshot.snapshot).padStart(3, '0')}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(snapshot.payload);
}

// ------------------------------------------------------------- windows

export async function clustersRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  await requireProject(req, slug);
  const clusters = await projectClusters(slug);
  const stages = await projectStages(slug);
  const out = [];
  for (const c of clusters) {
    out.push({
      name: c.name,
      time_zone: c.time_zone,
      stages: stages.filter((s) => s.cluster_id === c.id).map((s) => s.name),
      windows: (await clusterWindows(c.id)).map((w) => ({ id: w.id, label: w.label, days: w.days, start: w.start, end: w.end })),
    });
  }
  res.json({ clusters: out });
}

export async function addWindowRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  const { role } = await requireProject(req, slug);
  requireRole(role, ['platform_engineer']);
  const cluster = await findClusterByName(slug, String(req.params.c));
  if (!cluster) throw notFound();
  const body = req.body as { label?: unknown; days?: unknown; start?: unknown; end?: unknown };
  const fields: Record<string, string> = {};
  if (typeof body.label !== 'string' || body.label.length < 1 || body.label.length > 80) {
    fields.label = 'Use 1 to 80 characters.';
  }
  const days = Array.isArray(body.days) ? body.days : [];
  if (days.length < 1 || !days.every((d) => typeof d === 'string' && ['mon','tue','wed','thu','fri','sat','sun'].includes(d))) {
    fields.days = 'Pick at least one day.';
  }
  const startOk = typeof body.start === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.start);
  const endOk = typeof body.end === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.end) || body.end === '24:00';
  if (!startOk) fields.start = 'Use 24-hour time like 09:00.';
  if (!endOk) fields.end = 'Use 24-hour time like 09:00.';
  if (startOk && endOk && (body.end === '24:00' ? body.start === '24:00' : body.start! >= body.end!)) {
    fields.end = 'Closes must be after opens.';
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);
  const ins = await db.query<{ id: string }>(
    'INSERT INTO sync_windows (cluster_id, label, days, "start", "end") VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [cluster.id, body.label, days, body.start, body.end],
  );
  res.status(201).json({ id: ins.rows[0].id, label: body.label, days, start: body.start, end: body.end });
}

export async function deleteWindowRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  const { role } = await requireProject(req, slug);
  requireRole(role, ['platform_engineer']);
  const cluster = await findClusterByName(slug, String(req.params.c));
  if (!cluster) throw notFound();
  const r = await db.query('DELETE FROM sync_windows WHERE id = $1 AND cluster_id = $2', [String(req.params.id), cluster.id]);
  if (r.rowCount === 0) throw notFound();
  res.status(204).end();
}

async function findClusterByName(slug: string, name: string) {
  const r = await db.query<{ id: string; name: string; time_zone: string; project_slug: string }>(
    'SELECT id, name, time_zone, project_slug FROM clusters WHERE project_slug = $1 AND name = $2', [slug, name],
  );
  return r.rows[0] ?? null;
}

export async function windowOpeningsRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  await requireProject(req, slug);
  const cluster = await findClusterByName(slug, String(req.params.c));
  if (!cluster) throw notFound();
  const countRaw = req.query.count === undefined ? 5 : Number(req.query.count);
  if (!Number.isInteger(countRaw) || countRaw < 1 || countRaw > 20) {
    throw validationError({ count: 'Use a whole number from 1 to 20.' });
  }
  const fromRaw = req.query.from === undefined ? new Date().toISOString() : String(req.query.from);
  const from = new Date(fromRaw);
  if (Number.isNaN(from.getTime())) {
    throw validationError({ from: 'Use an ISO 8601 instant with an offset.' });
  }
  const windows = await clusterWindows(cluster.id);
  const openings = nextOpenings(cluster.time_zone, windows, from, countRaw);
  res.json({
    time_zone: cluster.time_zone,
    openings: openings.map((o) => ({
      window_id: o.window_id,
      label: o.label,
      opens_at: instantString(o.opens_at),
      closes_at: instantString(o.closes_at),
      local_opens: localTimeString(cluster.time_zone, o.opens_at),
      local_closes: localTimeString(cluster.time_zone, o.closes_at),
    })),
  });
}

export async function windowDecisionRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  await requireProject(req, slug);
  const stage = await findStage(slug, String(req.params.s));
  if (!stage) throw notFound();
  const atRaw = req.query.at === undefined ? new Date().toISOString() : String(req.query.at);
  const at = new Date(atRaw);
  if (Number.isNaN(at.getTime())) {
    throw validationError({ at: 'Use an ISO 8601 instant with an offset.' });
  }
  const versions = await freezeVersions(slug);
  const inForce = policyVersionInForce(versions.map((v) => ({ version: v.version, effective_from: new Date(v.effective_from) })), at);
  const decision = await evaluateWindowDecision(slug, stage.name, stage.cluster_id, inForce, at);
  res.json(decision);
}

// --------------------------------------------------------- freeze policy

export async function freezePolicyRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  await requireProject(req, slug);
  const versions = await freezeVersions(slug);
  const inForce = policyVersionInForce(versions.map((v) => ({ version: v.version, effective_from: new Date(v.effective_from) })), new Date());
  res.json({ in_force_version: inForce, versions });
}

export async function scheduleFreezeRoute(req: KeelsonRequest, res: Response): Promise<void> {
  const slug = String(req.params.p);
  const { role } = await requireProject(req, slug);
  requireRole(role, ['platform_engineer']);
  const body = req.body as { based_on_version?: unknown; effective_from?: unknown; freezes?: unknown };
  const stages = await projectStages(slug);
  const stageNames = new Set(stages.map((s) => s.name));
  const fields: Record<string, string> = {};
  if (typeof body.based_on_version !== 'number' || !Number.isInteger(body.based_on_version)) {
    throw validationError({ based_on_version: 'Name the version this one is based on.' });
  }
  const latest = await db.query<{ version: number }>(
    'SELECT version FROM freeze_policy_versions WHERE project_slug = $1 ORDER BY version DESC LIMIT 1', [slug],
  );
  const latestVersion = latest.rows[0]?.version ?? 0;
  if (body.based_on_version !== latestVersion) {
    throw new ApiErrorBody('stale_version', 'Someone scheduled a newer version first.', { current_version: latestVersion });
  }
  const effective = new Date(String(body.effective_from));
  if (Number.isNaN(effective.getTime())) {
    throw validationError({ effective_from: 'Effective time cannot be in the past.' });
  }
  if (effective.getTime() < Date.now()) {
    fields.effective_from = 'Effective time cannot be in the past.';
  }
  const latestEffective = await db.query<{ effective_from: Date }>(
    'SELECT effective_from FROM freeze_policy_versions WHERE project_slug = $1 AND version = $2', [slug, latestVersion],
  );
  if (latestEffective.rows[0] && effective.getTime() <= latestEffective.rows[0].effective_from.getTime()) {
    fields.effective_from = `Must be later than when version ${latestVersion} takes effect.`;
  }
  const freezes = Array.isArray(body.freezes) ? body.freezes : [];
  for (const f of freezes) {
    const freeze = f as { name?: unknown; stages?: unknown; starts_at?: unknown; ends_at?: unknown };
    if (new Date(String(freeze.ends_at)).getTime() <= new Date(String(freeze.starts_at)).getTime()) {
      fields.freezes = 'Ends must be after starts.';
      break;
    }
    for (const s of (freeze.stages ?? []) as string[]) {
      if (!stageNames.has(s)) {
        fields.freezes = `Unknown stage ${s}.`;
        break;
      }
    }
    if (fields.freezes) break;
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);
  const ins = await db.query<{ version: number }>(
    `INSERT INTO freeze_policy_versions (project_slug, version, effective_from, created_by, freezes)
     VALUES ($1,$2,$3,$4,$5) RETURNING version`,
    [slug, latestVersion + 1, effective, req.session!.email, JSON.stringify(freezes)],
  );
  const versions = await freezeVersions(slug);
  const created = versions.find((v) => v.version === ins.rows[0].version)!;
  res.status(201).json(created);
}

// ------------------------------------------------------------- agent

export async function agentReportRoute(req: Request, res: Response): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new ApiErrorBody('unauthenticated', 'A cluster agent token is required.');
  }
  const token = auth.slice('Bearer '.length);
  const r = await db.query<{ id: string; name: string }>('SELECT id, name FROM clusters WHERE agent_token = $1', [token]);
  if (r.rows.length === 0) {
    throw new ApiErrorBody('unauthenticated', 'A cluster agent token is required.');
  }
  const cluster = r.rows[0];
  const body = req.body as { promotion_id?: unknown; phase?: unknown; resources?: unknown };
  if (typeof body.promotion_id !== 'string' || (body.phase !== 'applying' && body.phase !== 'health_wait') || !Array.isArray(body.resources) || body.resources.length < 1 || body.resources.length > 200) {
    throw validationError({ resources: 'Unknown resource list.' });
  }
  const promo = await promotionById(body.promotion_id);
  if (!promo) throw notFound();
  const promoCluster = await findCluster(promo.cluster_id);
  if (!promoCluster || promoCluster.name !== cluster.name) throw notFound();
  const resources = body.resources.map((r2) => {
    const row = r2 as { ref?: unknown; sync?: unknown; health?: unknown };
    if (typeof row.ref !== 'string' || (row.sync !== 'Synced' && row.sync !== 'OutOfSync') ||
        !['Healthy', 'Progressing', 'Degraded', 'Missing'].includes(row.health as string)) {
      throw validationError({ resources: `Unknown resource ${String(row.ref)}.` });
    }
    return { ref: row.ref, sync: row.sync as 'Synced' | 'OutOfSync', health: row.health as 'Healthy' | 'Progressing' | 'Degraded' | 'Missing' };
  });
  const result = await agentReport({ promotion_id: body.promotion_id, phase: body.phase, resources }, cluster.name);
  res.json({ promotion_id: body.promotion_id, state: result.state, counter: result.counter });
}

// -------------------------------------------------------- approval links

export async function approvalLinkRoute(req: Request, res: Response): Promise<void> {
  const token = String(req.params.token);
  const link = await db.query<{ promotion_id: string }>('SELECT promotion_id FROM approval_links WHERE token = $1', [token]);
  if (link.rows.length === 0) throw notFound();
  const view = await promotionViewById(link.rows[0].promotion_id);
  if (!view) throw notFound();
  const decided = view.state !== 'awaiting_approval';
  if (decided || view.state === 'expired') {
    throw new ApiErrorBody('link_expired', 'This approval link has expired.');
  }
  res.json({
    project: view.project,
    stage: view.stage,
    bundle: { version: view.bundle.version, short_digest: view.bundle.short_digest },
    requested_by: view.requested_by,
    request_expires_at: view.approval!.request_expires_at,
    time_zone: view.time_zone,
    diff: view.diff,
    promotion_id: view.id,
  });
}

export { BUNDLE_BODY_LIMIT, DEFAULT_BODY_LIMIT };
