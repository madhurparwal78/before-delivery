import {
  Controller, Get, Post, Patch, Delete, Req, Res, HttpCode,
} from '@nestjs/common';
import { pool } from './db.mjs';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  userForToken, mintInviteToken, SESSION_COOKIE, sessionCookie, clearSessionCookie,
} from './tokens.mjs';
import { sendMail, invitationEmail, enquirySalesEmail, enquiryAckEmail } from './email.mjs';
import { drawArt } from '../art.mjs';
import {
  PLANS, MODELS, EXAMPLES, PLAN_LIMITS, modelById, generationCost, SEAT_CREDITS, SEAT_LIMIT,
} from '../content.mjs';
import {
  checkName, checkEmail, checkPassword, checkProjectName, checkPrompt,
  checkCompany, checkCompanySize, checkIndustry, checkMessage, checkProducts,
  checkGenerationFields,
} from './validation.mjs';

// ---------------------------------------------------------------- helpers

function statusError(status, payload) {
  const e = new Error(payload && payload.error ? payload.error : 'error');
  e.status = status;
  e.payload = payload;
  return e;
}

const errors422 = (errors) => statusError(422, { errors });
const insufficiency = (needed, balance) => statusError(402, { error: 'insufficient_credits', needed, balance });
const parallelReached = (limit) => statusError(409, { error: 'parallel_limit', limit });
const projectLimitReached = (limit) => statusError(409, { error: 'project_limit', limit });
const duplicateName = () => statusError(409, { error: 'duplicate_name' });

async function balanceOf(wsId) {
  const { rows } = await pool.query('SELECT COALESCE(SUM(amount),0) AS b FROM credit_entries WHERE workspace_id = $1', [wsId]);
  return rows[0].b;
}

async function startedBy(userId) {
  const { rows } = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
  return rows[0]?.name || 'Unknown';
}

async function serialiseGeneration(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    model: row.model,
    prompt: row.prompt,
    duration: row.duration,
    image_count: row.image_count,
    aspect: row.aspect,
    cost: row.cost,
    status: row.status,
    started_by: await startedBy(row.user_id),
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}

async function serialiseProject(row) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS c, MAX(created_at) AS latest FROM generations WHERE project_id = $1`, [row.id]);
  return {
    id: row.id,
    name: row.name,
    generation_count: Number(rows[0].c),
    latest_generation_at: rows[0].latest,
    created_at: row.created_at,
  };
}

function serialiseUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

function serialiseWorkspace(u) {
  return { id: u.workspace_id, name: u.workspace_name, plan: u.workspace_plan };
}

async function creditEntries(wsId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.kind, e.amount, e.balance_after, u.name AS user_name, e.generation_id, e.created_at
       FROM credit_entries e JOIN users u ON u.id = e.user_id
      WHERE e.workspace_id = $1 ORDER BY e.id DESC`, [wsId]);
  return rows;
}

/** Read the bearer token from the header or the session cookie. */
function tokenFrom(req) {
  const h = req.headers['authorization'];
  if (typeof h === 'string' && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const c = req.headers.cookie;
  if (typeof c === 'string') {
    for (const part of c.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === SESSION_COOKIE && v.length) return decodeURIComponent(v.join('='));
    }
  }
  return null;
}

