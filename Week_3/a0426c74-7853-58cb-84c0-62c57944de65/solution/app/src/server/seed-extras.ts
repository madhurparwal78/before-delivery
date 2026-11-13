// The sheet side of the grading seed: sheets with viewports, published versions (through the normal publish path), markups, issues,
// RFIs, reviews and view links.
import * as copy from '../shared/copy.ts';
import { fieldError } from '../shared/errors.ts';
import { isIssueState, isReviewStepState, isRfiState, isVersionState, REVIEW_STEP_ROLES } from '../shared/rules.ts';
import type { ReviewStep } from '../shared/types.ts';
import { type Body, objectBody, stringField } from './body.ts';
import { db } from './db.ts';
import { getDrawing } from './drawings.ts';
import { insertIssue, issueDraft } from './issues.ts';
import { createLink } from './links.ts';
import { insertMarkup, markupDraft } from './markups.ts';
import { publishSheet } from './publish.ts';
import { registerSeedStep, type SeededDrawing, type SeedOutput } from './registry.ts';
import { reviewDueAt, watchPendingStep } from './reviews.ts';
import { insertRfi } from './rfis.ts';
import { attributeInput, insertSheet, insertViewport, sheetInput } from './sheets.ts';
import { viewportInput } from './viewport-input.ts';

function list(body: Body, name: string): Body[] {
  const value = body[name] ?? [];
  if (!Array.isArray(value)) throw fieldError(name, copy.invalidValue(name));
  return value.map(objectBody);
}

/** The person the seed attributes sheets, markups and issues to when a record names nobody: the highest edit-capable role on the folder. */
async function defaultActor(folderId: string): Promise<string> {
  const rows = await db.query<{ username: string }>(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id FROM folders WHERE id = $1
       UNION ALL SELECT p.id, p.parent_id FROM folders p JOIN chain c ON p.id = c.parent_id)
     SELECT r.username FROM chain c JOIN folder_roles r ON r.folder_id = c.id
      ORDER BY CASE r.role WHEN 'edit' THEN 0 WHEN 'manage' THEN 1 WHEN 'markup' THEN 2 ELSE 3 END, c.id = $1 DESC, r.username LIMIT 1`,
    [folderId],
  );
  if (rows.length === 0) throw fieldError('sheets', copy.invalidValue('sheets'));
  return rows[0].username;
}

async function versionId(sheetId: string, record: Body): Promise<string> {
  const number = record.version;
  const rows = await db.query<{ id: string }>('SELECT id FROM versions WHERE sheet_id = $1 AND number = $2', [sheetId, typeof number === 'number' ? number : 0]);
  if (rows.length === 0) throw fieldError('version', copy.invalidValue('version'));
  return rows[0].id;
}

const personField = (record: Body, name: string, fallback: string): string => stringField(record, name) || fallback;

async function seedReview(sheetId: string, record: Body): Promise<void> {
  const id = await versionId(sheetId, record);
  if (!isVersionState(record.state)) throw fieldError('state', copy.invalidValue('state'));
  const steps: ReviewStep[] = list(record, 'steps').map((step) => {
    const role = REVIEW_STEP_ROLES.find((candidate) => candidate === step.role);
    if (!role || !isReviewStepState(step.state)) throw fieldError('steps', copy.invalidValue('steps'));
    const due = typeof step.due_at === 'string' ? step.due_at : null;
    return { role, state: step.state, due_at: due ?? (step.state === 'pending' ? reviewDueAt() : null) };
  });
  await db.query('UPDATE versions SET state = $2, steps = $3 WHERE id = $1', [id, record.state, JSON.stringify(steps)]);
  watchPendingStep(id, steps);
}

async function seedSheet(drawing: SeededDrawing, record: Body, creator: string, output: SeedOutput): Promise<void> {
  const locked = record.locked === true;
  const sheet = await insertSheet(drawing.id, { ...sheetInput(record), creator, locked_by: locked ? creator : null, attributes: {} });
  const key = stringField(record, 'key');
  output.sheets[key] = sheet.id;
  if (record.attributes !== undefined) {
    const attributes = attributeInput(sheet, record.attributes);
    await db.query('UPDATE sheets SET attributes = $2 WHERE id = $1', [sheet.id, JSON.stringify(attributes)]);
  }
  for (const viewport of list(record, 'viewports')) await insertViewport(sheet.id, viewportInput(viewport, null));
  const publish = typeof record.publish === 'number' ? record.publish : 0;
  for (let number = 1; number <= publish; number++) {
    const published = await publishSheet(drawing.id, sheet.id, (await getDrawing(drawing.id)).state);
    output.versions[`${key}:${published.number}`] = published.id;
  }
  for (const markup of list(record, 'markups')) {
    await insertMarkup(db, await versionId(sheet.id, markup), markupDraft(markup), null, personField(markup, 'author', creator));
  }
  for (const issue of list(record, 'issues')) {
    const state = issue.state ?? 'open';
    if (!isIssueState(state)) throw fieldError('state', copy.invalidValue('state'));
    output.issues[stringField(issue, 'key')] = await insertIssue(db, await versionId(sheet.id, issue), issueDraft(issue), personField(issue, 'creator', creator), state);
  }
  for (const rfi of list(record, 'rfis')) {
    const state = rfi.state ?? 'draft';
    const issueId = output.issues[stringField(rfi, 'issue')];
    if (!isRfiState(state) || issueId === undefined) throw fieldError('rfis', copy.invalidValue('rfis'));
    const asker = personField(rfi, 'asker', creator);
    const answer = typeof rfi.answer === 'string' ? rfi.answer : null;
    output.rfis[stringField(rfi, 'key')] = await insertRfi(db, issueId, { question: stringField(rfi, 'question'), asker, addressee: stringField(rfi, 'addressee') }, state, answer);
  }
  for (const review of list(record, 'reviews')) await seedReview(sheet.id, review);
  for (const link of list(record, 'links')) {
    output.links[stringField(link, 'key')] = (await createLink(await versionId(sheet.id, link), creator)).url;
  }
}

registerSeedStep(async (drawing, output) => {
  if (drawing.sheets === undefined) return;
  if (!Array.isArray(drawing.sheets)) throw fieldError('sheets', copy.invalidValue('sheets'));
  const creator = await defaultActor(drawing.folderId);
  for (const sheet of drawing.sheets) await seedSheet(drawing, objectBody(sheet), creator, output);
});
