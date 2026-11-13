import { IMAGE_MAX_BYTES } from '../../shared/protocol.js';
import {
  addQuestion,
  createDeck,
  deleteQuestion,
  listDecks,
  readDeck,
  renameDeck,
  requireQuestion,
  saveQuestion,
  setQuestionImage,
} from '../decks.js';
import { emptyFile, imageTooLarge, unsupportedType } from '../errors.js';
import { parseQuestionDraft, validateDeckTitle } from '../domain/questions.js';
import { sniffPicture } from '../domain/pictureBytes.js';
import { assertPictureStoreReady, pictureKey, putPicture } from '../images/minio.js';
import { readJsonBody, readUploadBody } from '../http/request.js';
import { sendJson, sendNoContent } from '../http/respond.js';
import { FieldErrors, readInteger, readString } from '../parse.js';
import { validationFailed } from '../errors.js';
import { param, requireQuizmaster, type Ctx } from './context.js';

export async function getDecks(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  sendJson(ctx.res, 200, { decks: await listDecks(quizmaster.id) });
}

export async function postDeck(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  const body = await readJsonBody(ctx.req);
  const errors = new FieldErrors();
  const title = validateDeckTitle(readString(body, 'title'), errors);
  errors.throwIfAny();
  sendJson(ctx.res, 201, { deck: await createDeck(quizmaster.id, title) });
}

export async function getDeck(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  sendJson(ctx.res, 200, { deck: await readDeck(quizmaster.id, param(ctx, 'deckId')) });
}

export async function patchDeck(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  const body = await readJsonBody(ctx.req);
  const errors = new FieldErrors();
  const title = validateDeckTitle(readString(body, 'title'), errors);
  const version = readInteger(body, 'version');
  if (version === null) errors.add('version', 'Send the version you are editing.');
  errors.throwIfAny();
  const deck = await renameDeck(quizmaster.id, param(ctx, 'deckId'), title, version as number);
  sendJson(ctx.res, 200, { deck });
}

export async function postQuestion(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  const draft = parseQuestionDraft(await readJsonBody(ctx.req));
  const question = await addQuestion(quizmaster.id, param(ctx, 'deckId'), draft);
  sendJson(ctx.res, 201, { question });
}

export async function putQuestion(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  const body = await readJsonBody(ctx.req);
  const version = readInteger(body, 'version');
  if (version === null) throw validationFailed({ version: 'Send the version you are editing.' });
  const draft = parseQuestionDraft(body);
  const question = await saveQuestion(
    quizmaster.id,
    param(ctx, 'deckId'),
    param(ctx, 'questionId'),
    draft,
    version,
  );
  sendJson(ctx.res, 200, { question });
}

export async function removeQuestion(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  await deleteQuestion(quizmaster.id, param(ctx, 'deckId'), param(ctx, 'questionId'));
  sendNoContent(ctx.res);
}

export async function postQuestionImage(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  const deckId = param(ctx, 'deckId');
  const questionId = param(ctx, 'questionId');
  await requireQuestion(quizmaster.id, deckId, questionId);

  const bytes = await readPictureField(ctx);
  if (bytes.byteLength === 0) throw emptyFile();
  if (bytes.byteLength > IMAGE_MAX_BYTES) throw imageTooLarge();
  const format = sniffPicture(bytes);
  if (!format) throw unsupportedType();

  const key = pictureKey(questionId, bytes, format.extension);
  const stored = await putPicture(key, bytes, format.contentType);
  const question = await setQuestionImage(deckId, questionId, {
    key,
    contentType: stored.contentType,
    bytes: stored.bytes,
  });
  sendJson(ctx.res, 201, { question });
}

async function readPictureField(ctx: Ctx): Promise<Buffer> {
  const body = await readUploadBody(ctx.req);
  const contentType = ctx.req.headers['content-type'] ?? '';
  if (!contentType.startsWith('multipart/form-data')) throw emptyFile();
  let field: FormDataEntryValue | null;
  try {
    const form = await new Response(new Uint8Array(body), {
      headers: { 'content-type': contentType },
    }).formData();
    field = form.get('image');
  } catch {
    throw emptyFile();
  }
  if (field === null || typeof field === 'string') throw emptyFile();
  return Buffer.from(await field.arrayBuffer());
}

export async function deleteQuestionImage(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  const deckId = param(ctx, 'deckId');
  const questionId = param(ctx, 'questionId');
  await requireQuestion(quizmaster.id, deckId, questionId);
  await assertPictureStoreReady();
  await setQuestionImage(deckId, questionId, null);
  sendNoContent(ctx.res);
}
