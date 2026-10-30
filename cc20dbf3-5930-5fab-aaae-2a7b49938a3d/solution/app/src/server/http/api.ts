// The API: the same-origin check, the route table and the writing of every answer.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { HoldCreated, Lanes, Loan, Receipt } from "../../shared/api.js";
import { isIsoDate } from "../../shared/calendar.js";
import { FIELD_COPY } from "../../shared/copy.js";
import { pool } from "../db.js";
import { asObject, cancelHold, markReady, parseHoldRequest, placeHold } from "../domain/holds.js";
import { listMembers } from "../domain/people.js";
import { ledgerView } from "../domain/ledger.js";
import { librarySettings, today } from "../domain/library.js";
import { holdPage, loanPage } from "../domain/lists.js";
import { checkIn, checkoutHold, inspect, lendWalkIn, parseCheckoutRequest, parseInspection, parseRenewal, parseReturn, renewLoan } from "../domain/loans.js";
import { itemsWithFreeToday, lanes } from "../domain/occupancy.js";
import { addPhoto, findPhotoKey, photoBytes, readPhotoUpload } from "../domain/photos.js";
import { findHold, findLoan, holdJson, loanJson, readLoan, settlementJson } from "../domain/records.js";
import { clearedSessionCookie, sessionCookie, signIn, signOut, tokenFromCookieHeader } from "../domain/sessions.js";
import { parseDamage, settleLoan } from "../domain/settlement.js";
import { describeError } from "../log.js";
import { counterStatus } from "../services/probes.js";
import { ApiError, FieldErrors, writeError } from "./errors.js";
import { ALL_ROLES, type Call, defineRoute, FOUNDER, MEMBERS, readJson, type Reply, type Route, STAFF } from "./route.js";

async function currentLoan(loanId: string, now: Date): Promise<Loan> {
  const row = await readLoan(pool, now, loanId);
  if (!row) throw ApiError.of("not_found");
  return loanJson(pool, row);
}

async function findItem(itemId: string, now: Date) {
  const [item] = await itemsWithFreeToday(pool, now, itemId);
  if (!item) throw ApiError.of("not_found");
  return item;
}

