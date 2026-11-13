import { Router, type Response } from 'express';
import type { AppCtx } from './ctx';
import { ApiError } from './api-errors';
import { requireAuth } from './sessions';
import { respond, readCookie, currentAllowance, announceAllowance } from './routes-session';
import { runOp, runUndo, runRedo, setAspectOp, rememberOp, ConflictError, OpValidationError, BlockedApiError, type OpOutput } from './ops-service';
import { loadTimeline, totalFramesOf } from './timeline';
import type { Clip, Project, Role } from '../shared/types';
import { aspectSize, isFrameRate, isAspectRatio, timecode } from '../shared/frames';
import { newHex, codePoints } from './util';

/** Projects, members and the op endpoint. */
export function projectRoutes(ctx: AppCtx): Router {
  const r = Router();

  // The caller's projects, in seed or creation order.
  r.get('/projects', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const rows = await ctx.db.query(
        `SELECT p.*, m.role FROM projects p JOIN members m ON m.project_id = p.id
         WHERE m.person_id = $1 ORDER BY p.seed_order, p.created_at`,
        [person.id],
      );
      const items: Project[] = [];
      for (const row of rows.rows) {
        items.push(await projectSummary(ctx, row));
      }
      res.json({ items });
    })().catch((err) => respond(res, err));
  });

  r.post('/projects', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const fields = validateProjectBody(body);
      const id = `p-${newHex(6)}`;
      const client = await ctx.db.connect();
      try {
        await client.query('BEGIN');
        const maxOrder = await client.query<{ max: number | null }>('SELECT MAX(seed_order) AS max FROM projects');
        const order = (maxOrder.rows[0]!.max ?? 0) + 1;
        await client.query(
          `INSERT INTO projects (id, workspace_id, title, agency, description, frame_rate, aspect_ratio, time_unit, version, seed_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'frames',0,$8)`,
          [id, ctx.workspaceId, fields.title, fields.agency, fields.description, fields.frameRate, fields.aspectRatio, order],
        );
        await client.query('INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,$3)', [id, person.id, 'owner']);
        const seedRows: { name: string; kind: string }[] = [
          { name: 'Titles', kind: 'video' },
          { name: 'Picture', kind: 'video' },
          { name: 'Audio', kind: 'audio' },
          { name: 'Captions', kind: 'caption' },
        ];
        let pos = 1;
        for (const { name, kind } of seedRows) {
          const rowId = `${id.slice(2)}-${name.toLowerCase()}`;
          await client.query('INSERT INTO rows (id, project_id, name, kind, position, locked) VALUES ($1,$2,$3,$4,$5,false)', [rowId, id, name, kind, pos]);
          pos++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        client.release();
        throw err;
      }
      client.release();
      const timeline = await loadTimeline(ctx.db, id);
      res.status(201).json(await projectJson(ctx, id, 'owner', timeline));
    })().catch((err) => respond(res, err));
  });

  r.get('/projects/:id', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const role = await memberRole(ctx, person.id, req.params.id!);
      const timeline = await loadTimeline(ctx.db, req.params.id!);
      res.json(await projectJson(ctx, req.params.id!, role, timeline));
    })().catch((err) => respond(res, err));
  });

  r.put('/projects/:id', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role !== 'owner') throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const opId = String(body.op_id ?? '');
      const baseVersion = Number(body.base_version ?? -1);
      const aspect = String(body.aspect_ratio ?? '');
      if (!isAspectRatio(aspect)) {
        throw ApiError.validation({ aspect_ratio: { key: 'aspect_ratio' } });
      }
      const output = await setAspectOp(ctx, projectId, aspect, { op_id: opId, base_version: baseVersion }, person);
      ctx.live.publishOp(projectId, {
        type: 'op',
        version: output.version,
        author: { id: output.author.id, name: output.author.name },
        op: { type: 'set_aspect', aspect_ratio: aspect },
        changes: output.changes,
        removed: [],
        stopped: null,
      });
      res.json(opResponse(output, { aspect_ratio: aspect }));
    })().catch((err) => respond(res, err));
  });

  r.get('/projects/:id/ops', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      await memberRole(ctx, person.id, projectId);
      const after = Number(req.query.after ?? 0);
      const rows = await ctx.db.query(
        `SELECT version, person_id, person_name, op_type, op FROM ops
         WHERE project_id = $1 AND version > $2 ORDER BY version`,
        [projectId, Number.isFinite(after) ? after : 0],
      );
      res.json({
        ops: rows.rows.map((row: Record<string, unknown>) => ({
          version: row.version,
          author: { id: row.person_id, name: row.person_name },
          op: row.op,
        })),
      });
    })().catch((err) => respond(res, err));
  });

  r.post('/projects/:id/ops', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role === 'commenter') throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      if (body.type === 'set_aspect' || body.type === 'restore_cut') {
        throw ApiError.validation({ type: { key: 'other' } });
      }
      const opId = String(body.op_id ?? '');
      if (opId.length < 1 || opId.length > 64) {
        throw ApiError.validation({ op_id: { key: 'other' } });
      }
      const output = await runOp(ctx, projectId, { ...body, op_id: opId, base_version: Number(body.base_version ?? -1) }, person);
      await rememberOp(ctx, projectId, person.id, opId, output);
      ctx.live.publishOp(projectId, {
        type: 'op',
        version: output.version,
        author: { id: output.author.id, name: output.author.name },
        op: { ...body, type: String(body.type ?? '') },
        changes: { clips: output.changes.clips, captions: output.changes.captions, comments: [], rows: output.changes.rows },
        removed: output.removed,
        stopped: output.stopped,
      });
      res.json(opResponse(output));
    })().catch((err) => respond(res, err));
  });

  r.post('/projects/:id/undo', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role === 'commenter') throw new ApiError('forbidden');
      const output = await runUndo(ctx, projectId, person);
      ctx.live.publishOp(projectId, {
        type: 'op',
        version: output.version,
        author: { id: output.author.id, name: output.author.name },
        op: { type: output.opType },
        changes: output.changes,
        removed: output.removed,
        stopped: output.stopped,
      });
      res.json(opResponse(output));
    })().catch((err) => respond(res, err));
  });

  r.post('/projects/:id/redo', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role === 'commenter') throw new ApiError('forbidden');
      const output = await runRedo(ctx, projectId, person);
      ctx.live.publishOp(projectId, {
        type: 'op',
        version: output.version,
        author: { id: output.author.id, name: output.author.name },
        op: { type: output.opType },
        changes: output.changes,
        removed: output.removed,
        stopped: output.stopped,
      });
      res.json(opResponse(output));
    })().catch((err) => respond(res, err));
  });

  r.get('/projects/:id/frames/:frame', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      await memberRole(ctx, person.id, projectId);
      res.json(await frameLayers(ctx, projectId, Number(req.params.frame!)));
    })().catch((err) => respond(res, err));
  });

  r.get('/projects/:id/members', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      await memberRole(ctx, person.id, projectId);
      const rows = await ctx.db.query(
        `SELECT p.id, p.name, p.email, p.handle, m.role FROM members m JOIN people p ON p.id = m.person_id
         WHERE m.project_id = $1`,
        [projectId],
      );
      res.json({ items: rows.rows.map((row: Record<string, unknown>) => ({ person: { id: row.id, name: row.name, email: row.email, handle: row.handle }, role: row.role })) });
    })().catch((err) => respond(res, err));
  });

  r.post('/projects/:id/members', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role !== 'owner') throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const email = String(body.email ?? '').trim();
      const memberRoleReq = String(body.role ?? '');
      if (memberRoleReq !== 'editor' && memberRoleReq !== 'commenter') {
        throw ApiError.validation({ role: { key: 'other' } });
      }
      const target = await ctx.db.query('SELECT id, name, email, handle FROM people WHERE lower(email) = lower($1)', [email]);
      if ((target.rowCount ?? 0) === 0) {
        throw ApiError.validation({ email: { key: 'email' } });
      }
      const t = target.rows[0]!;
      await ctx.db.query(
        `INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (project_id, person_id) DO UPDATE SET role = $3`,
        [projectId, t.id, memberRoleReq],
      );
      await announceRole(ctx, projectId, t.id);
      res.status(201).json({ person: { id: t.id, name: t.name, email: t.email, handle: t.handle }, role: memberRoleReq });
    })().catch((err) => respond(res, err));
  });

  r.put('/projects/:id/members/:personId', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role !== 'owner') throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const newRole = String(body.role ?? '');
      if (newRole !== 'editor' && newRole !== 'commenter') {
        throw ApiError.validation({ role: { key: 'other' } });
      }
      await ctx.db.query('UPDATE members SET role = $3 WHERE project_id = $1 AND person_id = $2', [projectId, req.params.personId, newRole]);
      await announceRole(ctx, projectId, req.params.personId!);
      const rows = await ctx.db.query('SELECT id, name, email, handle FROM people WHERE id = $1', [req.params.personId]);
      res.json({ person: rows.rows[0], role: newRole });
    })().catch((err) => respond(res, err));
  });

  r.delete('/projects/:id/members/:personId', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role !== 'owner') throw new ApiError('forbidden');
      await ctx.db.query('DELETE FROM members WHERE project_id = $1 AND person_id = $2', [projectId, req.params.personId]);
      await announceRole(ctx, projectId, req.params.personId!);
      res.status(204).end();
    })().catch((err) => respond(res, err));
  });

  return r;
}

