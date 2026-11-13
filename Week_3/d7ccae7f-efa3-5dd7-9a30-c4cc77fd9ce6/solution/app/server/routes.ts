import { z } from "zod";
import { hostCommands } from "../shared/schemas.js";
import { SESSION_SECONDS, currentQuizmaster, endSession, sessionCookie, signIn, signUp } from "./auth.js";
import { nowMs } from "./clock.js";
import { addQuestion, attachPicture, createDeck, deleteQuestion, listDecks, readDeck, removePicture, renameDeck, saveQuestion } from "./decks.js";
import { validationFailed } from "./errors.js";
import { jsonBody, type Reply, type Route } from "./http.js";
import { readImageField } from "./multipart.js";
import { listNights, readNight } from "./nights.js";
import { ownedRoomId } from "./rooms/access.js";
import { recordAnswer } from "./rooms/answers.js";
import { resolveClient } from "./rooms/clients.js";
import { runHostCommand } from "./rooms/commands.js";
import { joinRoom, parseRejoin, rejoinSeat } from "./rooms/join.js";
import { openRoom } from "./rooms/open.js";
import { loadHostRoom, loadPlayerView } from "./rooms/views.js";
import { openStream, pollEvents } from "./stream.js";

const ok = (body: unknown): Reply => ({ status: 200, body });
const created = (body: unknown): Reply => ({ status: 201, body });
const noContent: Reply = { status: 204 };

const commandBody = z.object({ command: z.enum(hostCommands) });
const deckIdBody = z.object({ deckId: z.string("Choose a deck") });

const param = (params: Record<string, string>, name: string): string => params[name] as string;