const routes: Route[] = [
  defineRoute({
    method: "GET",
    path: "/api/session",
    roles: ALL_ROLES,
    body: "none",
    handle: async ({ user }) => ({ status: 200, body: { user } }),
  }),
  defineRoute({
    method: "DELETE",
    path: "/api/session",
    roles: ALL_ROLES,
    body: "none",
    handle: async ({ req }) => {
      const token = tokenFromCookieHeader(req.headers.cookie);
      if (token) await signOut(token);
      return { status: 204, headers: { "Set-Cookie": clearedSessionCookie() } };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/api/library",
    roles: ALL_ROLES,
    body: "none",
    handle: async ({ now }) => ({ status: 200, body: librarySettings(now) }),
  }),
  defineRoute({
    method: "GET",
    path: "/api/items",
    roles: ALL_ROLES,
    body: "none",
    handle: async ({ now }) => ({ status: 200, body: { items: await itemsWithFreeToday(pool, now) } }),
  }),
  defineRoute({
    method: "GET",
    path: "/api/items/:itemId",
    roles: ALL_ROLES,
    body: "none",
    find: ({ params, now }) => findItem(params.itemId ?? "", now),
    handle: async (_, item) => ({ status: 200, body: { item } }),
  }),
  defineRoute({
    method: "GET",
    path: "/api/items/:itemId/lanes",
    roles: ALL_ROLES,
    body: "none",
    find: ({ params, now }) => findItem(params.itemId ?? "", now),
    parse: async ({ url, now }) => {
      const fields = new FieldErrors();
      const from = url.searchParams.get("from") ?? today(now);
      if (!isIsoDate(from)) fields.add("from", FIELD_COPY.from);
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      if (start !== null || end !== null) {
        if (!isIsoDate(start)) fields.add("start_date", FIELD_COPY.start_date);
        if (!isIsoDate(end) || (isIsoDate(start) && end < start)) fields.add("end_date", FIELD_COPY.end_date);
      }
      fields.throwIfAny();
      return { from, range: start !== null && end !== null ? { start, end } : null };
    },
    handle: async ({ user, now }, item, { from, range }): Promise<Reply> => {
      const body: Lanes = await lanes(pool, now, user, item.id, from, range);
      return { status: 200, body };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/api/holds",
    roles: MEMBERS,
    body: "json",
    keyed: true,
    parse: ({ now }, _, json) => parseHoldRequest(json, now),
    handle: async ({ user, now }, _, request) => {
      const body: HoldCreated = await placeHold(user, request, now);
      return { status: 201, body };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/api/holds",
    roles: ALL_ROLES,
    body: "none",
    handle: async ({ user, now, url }) => ({ status: 200, body: await holdPage(user, now, url.searchParams) }),
  }),
  defineRoute({
    method: "GET",
    path: "/api/holds/:holdId",
    roles: ALL_ROLES,
    body: "none",
    find: ({ user, now, params }) => findHold(user, now, params.holdId ?? ""),
    handle: async (_, hold) => ({ status: 200, body: { hold: holdJson(hold) } }),
  }),
  defineRoute({
    method: "POST",
    path: "/api/holds/:holdId/ready",
    roles: STAFF,
    body: "json",
    find: ({ user, now, params }) => findHold(user, now, params.holdId ?? ""),
    handle: async ({ now }, hold) => ({ status: 200, body: { hold: holdJson(await markReady(hold.id, now)) } }),
  }),
  defineRoute({
    method: "POST",
    path: "/api/holds/:holdId/cancel",
    roles: ALL_ROLES,
    body: "json",
    find: ({ user, now, params }) => findHold(user, now, params.holdId ?? ""),
    handle: async ({ now }, hold) => ({ status: 200, body: { hold: holdJson(await cancelHold(hold.id, now)) } }),
  }),
  defineRoute({
    method: "GET",
    path: "/api/members",
    roles: STAFF,
    body: "none",
    handle: async () => ({ status: 200, body: { members: await listMembers() } }),
  }),
  defineRoute({
    method: "POST",
    path: "/api/loans",
    roles: STAFF,
    body: "json",
    keyed: true,
    parse: ({ now }, _, json) => parseCheckoutRequest(json, now),
    handle: async ({ now }, _, request) => {
      const loanId = request.kind === "hold" ? await checkoutHold(request.holdId, now) : await lendWalkIn(request, now);
      return { status: 201, body: { loan: await currentLoan(loanId, now) } };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/api/loans",
    roles: ALL_ROLES,
    body: "none",
    handle: async ({ user, now, url }) => ({ status: 200, body: await loanPage(user, now, url.searchParams) }),
  }),
  defineRoute({
    method: "GET",
    path: "/api/loans/:loanId",
    roles: ALL_ROLES,
    body: "none",
    find: ({ user, now, params }) => findLoan(user, now, params.loanId ?? ""),
    handle: async (_, loan) => ({ status: 200, body: { loan: await loanJson(pool, loan) } }),
  }),
  defineRoute({
    method: "POST",
    path: "/api/loans/:loanId/renewal",
    roles: ALL_ROLES,
    body: "json",
    keyed: true,
    find: ({ user, now, params }) => findLoan(user, now, params.loanId ?? ""),
    parse: async (_, loan, json) => parseRenewal(json, loan),
    handle: async ({ now }, loan, dueDate) => {
      await renewLoan(loan, dueDate, now);
      return { status: 200, body: { loan: await currentLoan(loan.id, now) } };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/api/loans/:loanId/photos",
    roles: STAFF,
    body: "multipart",
    find: ({ user, now, params }) => findLoan(user, now, params.loanId ?? ""),
    parse: ({ req }) => readPhotoUpload(req),
    handle: async ({ now }, loan, upload) => ({ status: 201, body: { photo: await addPhoto(loan.id, upload, now) } }),
  }),
  defineRoute({
    method: "GET",
    path: "/api/loans/:loanId/photos/:photoId",
    roles: ALL_ROLES,
    body: "none",
    find: async ({ user, now, params }) => {
      const loan = await findLoan(user, now, params.loanId ?? "");
      return findPhotoKey(loan.id, params.photoId ?? "");
    },
    handle: async (_, photo) => ({
      status: 200,
      bytes: {
        data: await photoBytes(photo.key),
        headers: {
          "Content-Type": photo.contentType,
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      },
    }),
  }),
  defineRoute({
    method: "POST",
    path: "/api/loans/:loanId/return",
    roles: STAFF,
    body: "json",
    find: ({ user, now, params }) => findLoan(user, now, params.loanId ?? ""),
    parse: async ({ now }, loan, json) => parseReturn(json, loan, now),
    handle: async ({ now }, loan, returnedAt) => {
      await checkIn(loan.id, returnedAt, now);
      return { status: 200, body: { loan: await currentLoan(loan.id, now) } };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/api/loans/:loanId/inspection",
    roles: STAFF,
    body: "json",
    find: ({ user, now, params }) => findLoan(user, now, params.loanId ?? ""),
    parse: async (_, __, json) => parseInspection(json),
    handle: async ({ now }, loan, { outcome, note }) => {
      await inspect(loan.id, outcome, note, now);
      return { status: 200, body: { loan: await currentLoan(loan.id, now) } };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/api/loans/:loanId/settlement",
    roles: FOUNDER,
    body: "json",
    keyed: true,
    find: ({ user, now, params }) => findLoan(user, now, params.loanId ?? ""),
    parse: async (_, loan, json) => parseDamage(json, loan),
    handle: async ({ now }, loan, damageCents) => {
      await settleLoan(loan.id, damageCents, now);
      const settled = await currentLoan(loan.id, now);
      return { status: 201, body: { settlement: settled.settlement, loan: settled } };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/api/loans/:loanId/receipt",
    roles: ALL_ROLES,
    body: "none",
    find: ({ user, now, params }) => findLoan(user, now, params.loanId ?? ""),
    handle: async (_, loan) => {
      if (!loan.settlement) throw ApiError.of("not_settled");
      const receipt: Receipt = {
        ...settlementJson(loan.id, loan.settlement),
        item: { id: loan.item_id, name: loan.item_name },
        unit: { id: loan.unit_id, label: loan.unit_label, lane_index: loan.lane_index },
        member: { id: loan.member_id, name: loan.member_name },
      };
      return { status: 200, body: { receipt } };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/api/ledger",
    roles: FOUNDER,
    body: "none",
    handle: async ({ url }) => ({ status: 200, body: await ledgerView(url.searchParams.get("loan_id")) }),
  }),
  defineRoute({
    method: "GET",
    path: "/api/counter/status",
    roles: STAFF,
    body: "none",
    handle: async () => ({ status: 200, body: await counterStatus() }),
  }),
];

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return req.headers["sec-fetch-site"] !== "cross-site";
  return origin === `http://${req.headers.host ?? ""}`;
}

async function signInReply(req: IncomingMessage, now: Date): Promise<Reply> {
  const body = asObject(await readJson(req));
  const fields = new FieldErrors();
  if (typeof body.email !== "string" || body.email.trim() === "") fields.add("email", FIELD_COPY.required);
  if (typeof body.password !== "string" || body.password === "") fields.add("password", FIELD_COPY.required);
  fields.throwIfAny();
  const signedIn = await signIn(body.email as string, body.password as string, now);
  if (!signedIn) throw ApiError.of("bad_credentials");
  return { status: 200, body: { user: signedIn.user }, headers: { "Set-Cookie": sessionCookie(signedIn.token) } };
}

function writeReply(res: ServerResponse, reply: Reply): void {
  if (reply.bytes) {
    res.writeHead(reply.status, { ...reply.bytes.headers, "Content-Length": reply.bytes.data.length });
    res.end(reply.bytes.data);
    return;
  }
  if (reply.status === 204) {
    res.writeHead(204, { "Cache-Control": "no-store", ...reply.headers });
    res.end();
    return;
  }
  const payload = reply.json ?? JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...reply.headers,
  });
  res.end(payload);
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const now = new Date();
  let reply: Reply | ApiError;
  try {
    if ((req.method === "POST" || req.method === "DELETE") && !sameOrigin(req)) throw ApiError.of("cross_origin");
    if (req.method === "GET" && url.pathname === "/api/health") {
      reply = { status: 200, body: { status: "ok" } };
    } else if (req.method === "POST" && url.pathname === "/api/session") {
      reply = await signInReply(req, now);
    } else {
      const call: Call = { req, url, now, params: {} };
      const route = routes.find((candidate) => {
        if (candidate.method !== req.method) return false;
        const params = candidate.match(url.pathname);
        if (params) call.params = params;
        return params !== null;
      });
      if (!route) throw ApiError.of("not_found");
      reply = await route.run(call);
    }
  } catch (error) {
    if (error instanceof ApiError) {
      reply = error;
    } else {
      console.error(`request ${req.method} ${url.pathname} failed: ${describeError(error)}`);
      reply = ApiError.of("internal");
    }
  }
  if (!req.complete) res.setHeader("Connection", "close");
  if (reply instanceof ApiError) writeError(res, reply);
  else writeReply(res, reply);
}
