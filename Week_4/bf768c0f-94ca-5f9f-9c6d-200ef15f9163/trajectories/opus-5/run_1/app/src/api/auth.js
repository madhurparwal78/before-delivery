/**
 * Joining, signing in and out, the profile and the profile picture.
 */

import express from 'express';
import { one, rows, query, newId } from '../db.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, newToken, hashToken } from '../security.js';
import {
  route, fail, bodyObject, requireString, requireMember, requireOneOf, requireBoolean, bearerToken,
} from '../http.js';
import {
  selfMember, publicMember, isValidUsername, AVATAR_KEYS, VIEWS, PIECE_SETS_2D, PIECE_SETS_3D, THEMES,
} from '../members.js';
import { normaliseUpload, parseMultipart } from '../media.js';

export const router = express.Router();

const SESSION_COOKIE = 'gh_token';

function setSessionCookie(res, token) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

async function openSession(res, member) {
  const token = newToken();
  await query('insert into sessions (id, member_id, token_hash) values ($1, $2, $3)', [
    newId(), member.id, hashToken(token),
  ]);
  setSessionCookie(res, token);
  return token;
}

router.post('/auth/register', route(async (req, res) => {
  const body = bodyObject(req);
  const username = body.username;
  if (!isValidUsername(username)) {
    fail(422, 'A username is 3 to 20 characters of letters, digits and the underscore only.');
  }
  const email = requireString(body.email, 'Email', { max: 200 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(422, 'That email address cannot be read.');
  requireString(body.password, 'Password', { min: 8, max: 200 });

  const takenName = await one('select id from members where lower(username) = lower($1)', [username]);
  if (takenName) fail(409, 'That username is taken.');
  const takenEmail = await one('select id from members where lower(email) = lower($1)', [email]);
  if (takenEmail) fail(409, 'That email address is already in the club.');

  let member;
  try {
    member = await one(
      `insert into members (id, username, email, password_hash)
       values ($1, $2, $3, $4) returning *`,
      [newId(), username, email, hashPassword(body.password)],
    );
  } catch (error) {
    if (error.code === '23505') fail(409, 'That username is taken.');
    throw error;
  }
  await openSession(res, member);
  res.status(201).json(selfMember(member));
}));

router.post('/auth/login', route(async (req, res) => {
  const body = bodyObject(req);
  const identifier = requireString(body.email, 'Username', { max: 200 });
  const password = requireString(body.password, 'Password', { max: 200 });

  const member = await one(
    'select * from members where lower(username) = lower($1) or lower(email) = lower($1)',
    [identifier],
  );
  const accountName = member ? member.username : identifier;

  const lock = await one(
    `select count(*)::int as fails, max(attempted_at) as last_fail from login_attempts
      where lower(username) = lower($1) and succeeded = false
        and attempted_at > coalesce(
          (select max(attempted_at) from login_attempts where lower(username) = lower($1) and succeeded),
          to_timestamp(0))`,
    [accountName],
  );
  if (lock.fails >= config.loginMaxFails && lock.last_fail) {
    const since = (Date.now() - new Date(lock.last_fail).getTime()) / 1000;
    if (since < config.lockoutSec) {
      const wait = Math.ceil(config.lockoutSec - since);
      fail(423, `This account is locked after too many refused sign-ins. Try again in ${wait} seconds.`);
    }
  }

  if (!member || !verifyPassword(password, member.password_hash)) {
    await query('insert into login_attempts (id, username, succeeded) values ($1, $2, false)', [newId(), accountName]);
    fail(401, 'That username and password do not match.');
  }

  await query('insert into login_attempts (id, username, succeeded) values ($1, $2, true)', [newId(), accountName]);
  const token = await openSession(res, member);
  res.json({ token, member: selfMember(member) });
}));

router.post('/auth/logout', route(async (req, res) => {
  const token = bearerToken(req);
  if (token) await query('delete from sessions where token_hash = $1', [hashToken(token)]);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

router.get('/profile', route(async (req, res) => {
  const member = requireMember(req);
  res.json(selfMember(member));
}));

/** Apply the preference fields, refusing any value outside the published lists. */
export async function applyProfilePatch(member, body) {
  const updates = [];
  const params = [member.id];

  if (Object.hasOwn(body, 'username')) {
    const username = body.username;
    if (!isValidUsername(username)) {
      fail(422, 'A username is 3 to 20 characters of letters, digits and the underscore only.');
    }
    const taken = await one(
      'select id from members where lower(username) = lower($1) and id <> $2',
      [username, member.id],
    );
    if (taken) fail(409, 'That username is taken.');
    params.push(username);
    updates.push(`username = $${params.length}`);
  }
  const enums = [
    ['view', VIEWS], ['piece_set_2d', PIECE_SETS_2D], ['piece_set_3d', PIECE_SETS_3D], ['theme', THEMES],
  ];
  for (const [field, options] of enums) {
    if (!Object.hasOwn(body, field)) continue;
    requireOneOf(body[field], options, field);
    params.push(body[field]);
    updates.push(`${field} = $${params.length}`);
  }
  if (Object.hasOwn(body, 'sound')) {
    requireBoolean(body.sound, 'sound');
    params.push(body.sound);
    updates.push(`sound = $${params.length}`);
  }
  if (!updates.length) fail(422, 'That request changes nothing.');
  const updated = await one(
    `update members set ${updates.join(', ')} where id = $1 returning *`,
    params,
  );
  return updated;
}

router.patch('/profile', route(async (req, res) => {
  const member = requireMember(req);
  const updated = await applyProfilePatch(member, bodyObject(req));
  res.json(selfMember(updated));
}));

/** The avatar endpoint, shared by /profile/avatar and /members/{username}/avatar. */
export async function applyAvatar(req, res, member) {
  const contentType = req.get('content-type') || '';
  if (contentType.startsWith('multipart/form-data')) {
    const parts = parseMultipart(req.rawBody || Buffer.alloc(0), contentType);
    const file = parts.find((part) => part.name === 'file' && part.filename);
    if (!file) fail(422, 'Attach the picture in a field named file.');
    const png = await normaliseUpload(file.body, file.filename, file.mime);
    const updated = await one(
      `update members set avatar_key = 'upload', avatar_mime = 'image/png', avatar_bytes = $2
       where id = $1 returning *`,
      [member.id, png],
    );
    return res.json(selfMember(updated));
  }
  const body = bodyObject(req);
  const avatar = requireString(body.avatar, 'avatar', { max: 40 });
  if (!AVATAR_KEYS.includes(avatar)) {
    fail(422, 'Choose one of avatar_01 to avatar_12, or upload a picture.');
  }
  const updated = await one(
    `update members set avatar_key = $2, avatar_mime = null, avatar_bytes = null
     where id = $1 returning *`,
    [member.id, avatar],
  );
  return res.json(selfMember(updated));
}

router.put('/profile/avatar', route(async (req, res) => {
  const member = requireMember(req);
  await applyAvatar(req, res, member);
}));

export async function memberByUsername(username) {
  return one('select * from members where lower(username) = lower($1)', [username]);
}

export { publicMember, rows };
