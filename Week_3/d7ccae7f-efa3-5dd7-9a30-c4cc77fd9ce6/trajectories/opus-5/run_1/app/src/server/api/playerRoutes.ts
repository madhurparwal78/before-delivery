import { readJsonBody } from '../http/request.js';
import { sendJson } from '../http/respond.js';
import { readString } from '../parse.js';
import { joinRoom, recordAnswer, rejoinRoom, requireSeatClient } from '../rooms/players.js';
import { playerRoomView, readRoom } from '../rooms/store.js';
import { notFound } from '../errors.js';
import { param, type Ctx } from './context.js';

export async function postJoin(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx.req);
  const result = await joinRoom(readString(body, 'pin') ?? '', readString(body, 'nickname') ?? '');
  sendJson(ctx.res, 201, result);
}

export async function postRejoin(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx.req);
  sendJson(ctx.res, 200, await rejoinRoom(readString(body, 'rejoinToken') ?? ''));
}

export async function getPlayerState(ctx: Ctx): Promise<void> {
  const roomId = param(ctx, 'roomId');
  const client = await requireSeatClient(roomId, ctx.url.searchParams.get('clientId'));
  const room = await readRoom(roomId);
  if (!room) throw notFound();
  sendJson(ctx.res, 200, await playerRoomView(room, client.seatId));
}

export async function postAnswer(ctx: Ctx): Promise<void> {
  const receivedAt = ctx.receivedAt;
  const roomId = param(ctx, 'roomId');
  const body = await readJsonBody(ctx.req);
  const client = await requireSeatClient(roomId, body['clientId']);
  const answer = await recordAnswer(receivedAt, roomId, client.seatId, body);
  sendJson(ctx.res, 201, { answer });
}
