import { randomUUID } from 'node:crypto';
import { errors, readJsonBody, sendBytes, sendJson } from './http';
import { MSG, copy } from '../shared/messages';
import { config } from './config';
import { query, queryOne, transaction } from './db';
import { serverNow } from './clock';
import { projectRow, purgeExpired } from './repo';
import { openProject, requireActive } from './access';
import type { Router } from './router';
import { withIdempotency } from './idempotency';
import { liveVersion, publishVersion } from './publish';
import { enqueueMail, flushOutbox, inviteStatus, noticeStatus } from './mail';
import { getObject, storageKeys, StorageUnavailable } from './storage';
import { EMAIL_PATTERN, hashPassword, sessionCookie, verifyPassword } from './api-shared';
import { formatDate, formatTime } from '../shared/format';
import type { JsonValue } from '../shared/types';
import { startSession } from './api-core';

export function registerPublishRoutes(router: Router): void {
  router.add('GET', '/api/projects/:id/versions', async ({ response, person, params }) => {
    await openProject(person, params.id, 'view');
    const rows = await query<{
      number: number;
      status: string;
      published_at: string;
      published_by: string;
      sha256: string;
    }>(
      `SELECT number, status, published_at, published_by, sha256 FROM versions
       WHERE project_id = $1 ORDER BY number DESC`,
      [params.id],
    );
    const versions = [];
    for (const row of rows) {
      versions.push({
        number: row.number,
        status: row.status,
        publishedAt: new Date(row.published_at).toISOString(),
        publishedBy: row.published_by,
        sha256: row.sha256,
        notice: await noticeStatus(params.id, row.number),
      });
    }
    sendJson(response, 200, { versions });
  });

  router.add('POST', '/api/projects/:id/versions', async ({ request, response, person, params }) => {
    const access = await openProject(person, params.id, 'publish');
    const body = await readJsonBody(request);
    const headerKey = request.headers['idempotency-key'];
    const key = Array.isArray(headerKey) ? headerKey[0] : headerKey;
    if (typeof key !== 'string' || key.length < 1 || key.length > 100) {
      throw errors.validation({
        'Idempotency-Key': 'Must be between 1 and 100 characters.',
      });
    }
    const result = await withIdempotency(
      `publish:${params.id}`,
      key,
      person!.id,
      body,
      async () => {
        requireActive(access.row);
        const fromVersionRaw = body.fromVersion;
        if (fromVersionRaw !== undefined && typeof fromVersionRaw !== 'number') {
          throw errors.validation({ fromVersion: 'Choose a version that exists.' });
        }
        const version = await publishVersion(
          params.id,
          access.row.name,
          person!,
          typeof fromVersionRaw === 'number' ? fromVersionRaw : null,
        );
        return { status: 201, body: { version } as unknown as JsonValue };
      },
    );
    sendJson(response, result.status, result.body);
  });

  router.add(
    'GET',
    '/api/projects/:id/versions/:number/export',
    async ({ response, person, params }) => {
      await openProject(person, params.id, 'view');
      const row = await queryOne<{ bundle: string }>(
        `SELECT bundle FROM versions WHERE project_id = $1 AND number = $2`,
        [params.id, Number(params.number)],
      );
      if (!row) throw errors.notFound();
      sendBytes(response, 200, Buffer.from(row.bundle, 'utf8'), 'application/json');
    },
  );

  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    router.add(method, '/api/projects/:id/versions/:number', async () => {
      throw errors.immutable();
    });
  }

  router.add('GET', '/api/projects/:id/members', async ({ response, person, params }) => {
    await openProject(person, params.id, 'view');
    const members = await query<{
      person_id: string;
      name: string;
      email: string;
      role: string;
    }>(
      `SELECT m.person_id, p.name, p.email, m.role FROM members m JOIN people p ON p.id = m.person_id
       WHERE m.project_id = $1 ORDER BY m.role, p.name`,
      [params.id],
    );
    const inviteRows = await query<{
      id: string;
      email: string;
      role: string;
      status: string;
      expires_at: string;
    }>(
      `SELECT id, email, role, status, expires_at FROM invites WHERE project_id = $1
       ORDER BY created_at`,
      [params.id],
    );
    const now = await serverNow();
    const invites = [];
    for (const row of inviteRows) {
      let status = row.status;
      if (status === 'pending') {
        status =
          new Date(row.expires_at).getTime() < now.getTime()
            ? 'expired'
            : await inviteStatus(row.id);
      }
      invites.push({
        id: row.id,
        email: row.email,
        role: row.role,
        status,
        expiresAt: new Date(row.expires_at).toISOString(),
      });
    }
    sendJson(response, 200, {
      members: members.map((member) => ({
        personId: member.person_id,
        name: member.name,
        email: member.email,
        role: member.role,
      })),
      invites,
    });
  });

  router.add('POST', '/api/projects/:id/invites', async ({ request, response, person, params }) => {
    const access = await openProject(person, params.id, 'manage');
    const body = await readJsonBody(request);
    requireActive(access.row);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!EMAIL_PATTERN.test(email)) throw errors.validation({ email: MSG.enterEmail });
    const role = body.role;
    if (role !== 'Editor' && role !== 'Viewer') {
      throw errors.validation({ role: 'Choose Editor or Viewer.' });
    }
    const existingMember = await queryOne<{ person_id: string }>(
      `SELECT m.person_id FROM members m JOIN people p ON p.id = m.person_id
       WHERE m.project_id = $1 AND lower(p.email) = lower($2)`,
      [params.id, email],
    );
    if (existingMember) throw errors.validation({ email: copy.alreadyMember(email) });
    const now = await serverNow();
    const pending = await queryOne<{ id: string }>(
      `SELECT id FROM invites WHERE project_id = $1 AND lower(email) = lower($2)
       AND status = 'pending' AND expires_at > $3`,
      [params.id, email, now.toISOString()],
    );
    if (pending) throw errors.validation({ email: copy.invitePending(email) });
    const inviteId = randomUUID();
    const token = randomUUID().replace(/-/g, '');
    const expiresAt = new Date(now.getTime() + config.inviteTtlHours * 3600 * 1000);
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO invites (id, project_id, email, role, token, status, expires_at, created_at, invited_by)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8)`,
        [
          inviteId,
          params.id,
          email,
          role,
          token,
          expiresAt.toISOString(),
          now.toISOString(),
          person!.id,
        ],
      );
      await enqueueMail(client, {
        kind: 'invite',
        toEmail: email,
        subject: `Join ${access.row.name} in Halation Studio`,
        body: [
          `${person!.name} invited you to ${access.row.name} as ${role}.`,
          '',
          `${config.publicUrl}/invite/${token}`,
          '',
          `This link works once and expires on ${formatDate(
            expiresAt,
            config.timeZone,
          )} at ${formatTime(expiresAt, config.timeZone)}.`,
        ].join('\n'),
        projectId: params.id,
        versionNumber: null,
        inviteId,
      });
    });
    await flushOutbox().catch(() => undefined);
    sendJson(response, 201, {
      invite: {
        id: inviteId,
        email,
        role,
        status: await inviteStatus(inviteId),
        expiresAt: expiresAt.toISOString(),
      },
    });
  });

  router.add(
    'DELETE',
    '/api/projects/:id/members/:personId',
    async ({ response, person, params }) => {
      await openProject(person, params.id, 'manage');
      await query(`DELETE FROM members WHERE project_id = $1 AND person_id = $2 AND role <> 'Owner'`, [
        params.id,
        params.personId,
      ]);
      response.writeHead(204);
      response.end();
    },
  );

  router.add('GET', '/api/invites/:token', async ({ response, params }) => {
    const now = await serverNow();
    const invite = await queryOne<{
      email: string;
      role: string;
      status: string;
      expires_at: string;
      project_name: string;
    }>(
      `SELECT i.email, i.role, i.status, i.expires_at, p.name AS project_name
       FROM invites i JOIN projects p ON p.id = i.project_id WHERE i.token = $1`,
      [params.token],
    );
    if (!invite || invite.status !== 'pending' || new Date(invite.expires_at) < now) {
      throw errors.inviteUnavailable();
    }
    const account = await queryOne<{ id: string }>(
      `SELECT id FROM people WHERE lower(email) = lower($1)`,
      [invite.email],
    );
    sendJson(response, 200, {
      projectName: invite.project_name,
      role: invite.role,
      email: invite.email,
      accountExists: account !== null,
    });
  });

  router.add('POST', '/api/invites/:token/accept', async ({ request, response, person, params }) => {
    const body = await readJsonBody(request);
    const now = await serverNow();
    const invite = await queryOne<{
      id: string;
      project_id: string;
      email: string;
      role: string;
      status: string;
      expires_at: string;
    }>(
      `SELECT id, project_id, email, role, status, expires_at FROM invites WHERE token = $1`,
      [params.token],
    );
    if (!invite || invite.status !== 'pending' || new Date(invite.expires_at) < now) {
      throw errors.inviteUnavailable();
    }
    if (person && person.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw errors.wrongPerson(invite.email);
    }
    const account = await queryOne<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM people WHERE lower(email) = lower($1)`,
      [invite.email],
    );
    let personId: string;
    if (person) {
      personId = person.id;
    } else if (account) {
      const password = typeof body.password === 'string' ? body.password : '';
      if (!verifyPassword(password, account.password_hash)) {
        throw errors.validation({ password: MSG.badCredentials });
      }
      personId = account.id;
    } else {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (name.length === 0) throw errors.validation({ name: MSG.enterName });
      if (password.length < 10) throw errors.validation({ password: MSG.shortPassword });
      personId = randomUUID();
      await query(
        `INSERT INTO people (id, name, email, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [personId, name, invite.email, hashPassword(password), now.toISOString()],
      );
    }
    const claimed = await query<{ id: string }>(
      `UPDATE invites SET status = 'accepted' WHERE id = $1 AND status = 'pending' RETURNING id`,
      [invite.id],
    );
    if (claimed.length === 0) throw errors.inviteUnavailable();
    await query(
      `INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (project_id, person_id) DO NOTHING`,
      [invite.project_id, personId, invite.role],
    );
    const sessionId = await startSession(personId);
    sendJson(
      response,
      200,
      { projectId: invite.project_id, role: invite.role },
      { 'set-cookie': sessionCookie(sessionId) },
    );
  });

  router.add('GET', '/api/embed/:projectId/version', async ({ response, params }) => {
    await purgeExpired();
    const row = await projectRow(params.projectId);
    if (!row || row.status !== 'active') throw errors.notFound();
    const live = await liveVersion(params.projectId);
    if (!live) throw errors.notFound();
    sendJson(response, 200, { number: live.number });
  });

  router.add('GET', '/api/embed/:projectId/scene', async ({ response, params }) => {
    await purgeExpired();
    const row = await projectRow(params.projectId);
    if (!row || row.status !== 'active') throw errors.notFound();
    const live = await liveVersion(params.projectId);
    if (!live) throw errors.notFound();
    let bytes = Buffer.from(live.bundle, 'utf8');
    let source = 'row';
    try {
      const object = await getObject(storageKeys.versionBundle(params.projectId, live.number));
      if (object) {
        bytes = object.body;
        source = 'bundle';
      }
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
    }
    sendBytes(response, 200, bytes, 'application/json', {
      'X-Halation-Version': String(live.number),
      'X-Scene-Source': source,
      'cache-control': 'no-store',
    });
  });

  router.add(
    'GET',
    '/api/embed/:projectId/assets/:assetId',
    async ({ response, params }) => {
      await purgeExpired();
      const row = await projectRow(params.projectId);
      if (!row || row.status !== 'active') throw errors.notFound();
      const live = await liveVersion(params.projectId);
      if (!live) throw errors.notFound();
      if (!live.bundle.includes(params.assetId)) throw errors.notFound();
      const asset = await queryOne<{ content_type: string }>(
        `SELECT content_type FROM assets WHERE id = $1 AND project_id = $2`,
        [params.assetId, params.projectId],
      );
      if (!asset) throw errors.notFound();
      try {
        const object = await getObject(storageKeys.asset(params.projectId, params.assetId));
        if (!object) throw errors.notFound();
        sendBytes(response, 200, object.body, asset.content_type);
      } catch (error) {
        if (error instanceof StorageUnavailable) {
          throw errors.storageUnavailable(MSG.storageUploads);
        }
        throw error;
      }
    },
  );

}
