import { serverNow } from '../clock.js';
import { validationFailed } from '../errors.js';
import { isHostCommand } from '../../shared/transitions.js';
import { readJsonBody } from '../http/request.js';
import { sendJson } from '../http/respond.js';
import { listNights, readNight } from '../nights.js';
import { readString } from '../parse.js';
import { openRoom, runHostCommand } from '../rooms/lifecycle.js';
import { hostRoomView, readOwnedRoom, readRoom } from '../rooms/store.js';
import { notFound } from '../errors.js';
import { param, requireQuizmaster, type Ctx } from './context.js';

export async function postRoom(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  const body = await readJsonBody(ctx.req);
  const deckId = readString(body, 'deckId');
  if (deckId === null) throw validationFailed({ deckId: 'Pick a deck to open a room for.' });
  const roomId = await openRoom(quizmaster.id, deckId);
  const room = await readRoom(roomId);
  if (!room) throw notFound();
  sendJson(ctx.res, 201, { room: await hostRoomView(room) });
}

export async function getHostRoom(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  const room = await readOwnedRoom(param(ctx, 'roomId'), quizmaster.id);
  sendJson(ctx.res, 200, { room: await hostRoomView(room) });
}

export async function postRoomCommand(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  const roomId = param(ctx, 'roomId');
  const body = await readJsonBody(ctx.req);
  const command = body['command'];
  if (!isHostCommand(command)) throw validationFailed({ command: 'Send a known host command.' });
  await runHostCommand(quizmaster.id, roomId, command);
  const room = await readOwnedRoom(roomId, quizmaster.id);
  sendJson(ctx.res, 200, { room: await hostRoomView(room) });
}

export async function getNights(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  sendJson(ctx.res, 200, { nights: await listNights(quizmaster.id) });
}

export async function getNight(ctx: Ctx): Promise<void> {
  const quizmaster = await requireQuizmaster(ctx);
  sendJson(ctx.res, 200, { night: await readNight(quizmaster.id, param(ctx, 'roomId')) });
}

export function getTime(ctx: Ctx): void {
  sendJson(ctx.res, 200, { serverNow: serverNow() });
}
