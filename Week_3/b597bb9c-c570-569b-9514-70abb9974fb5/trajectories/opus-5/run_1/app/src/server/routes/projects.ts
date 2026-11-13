import { ApiError } from '../../domain/api-error.js';
import { layersAtFrame } from '../../domain/layers.js';
import { isPublicOpType } from '../../domain/ops-apply.js';
import { exactRate, isFrameRateName, timecode } from '../../domain/rate.js';
import { asLayerClip } from '../../domain/timeline-state.js';
import { codePoints, invalid, readString } from '../../domain/validate.js';
import { pool, query } from '../db.js';
import { jsonBody, notFound, requireOwner, requireSigned, sendEmpty, sendJson, type Route } from '../http.js';
import { broadcastOp, closeForRoleChange } from '../live.js';
import { randomId } from '../ids.js';
import { loadMediaInfo } from '../repo/media.js';
import { nextRedoEntry, nextUndoEntry, performOp } from '../repo/ops.js';
import { peopleOnProject, personByEmail, publicPerson } from '../repo/people.js';
import {
  loadProject,
  projectRecord,
  projectsFor,
  publicCaption,
  publicClip,
  type ProjectRow,
} from '../repo/projects.js';
import { ANY_ROLE, EDITORS, loadedProjectAccess, OWNER_ONLY, projectAccess } from './guards.js';
import { isAspectRatio, type Role } from '../../shared/types.js';

async function lastCutOf(projectId: string): Promise<{ id: string; name: string; total_frames: number } | null> {
  const cuts = await query<{ id: string; name: string; total_frames: number }>(
    `select id, name, total_frames from cuts where project_id = $1 order by created_at desc, id desc limit 1`,
    [projectId],
  );
  return cuts.length > 0 ? cuts[0] : null;
}

async function projectPayload(row: ProjectRow, role: Role): Promise<ReturnType<typeof projectRecord>> {
  const media = await loadMediaInfo();
  const loaded = await loadProject(pool, row.id, media);
  if (loaded === null) throw notFound();
  return projectRecord(loaded, role, await lastCutOf(row.id));
}

