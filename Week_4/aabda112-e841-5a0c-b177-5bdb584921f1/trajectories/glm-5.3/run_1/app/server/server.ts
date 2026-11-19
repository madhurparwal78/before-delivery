import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, q, one, createSchema } from './db.js';
import { settings } from './settings.js';
import { clockNow } from './clock.js';
import { t } from './errors.js';
import { currentUser, safeLandingPath, readSessionCookie, setSessionCookie, handler } from './core.js';
import * as bus from './live.js';
import { isReachable } from './s3.js';
import { createSchema as migrate } from './db.js';
import { seedIfEmpty } from './seed.js';
import { startLoop, runTick } from './background.js';
import { clinicDateOf } from './tz.js';

import authRouter, { createLoginLink } from './routes/auth.js';
import appointmentsRouter from './routes/appointments.js';
import notesRouter from './routes/notes.js';
import wardRouter from './routes/ward.js';
import invoicesRouter from './routes/invoices.js';
import stockRouter from './routes/stock.js';
import filesRouter from './routes/files.js';
import patientsRouter from './routes/patients.js';
import publicRouter from './routes/public.js';
import gradingRouter from './routes/grading.js';
import { renderHistoryPdf, renderInvoicePdf } from './routes/pdfs.js';
import { putObject } from './s3.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');

// JSON bodies at most 100,000 bytes; exactly that size is allowed.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const len = Number(req.headers['content-length'] || '0');
    if (len > 100000) {
      return res.status(413).json({ error: 'payload_too_large', message: 'That request is too large.' });
    }
  }
  next();
});
app.use(express.json({ limit: '100kb' }));

// Multipart upload handling for /api/patients/:id/files only.
app.post('/api/patients/:id/files', (req, res, next) => {
  const busboyLimit = settings.uploadMaxMb * 1048576 + 65536;
  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;
  req.on('data', (c: Buffer) => {
    total += c.length;
    if (total > busboyLimit) {
      aborted = true;
      (req as any).upload = { tooLarge: true };
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    const boundary = (req.headers['content-type'] || '').match(/boundary=(.+)$/)?.[1];
    if (!boundary) {
      return res.status(422).json({ error: 'validation_failed', message: 'file is required.', field: 'file' });
    }
    const parsed = parseMultipart(Buffer.concat(chunks), boundary);
    (req as any).upload = parsed;
    next();
  });
});

// Minimal multipart parser: pulls out the file part and the kind field.
function parseMultipart(body: Buffer, boundary: string): any {
  const delim = Buffer.from(`--${boundary}`);
  const parts: { headers: Record<string, string>; body: Buffer }[] = [];
  let pos = body.indexOf(delim);
  while (pos !== -1) {
    const start = pos + delim.length;
    const next = body.indexOf(delim, start);
    if (next === -1) break;
    let segment = body.subarray(start, next);
    // strip leading CRLF
    if (segment[0] === 13 && segment[1] === 10) segment = segment.subarray(2);
    // strip trailing CRLF
    if (segment[segment.length - 2] === 13 && segment[segment.length - 1] === 10) {
      segment = segment.subarray(0, segment.length - 2);
    }
    const headerEnd = segment.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = segment.subarray(0, headerEnd).toString('utf8');
      const headers: Record<string, string> = {};
      for (const line of headerText.split('\r\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
      }
      parts.push({ headers, body: segment.subarray(headerEnd + 4) });
    }
    pos = next;
  }
  const out: any = { file: null, kind: null, appointmentId: null };
  for (const part of parts) {
    const cd = part.headers['content-disposition'] || '';
    const name = cd.match(/name="([^"]+)"/)?.[1];
    const filename = cd.match(/filename="([^"]*)"/)?.[1];
    if (name === 'file') {
      out.file = { name: filename ?? '', buffer: part.body, size: part.body.length };
    } else if (name === 'kind' || name === 'appointmentId') {
      out[name] = part.body.toString('utf8');
    }
  }
  return out;
}

// time and health (public, mounted before the role-checked routers)
app.get('/api/health', async (req, res) => {
  try {
    await one(`select 1`);
  } catch {
    return res.status(503).json({ status: 'down' });
  }
  if (!(await isReachable())) {
    return res.status(200).json({ status: 'unavailable' });
  }
  return res.status(200).json({ status: 'ok' });
});