export async function memberRole(ctx: AppCtx, personId: string, projectId: string): Promise<Role> {
  const res = await ctx.db.query<{ role: string }>('SELECT role FROM members WHERE project_id = $1 AND person_id = $2', [projectId, personId]);
  if ((res.rowCount ?? 0) === 0) throw new ApiError('not_found');
  const role = res.rows[0]!.role;
  if (role === 'owner' || role === 'editor' || role === 'commenter') return role;
  throw new ApiError('not_found');
}

function validateProjectBody(body: Record<string, unknown>): { title: string; agency: string; description: string; frameRate: string; aspectRatio: string } {
  const title = String(body.title ?? '').trim();
  const agency = String(body.agency ?? '').trim();
  const description = String(body.description ?? '');
  const frameRate = String(body.frame_rate ?? '');
  const aspectRatio = String(body.aspect_ratio ?? '');
  const errors: Record<string, { key: 'title' | 'frame_rate' | 'aspect_ratio' }> = {};
  if (codePoints(title) < 1 || codePoints(title) > 80) errors.title = { key: 'title' };
  if (!isFrameRate(frameRate)) errors.frame_rate = { key: 'frame_rate' };
  if (!isAspectRatio(aspectRatio)) errors.aspect_ratio = { key: 'aspect_ratio' };
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);
  return { title, agency, description, frameRate, aspectRatio };
}