export const projectRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/projects',
    auth: 'session',
    handle: async (context) => {
      const signed = requireSigned(context);
      const projects = await projectsFor(signed.person.id, signed.is_owner);
      const items = [];
      for (const project of projects) items.push(await projectPayload(project.row, project.role));
      sendJson(context.response, 200, { items });
    },
  },
  {
    method: 'POST',
    path: '/api/projects',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const signed = requireOwner(context);
      const body = jsonBody(context);
      const errors: Record<string, string> = {};
      const title = typeof body.title === 'string' ? body.title : '';
      if (codePoints(title) < 1 || codePoints(title) > 80) errors.title = 'Give the project a title of 1 to 80 characters.';
      if (!isFrameRateName(body.frame_rate)) errors.frame_rate = 'Choose a frame rate from the list.';
      if (!isAspectRatio(body.aspect_ratio)) errors.aspect_ratio = 'Choose an aspect ratio from the list.';
      if (Object.keys(errors).length > 0) throw ApiError.validation(errors);
      const agency = typeof body.agency === 'string' ? body.agency : '';
      const description = typeof body.description === 'string' ? body.description : '';
      const id = randomId('proj');
      await query(
        `insert into projects (id, title, agency, description, frame_rate, aspect_ratio, time_unit, version, seed_order)
         values ($1,$2,$3,$4,$5,$6,'frames',1,(select coalesce(max(seed_order),0)+1 from projects))`,
        [id, title, agency, description, body.frame_rate, body.aspect_ratio],
      );
      const rows: [string, string][] = [
        ['Titles', 'video'],
        ['Picture', 'video'],
        ['Audio', 'audio'],
        ['Captions', 'caption'],
      ];
      for (const [index, row] of rows.entries()) {
        await query(`insert into project_rows (id, project_id, name, kind, position, locked) values ($1,$2,$3,$4,$5,false)`, [
          randomId('row'),
          id,
          row[0],
          row[1],
          index + 1,
        ]);
      }
      await query(`insert into members (project_id, person_id, role) values ($1,$2,'owner')`, [id, signed.person.id]);
      const created = await query<ProjectRow>(
        `select id, title, agency, description, frame_rate, aspect_ratio, time_unit, version, seed_order, updated_at
         from projects where id = $1`,
        [id],
      );
      sendJson(context.response, 201, await projectPayload(created[0], 'owner'));
    },
  },
  {
    method: 'GET',
    path: '/api/projects/{id}',
    auth: 'session',
    handle: async (context) => {
      const access = await loadedProjectAccess(context, ANY_ROLE);
      const members = await peopleOnProject(access.projectId);
      sendJson(context.response, 200, {
        project: projectRecord(access.loaded, access.role, await lastCutOf(access.projectId)),
        rows: access.loaded.state.rows,
        clips: access.loaded.state.clips.map(publicClip),
        captions: access.loaded.state.captions.map(publicCaption),
        members: members.map((member) => ({ person: publicPerson(member.person), role: member.role })),
      });
    },
  },
  {
    method: 'PUT',
    path: '/api/projects/{id}',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await projectAccess(context, OWNER_ONLY);
      const body = jsonBody(context);
      const opId = readString(body, 'op_id', { min: 1, max: 64 });
      const baseVersion = typeof body.base_version === 'number' ? body.base_version : 0;
      if (!isAspectRatio(body.aspect_ratio)) throw invalid('aspect_ratio');
      const outcome = await performOp({
        projectId: access.projectId,
        author: { id: access.signed.person.id, name: access.signed.person.name },
        role: access.role,
        opId,
        baseVersion,
        type: 'set_aspect',
        body: { aspect_ratio: body.aspect_ratio },
      });
      const media = await loadMediaInfo();
      const loaded = await loadProject(pool, access.projectId, media);
      const project = loaded === null ? undefined : projectRecord(loaded, access.role, await lastCutOf(access.projectId));
      broadcastOp(access.projectId, {
        version: outcome.result.version,
        author: outcome.author,
        op: { type: 'set_aspect', aspect_ratio: body.aspect_ratio },
        changes: outcome.result.changes,
        removed: outcome.result.removed,
        project,
      });
      sendJson(context.response, outcome.status, { ...outcome.result, project });
    },
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/ops',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, ANY_ROLE);
      const after = Number(context.url.searchParams.get('after') ?? '0');
      if (!Number.isInteger(after) || after < 0) throw invalid('after');
      const ops = await query<{
        version: number;
        author_id: string;
        name: string;
        op: Record<string, unknown>;
        changes: unknown;
        removed: string[];
      }>(
        `select o.version, o.author_id, p.name, o.op, o.changes, o.removed from ops o join people p on p.id = o.author_id
         where o.project_id = $1 and o.version > $2 order by o.version`,
        [access.projectId, after],
      );
      sendJson(context.response, 200, {
        ops: ops.map((op) => ({
          version: op.version,
          author: { id: op.author_id, name: op.name },
          op: op.op,
          changes: op.changes,
          removed: op.removed,
        })),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/ops',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await projectAccess(context, EDITORS);
      const body = jsonBody(context);
      const opId = readString(body, 'op_id', { min: 1, max: 64 });
      const baseVersion = typeof body.base_version === 'number' ? body.base_version : 0;
      if (!isPublicOpType(body.type)) throw invalid('type');
      const { op_id: _op, base_version: _base, type, ...rest } = body;
      void _op;
      void _base;
      const outcome = await performOp({
        projectId: access.projectId,
        author: { id: access.signed.person.id, name: access.signed.person.name },
        role: access.role,
        opId,
        baseVersion,
        type: type as string,
        body: rest,
      });
      broadcastOp(access.projectId, {
        version: outcome.result.version,
        author: outcome.author,
        op: { ...rest, type: type as string },
        changes: outcome.result.changes,
        removed: outcome.result.removed,
      });
      sendJson(context.response, outcome.status, outcome.result);
    },
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/undo',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await projectAccess(context, EDITORS);
      const body = jsonBody(context);
      const opId = readString(body, 'op_id', { min: 1, max: 64 });
      const entry = await nextUndoEntry(access.projectId, access.signed.person.id);
      if (entry === null) throw ApiError.of('nothing_to_undo', undefined);
      const current = await query<{ version: number }>(`select version from projects where id = $1`, [access.projectId]);
      const outcome = await performOp({
        projectId: access.projectId,
        author: { id: access.signed.person.id, name: access.signed.person.name },
        role: access.role,
        opId,
        baseVersion: current[0].version,
        type: entry.inverse.type,
        body: entry.inverse,
        entry: { id: entry.id, mode: 'undo' },
      });
      broadcastOp(access.projectId, {
        version: outcome.result.version,
        author: outcome.author,
        op: { type: entry.inverse.type },
        changes: outcome.result.changes,
        removed: outcome.result.removed,
      });
      sendJson(context.response, outcome.status, outcome.result);
    },
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/redo',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await projectAccess(context, EDITORS);
      const body = jsonBody(context);
      const opId = readString(body, 'op_id', { min: 1, max: 64 });
      const entry = await nextRedoEntry(access.projectId, access.signed.person.id);
      if (entry === null) throw ApiError.of('nothing_to_redo', undefined);
      const current = await query<{ version: number }>(`select version from projects where id = $1`, [access.projectId]);
      const outcome = await performOp({
        projectId: access.projectId,
        author: { id: access.signed.person.id, name: access.signed.person.name },
        role: access.role,
        opId,
        baseVersion: current[0].version,
        type: entry.forward.type,
        body: entry.forward,
        entry: { id: entry.id, mode: 'redo' },
      });
      broadcastOp(access.projectId, {
        version: outcome.result.version,
        author: outcome.author,
        op: { type: entry.forward.type },
        changes: outcome.result.changes,
        removed: outcome.result.removed,
      });
      sendJson(context.response, outcome.status, outcome.result);
    },
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/frames/{frame}',
    auth: 'session',
    handle: async (context) => {
      const access = await loadedProjectAccess(context, ANY_ROLE);
      const frame = Number(context.params.frame);
      if (!Number.isInteger(frame) || frame < 0) throw invalid('frame');
      const rate = exactRate(access.loaded.row.frame_rate);
      const clips = access.loaded.state.clips.map((clip) => asLayerClip(clip, access.media));
      sendJson(context.response, 200, {
        frame,
        timecode: timecode(frame, rate),
        layers: layersAtFrame(clips, access.loaded.state.rows, frame, access.loaded.row.aspect_ratio),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/members',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, ANY_ROLE);
      const members = await peopleOnProject(access.projectId);
      sendJson(context.response, 200, {
        items: members.map((member) => ({ person: publicPerson(member.person), role: member.role })),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/members',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await projectAccess(context, OWNER_ONLY);
      const body = jsonBody(context);
      const email = typeof body.email === 'string' ? body.email : '';
      const role = body.role;
      if (role !== 'editor' && role !== 'commenter') throw invalid('role');
      const person = await personByEmail(email);
      if (person === null) throw ApiError.validation({ email: 'No Gatecut account uses that email.' });
      await query(
        `insert into members (project_id, person_id, role) values ($1,$2,$3)
         on conflict (project_id, person_id) do update set role = excluded.role`,
        [access.projectId, person.id, role],
      );
      sendJson(context.response, 201, { person: publicPerson(person), role });
    },
  },
  {
    method: 'PUT',
    path: '/api/projects/{id}/members/{person_id}',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await projectAccess(context, OWNER_ONLY);
      const body = jsonBody(context);
      const role = body.role;
      if (role !== 'editor' && role !== 'commenter') throw invalid('role');
      const personId = context.params.person_id;
      const updated = await query<{ person_id: string }>(
        `update members set role = $3 where project_id = $1 and person_id = $2 returning person_id`,
        [access.projectId, personId, role],
      );
      if (updated.length === 0) throw notFound();
      const members = await peopleOnProject(access.projectId);
      const member = members.find((candidate) => candidate.person.id === personId);
      closeForRoleChange(access.projectId, personId, role);
      sendJson(context.response, 200, { person: member ? publicPerson(member.person) : null, role });
    },
  },
  {
    method: 'DELETE',
    path: '/api/projects/{id}/members/{person_id}',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, OWNER_ONLY);
      const personId = context.params.person_id;
      const removed = await query<{ person_id: string }>(
        `delete from members where project_id = $1 and person_id = $2 returning person_id`,
        [access.projectId, personId],
      );
      if (removed.length === 0) throw notFound();
      closeForRoleChange(access.projectId, personId, null);
      sendEmpty(context.response, 204);
    },
  },
];