export const routes: Route[] = [
  { method: "GET", pattern: "/api/health", public: true, handle: async () => ok({ status: "ok" }) },
  { method: "GET", pattern: "/api/time", handle: async () => ok({ serverNow: nowMs() }) },

  {
    method: "POST",
    pattern: "/api/auth/signup",
    handle: async (ctx) => {
      const { quizmaster, token } = await signUp(jsonBody(ctx));
      return { status: 201, body: { quizmaster }, headers: { "set-cookie": sessionCookie(token, SESSION_SECONDS) } };
    },
  },
  {
    method: "POST",
    pattern: "/api/auth/login",
    handle: async (ctx) => {
      const { quizmaster, token } = await signIn(jsonBody(ctx));
      return { status: 200, body: { quizmaster }, headers: { "set-cookie": sessionCookie(token, SESSION_SECONDS) } };
    },
  },
  {
    method: "POST",
    pattern: "/api/auth/logout",
    handle: async (ctx) => {
      await endSession(ctx.req);
      return { ...noContent, headers: { "set-cookie": sessionCookie("", 0) } };
    },
  },
  { method: "GET", pattern: "/api/auth/me", handle: async (ctx) => ok({ quizmaster: await currentQuizmaster(ctx.req) }) },

  { method: "GET", pattern: "/api/decks", handle: async (ctx) => ok({ decks: await listDecks((await currentQuizmaster(ctx.req)).id) }) },
  { method: "POST", pattern: "/api/decks", handle: async (ctx) => created({ deck: await createDeck((await currentQuizmaster(ctx.req)).id, jsonBody(ctx)) }) },
  { method: "GET", pattern: "/api/decks/:deckId", handle: async (ctx) => ok({ deck: await readDeck((await currentQuizmaster(ctx.req)).id, param(ctx.params, "deckId")) }) },
  {
    method: "PATCH",
    pattern: "/api/decks/:deckId",
    handle: async (ctx) => ok({ deck: await renameDeck((await currentQuizmaster(ctx.req)).id, param(ctx.params, "deckId"), jsonBody(ctx)) }),
  },
  {
    method: "POST",
    pattern: "/api/decks/:deckId/questions",
    handle: async (ctx) => created({ question: await addQuestion((await currentQuizmaster(ctx.req)).id, param(ctx.params, "deckId"), jsonBody(ctx)) }),
  },
  {
    method: "PUT",
    pattern: "/api/decks/:deckId/questions/:questionId",
    handle: async (ctx) =>
      ok({ question: await saveQuestion((await currentQuizmaster(ctx.req)).id, param(ctx.params, "deckId"), param(ctx.params, "questionId"), jsonBody(ctx)) }),
  },
  {
    method: "DELETE",
    pattern: "/api/decks/:deckId/questions/:questionId",
    handle: async (ctx) => {
      await deleteQuestion((await currentQuizmaster(ctx.req)).id, param(ctx.params, "deckId"), param(ctx.params, "questionId"));
      return noContent;
    },
  },
  {
    method: "POST",
    pattern: "/api/decks/:deckId/questions/:questionId/image",
    upload: true,
    handle: async (ctx) => {
      const quizmaster = await currentQuizmaster(ctx.req);
      const deckId = param(ctx.params, "deckId");
      const questionId = param(ctx.params, "questionId");
      await readDeck(quizmaster.id, deckId);
      const file = await readImageField(ctx.req);
      return created({ question: await attachPicture(quizmaster.id, deckId, questionId, file) });
    },
  },
  {
    method: "DELETE",
    pattern: "/api/decks/:deckId/questions/:questionId/image",
    handle: async (ctx) => {
      await removePicture((await currentQuizmaster(ctx.req)).id, param(ctx.params, "deckId"), param(ctx.params, "questionId"));
      return noContent;
    },
  },

  {
    method: "POST",
    pattern: "/api/rooms",
    handle: async (ctx) => {
      const quizmaster = await currentQuizmaster(ctx.req);
      const parsed = deckIdBody.safeParse(jsonBody(ctx));
      if (!parsed.success) throw validationFailed({ deckId: "Choose a deck" });
      return created({ room: await loadHostRoom(await openRoom(quizmaster.id, parsed.data.deckId)) });
    },
  },
  {
    method: "POST",
    pattern: "/api/rooms/join",
    handle: async (ctx) => created(await joinRoom(jsonBody(ctx))),
  },
  {
    method: "POST",
    pattern: "/api/rooms/rejoin",
    handle: async (ctx) => ok(await rejoinSeat(parseRejoin(jsonBody(ctx)))),
  },
  {
    method: "GET",
    pattern: "/api/rooms/:roomId/host",
    handle: async (ctx) => ok({ room: await loadHostRoom(await ownedRoomId((await currentQuizmaster(ctx.req)).id, param(ctx.params, "roomId"))) }),
  },
  {
    method: "POST",
    pattern: "/api/rooms/:roomId/commands",
    handle: async (ctx) => {
      const roomId = await ownedRoomId((await currentQuizmaster(ctx.req)).id, param(ctx.params, "roomId"));
      const parsed = commandBody.safeParse(jsonBody(ctx));
      if (!parsed.success) throw validationFailed({ command: "Unknown command" });
      await runHostCommand(roomId, parsed.data.command);
      return ok({ room: await loadHostRoom(roomId) });
    },
  },
  {
    method: "GET",
    pattern: "/api/rooms/:roomId/state",
    handle: async (ctx) => {
      const client = await resolveClient(ctx.query.get("clientId"), param(ctx.params, "roomId"));
      return ok(await loadPlayerView(client.roomId, client.seatId));
    },
  },
  {
    method: "POST",
    pattern: "/api/rooms/:roomId/answers",
    handle: async (ctx) => created({ answer: await recordAnswer(param(ctx.params, "roomId"), jsonBody(ctx)) }),
  },
  {
    method: "GET",
    pattern: "/api/rooms/:roomId/stream",
    handle: async (ctx) => {
      await openStream(ctx.req, ctx.res, param(ctx.params, "roomId"), ctx.query);
      return "streamed";
    },
  },
  {
    method: "GET",
    pattern: "/api/rooms/:roomId/poll",
    handle: async (ctx) => ok({ events: await pollEvents(ctx.req, ctx.res, param(ctx.params, "roomId"), ctx.query) }),
  },

  { method: "GET", pattern: "/api/nights", handle: async (ctx) => ok({ nights: await listNights((await currentQuizmaster(ctx.req)).id) }) },
  { method: "GET", pattern: "/api/nights/:roomId", handle: async (ctx) => ok({ night: await readNight((await currentQuizmaster(ctx.req)).id, param(ctx.params, "roomId")) }) },
];
