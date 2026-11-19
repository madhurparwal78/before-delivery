import { timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { mediaObjectByKey } from "../shared/media-manifest.js";
import { checkEnquiry, normaliseEnquiry } from "../shared/enquiry.js";
import { type Config } from "./config.js";
import {
  BAD_REQUEST, MAIL_UNAVAILABLE, MEDIA_UNAVAILABLE, METHOD_NOT_ALLOWED, NOT_FOUND, TOO_LARGE,
  invalidEnquiry, readJsonObject, sendError, sendJson, sendNoContent,
} from "./http.js";
import { MailUnavailableError, composeEnquiryMail, mailAcceptsConnection, sendMail } from "./mail.js";
import { type MediaLibrary } from "./media-library.js";
import { StorageUnavailableError } from "./object-store.js";

/** The API and media routes. Errors are decided in one fixed order: unknown route, wrong method, grading key, body size,
 * body shape, field checks. */

export interface ApiContext {
  readonly config: Config;
  readonly library: MediaLibrary;
}

interface Route {
  readonly pattern: RegExp;
  readonly method: string;
  readonly grading: boolean;
  readonly takesBody: boolean;
  readonly run: (context: ApiContext, request: IncomingMessage, response: ServerResponse, parameter: string, body: Record<string, unknown>) => Promise<void>;
}

async function health(context: ApiContext, _request: IncomingMessage, response: ServerResponse): Promise<void> {
  const [storage, mail] = await Promise.all([context.library.storageAnswers(), mailAcceptsConnection(context.config.mail)]);
  sendJson(response, 200, { status: storage && mail ? "ok" : "unavailable" });
}

async function mediaReport(context: ApiContext, _request: IncomingMessage, response: ServerResponse): Promise<void> {
  sendJson(response, 200, await context.library.report());
}

async function mediaObject(context: ApiContext, _request: IncomingMessage, response: ServerResponse, key: string): Promise<void> {
  if (mediaObjectByKey(key) === undefined) {
    sendError(response, 404, NOT_FOUND);
    return;
  }
  try {
    const object = await context.library.read(key);
    if (object === undefined) {
      sendError(response, 404, NOT_FOUND);
      return;
    }
    response.writeHead(200, { "content-type": object.contentType, "x-content-type-options": "nosniff", "cache-control": "no-cache" });
    response.end(object.bytes);
  } catch (error) {
    if (!(error instanceof StorageUnavailableError)) throw error;
    sendError(response, 503, MEDIA_UNAVAILABLE);
  }
}

async function enquiry(context: ApiContext, _request: IncomingMessage, response: ServerResponse, _parameter: string, body: Record<string, unknown>): Promise<void> {
  const normalised = normaliseEnquiry(body);
  const messages = checkEnquiry(normalised);
  if (Object.keys(messages).length > 0) {
    sendJson(response, 422, invalidEnquiry(messages));
    return;
  }
  try {
    await sendMail(context.config.mail, composeEnquiryMail(normalised, context.config.mail.from));
  } catch (error) {
    if (!(error instanceof MailUnavailableError)) throw error;
    sendError(response, 503, MAIL_UNAVAILABLE);
    return;
  }
  sendJson(response, 201, { status: "sent" });
}

async function removeObject(context: ApiContext, _request: IncomingMessage, response: ServerResponse, key: string): Promise<void> {
  if (mediaObjectByKey(key) === undefined) {
    sendError(response, 404, NOT_FOUND);
    return;
  }
  try {
    await context.library.remove(key);
    sendNoContent(response);
  } catch (error) {
    if (!(error instanceof StorageUnavailableError)) throw error;
    sendError(response, 503, MEDIA_UNAVAILABLE);
  }
}

async function resetObjects(context: ApiContext, _request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    await context.library.restore();
    sendJson(response, 200, { status: "ok" });
  } catch (error) {
    if (!(error instanceof StorageUnavailableError)) throw error;
    sendError(response, 503, MEDIA_UNAVAILABLE);
  }
}

const ROUTES: readonly Route[] = [
  { pattern: /^\/api\/health$/, method: "GET", grading: false, takesBody: false, run: health },
  { pattern: /^\/api\/media$/, method: "GET", grading: false, takesBody: false, run: mediaReport },
  { pattern: /^\/media\/(.+)$/, method: "GET", grading: false, takesBody: false, run: mediaObject },
  { pattern: /^\/api\/enquiries$/, method: "POST", grading: false, takesBody: true, run: enquiry },
  { pattern: /^\/api\/grading\/media\/(.+)$/, method: "DELETE", grading: true, takesBody: false, run: removeObject },
  { pattern: /^\/api\/grading\/reset$/, method: "POST", grading: true, takesBody: false, run: resetObjects },
];

function gradingKeyMatches(request: IncomingMessage, expected: string): boolean {
  const sent = Buffer.from(request.headers["x-grading-key"]?.toString() ?? "");
  const wanted = Buffer.from(expected);
  return sent.length === wanted.length && timingSafeEqual(sent, wanted);
}

export async function handleApi(context: ApiContext, request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  const candidates = ROUTES.filter((route) => route.pattern.test(pathname) && (!route.grading || context.config.gradingKey !== undefined));
  const route = candidates.find((candidate) => candidate.method === request.method);
  if (candidates.length === 0) return sendError(response, 404, NOT_FOUND);
  if (route === undefined) return sendError(response, 405, METHOD_NOT_ALLOWED);
  if (route.grading && !(context.config.gradingKey !== undefined && gradingKeyMatches(request, context.config.gradingKey))) {
    return sendError(response, 404, NOT_FOUND);
  }
  let body: Record<string, unknown> = {};
  if (route.takesBody) {
    const outcome = await readJsonObject(request);
    if (outcome.kind === "too-large") return sendError(response, 413, TOO_LARGE);
    if (outcome.kind === "not-object") return sendError(response, 400, BAD_REQUEST);
    body = outcome.value;
  }
  await route.run(context, request, response, route.pattern.exec(pathname)?.[1] ?? "", body);
}
