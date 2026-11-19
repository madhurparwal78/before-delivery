import { randomUUID } from 'node:crypto';
import {
  checkLayoutName,
  checkPassword,
  checkUsername,
  checkVersionName,
} from '../shared/accounts.js';
import { BODY_MESSAGE, USERNAME_TAKEN_MESSAGE } from '../shared/messages.js';
import { readLayoutState } from '../shared/stateInput.js';
import { isTemplateKey, templateState } from '../shared/templates.js';
import type { LayoutState } from '../shared/types.js';
import { config, limits } from './config.js';
import { transaction } from './db.js';
import type { ApiReply } from './api.js';
import type { RequestContext } from './http.js';
import { checkCredentials, designerByUsername, hashPassword, newToken } from './store.js';

const notFound: ApiReply = { status: 404, body: { error: 'not_found' } };

function invalid(message: string): ApiReply {
  return { status: 422, body: { error: 'invalid', message } };
}

interface UserInput {
  username: string;
  password: string;
}

interface VersionInput {
  name: string;
  state: LayoutState;
}

interface LayoutInput {
  ref: string;
  owner: string;
  name: string;
  state: LayoutState;
  versions: VersionInput[];
  collaborators: string[];
  viewLink: boolean;
}

function readState(value: Record<string, unknown>): { ok: true; state: LayoutState } | { ok: false; message: string } {
  const template = value['template'];
  if (template !== undefined) {
    if (!isTemplateKey(template)) return { ok: false, message: 'Choose a starter template.' };
    return { ok: true, state: templateState(template) };
  }
  return readLayoutState(value, limits);
}

/** Creates the published users, layouts, versions, collaborators and links in one call. */
export async function handleGradingSetup(context: RequestContext): Promise<ApiReply> {
  const key = context.headers['x-grading-key'];
  if (!config.gradingKey || key !== config.gradingKey) return notFound;
  if (context.bodyInvalid) return invalid(BODY_MESSAGE);

  const rawUsers = Array.isArray(context.body['users']) ? (context.body['users'] as unknown[]) : [];
  const rawLayouts = Array.isArray(context.body['layouts']) ? (context.body['layouts'] as unknown[]) : [];

  const users: UserInput[] = [];
  for (const item of rawUsers) {
    if (typeof item !== 'object' || item === null) return invalid(BODY_MESSAGE);
    const value = item as Record<string, unknown>;
    const usernameProblem = checkUsername(value['username']);
    if (usernameProblem) return invalid(usernameProblem);
    const passwordProblem = checkPassword(value['password']);
    if (passwordProblem) return invalid(passwordProblem);
    users.push({ username: value['username'] as string, password: value['password'] as string });
  }

  const layoutInputs: LayoutInput[] = [];
  for (const item of rawLayouts) {
    if (typeof item !== 'object' || item === null) return invalid(BODY_MESSAGE);
    const value = item as Record<string, unknown>;
    if (typeof value['ref'] !== 'string' || typeof value['owner'] !== 'string') return invalid(BODY_MESSAGE);
    const nameProblem = checkLayoutName(value['name']);
    if (nameProblem) return invalid(nameProblem);
    const state = readState(value);
    if (!state.ok) return invalid(state.message);

    const versions: VersionInput[] = [];
    const rawVersions = Array.isArray(value['versions']) ? (value['versions'] as unknown[]) : [];
    for (const rawVersion of rawVersions) {
      if (typeof rawVersion !== 'object' || rawVersion === null) return invalid(BODY_MESSAGE);
      const versionValue = rawVersion as Record<string, unknown>;
      const versionNameProblem = checkVersionName(versionValue['name']);
      if (versionNameProblem) return invalid(versionNameProblem);
      const versionState = readState(versionValue);
      if (!versionState.ok) return invalid(versionState.message);
      versions.push({ name: versionValue['name'] as string, state: versionState.state });
    }

    const collaborators: string[] = [];
    const rawCollaborators = Array.isArray(value['collaborators']) ? (value['collaborators'] as unknown[]) : [];
    for (const name of rawCollaborators) {
      const problem = checkUsername(name);
      if (problem) return invalid(problem);
      collaborators.push(name as string);
    }

    layoutInputs.push({
      ref: value['ref'],
      owner: value['owner'],
      name: (value['name'] as string).trim(),
      state: state.state,
      versions,
      collaborators,
      viewLink: value['view_link'] === true,
    });
  }

  const existing = new Map<string, string>();
  for (const user of users) {
    const found = await designerByUsername(user.username);
    if (!found) continue;
    const matches = await checkCredentials(user.username, user.password);
    if (!matches) return { status: 409, body: { error: 'taken', message: USERNAME_TAKEN_MESSAGE } };
    existing.set(user.username, found.id);
  }

  const namedUsers = new Set(users.map((user) => user.username));
  for (const layout of layoutInputs) {
    for (const username of [layout.owner, ...layout.collaborators]) {
      if (namedUsers.has(username) || existing.has(username)) continue;
      const found = await designerByUsername(username);
      if (!found) return invalid(BODY_MESSAGE);
      existing.set(username, found.id);
    }
  }

  const hashes = new Map<string, string>();
  for (const user of users) {
    if (existing.has(user.username)) continue;
    hashes.set(user.username, await hashPassword(user.password));
  }

  const result = await transaction(async (client) => {
    const designerIds = new Map(existing);
    for (const user of users) {
      if (designerIds.has(user.username)) continue;
      const id = randomUUID();
      await client.query('insert into designers (id, username, password_hash) values ($1, $2, $3)', [
        id,
        user.username,
        hashes.get(user.username) as string,
      ]);
      designerIds.set(user.username, id);
    }

    const sessions: Record<string, string> = {};
    for (const [username, id] of designerIds) {
      const token = newToken();
      await client.query('insert into sessions (token, designer_id) values ($1, $2)', [token, id]);
      sessions[username] = token;
    }

    const layouts: Record<string, { id: string; revision: number; view_path: string | null; join_path: string }> = {};
    for (const input of layoutInputs) {
      const ownerId = designerIds.get(input.owner) as string;
      const id = randomUUID();
      await client.query(
        'insert into layouts (id, owner_id, name, revision, state) values ($1, $2, $3, 1, $4)',
        [id, ownerId, input.name, JSON.stringify(input.state)],
      );
      const joinToken = newToken();
      await client.query('insert into links (token, layout_id, kind, active) values ($1, $2, $3, true)', [
        joinToken,
        id,
        'join',
      ]);
      let viewPath: string | null = null;
      if (input.viewLink) {
        const viewToken = newToken();
        await client.query('insert into links (token, layout_id, kind, active) values ($1, $2, $3, true)', [
          viewToken,
          id,
          'view',
        ]);
        viewPath = `/view/${viewToken}`;
      }
      for (let index = 0; index < input.versions.length; index += 1) {
        const version = input.versions[index] as VersionInput;
        await client.query(
          'insert into versions (layout_id, number, name, revision, state) values ($1, $2, $3, 1, $4)',
          [id, index + 1, version.name, JSON.stringify(version.state)],
        );
      }
      for (const username of input.collaborators) {
        const collaboratorId = designerIds.get(username) as string;
        if (collaboratorId === ownerId) continue;
        await client.query(
          'insert into collaborators (layout_id, designer_id) values ($1, $2) on conflict do nothing',
          [id, collaboratorId],
        );
      }
      layouts[input.ref] = { id, revision: 1, view_path: viewPath, join_path: `/join/${joinToken}` };
    }

    return { sessions, layouts };
  });

  return { status: 201, body: result };
}