export async function projectSummary(ctx: AppCtx, row: { id: string; title: string; agency: string; description: string; frame_rate: string; aspect_ratio: string; time_unit: string; version: number; role: string }): Promise<Project> {
  const timeline = await loadTimeline(ctx.db, row.id);
  const size = aspectSize(row.aspect_ratio);
  const lastCut = await ctx.db.query(
    'SELECT id, name, total_frames FROM cuts WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
    [row.id],
  );
  const markers = await ctx.db.query('SELECT frame, label FROM markers WHERE project_id = $1 ORDER BY frame', [row.id]);
  const rate = row.frame_rate;
  return {
    id: row.id,
    title: row.title,
    agency: row.agency,
    description: row.description,
    frame_rate: rate,
    aspect_ratio: row.aspect_ratio,
    width: size.width,
    height: size.height,
    time_unit: 'frames',
    version: row.version,
    total_frames: timeline?.totalFrames ?? 0,
    role: row.role as Role,
    markers: markers.rows.map((m: { frame: number; label: string }) => ({ frame: Number(m.frame), label: m.label })),
    last_cut: lastCut.rows[0] ?? null,
  };
}

export async function projectJson(ctx: AppCtx, projectId: string, role: Role, timeline: Awaited<ReturnType<typeof loadTimeline>>): Promise<Record<string, unknown>> {
  const meta = await ctx.db.query(
    'SELECT id, title, agency, description, frame_rate, aspect_ratio, time_unit, version FROM projects WHERE id = $1',
    [projectId],
  );
  const m = meta.rows[0]!;
  const size = aspectSize(m.aspect_ratio);
  const markers = await ctx.db.query('SELECT frame, label FROM markers WHERE project_id = $1 ORDER BY frame', [projectId]);
  const lastCut = await ctx.db.query('SELECT id, name, total_frames FROM cuts WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1', [projectId]);
  const members = await ctx.db.query(
    `SELECT p.id, p.name, p.email, p.handle, m.role FROM members m JOIN people p ON p.id = m.person_id WHERE m.project_id = $1`,
    [projectId],
  );
  return {
    project: {
      id: m.id, title: m.title, agency: m.agency, description: m.description,
      frame_rate: m.frame_rate, aspect_ratio: m.aspect_ratio,
      width: size.width, height: size.height,
      time_unit: 'frames', version: m.version,
      total_frames: timeline?.totalFrames ?? 0,
      role,
      markers: markers.rows.map((mk: { frame: number; label: string }) => ({ frame: Number(mk.frame), label: mk.label })),
      last_cut: lastCut.rows[0] ?? null,
    },
    rows: timeline?.rows ?? [],
    clips: timeline?.clips ?? [],
    captions: timeline?.captions ?? [],
    members: members.rows.map((row: Record<string, unknown>) => ({
      person: { id: row.id, name: row.name, email: row.email, handle: row.handle },
      role: row.role,
    })),
  };
}

