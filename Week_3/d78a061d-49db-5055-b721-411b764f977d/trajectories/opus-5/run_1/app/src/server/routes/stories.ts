import { errors } from '../errors.js';
import { readJsonBody, requireAccount, type Ctx, type Reply } from '../http.js';
import { STORIES } from '../../shared/constants.js';
import { t, type MessageKey } from '../../shared/i18n/index.js';
import type { StoryListEntry } from '../../shared/types.js';
import { readProgress, storyChapters, storyMode } from '../domain/progress.js';
import { loadParty, partyIdOf } from '../domain/party.js';
import {
  createSession,
  endRunningSoloSessions,
  sessionRecord,
  snapshotFor,
} from '../sessions/engine.js';
import { getObject, originalKey } from '../storage/s3.js';
import { query } from '../db.js';

export async function listStories(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const partyId = await partyIdOf(account.id);
  const party = partyId === null ? null : await loadParty(partyId);
  const stories: StoryListEntry[] = [];
  for (const story of STORIES) {
    const progress =
      story.mode === 'solo'
        ? await readProgress({ kind: 'solo', accountId: account.id }, story.id)
        : party !== null && party.story_id === story.id
          ? party.progress
          : partyId === null
            ? null
            : await readProgress({ kind: 'party', partyId }, story.id);
    stories.push({
      id: story.id,
      mode: story.mode,
      title: t(ctx.locale, `story.${story.id}` as MessageKey),
      chapters: story.chapters,
      progress,
    });
  }
  return { status: 200, body: { stories } };
}

export async function getStoryProgress(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const mode = storyMode(ctx.params.id);
  if (mode === null) throw errors.notFound();
  if (mode === 'coop') throw errors.conflict('wrong_story_mode', { key: 'fb.generic' });
  return {
    status: 200,
    body: { progress: await readProgress({ kind: 'solo', accountId: account.id }, ctx.params.id) },
  };
}

export async function startStorySession(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const storyId = ctx.params.id;
  const chapters = storyChapters(storyId);
  const mode = storyMode(storyId);
  if (chapters === null || mode === null) throw errors.notFound();

  const input = (await readJsonBody(ctx.req)) as { chapter?: unknown };
  const chapter = input.chapter;
  if (!Number.isInteger(chapter) || (chapter as number) < 1 || (chapter as number) > chapters) {
    throw errors.invalidField('chapter', { key: 'fb.chapterInvalid' });
  }
  if (mode === 'coop') throw errors.conflict('wrong_story_mode', { key: 'fb.generic' });

  const progress = await readProgress({ kind: 'solo', accountId: account.id }, storyId);
  if ((chapter as number) > progress.unlocked_chapter) {
    throw errors.conflict('chapter_locked', { key: 'fb.chapterLocked' });
  }

  await endRunningSoloSessions(account.id);
  const created = await createSession({
    storyId,
    chapter: chapter as number,
    mode: 'solo',
    members: [{ account_id: account.id, display_name: account.display_name }],
    partyId: null,
    ownerAccountId: account.id,
  });
  return { status: 201, body: created };
}

export async function getSession(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const record = await sessionRecord(ctx.params.id);
  if (record === null || record.status === 'ended') throw errors.notFound();
  if (!record.members.some((member) => member.account_id === account.id)) throw errors.notFound();
  const snapshot = await snapshotFor(ctx.params.id);
  if (snapshot === null) throw errors.notFound();
  return { status: 200, body: { session: snapshot } };
}

export async function getSessionMemberModel(ctx: Ctx): Promise<Reply> {
  const account = requireAccount(ctx);
  const record = await sessionRecord(ctx.params.id);
  if (record === null || record.status !== 'running') throw errors.notFound();
  if (!record.members.some((member) => member.account_id === account.id)) throw errors.notFound();
  const ownerId = ctx.params.accountId;
  if (!record.members.some((member) => member.account_id === ownerId)) throw errors.notFound();

  const rows = await query<{ id: string; status: string }>(
    `SELECT m.id, m.status FROM accounts a
     JOIN characters c ON c.id = a.equipped_character_id
     JOIN models m ON m.id = c.model_id
     WHERE a.id = $1`,
    [ownerId],
  );
  const model = rows[0];
  if (model === undefined || (model.status !== 'accepted' && model.status !== 'equipped')) {
    throw errors.notFound();
  }
  let bytes: Buffer | null;
  try {
    bytes = await getObject(originalKey(ownerId, model.id));
  } catch {
    throw errors.storageUnavailable('upload');
  }
  if (bytes === null) throw errors.notFound();
  return {
    status: 200,
    raw: { contentType: 'model/gltf-binary', body: bytes },
    headers: { 'Content-Disposition': 'attachment' },
  };
}