app.get('/api/time', (req, res) => {
  res.json({ now: clockNow().toISOString(), clinicDate: clinicDateOf(clockNow()), timeZone: settings.timeZone });
});

// PDF exports must be matched before the /api routers that own :id patterns.
const pdfRoutes = express.Router();
pdfRoutes.get('/api/patients/:id/history.pdf', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRoleOrThrow(user.role, ['vet', 'manager']);
  const include = req.query.include === 'files';
  const pdf = await renderHistoryPdf(user.clinicId, req.params.id, include);
  const key = `/clinics/${user.clinicId}/exports/history-${req.params.id}-${Math.floor(clockNow().getTime() / 1000)}.pdf`;
  await putObject(key, pdf);
  res.setHeader('Content-Type', 'application/pdf');
  res.status(200).send(pdf);
  return null;
}));
pdfRoutes.get('/api/invoices/:id.pdf', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRoleOrThrow(user.role, ['front-desk', 'vet', 'manager']);
  const invoiceId = req.params.id.replace(/\.pdf$/, '');
  const pdf = await renderInvoicePdf(user.clinicId, invoiceId);
  const key = `/clinics/${user.clinicId}/exports/invoice-${invoiceId}-${Math.floor(clockNow().getTime() / 1000)}.pdf`;
  await putObject(key, pdf);
  res.setHeader('Content-Type', 'application/pdf');
  res.status(200).send(pdf);
  return null;
}));
app.use('/', pdfRoutes);

function requireRoleOrThrow(role: string | null, allowed: string[]): void {
  if (!role || !allowed.includes(role)) throw t('forbidden');
}

app.use('/api', authRouter);
app.use('/api', appointmentsRouter);
app.use('/api', notesRouter);
app.use('/api', wardRouter);
app.use('/api', invoicesRouter);
app.use('/api', stockRouter);
app.use('/api', filesRouter);
app.use('/api', patientsRouter);
app.use('/api', publicRouter);
app.use('/api', gradingRouter);

// The one-time login link lives at the root, outside /api.
const rootAuth = express.Router();
rootAuth.get('/auth/link/:token', handler(async (req, res) => {
  const next = safeLandingPath(typeof req.query.next === 'string' ? req.query.next : undefined);
  const link = await one(
    `select l.*, u.status from login_links l join users u on u.id = l.user_id
     where l.token = $1 and l.used_at is null and u.status = 'Active'`,
    [req.params.token]
  );
  if (!link) {
    res.redirect(302, '/login');
    return null;
  }
  await q(`update login_links set used_at = now() where token = $1`, [req.params.token]);
  const sessionToken = crypto.randomBytes(24).toString('base64url');
  await q(`insert into sessions (token, user_id) values ($1, $2)`, [sessionToken, link.user_id]);
  setSessionCookie(res, sessionToken);
  res.redirect(302, next);
  return null;
}));

app.use('/', rootAuth);

// SSE live feed
app.get('/api/live', async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: hello\ndata: {"clinicId":"${user.clinicId}"}\n\n`);
  const id = bus.subscribe(user.clinicId, user.userId, (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  });
  req.on('close', () => bus.unsubscribe(id));
});

// static frontend
const distDir = path.join(__dirname, 'public');
app.use(express.static(distDir, { index: false, maxAge: 0 }));

const HTML_ROUTES = [
  /^\/$/,
  /^\/login/,
  /^\/invite\//,
  /^\/today/,
  /^\/ward/,
  /^\/patients(\/|$)/,
  /^\/consult\//,
  /^\/invoices(\/|$)/,
  /^\/stock/,
  /^\/staff/,
  /^\/book\//,
  /^\/auth\/link\//,
];
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const isHtml = HTML_ROUTES.some((rx) => rx.test(req.path));
  if (!isHtml) return next();
  res.sendFile(path.join(distDir, 'index.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found', message: "We couldn't find that." });
  }
  res.sendFile(path.join(distDir, 'index.html'));
});

const PORT = settings.appPublicPort ?? 4173;

async function start(): Promise<void> {
  // retry Postgres connection every two seconds
  for (;;) {
    try {
      await pool.query('select 1');
      break;
    } catch {
      console.log('postgres not ready, retrying');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await createSchema();
  await seedIfEmpty();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`roundbook listening on ${PORT}`);
  });
  startLoop();
}

start().catch((e) => {
  console.error('failed to start', e);
  process.exit(1);
});