export async function frameLayers(ctx: AppCtx, projectId: string, frame: number): Promise<Record<string, unknown>> {
  const timeline = await loadTimeline(ctx.db, projectId);
  if (timeline === null) throw new ApiError('not_found');
  const layers = await computeFrameLayers(ctx, timeline, frame);
  return {
    frame,
    timecode: timecode(frame, timeline.meta.frame_rate),
    layers,
  };
}

// Layers are computed in one place for the frame endpoint and the stage.
export async function computeFrameLayers(ctx: AppCtx, timeline: NonNullable<Awaited<ReturnType<typeof loadTimeline>>>, frame: number): Promise<unknown[]> {
  const mediaRes = await ctx.db.query('SELECT id, width, height FROM media');
  const mediaDims = new Map(mediaRes.rows.map((row: { id: string; width: number; height: number }) => [row.id, { width: row.width, height: row.height }]));
  const { fittedBox, layerValuesAt, baseDefaults } = await import('../shared/keyframes');
  const defaults = baseDefaults(timeline.width, timeline.height);
  const layers: Record<string, unknown>[] = [];
  const rowPos = new Map(timeline.rows.map((r) => [r.id, r.position]));
  const drawn = timeline.clips
    .filter((c) => !c.hidden && frame >= c.start_frame && frame < c.end_frame)
    .sort((a, b) => (rowPos.get(a.row_id) ?? 0) - (rowPos.get(b.row_id) ?? 0));
  for (const clip of drawn) {
    const values = layerValuesAt(clip.keyframes, frame - clip.start_frame, defaults);
    let box: { width: number; height: number };
    if (clip.kind === 'text') {
      const tb = (await import('../shared/keyframes')).textBox(timeline.width, timeline.height);
      box = tb;
    } else {
      const dims = clip.media_id !== null ? mediaDims.get(clip.media_id) : undefined;
      box = dims ?? { width: timeline.width, height: timeline.height };
    }
    const fitted = fittedBox(box.width, box.height, timeline.width, timeline.height, values.scale, values.x, values.y);
    layers.push({
      clip_id: clip.id,
      row_id: clip.row_id,
      x: Math.round(fitted.x * 100) / 100,
      y: Math.round(fitted.y * 100) / 100,
      width: Math.round(fitted.width * 100) / 100,
      height: Math.round(fitted.height * 100) / 100,
      scale: values.scale,
      rotation: values.rotation,
      opacity: values.opacity,
    });
  }
  return layers;
}


async function announceRole(ctx: AppCtx, projectId: string, personId: string): Promise<void> {
  const rows = await ctx.db.query<{ role: string | null }>(
    'SELECT role FROM members WHERE project_id = $1 AND person_id = $2',
    [projectId, personId],
  );
  const role = (rows.rowCount ?? 0) > 0 ? rows.rows[0]!.role : null;
  ctx.live.roleChanged(projectId, personId, role);
}

function opResponse(output: OpOutput, extra?: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    version: output.version,
    changes: output.changes,
    removed: output.removed,
    stopped: output.stopped,
  };
  if (output.project !== undefined) body.project = output.project;
  return { ...body, ...(extra ?? {}) };
}
