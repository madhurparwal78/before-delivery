import { Router } from 'express';
import { query } from './db';
import { env } from './env';
import { ObjectStore } from './objectstore';
import { publishProject } from './routes-tasks';
import { AuthedRequest, readBody, BODY_MAX } from './apiutil';
import { requireAuth } from './auth';
import { projectTeam } from './access';
import { TaskRow } from './taskjson';

export function filesRouter(store: ObjectStore): Router {
  const r = Router();

  r.post('/api/projects/:id/files', requireAuth(), readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const pid = String(req.params.id);
    const ctx = await projectTeam(pid, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const body = req.body as { format?: unknown };
    const format = body.format === 'csv' || body.format === 'json' ? body.format : null;
    if (!format) { res.status(422).json({ errors: { format: 'Choose csv or json' } }); return; }
    const ins = await query<{ id: string }>(
      `INSERT INTO project_files (project_id, format) VALUES ($1,$2) RETURNING id`, [pid, format]);
    const id = ins.rows[0].id;
    res.status(202).json({ id, status: 'preparing' });
    void (async () => {
      const key = `exports/${pid}/${id}.${format}`;
      try {
        const data = format === 'csv' ? await buildCsv(pid) : await buildJson(pid);
        await store.put(key, Buffer.from(data, 'utf8'), format === 'csv' ? 'text/csv' : 'application/json');
        const ok = await store.exists(key);
        if (!ok) throw new Error('not confirmed');
        await query(`UPDATE project_files SET status = 'ready', object_key = $1 WHERE id = $2`, [key, id]);
      } catch {
        await query(`UPDATE project_files SET status = 'failed', error = 'storage_unavailable' WHERE id = $1`, [id]);
      }
    })();
  });

  r.get('/api/files/:id', requireAuth(), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const row = (await query<{ id: string; status: string; format: string; object_key: string | null; error: string | null; project_id: string }>(
      `SELECT * FROM project_files WHERE id = $1`, [id])).rows[0];
    if (!row) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(row.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const out: Record<string, unknown> = { id: row.id, status: row.status, format: row.format };
    if (row.status === 'ready') out.url = `/api/files/${row.id}/download`;
    if (row.status === 'failed') out.error = row.error;
    res.json(out);
  });

  r.get('/api/files/:id/download', requireAuth(), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const row = (await query<{ id: string; status: string; format: string; object_key: string | null; project_id: string }>(
      `SELECT * FROM project_files WHERE id = $1`, [id])).rows[0];
    if (!row) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(row.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    if (row.status !== 'ready' || !row.object_key) { res.status(404).json({ error: 'not_found' }); return; }
    try {
      const data = await store.get(row.object_key);
      if (!data) { res.status(404).json({ error: 'not_found' }); return; }
      res.setHeader('content-type', row.format === 'csv' ? 'text/csv' : 'application/json');
      res.setHeader('content-disposition', `attachment; filename="project.${row.format}"`);
      res.send(data);
    } catch {
      res.status(503).json({ error: 'storage_unavailable' });
    }
  });

  r.post('/api/tasks/:id/attachments', requireAuth(), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const task = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(task.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const cap = env().limits.uploadMaxBytes;
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    let ended = false;
    let fields: Record<string, string> = {};
    let filename = '';
    let contentType = 'application/octet-stream';
    let fileData: Buffer | null = null;

    const parseMultipart = (): void => {
      const ct = req.headers['content-type'] ?? '';
      const m = /boundary=(.+)$/.exec(ct);
      if (!m) return;
      const boundary = Buffer.from(`--${m[1]}`);
      const buf = Buffer.concat(chunks);
      let idx = buf.indexOf(boundary);
      while (idx !== -1) {
        const next = buf.indexOf(boundary, idx + boundary.length);
        if (next === -1) break;
        const part = buf.slice(idx + boundary.length + 2, next - 2);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const headerText = part.slice(0, headerEnd).toString('utf8');
          const body = part.slice(headerEnd + 4);
          const nameM = /name="([^"]+)"/.exec(headerText);
          const fileM = /filename="([^"]*)"/.exec(headerText);
          if (nameM) {
            if (fileM && nameM[1] === 'file') {
              filename = fileM[1];
              fileData = body;
              const ctM = /content-type:\s*([^\r\n]+)/i.exec(headerText);
              contentType = ctM ? ctM[1].trim() : 'application/octet-stream';
            } else {
              fields[nameM[1]] = body.toString('utf8');
            }
          }
        }
        idx = next;
      }
    };

    req.on('data', (c: Buffer) => {
      if (ended) return;
      size += c.length;
      if (size > cap) {
        tooBig = true;
        ended = true;
        res.status(413).json({ error: 'file_too_large' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (ended) return;
      ended = true;
      parseMultipart();
      if (!filename || !fileData) {
        res.status(422).json({ errors: { file: 'Choose a file to attach' } });
        return;
      }
      const attId = (await query<{ id: string }>(
        `INSERT INTO attachments (task_id, name, size, content_type, object_key) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [id, filename, fileData.length, contentType, 'pending'])).rows[0];
      const key = `attachments/${id}/${attId.id}/${filename}`;
      try {
        await store.put(key, fileData, contentType);
        await query(`UPDATE attachments SET object_key = $1 WHERE id = $2`, [key, attId.id]);
        publishProject(ctx.teamId, 'attachment', { taskId: id });
        res.status(201).json({ id: attId.id, name: filename, size: fileData.length, contentType });
      } catch {
        await query(`DELETE FROM attachments WHERE id = $1`, [attId.id]);
        res.status(503).json({ error: 'storage_unavailable' });
      }
    });
  });

  r.get('/api/attachments/:id', requireAuth(), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const row = (await query<{ task_id: string; name: string; content_type: string; object_key: string }>(
      `SELECT * FROM attachments WHERE id = $1`, [id])).rows[0];
    if (!row) { res.status(404).json({ error: 'not_found' }); return; }
    const task = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [row.task_id])).rows[0];
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(task.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    try {
      const data = await store.get(row.object_key);
      if (!data) { res.status(404).json({ error: 'not_found' }); return; }
      res.setHeader('content-type', row.content_type);
      res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(row.name)}"`);
      res.send(data);
    } catch {
      res.status(503).json({ error: 'storage_unavailable' });
    }
  });

  return r;
}

async function csvEscape(v: string): Promise<string> {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

async function buildCsv(pid: string): Promise<string> {
  const secs = await query<{ id: string; name: string }>(`SELECT id, name FROM sections WHERE project_id = $1 ORDER BY position`, [pid]);
  const tasks = await query<TaskRow>(`SELECT * FROM tasks WHERE project_id = $1 ORDER BY section_id, position`, [pid]);
  const people = await query<{ id: string; email: string }>(`SELECT id, email FROM people`, []);
  const emailOf = new Map(people.rows.map(p => [p.id, p.email]));
  const secName = new Map(secs.rows.map(s => [s.id, s.name]));
  const lines = ['id,name,section,assignee_email,start,due,effort_hours,completed,parent_id'];
  for (const t of tasks.rows) {
    const row = [
      t.id, await csvEscape(t.name), await csvEscape(secName.get(t.section_id) ?? ''),
      emailOf.get(t.assignee_id ?? '') ?? '',
      t.start_date ?? '', t.due_date ?? '',
      t.effort === null ? '' : String(t.effort),
      t.completed ? 'true' : 'false',
      t.parent_id ?? '',
    ];
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

async function buildJson(pid: string): Promise<string> {
  const proj = (await query<{ id: string; name: string }>(`SELECT id, name FROM projects WHERE id = $1`, [pid])).rows[0];
  const secs = await query<{ id: string; name: string; position: number }>(`SELECT id, name, position FROM sections WHERE project_id = $1 ORDER BY position`, [pid]);
  const tasks = await query<TaskRow>(`SELECT * FROM tasks WHERE project_id = $1 ORDER BY section_id, position`, [pid]);
  const people = await query<{ id: string; email: string }>(`SELECT id, email FROM people`, []);
  const emailOf = new Map(people.rows.map(p => [p.id, p.email]));
  const out = {
    schema: 'everyweek.project/1',
    project: { id: proj.id, name: proj.name },
    sections: secs.rows,
    tasks: tasks.rows.map(t => ({
      id: t.id,
      name: t.name,
      section: t.section_id,
      assignee_email: emailOf.get(t.assignee_id ?? '') ?? null,
      start: t.start_date,
      due: t.due_date,
      effort_hours: t.effort === null ? null : Number(t.effort),
      completed: t.completed,
      parent_id: t.parent_id,
    })),
  };
  return JSON.stringify(out, null, 2);
}
