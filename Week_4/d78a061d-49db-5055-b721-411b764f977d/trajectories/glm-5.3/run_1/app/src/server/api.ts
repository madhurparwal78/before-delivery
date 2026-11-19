import type { IncomingMessage, ServerResponse } from 'node:http';
import { query, transaction } from './db.js';
import { ApiError, json, readJsonBody, sendError, notFound, unauthenticated } from './http.js';
import { contextFrom, sessionCookie, localeCookie, crossOriginForbidden, type Ctx } from './context.js';
import { route, dispatch } from './api-core.js';
import { extraRoutes } from './api-extra.js';
import type { Route } from './api-core.js';
import { hashPassword, verifyPassword, randomToken } from './auth.js';
import {
  accountJson, createSession, endSessions, sendAccountEmail, judgeToken, useToken, type AccountRow,
} from './accounts.js';
import { charactersForAccount, characterById, equippedCharacter, characterJson } from './characters.js';
import { weaponsForAccount, weaponById, weaponJson, equippedOnCharacterIds } from './weapons.js';
import {
  modelsForAccount, modelById, modelJson, storeUpload, intakeChecks, deleteModel, readModelFile,
  readThumbnail, equipModel, refreshEquipState, setStorageNotice, resumePendingValidation,
} from './models.js';
import { rulebookVersion, validatorVersion } from '../shared/domain.js';
import { ruleIds, ruleLimits, ruleTitle } from './rulebook.js';
import { stories, storyById, deriveWeaponStats, drawingLimits, vertexCount, countChars, emailLooksValid, isLocale, degreesToRoundedRadians, radiansToDegrees, PROPORTION_KEYS, proportionInRange, poseInRange, type Stroke } from '../shared/domain.js';
import { progressFor, storyProgressForCaller, ensureProgress, progressJson } from './progress.js';
import { createSoloSession, sessionState, snapshotJson, applyIntent, runningSessions, persistSession, refreshMemberHero } from './world.js';
import { partyById, partyMembers, partyJson, isMember, partyForAccount, startReadyCheck, answerReadyCheck, handoffLeadership, leaveParty, tickReadyChecks, partyChannel } from './parties.js';
import { messagesAfter, findStoredClientMessage, checkRate, appendChatMessage, channelExists, bodyLengthOk, messageJson } from './chat.js';

