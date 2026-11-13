import {
  authenticate,
  createQuizmaster,
  endSession,
  startSession,
  validateCredentials,
} from '../accounts.js';
import { readJsonBody, readSessionCookie } from '../http/request.js';
import { sendJson, sendNoContent } from '../http/respond.js';
import { readString } from '../parse.js';
import { clearSessionCookie, requireQuizmaster, setSessionCookie, type Ctx } from './context.js';

export async function signup(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx.req);
  const credentials = validateCredentials(
    readString(body, 'email'),
    readString(body, 'password'),
    readString(body, 'displayName'),
  );
  const quizmaster = await createQuizmaster(
    credentials.email,
    credentials.password,
    credentials.displayName,
  );
  setSessionCookie(ctx.res, await startSession(quizmaster.id));
  sendJson(ctx.res, 201, { quizmaster });
}

export async function login(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx.req);
  const quizmaster = await authenticate(readString(body, 'email') ?? '', readString(body, 'password') ?? '');
  setSessionCookie(ctx.res, await startSession(quizmaster.id));
  sendJson(ctx.res, 200, { quizmaster });
}

export async function logout(ctx: Ctx): Promise<void> {
  const token = readSessionCookie(ctx.req);
  if (token) await endSession(token);
  clearSessionCookie(ctx.res);
  sendNoContent(ctx.res);
}

export async function me(ctx: Ctx): Promise<void> {
  sendJson(ctx.res, 200, { quizmaster: await requireQuizmaster(ctx) });
}