const needAuth = async (req) => {
  const u = await userForToken(tokenFrom(req));
  if (!u) throw statusError(401, { error: 'unauthorized' });
  return u;
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

/** One transaction that locks the workspace first, so money changes serialise. */
async function withWorkspaceTx(wsId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (wsId != null) {
      await client.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [wsId]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function lockedBalance(client, wsId) {
  const { rows } = await client.query(
    'SELECT COALESCE(SUM(amount),0) AS b FROM credit_entries WHERE workspace_id = $1', [wsId]);
  return rows[0].b;
}

// ---------------------------------------------------------------- controller

@Controller('api')
export class ApiController {
  // ---- catalogue -----------------------------------------------------

  @Get('health')
  async health() {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  }

  @Get('plans')
  async plans() {
    return PLANS.map(p => ({
      id: p.id, name: p.name, monthly_price: p.monthly_price, yearly_price: p.yearly_price,
      credits: p.credits, parallel_limit: p.parallel_limit, project_limit: p.project_limit,
    }));
  }

  @Get('models')
  models() {
    return MODELS.map(m => ({ id: m.id, name: m.name, kind: m.kind, credits_per_unit: m.credits_per_unit }));
  }

  @Get('examples')
  examples(@Req() req) {
    const { category, search } = req.query;
    let items = EXAMPLES;
    if (typeof category === 'string' && category && category !== 'all') {
      items = items.filter(e => e.category === category);
    }
    if (typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(e => e.heading.toLowerCase().includes(q) || e.prompt.toLowerCase().includes(q));
    }
    return { items, total: items.length };
  }

  // ---- enquiries -----------------------------------------------------

  @Post('enquiries')
  async createEnquiry(@Req() req, @Res() res) {
    const body = await readBody(req);
    const source = body.source;
    if (source !== 'contact' && source !== 'licensing') {
      throw errors422({ source: 'Choose an enquiry source.' });
    }
    const errors = {};
    if (source === 'contact') {
      const fn = checkName(body.first_name, 'First name'); if (fn) errors.first_name = fn;
      const ln = checkName(body.last_name, 'Last name'); if (ln) errors.last_name = ln;
      const p = checkProducts(body.products); if (p) errors.products = p;
    } else {
      const fn = checkName(body.full_name, 'Full name'); if (fn) errors.full_name = fn;
    }
    const em = checkEmail(body.email); if (em) errors.email = em;
    const co = checkCompany(body.company); if (co) errors.company = co;
    const cs = checkCompanySize(body.company_size); if (cs) errors.company_size = cs;
    const ind = checkIndustry(body.industry); if (ind) errors.industry = ind;
    const ms = checkMessage(body.message); if (ms) errors.message = ms;
    if (Object.keys(errors).length) throw errors422(errors);

    const enquiry = {
      source,
      first_name: body.first_name || null,
      last_name: body.last_name || null,
      full_name: body.full_name || null,
      email: body.email.trim(),
      company: body.company.trim(),
      company_size: body.company_size,
      industry: body.industry,
      products: source === 'contact' ? body.products : null,
      message: body.message.trim(),
    };
    await pool.query(
      `INSERT INTO enquiries (source, first_name, last_name, full_name, email, company, company_size, industry, products, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [enquiry.source, enquiry.first_name, enquiry.last_name, enquiry.full_name, enquiry.email,
       enquiry.company, enquiry.company_size, enquiry.industry,
       enquiry.products ? enquiry.products.join(',') : null, enquiry.message]);
    await sendMail({ to: 'sales@example.com', ...enquirySalesEmail(enquiry) });
    await sendMail({ to: enquiry.email, ...enquiryAckEmail() });
    res.status(201).json(enquiry);
  }

  // ---- auth ----------------------------------------------------------

  @Post('auth/signup')
  async signup(@Req() req, @Res() res) {
    const body = await readBody(req);
    const errors = {};
    const n = checkName(body.name); if (n) errors.name = n;
    const e = checkEmail(body.email); if (e) errors.email = e;
    const p = checkPassword(body.password); if (p) errors.password = p;
    if (Object.keys(errors).length) throw errors422(errors);

    const email = body.email.trim();
    const name = body.name.trim();
    const { rows: taken } = await pool.query(
      'SELECT id FROM users WHERE email_ci = $1', [email.toLowerCase()]);
    if (taken.length) throw statusError(409, { error: 'An account with this email already exists.' });

    const userId = await withWorkspaceTx(null, async (client) => {
      const ws = await client.query(
        `INSERT INTO workspaces (name, plan) VALUES ($1, 'free') RETURNING id`,
        [`${name}'s workspace`]);
      const wsId = ws.rows[0].id;
      const user = await client.query(
        `INSERT INTO users (workspace_id, name, email, email_ci, password_hash, role)
         VALUES ($1,$2,$3,$4,$5,'owner') RETURNING id`,
        [wsId, name, email, email.toLowerCase(), await hashPassword(body.password)]);
      const id = user.rows[0].id;
      await client.query(
        `INSERT INTO projects (workspace_id, name, name_ci) VALUES ($1, 'My first project', 'my first project')`,
        [wsId]);
      await client.query(
        `INSERT INTO credit_entries (workspace_id, kind, amount, balance_after, user_id, generation_id)
         VALUES ($1, 'plan', 125, 125, $2, NULL)`, [wsId, id]);
      return id;
    });
    const token = await createSession(userId);
    const u = await userForToken(token);
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.status(201).json({ token, user: serialiseUser(u) });
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Req() req, @Res() res) {
    const body = await readBody(req);
    const errors = {};
    if (typeof body.email !== 'string' || !body.email.trim()) errors.email = 'Enter your email.';
    if (typeof body.password !== 'string' || !body.password) errors.password = 'Enter your password.';
    if (Object.keys(errors).length) throw errors422(errors);
    const { rows } = await pool.query(
      `SELECT id, password_hash FROM users WHERE email_ci = $1 AND removed_at IS NULL`,
      [body.email.trim().toLowerCase()]);
    if (!rows[0] || !(await verifyPassword(body.password, rows[0].password_hash))) {
      throw statusError(401, { error: 'Email or password is incorrect.' });
    }
    const token = await createSession(rows[0].id);
    const u = await userForToken(token);
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.status(200).json({ token, user: serialiseUser(u) });
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() req, @Res() res) {
    await destroySession(tokenFrom(req));
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.status(200).json({ ok: true });
  }

  @Get('me')
  async me(@Req() req) {
    const u = await needAuth(req);
    const balance = await balanceOf(u.workspace_id);
    return { user: serialiseUser(u), workspace: serialiseWorkspace(u), balance };
  }

  // ---- projects ------------------------------------------------------

  @Get('projects')
  async listProjects(@Req() req) {
    const u = await needAuth(req);
    const { rows } = await pool.query(
      `SELECT * FROM projects WHERE workspace_id = $1 ORDER BY id DESC`, [u.workspace_id]);
    return Promise.all(rows.map(serialiseProject));
  }

  @Post('projects')
  async createProject(@Req() req, @Res() res) {
    const u = await needAuth(req);
    const body = await readBody(req);
    const err = checkProjectName(body.name);
    if (err) throw errors422({ name: err });
    const name = body.name.trim();
    const limit = PLAN_LIMITS[u.workspace_plan].projects;
    const project = await withWorkspaceTx(u.workspace_id, async (client) => {
      const dup = await client.query(
        'SELECT id FROM projects WHERE workspace_id = $1 AND name_ci = $2',
        [u.workspace_id, name.toLowerCase()]);
      if (dup.rows[0]) throw duplicateName();
      const count = await client.query('SELECT COUNT(*) AS c FROM projects WHERE workspace_id = $1', [u.workspace_id]);
      if (Number(count.rows[0].c) >= limit) throw projectLimitReached(limit);
      const r = await client.query(
        `INSERT INTO projects (workspace_id, name, name_ci) VALUES ($1,$2,$3) RETURNING *`,
        [u.workspace_id, name, name.toLowerCase()]);
      return r.rows[0];
    });
    res.status(201).json(await serialiseProject(project));
  }

  @Patch('projects/:id')
  async renameProject(@Req() req) {
    const u = await needAuth(req);
    const id = Number(req.params.id);
    const body = await readBody(req);
    const err = checkProjectName(body.name);
    if (err) throw errors422({ name: err });
    const name = body.name.trim();
    const project = await withWorkspaceTx(u.workspace_id, async (client) => {
      const proj = await client.query(
        'SELECT * FROM projects WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [id, u.workspace_id]);
      if (!proj.rows[0]) throw statusError(404, { error: 'not_found' });
      const dup = await client.query(
        'SELECT id FROM projects WHERE workspace_id = $1 AND name_ci = $2 AND id <> $3',
        [u.workspace_id, name.toLowerCase(), id]);
      if (dup.rows[0]) throw duplicateName();
      const r = await client.query(
        'UPDATE projects SET name = $1, name_ci = $2 WHERE id = $3 RETURNING *',
        [name, name.toLowerCase(), id]);
      return r.rows[0];
    });
    return serialiseProject(project);
  }

  @Get('projects/:id/generations')
  async projectGenerations(@Req() req) {
    const u = await needAuth(req);
    const id = Number(req.params.id);
    const proj = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2', [id, u.workspace_id]);
    if (!proj.rows[0]) throw statusError(404, { error: 'not_found' });
    const { rows } = await pool.query(
      'SELECT * FROM generations WHERE project_id = $1 ORDER BY id DESC', [id]);
    return Promise.all(rows.map(serialiseGeneration));
  }

  // ---- generations ---------------------------------------------------

  @Post('generations')
  async startGeneration(@Req() req, @Res() res) {
    const u = await needAuth(req);
    const body = await readBody(req);
    const errors = checkGenerationFields(body);
    const perr = checkPrompt(body.prompt);
    if (perr) errors.prompt = perr;
    const projectId = Number(body.project_id);
    if (!Number.isInteger(projectId)) errors.project_id = 'Choose a project.';
    if (Object.keys(errors).length) throw errors422(errors);

    const model = modelById(body.model);
    const duration = model.kind === 'video' ? body.duration : null;
    const imageCount = model.kind === 'image' ? body.image_count : null;
    const cost = generationCost(body.model, duration, imageCount);
    const prompt = body.prompt.trim();
    const idemRaw = req.headers['idempotency-key'];
    const idem = typeof idemRaw === 'string' && idemRaw.trim() ? idemRaw.trim() : null;

    const generation = await withWorkspaceTx(u.workspace_id, async (client) => {
      if (idem) {
        const seen = await client.query(
          `SELECT * FROM generations WHERE workspace_id = $1 AND idempotency_key = $2`,
          [u.workspace_id, idem]);
        if (seen.rows[0]) return { row: seen.rows[0], replay: true };
      }
      const proj = await client.query(
        'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2', [projectId, u.workspace_id]);
      if (!proj.rows[0]) throw errors422({ project_id: 'Choose a project.' });
      const balance = await lockedBalance(client, u.workspace_id);
      if (balance < cost) throw insufficiency(cost, balance);
      const limit = PLAN_LIMITS[u.workspace_plan].parallel;
      const active = await client.query(
        `SELECT COUNT(*) AS c FROM generations WHERE workspace_id = $1 AND status IN ('queued','rendering')`,
        [u.workspace_id]);
      if (Number(active.rows[0].c) >= limit) throw parallelReached(limit);
      const gen = await client.query(
        `INSERT INTO generations (workspace_id, project_id, user_id, model, prompt, duration, image_count, aspect, cost, status, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10) RETURNING *`,
        [u.workspace_id, projectId, u.id, body.model, prompt, duration, imageCount, body.aspect, cost, idem]);
      await client.query(
        `INSERT INTO credit_entries (workspace_id, kind, amount, balance_after, user_id, generation_id)
         VALUES ($1, 'charge', $2, $3, $4, $5)`,
        [u.workspace_id, -cost, balance - cost, u.id, gen.rows[0].id]);
      return { row: gen.rows[0], replay: false };
    });
    res.status(generation.replay ? 200 : 201).json(await serialiseGeneration(generation.row));
  }

  @Get('generations/:id')
  async getGeneration(@Req() req) {
    const u = await needAuth(req);
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      'SELECT * FROM generations WHERE id = $1 AND workspace_id = $2', [id, u.workspace_id]);
    if (!rows[0]) throw statusError(404, { error: 'not_found' });
    return serialiseGeneration(rows[0]);
  }

  @Post('generations/:id/cancel')
  @HttpCode(200)
  async cancelGeneration(@Req() req) {
    const u = await needAuth(req);
    const id = Number(req.params.id);
    const row = await withWorkspaceTx(u.workspace_id, async (client) => {
      const found = await client.query(
        'SELECT * FROM generations WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [id, u.workspace_id]);
      if (!found.rows[0]) throw statusError(404, { error: 'not_found' });
      const gen = found.rows[0];
      if (gen.status === 'ready' || gen.status === 'cancelled') {
        throw statusError(409, { error: 'already_finished' });
      }
      await client.query(
        `UPDATE generations SET status = 'cancelled', finished_at = NOW() WHERE id = $1`, [id]);
      const balance = await lockedBalance(client, u.workspace_id);
      // The unique (generation_id, kind) index holds the refund to exactly one.
      await client.query(
        `INSERT INTO credit_entries (workspace_id, kind, amount, balance_after, user_id, generation_id)
         VALUES ($1, 'refund', $2, $3, $4, $5)`,
        [u.workspace_id, gen.cost, balance + gen.cost, u.id, id]);
      return gen;
    });
    const after = await pool.query('SELECT * FROM generations WHERE id = $1', [id]);
    return serialiseGeneration(after.rows[0]);
  }

  @Get('generations/:id/output')
  async generationOutput(@Req() req, @Res() res) {
    const u = await needAuth(req);
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      'SELECT * FROM generations WHERE id = $1 AND workspace_id = $2', [id, u.workspace_id]);
    if (!rows[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const gen = rows[0];
    if (gen.status !== 'ready') {
      res.status(409).json({ error: 'not_ready' });
      return;
    }
    const model = modelById(gen.model);
    const svg = drawArt(gen.prompt, gen.aspect, {
      animate: model.kind === 'video',
      duration: gen.duration || 10,
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).send(svg);
  }

  // ---- credits -------------------------------------------------------

  @Get('credits')
  async credits(@Req() req) {
    const u = await needAuth(req);
    const balance = await balanceOf(u.workspace_id);
    return { balance, entries: await creditEntries(u.workspace_id) };
  }

  // ---- team ----------------------------------------------------------

  @Get('team')
  async team(@Req() req) {
    const u = await needAuth(req);
    const members = await pool.query(
      `SELECT id, name, email, role, created_at FROM users WHERE workspace_id = $1 AND removed_at IS NULL ORDER BY id`,
      [u.workspace_id]);
    const invitations = await pool.query(
      `SELECT id, email, created_at FROM invitations WHERE workspace_id = $1 AND status = 'pending' ORDER BY id`,
      [u.workspace_id]);
    return {
      members: members.rows,
      invitations: invitations.rows,
      seats_used: members.rows.length + invitations.rows.length,
      seat_limit: SEAT_LIMIT,
    };
  }

  @Post('team/invitations')
  async invite(@Req() req, @Res() res) {
    const u = await needAuth(req);
    await this.requireTeamOwner(u);
    const body = await readBody(req);
    const err = checkEmail(body.email);
    if (err) throw errors422({ email: err });
    const email = body.email.trim();
    const invitation = await withWorkspaceTx(u.workspace_id, async (client) => {
      const members = await client.query(
        `SELECT id FROM users WHERE workspace_id = $1 AND removed_at IS NULL`, [u.workspace_id]);
      const pending = await client.query(
        `SELECT id FROM invitations WHERE workspace_id = $1 AND status = 'pending'`, [u.workspace_id]);
      if (members.rows.length + pending.rows.length >= SEAT_LIMIT) {
        throw statusError(409, { error: 'Your team already uses all 9 seats.' });
      }
      const taken = await client.query(
        'SELECT id FROM users WHERE email_ci = $1', [email.toLowerCase()]);
      if (taken.rows[0]) {
        throw statusError(409, { error: 'That person already has an account or an invitation.' });
      }
      const invited = await client.query(
        'SELECT id FROM invitations WHERE email_ci = $1 AND status = $2',
        [email.toLowerCase(), 'pending']);
      if (invited.rows[0]) {
        throw statusError(409, { error: 'That person already has an account or an invitation.' });
      }
      const token = mintInviteToken();
      const r = await client.query(
        `INSERT INTO invitations (workspace_id, email, email_ci, token, status)
         VALUES ($1,$2,$3,$4,'pending') RETURNING *`,
        [u.workspace_id, email, email.toLowerCase(), token]);
      return r.rows[0];
    });
    const publicUrl = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
    await sendMail({
      to: invitation.email,
      ...invitationEmail(u.name, u.workspace_name, `${publicUrl}/invite/${invitation.token}`),
    });
    res.status(201).json({ id: invitation.id, email: invitation.email, created_at: invitation.created_at });
  }

  @Delete('team/invitations/:id')
  async revokeInvitation(@Req() req, @Res() res) {
    const u = await needAuth(req);
    await this.requireTeamOwner(u);
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE invitations SET status = 'revoked'
        WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
        RETURNING id`, [id, u.workspace_id]);
    if (!rows[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(200).json({ ok: true });
  }

  @Delete('team/members/:id')
  async removeMember(@Req() req, @Res() res) {
    const u = await needAuth(req);
    await this.requireTeamOwner(u);
    const id = Number(req.params.id);
    if (id === u.id) {
      res.status(409).json({ error: 'cannot_remove_self' });
      return;
    }
    const removed = await withWorkspaceTx(u.workspace_id, async (client) => {
      const found = await client.query(
        'SELECT id FROM users WHERE id = $1 AND workspace_id = $2 AND removed_at IS NULL FOR UPDATE',
        [id, u.workspace_id]);
      if (!found.rows[0]) throw statusError(404, { error: 'not_found' });
      await client.query(
        'UPDATE users SET removed_at = NOW(), session_hash = NULL WHERE id = $1', [id]);
      return true;
    });
    if (removed) res.status(200).json({ ok: true });
  }

  private async requireTeamOwner(u) {
    if (u.workspace_plan !== 'team' || u.role !== 'owner') {
      throw statusError(403, { error: 'forbidden' });
    }
  }

  // ---- invitations (public) ------------------------------------------

  @Get('invitations/:token')
  async getInvitation(@Req() req) {
    const token = req.params.token;
    const { rows } = await pool.query(
      `SELECT i.email, w.name AS workspace_name
         FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
        WHERE i.token = $1 AND i.status = 'pending'`, [token]);
    if (!rows[0]) throw statusError(404, { error: 'not_found' });
    return { workspace_name: rows[0].workspace_name, email: rows[0].email };
  }

  @Post('invitations/:token')
  async acceptInvitation(@Req() req, @Res() res) {
    const token = req.params.token;
    const body = await readBody(req);
    const errors = {};
    const n = checkName(body.name); if (n) errors.name = n;
    const p = checkPassword(body.password); if (p) errors.password = p;
    if (Object.keys(errors).length) throw errors422(errors);

    const userId = await withWorkspaceTx(null, async (client) => {
      const inv = await client.query(
        'SELECT * FROM invitations WHERE token = $1 FOR UPDATE', [token]);
      const invitation = inv.rows[0];
      if (!invitation || invitation.status !== 'pending') {
        throw statusError(404, { error: 'not_found' });
      }
      const taken = await client.query(
        'SELECT id FROM users WHERE email_ci = $1', [invitation.email_ci]);
      if (taken.rows[0]) throw statusError(404, { error: 'not_found' });
      const user = await client.query(
        `INSERT INTO users (workspace_id, name, email, email_ci, password_hash, role)
         VALUES ($1,$2,$3,$4,$5,'member') RETURNING id`,
        [invitation.workspace_id, body.name.trim(), invitation.email, invitation.email_ci,
         await hashPassword(body.password)]);
      const id = user.rows[0].id;
      await client.query(
        `UPDATE invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
        [invitation.id]);
      const balance = await lockedBalance(client, invitation.workspace_id);
      await client.query(
        `INSERT INTO credit_entries (workspace_id, kind, amount, balance_after, user_id, generation_id)
         VALUES ($1, 'seat', $2, $3, $4, NULL)`,
        [invitation.workspace_id, SEAT_CREDITS, balance + SEAT_CREDITS, id]);
      return id;
    });
    const sessionToken = await createSession(userId);
    const u = await userForToken(sessionToken);
    res.setHeader('Set-Cookie', sessionCookie(sessionToken));
    res.status(201).json({ token: sessionToken, user: serialiseUser(u) });
  }
}