const routes: Route[] = [
  route('GET', '/api/health', async (ctx, _m, res) => {
    json(res, 200, { status: 'ok' });
  }, false),

  route('PUT', '/api/locale', async (ctx, _m, res, req) => {
    const body = (await readJsonBody(req)) as { locale?: unknown };
    if (!isLocale(body.locale)) {
      throw new ApiError(422, 'invalid_field', { fields: { locale: ['invalid_field'] } });
    }
    const headers: Record<string, string | string[]> = { 'set-cookie': localeCookie(body.locale) };
    if (ctx.account) {
      await query('update accounts set locale = $1 where id = $2', [body.locale, ctx.account.id]);
      headers['set-cookie'] = [localeCookie(body.locale), sessionCookie(ctx.cookies.lw_session ?? '')].join('; ');
    }
    json(res, 204, '', headers);
  }, false),

  // Auth
  route('POST', '/api/auth/signup', async (ctx, _m, res, req) => {
    const body = (await readJsonBody(req)) as { email?: unknown; password?: unknown; display_name?: unknown; locale?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    const fields: Record<string, string[]> = {};
    if (!isLocale(body.locale)) fields.locale = ['invalid_field'];
    if (!emailLooksValid(email)) fields.email = ['invalid_field'];
    if (countChars(password) < 10 || countChars(password) > 128) fields.password = ['password_limit'];
    if (countChars(displayName) < 3 || countChars(displayName) > 20) fields.display_name = ['display_name_limit'];
    if (Object.keys(fields).length > 0) throw new ApiError(422, 'invalid_field', { fields });
    const existingEmail = await query('select id from accounts where lower(email) = lower($1)', [email]);
    if (existingEmail.rows.length > 0) throw new ApiError(409, 'email_taken');
    const existingName = await query('select id from accounts where lower(display_name) = lower($1)', [displayName]);
    if (existingName.rows.length > 0) throw new ApiError(409, 'display_name_taken');
    const locale = isLocale(body.locale) ? body.locale : 'en';
    const accountId = crypto.randomUUID();
    const inserted = await query<AccountRow>(
      `insert into accounts (id, email, password_hash, display_name, locale, email_verified, verification_email)
       values ($1, $2, $3, $4, $5, false, 'not_sent')
       returning id, email, display_name, locale, email_verified, verification_email, storage_notice`,
      [accountId, email, hashPassword(password), displayName, locale],
    );
    const account = inserted.rows[0] as AccountRow;
    // The hero every new account gets in slot 1 at sign-up, named after its display name.
    await query(
      `insert into characters (id, account_id, slot, revision, name, parts, proportions, pose, material, accessories, equipped)
       values ($1, $2, 1, 1, $3, $4, $5, $6, 'graphite', $7, true)`,
      [
        crypto.randomUUID(), accountId, displayName,
        JSON.stringify({ head: 'round', torso: 'stick', arms: 'thin', legs: 'thin' }),
        JSON.stringify(Object.fromEntries(PROPORTION_KEYS.map((k) => [k, 1]))),
        JSON.stringify({ right_arm_raise: 0 }),
        JSON.stringify({ head: 'none', back: 'none', left_hand: 'none' }),
      ],
    );
    const sendResult = await sendAccountEmail(account, 'verify');
    if (sendResult === 'sent') {
      await query("update accounts set verification_email = 'sent' where id = $1", [accountId]);
      account.verification_email = 'sent';
    }
    const token = await createSession(accountId);
    json(res, 201, { account: accountJson(account), verification_email: account.verification_email }, {
      'set-cookie': [sessionCookie(token), localeCookie(account.locale)].join('; '),
    });
  }, false),

  route('POST', '/api/auth/signin', async (ctx, _m, res, req) => {
    const body = (await readJsonBody(req)) as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const result = await query<AccountRow & { password_hash: string }>(
      `select id, email, display_name, locale, email_verified, verification_email, storage_notice, password_hash
         from accounts where lower(email) = lower($1)`,
      [email],
    );
    const row = result.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) throw new ApiError(401, 'invalid_credentials');
    const token = await createSession(row.id);
    const account: AccountRow = {
      id: row.id, email: row.email, display_name: row.display_name, locale: row.locale,
      email_verified: row.email_verified, verification_email: row.verification_email, storage_notice: row.storage_notice,
    };
    json(res, 200, { account: accountJson(account) }, {
      'set-cookie': [sessionCookie(token), localeCookie(row.locale)].join('; '),
    });
  }, false),

  route('POST', '/api/auth/signout', async (ctx, _m, res) => {
    if (ctx.cookies.lw_session) {
      await query('delete from sessions where token = $1', [ctx.cookies.lw_session]);
    }
    json(res, 204, '', { 'set-cookie': 'lw_session=; Path=/; Max-Age=0; SameSite=Lax' });
  }, false),

  route('POST', '/api/auth/verify', async (ctx, _m, res, req) => {
    const body = (await readJsonBody(req)) as { token?: unknown };
    const token = typeof body.token === 'string' ? body.token : '';
    const verdict = await judgeToken(token, 'verify');
    if (verdict === 'unknown') throw notFound();
    if (verdict === 'used') throw new ApiError(410, 'link_used');
    if (verdict === 'replaced') throw new ApiError(410, 'link_replaced');
    if (verdict === 'expired') throw new ApiError(410, 'link_expired');
    const used = await useToken(token, 'verify');
    if (!used) throw new ApiError(410, 'link_used');
    await query('update accounts set email_verified = true where id = $1', [used.account_id]);
    const account = await query<AccountRow>('select id, email, display_name, locale, email_verified, verification_email, storage_notice from accounts where id = $1', [used.account_id]);
    json(res, 200, { account: accountJson(account.rows[0] as AccountRow) });
  }, false),

  route('POST', '/api/auth/verification/resend', async (ctx, _m, res) => {
    if (!ctx.account) throw unauthenticated();
    if (ctx.account.email_verified) throw new ApiError(409, 'already_verified');
    const result = await sendAccountEmail(ctx.account, 'verify');
    if (result === 'not_sent') throw new ApiError(503, 'mail_unavailable');
    await query("update accounts set verification_email = 'sent' where id = $1", [ctx.account.id]);
    json(res, 202, { verification_email: 'sent' });
  }),

  route('POST', '/api/auth/password-reset', async (ctx, _m, res, req) => {
    const body = (await readJsonBody(req)) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email : '';
    if (!emailLooksValid(email)) throw new ApiError(422, 'invalid_field', { fields: { email: ['invalid_field'] } });
    const found = await query<AccountRow>('select id, email, display_name, locale, email_verified, verification_email, storage_notice from accounts where lower(email) = lower($1)', [email]);
    const account = found.rows[0];
    if (account) {
      const result = await sendAccountEmail(account, 'reset');
      if (result === 'not_sent') throw new ApiError(503, 'mail_unavailable');
    } else {
      // The SMTP server is tried on every reset request, so unknown addresses get the same answer.
      const { sendMail, MailUnavailable } = await import('./mail.js');
      try {
        await sendMail({ to: email, subject: 'Reset your Linewright password', html: '<p></p>', text: '', lang: 'en' });
      } catch (err) {
        if (err instanceof MailUnavailable) throw new ApiError(503, 'mail_unavailable');
      }
    }
    json(res, 202, {});
  }, false),

  route('POST', '/api/auth/password-reset/confirm', async (ctx, _m, res, req) => {
    const body = (await readJsonBody(req)) as { token?: unknown; password?: unknown };
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (countChars(password) < 10 || countChars(password) > 128) {
      throw new ApiError(422, 'invalid_field', { fields: { password: ['password_limit'] } });
    }
    const verdict = await judgeToken(token, 'reset');
    if (verdict === 'unknown') throw notFound();
    if (verdict === 'used') throw new ApiError(410, 'link_used');
    if (verdict === 'replaced') throw new ApiError(410, 'link_replaced');
    if (verdict === 'expired') throw new ApiError(410, 'link_expired');
    const used = await useToken(token, 'reset');
    if (!used) throw new ApiError(410, 'link_used');
    await query('update accounts set password_hash = $1 where id = $2', [hashPassword(password), used.account_id]);
    await endSessions(used.account_id);
    json(res, 200, {});
  }, false),

  route('GET', '/api/me', async (ctx, _m, res) => {
    if (!ctx.account) throw unauthenticated();
    const equipped = await equippedCharacter(ctx.account.id);
    json(res, 200, { account: accountJson(ctx.account), equipped_character_id: equipped?.id ?? null });
  }),

  route('PATCH', '/api/me', async (ctx, _m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const body = (await readJsonBody(req)) as { display_name?: unknown };
    if (typeof body.display_name === 'string') {
      const name = body.display_name.trim();
      if (countChars(name) < 3 || countChars(name) > 20) {
        throw new ApiError(422, 'invalid_field', { fields: { display_name: ['display_name_limit'] } });
      }
      const taken = await query('select id from accounts where lower(display_name) = lower($1) and id <> $2', [name, ctx.account.id]);
      if (taken.rows.length > 0) throw new ApiError(409, 'display_name_taken');
      await query('update accounts set display_name = $1 where id = $2', [name, ctx.account.id]);
    }
    const account = await query<AccountRow>('select id, email, display_name, locale, email_verified, verification_email, storage_notice from accounts where id = $1', [ctx.account.id]);
    json(res, 200, { account: accountJson(account.rows[0] as AccountRow) });
  }),

  // Characters
  route('GET', '/api/characters', async (ctx, _m, res) => {
    if (!ctx.account) throw unauthenticated();
    const characters = await charactersForAccount(ctx.account.id);
    json(res, 200, { characters: characters.map(characterJson) });
  }),

  route('GET', '/api/characters/([^/]+)', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const character = await characterById(m[1] ?? '');
    if (!character || character.account_id !== ctx.account.id) throw notFound();
    json(res, 200, { character: characterJson(character) });
  }),

  route('PUT', '/api/characters/slots/([123])', async (ctx, m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const slot = Number(m[1]);
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const existingRes = await query('select id, revision from characters where account_id = $1 and slot = $2', [ctx.account.id, slot]);
    const existing = existingRes.rows[0] as { id: string; revision: number } | undefined;
    const bodyRevision = body.revision === null ? null : typeof body.revision === 'number' ? body.revision : undefined;
    if (bodyRevision === undefined) throw new ApiError(422, 'invalid_field', { fields: { revision: ['invalid_field'] } });
    const currentRevision = existing ? existing.revision : null;
    if (bodyRevision !== currentRevision) throw new ApiError(412, 'stale_revision');

    const fields: Record<string, string[]> = {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (countChars(name) < 3 || countChars(name) > 20) fields.name = ['hero_name_limit'];
    const proportions = body.proportions as Record<string, unknown> | undefined;
    if (!proportions || !PROPORTION_KEYS.every((k) => typeof proportions[k] === 'number' && proportionInRange(proportions[k] as number))) {
      fields.proportions = ['hero_invalid'];
    }
    const pose = (body.pose ?? { right_arm_raise: 0 }) as { right_arm_raise?: unknown };
    if (typeof pose.right_arm_raise !== 'number' || !poseInRange(pose.right_arm_raise)) fields.pose = ['hero_invalid'];
    const parts = body.parts as Record<string, string> | undefined;
    if (!parts || !['round', 'square', 'triangle'].includes(parts.head ?? '') || !['stick', 'barrel', 'kite'].includes(parts.torso ?? '')
      || !['thin', 'thick'].includes(parts.arms ?? '') || !['thin', 'thick', 'spring'].includes(parts.legs ?? '')) {
      fields.parts = ['hero_invalid'];
    }
    const material = body.material;
    if (typeof material !== 'string' || !['graphite', 'cobalt', 'marker', 'chalk', 'brick', 'moss'].includes(material)) {
      fields.material = ['hero_invalid'];
    }
    const accessories = body.accessories as Record<string, string> | undefined;
    if (!accessories || !['none', 'paper_crown', 'beanie'].includes(accessories.head ?? '')
      || !['none', 'scarf', 'satchel'].includes(accessories.back ?? '')
      || !['none', 'lantern', 'shield'].includes(accessories.left_hand ?? '')) {
      fields.accessories = ['hero_invalid'];
    }
    if (Object.keys(fields).length > 0) throw new ApiError(422, 'invalid_field', { fields });

    const modelId = body.model_id;
    if (modelId !== null && typeof modelId === 'string') {
      const model = await modelById(modelId);
      if (!model || model.account_id !== ctx.account.id) throw notFound();
      if (model.status !== 'accepted' && model.status !== 'equipped') throw new ApiError(409, 'model_not_accepted');
    }
    const weaponId = body.weapon_id;
    if (weaponId !== null && typeof weaponId === 'string') {
      const weapon = await weaponById(weaponId);
      if (!weapon || weapon.account_id !== ctx.account.id) throw notFound();
    }

    const poseValue = degreesToRoundedRadians(radiansToDegrees((pose.right_arm_raise as number))) as number;
    if (existing) {
      const updated = await query(
        `update characters set revision = revision + 1, name = $1, parts = $2, proportions = $3, pose = $4, material = $5,
           accessories = $6, model_id = $7, weapon_id = $8 where id = $9 returning id`,
        [name, JSON.stringify(parts), JSON.stringify(proportions), JSON.stringify({ right_arm_raise: poseValue }), material, JSON.stringify(accessories), modelId, weaponId, existing.id],
      );
      const character = updated.rows[0] ? await characterById(String(updated.rows[0].id)) : null;
      json(res, 200, { character: character ? characterJson(character) : null });
    } else {
      const id = crypto.randomUUID();
      await query(
        `insert into characters (id, account_id, slot, revision, name, parts, proportions, pose, material, accessories, model_id, weapon_id, equipped)
         values ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
        [id, ctx.account.id, slot, name, JSON.stringify(parts), JSON.stringify(proportions), JSON.stringify({ right_arm_raise: poseValue }), material, JSON.stringify(accessories), modelId, weaponId],
      );
      const character = await characterById(id);
      json(res, 201, { character: character ? characterJson(character) : null });
    }
  }),

  route('POST', '/api/characters/([^/]+)/equip', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const character = await characterById(m[1] ?? '');
    if (!character || character.account_id !== ctx.account.id) throw notFound();
    const accountId = ctx.account.id;
    await transaction(async (client) => {
      await client.query('update characters set equipped = false where account_id = $1', [accountId]);
      await client.query('update characters set equipped = true where id = $1', [character.id]);
    });
    const refreshed = await characterById(character.id);
    const sessions = [...runningSessions.values()].filter((s) => s.members.some((mm) => mm.account_id === accountId));
    for (const s of sessions) {
      await refreshMemberHero(s, accountId);
      await persistSession(s);
    }
    json(res, 200, { character: refreshed ? characterJson(refreshed) : null });
  }),

  route('DELETE', '/api/characters/([^/]+)', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const character = await characterById(m[1] ?? '');
    if (!character || character.account_id !== ctx.account.id) throw notFound();
    const accountId = ctx.account.id;
    await transaction(async (client) => {
      await client.query('delete from characters where id = $1', [character.id]);
      if (character.equipped) {
        await client.query(
          `update characters set equipped = true
             where id = (select id from characters where account_id = $1 order by slot limit 1)`,
          [accountId],
        );
      }
    });
    json(res, 204, '');
  }),

  // Weapons
  route('POST', '/api/weapons/preview', async (ctx, _m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const body = (await readJsonBody(req)) as { strokes?: unknown; drawing_revision?: unknown };
    const strokes = parseStrokes(body.strokes);
    const drawingRevision = body.drawing_revision;
    if (drawingRevision !== undefined && drawingRevision !== null && typeof drawingRevision !== 'number') {
      throw new ApiError(422, 'invalid_field', { fields: { drawing_revision: ['invalid_field'] } });
    }
    const limits = drawingLimits(strokes);
    json(res, 200, {
      drawing_revision: drawingRevision ?? null,
      stats: deriveWeaponStats(strokes),
      strokes: limits.strokes,
      vertices: limits.vertices,
      within_limits: limits.within_limits,
      over: limits.over,
    });
  }),

  route('POST', '/api/weapons', async (ctx, _m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const body = (await readJsonBody(req)) as { character_id?: unknown; strokes?: unknown };
    const characterId = typeof body.character_id === 'string' ? body.character_id : '';
    const character = await characterById(characterId);
    if (!character || character.account_id !== ctx.account.id) throw notFound();
    const accountId = ctx.account.id;
    const strokes = parseStrokes(body.strokes);
    const limits = drawingLimits(strokes);
    const fields: Record<string, string[]> = {};
    if (limits.strokes < 1 || limits.strokes > 24) fields.strokes = ['stroke_count'];
    if (limits.vertices > 12000) fields.vertices = ['vertex_limit'];
    if (Object.keys(fields).length > 0) throw new ApiError(422, 'invalid_field', { fields });
    const stats = deriveWeaponStats(strokes);
    const id = crypto.randomUUID();
    await transaction(async (client) => {
      const nextNumber = await client.query<{ next_number: number }>(
        `insert into weapon_numbers (account_id, next_number) values ($1, 1)
         on conflict (account_id) do update set next_number = weapon_numbers.next_number + 1
         returning next_number`,
        [accountId],
      );
      const number = nextNumber.rows[0]?.next_number ?? 1;
      await client.query(
        'insert into weapons (id, account_id, number, strokes, stats, vertices) values ($1, $2, $3, $4, $5, $6)',
        [id, accountId, number, JSON.stringify(strokes), JSON.stringify(stats), limits.vertices],
      );
      await client.query('update characters set weapon_id = $1 where id = $2', [id, characterId]);
    });
    const weapon = await weaponById(id);
    const refreshedCharacter = await characterById(characterId);
    const sessions = [...runningSessions.values()].filter((s) => s.members.some((mm) => mm.account_id === accountId));
    for (const s of sessions) {
      await refreshMemberHero(s, ctx.account.id);
      await persistSession(s);
    }
    json(res, 201, {
      weapon: weapon ? weaponJson(weapon, [characterId]) : null,
      character: refreshedCharacter ? characterJson(refreshedCharacter) : null,
    });
  }),

  route('GET', '/api/weapons', async (ctx, _m, res) => {
    if (!ctx.account) throw unauthenticated();
    const weapons = await weaponsForAccount(ctx.account.id);
    const equipped = await query<{ weapon_id: string | null }>('select weapon_id from characters where account_id = $1', [ctx.account.id]);
    const equippedIds = new Set(equipped.rows.map((r) => r.weapon_id).filter((x): x is string => x !== null));
    json(res, 200, { weapons: weapons.map((w) => weaponJson(w, equippedIds.has(w.id) ? [characterIdFor(weaponJson(w, []))] : [])) });
  }),

  route('GET', '/api/weapons/([^/]+)', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const weapon = await weaponById(m[1] ?? '');
    if (!weapon || weapon.account_id !== ctx.account.id) throw notFound();
    json(res, 200, { weapon: weaponJson(weapon, await equippedOnCharacterIds(weapon.id)) });
  }),

  route('DELETE', '/api/weapons/([^/]+)', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const weapon = await weaponById(m[1] ?? '');
    if (!weapon || weapon.account_id !== ctx.account.id) throw notFound();
    const accountId = ctx.account.id;
    await transaction(async (client) => {
      await client.query('delete from weapons where id = $1', [weapon.id]);
      await client.query('update characters set weapon_id = null where weapon_id = $1', [weapon.id]);
    });
    const sessions = [...runningSessions.values()].filter((s) => s.members.some((mm) => mm.account_id === accountId));
    for (const s of sessions) {
      await refreshMemberHero(s, ctx.account.id);
      await persistSession(s);
    }
    json(res, 204, '');
  }),

  // Models
  route('GET', '/api/rulebook', async (ctx, _m, res) => {
    json(res, 200, {
      version: rulebookVersion,
      validator: validatorVersion,
      rules: ruleIds.map((id) => ({ id, title: ruleTitle(id, ctx.locale), limit: ruleLimits[id] ?? null })),
    });
  }, false),

  route('POST', '/api/models', async (ctx, _m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const contentType = req.headers['content-type'];
    const filename = req.headers['x-filename'];
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > 15728640) {
        throw new ApiError(413, 'too_large');
      }
      chunks.push(buf);
    }
    const buf = Buffer.concat(chunks);
    const intake = intakeChecks(contentType, buf);
    if (intake.error === 'unsupported_type') throw new ApiError(415, 'unsupported_type');
    if (intake.error === 'not_gltf') throw new ApiError(415, 'not_gltf');
    try {
      const model = await storeUpload(ctx.account.id, typeof filename === 'string' ? filename : '', buf);
      await setStorageNotice(ctx.account.id, null);
      void resumePendingValidation(ctx.account.id);
      json(res, 201, { model: modelJson(model) });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'too_large') throw new ApiError(413, 'too_large');
      if (code === 'quota_exceeded') throw new ApiError(413, 'quota_exceeded');
      if (code === 'storage_unavailable') {
        await setStorageNotice(ctx.account.id, 'upload_unavailable');
        throw new ApiError(503, 'storage_unavailable');
      }
      throw new ApiError(500, 'internal');
    }
  }),

  route('GET', '/api/models', async (ctx, _m, res) => {
    if (!ctx.account) throw unauthenticated();
    const models = await modelsForAccount(ctx.account.id);
    json(res, 200, { models: models.map(modelJson) });
  }),

  route('GET', '/api/models/([^/]+)', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const model = await modelById(m[1] ?? '');
    if (!model || model.account_id !== ctx.account.id) throw notFound();
    json(res, 200, { model: modelJson(model) });
  }),

  route('GET', '/api/models/([^/]+)/file', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const model = await modelById(m[1] ?? '');
    if (!model || model.account_id !== ctx.account.id) throw notFound();
    try {
      const buf = await readModelFile(ctx.account.id, model.id);
      res.writeHead(200, {
        'content-type': 'model/gltf-binary',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'attachment',
      });
      res.end(buf);
    } catch {
      throw new ApiError(503, 'storage_unavailable');
    }
  }),

  route('GET', '/api/models/([^/]+)/thumbnail', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const model = await modelById(m[1] ?? '');
    if (!model || model.account_id !== ctx.account.id) throw notFound();
    if (model.status !== 'accepted' && model.status !== 'equipped') throw notFound();
    try {
      const buf = await readThumbnail(ctx.account.id, model.id);
      res.writeHead(200, { 'content-type': 'image/png', 'x-content-type-options': 'nosniff' });
      res.end(buf);
    } catch {
      throw new ApiError(503, 'storage_unavailable');
    }
  }),

  route('DELETE', '/api/models/([^/]+)', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    try {
      await deleteModel(ctx.account.id, m[1] ?? '');
      await setStorageNotice(ctx.account.id, null);
      json(res, 204, '');
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'storage_unavailable') {
        await setStorageNotice(ctx.account.id, 'delete_unavailable');
        throw new ApiError(503, 'storage_unavailable');
      }
      if (code === 'not_found') throw notFound();
      throw new ApiError(500, 'internal');
    }
  }),

  route('POST', '/api/models/([^/]+)/equip', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const model = await modelById(m[1] ?? '');
    if (!model || model.account_id !== ctx.account.id) throw notFound();
    if (model.status !== 'accepted' && model.status !== 'equipped') throw new ApiError(409, 'model_not_accepted');
    const equipped = await equippedCharacter(ctx.account.id);
    if (!equipped) throw new ApiError(422, 'invalid_field', { fields: { character_id: ['invalid_field'] } });
    const accountId = ctx.account.id;
    await equipModel(accountId, model.id, equipped.id);
    const sessions = [...runningSessions.values()].filter((s) => s.members.some((mm) => mm.account_id === accountId));
    for (const s of sessions) {
      await refreshMemberHero(s, ctx.account.id);
      await persistSession(s);
    }
    json(res, 200, { model: modelJson({ ...(model as object), status: 'equipped' } as typeof model) });
  }),

  // Stories
  route('GET', '/api/stories', async (ctx, _m, res) => {
    if (!ctx.account) throw unauthenticated();
    const party = await partyForAccount(ctx.account.id);
    const out = [];
    for (const story of stories) {
      const progress = await storyProgressForCaller(ctx.account.id, party?.id ?? null, story.id);
      out.push({
        id: story.id,
        mode: story.mode,
        title: story.title[ctx.locale],
        chapters: story.chapters,
        progress: progress ? progressJson(progress) : null,
      });
    }
    json(res, 200, { stories: out });
  }),

  route('GET', '/api/stories/([^/]+)/progress', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const story = storyById(m[1] ?? '');
    if (!story) throw notFound();
    if (story.mode !== 'solo') throw new ApiError(409, 'wrong_story_mode');
    const progress = await progressFor('account', ctx.account.id, story.id);
    json(res, 200, { progress: progress ? progressJson(progress) : { unlocked_chapter: 1, completed_chapters: [], checkpoint: null } });
  }),

  route('POST', '/api/stories/([^/]+)/sessions', async (ctx, m, res, req) => {
    if (!ctx.account) throw unauthenticated();
    const story = storyById(m[1] ?? '');
    if (!story) throw notFound();
    const body = (await readJsonBody(req)) as { chapter?: unknown };
    if (typeof body.chapter !== 'number' || !Number.isInteger(body.chapter) || body.chapter < 1 || body.chapter > story.chapters) {
      throw new ApiError(422, 'invalid_field', { fields: { chapter: ['invalid_field'] } });
    }
    if (story.mode !== 'solo') throw new ApiError(409, 'wrong_story_mode');
    const progress = await progressFor('account', ctx.account.id, story.id);
    const unlocked = progress?.unlocked_chapter ?? 1;
    if (body.chapter > unlocked) throw new ApiError(409, 'chapter_locked');
    const checkpoint = progress?.checkpoint ?? null;
    const resumed = checkpoint !== null && checkpoint.chapter === body.chapter;
    const state = await createSoloSession(ctx.account.id, story.id, body.chapter);
    json(res, 201, { session_id: state.id, chapter: state.chapter, resumed_from_checkpoint: resumed });
  }),

  route('GET', '/api/sessions/([^/]+)', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const state = sessionState(m[1] ?? '');
    if (!state) throw notFound();
    const accountId = ctx.account.id;
    const member = state.members.find((mm) => mm.account_id === accountId);
    if (!member) throw notFound();
    json(res, 200, { session: snapshotJson(state) });
  }),

  route('GET', '/api/sessions/([^/]+)/members/([^/]+)/model', async (ctx, m, res) => {
    if (!ctx.account) throw unauthenticated();
    const state = sessionState(m[1] ?? '');
    if (!state || state.status !== 'running') throw notFound();
    const viewerAccountId = ctx.account.id;
    const viewer = state.members.find((mm) => mm.account_id === viewerAccountId);
    if (!viewer) throw notFound();
    const owner = state.members.find((mm) => mm.account_id === m[2]);
    if (!owner) throw notFound();
    if (!owner.modelId) throw notFound();
    const model = await modelById(owner.modelId);
    if (!model || (model.status !== 'accepted' && model.status !== 'equipped')) throw notFound();
    try {
      const buf = await readModelFile(owner.account_id, model.id);
      res.writeHead(200, {
        'content-type': 'model/gltf-binary',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'attachment',
      });
      res.end(buf);
    } catch {
      throw new ApiError(503, 'storage_unavailable');
    }
  }),
];

function characterIdFor(_w: Record<string, unknown>): string {
  return '';
}

function parseStrokes(input: unknown): Stroke[] {
  if (!Array.isArray(input)) {
    throw new ApiError(422, 'invalid_field', { fields: { strokes: ['stroke_count'] } });
  }
  const strokes: Stroke[] = [];
  let shapeError = false;
  let thicknessError = false;
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) {
      shapeError = true;
      continue;
    }
    const stroke = raw as { thickness?: unknown; points?: unknown };
    if (typeof stroke.thickness !== 'number' || stroke.thickness < 0.01 || stroke.thickness > 0.08) thicknessError = true;
    if (!Array.isArray(stroke.points)) { shapeError = true; continue; }
    const points: [number, number][] = [];
    for (const point of stroke.points) {
      if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number') {
        shapeError = true;
        break;
      }
      const [x, y] = point as [number, number];
      if (x < -1 || x > 1 || y < -1 || y > 1) { shapeError = true; break; }
      points.push([x, y]);
    }
    if (points.length < 2 || points.length > 200) { shapeError = true; continue; }
    strokes.push({ thickness: typeof stroke.thickness === 'number' ? stroke.thickness : 0.04, points });
  }
  // Shape and thickness are checked before counts.
  if (shapeError) throw new ApiError(422, 'invalid_field', { fields: { strokes: ['stroke_shape'] } });
  if (thicknessError) throw new ApiError(422, 'invalid_field', { fields: { thickness: ['stroke_thickness'] } });
  return strokes;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  return dispatch([...routes, ...extraRoutes], req, res);
}

export { routes as apiRoutes };
