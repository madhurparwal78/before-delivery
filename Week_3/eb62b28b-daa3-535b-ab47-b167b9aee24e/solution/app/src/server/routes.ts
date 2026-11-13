// Every published endpoint, with its roles and the ids it must locate at rung 5.

import { randomUUID } from "node:crypto";
import { Cadence, type Role, type SessionUser } from "../shared/api";
import { INGREDIENTS } from "../shared/ingredients";
import { addDays, instantOf, wholeSeconds } from "../shared/time";
import { currentBlend, memberBlends, readBlend, saveBlend } from "./blends";
import { CATEGORIES, isServed, markerById, MARKERS, squeezeName, stateCheckCopy, stateName, US_STATES } from "./catalog";
import { requestClosure, restoreAccount } from "./closure";
import { inTransaction, pool } from "./db";
import { bookDraw, cancelDraw, drawRow, drawRows, drawView, endVisitPage, moveDraw, newVisitPage, phlebotomistExists, phlebotomists, requireDate, slotsOn, type DrawRow } from "./draws";
import { requireCollectedOrReady } from "./drawStates";
import { invalid, notFound, refuseWhileClosing } from "./errors";
import { isOneOf, nullableText, text } from "./fields";
import { locatedOpenRoute, locatedRoute, openRoute, route, type ApiRequest, type Caller, type Route } from "./http";
import { allMembers, billingProjection, emailIsTaken, emailTaken, insertMember, liveMemberOr404, memberView, requireMemberRow, OPTIONS_COPY, PASSWORD_COPY, isLongEnoughPassword, readNewMember, readProfile, saveProfile, type LiveMember, type MemberRow } from "./members";
import { cancelPlus, changeCadence, createMemberWithPlus, freshRow, join, joinWithRequestKey } from "./membership";
import { attachmentBytes, locateAttachment, markThreadHandled, memberMessages, messageThreads, sendMessage } from "./messages";
import { createDraft, locatePlan, memberPlans, planExists, planForMember, planForStaff, publishPlan, saveDraft } from "./plans";
import { addRangeChange, rangeChanges, rangesOn, rangeTables } from "./ranges";
import { countDownload, enforceDownloadLimit, enforceMessageLimit } from "./rate";
import { planPrices } from "./prices";
import { locateReceipt, memberReceipts, receiptPage, receiptView } from "./receipts";
import { correctResult, locateResult, memberResults, readReport, readResultsFile, releaseDraw, resultHistory, resultsHistoryFile, saveReport, saveResults, saveResultsFile, savedValues, type LocatedResult } from "./results";
import { changePassword, endSession, homeOf, openSession, sessionView, signIn } from "./sessions";
import { addStaff, changeStaffRole, removeStaff, staffById, staffList } from "./staff";
import { addKitCode, locateVisit, markCollected, visitView } from "./visits";

const OWNER: readonly Role[] = ["owner"];
const ALL_STAFF: readonly Role[] = ["owner", "specialist", "coordinator", "billingLead"];
const DESK: readonly Role[] = ["owner", "coordinator"];
const CARE: readonly Role[] = ["owner", "specialist", "coordinator"];
const SPECIALISTS: readonly Role[] = ["owner", "specialist"];
const BILLING: readonly Role[] = ["owner", "billingLead"];
const MEMBER: readonly Role[] = ["member"];
const EVERYONE: readonly Role[] = [...ALL_STAFF, "member"];

const PREVIEW_UPLOAD = {
  bodyLimit: 1_100_000,
  partLimits: { file: { limit: 1_000_000, message: "The results file must be at most 1,000,000 bytes." } },
};
const SAVE_UPLOAD = {
  bodyLimit: 11_100_000,
  partLimits: {
    file: { limit: 1_000_000, message: "The results file must be at most 1,000,000 bytes." },
    report: { limit: 10_000_000, message: "The report must be at most 10,000,000 bytes." },
  },
};
const MESSAGE_UPLOAD = {
  bodyLimit: 5_100_000,
  partLimits: { attachment: { limit: 5_000_000, message: "Attachments must be at most 5,000,000 bytes." } },
};

function markerMatchesQuery(markerName: string, aliases: readonly string[], query: string): boolean {
  const wanted = squeezeName(query);
  return [markerName, ...aliases].some((name) => squeezeName(name).includes(wanted));
}

const locateMember = (request: ApiRequest): Promise<MemberRow> => requireMemberRow(pool, request.param("memberId"));

const locateLiveMember = (request: ApiRequest): Promise<LiveMember> => liveMemberOr404(request.param("memberId"));

const callerMember = (caller: Caller): Promise<LiveMember> => liveMemberOr404(caller.id);

// A member may only ever see their own: someone else's id answers exactly like an unknown one.
function hideFromOtherMembers(ownerId: string, caller: Caller): void {
  if (caller.role === "member" && caller.id !== ownerId) throw notFound();
}

async function locateDraw(request: ApiRequest, caller: Caller): Promise<DrawRow> {
  const row = await drawRow(pool, request.param("drawId"));
  if (!row) throw notFound();
  hideFromOtherMembers(row.member_id, caller);
  return row;
}

async function locatePhlebotomistInBody(request: ApiRequest): Promise<string> {
  const id = text(request.peekJson() ?? {}, "phlebotomistId");
  if (request.peekJson() && !(await phlebotomistExists(id))) throw notFound();
  return id;
}

async function requirePlan(request: ApiRequest): Promise<NonNullable<Awaited<ReturnType<typeof locatePlan>>>> {
  const plan = await locatePlan(request.param("planId"));
  if (!plan) throw notFound();
  return plan;
}

async function requireResult(request: ApiRequest): Promise<LocatedResult> {
  const result = await locateResult(request.param("resultId"));
  if (!result) throw notFound();
  return result;
}

const created = (json: unknown): { status: number; json: unknown } => ({ status: 201, json });
const ok = (json: unknown): { status: number; json: unknown } => ({ status: 200, json });
const noContent = { status: 204 };

function sessionAnswer(user: SessionUser): { user: SessionUser; home: string } {
  return { user, home: homeOf(user.role) };
}

export const routes: readonly Route[] = [
  openRoute({ method: "GET", path: "/api/health", handle: async () => ok({ status: "ok" }) }),
  openRoute({
    method: "GET",
    path: "/api/plans",
    handle: async () => ok({ plans: [{ id: "free", name: "Free", prices: [] }, { id: "plus", name: "Plus", prices: planPrices() }] }),
  }),
  openRoute({
    method: "GET",
    path: "/api/states",
    handle: async () => ok({ states: US_STATES.map(({ code, name }) => ({ state: code, name, served: isServed(code) })) }),
  }),
  locatedOpenRoute({
    method: "GET",
    path: "/api/states/:code",
    locate: async (request) => {
      const code = request.param("code");
      if (!US_STATES.some((entry) => entry.code === code)) throw notFound();
      return code;
    },
    handle: async (_request, code) => ok({ state: code, name: stateName(code), served: isServed(code), message: stateCheckCopy(code) }),
  }),
  openRoute({
    method: "GET",
    path: "/api/markers",
    handle: async ({ query }) => {
      const wanted = query.get("q") ?? "";
      const categories = CATEGORIES.flatMap((category) => {
        const markers = MARKERS.filter((marker) => marker.category === category.id && markerMatchesQuery(marker.name, marker.aliases, wanted))
          .map(({ id, name, unit, decimals }) => ({ id, name, unit, decimals }));
        return markers.length > 0 ? [{ id: category.id, name: category.name, markers }] : [];
      });
      return ok({ categories });
    },
  }),

  openRoute({
    method: "POST",
    path: "/api/accounts",
    handle: async ({ json }) => {
      const fields = readNewMember(json, new Date());
      if (await emailIsTaken(pool, fields.email)) throw emailTaken();
      const id = randomUUID();
      const cookie = await inTransaction(async (db) => {
        await insertMember(db, id, fields, null);
        return openSession(db, id);
      });
      return { status: 201, json: { member: memberView(await requireMemberRow(pool, id)) }, headers: { "Set-Cookie": cookie } };
    },
  }),
  openRoute({
    method: "POST",
    path: "/api/session",
    handle: async ({ json }) => {
      const { user, cookie } = await signIn(text(json, "email"), text(json, "password"));
      return { status: 200, json: sessionAnswer(user), headers: { "Set-Cookie": cookie } };
    },
  }),
  route({ method: "GET", path: "/api/session", roles: EVERYONE, handle: async ({ caller }) => ok(sessionView(caller)) }),
  route({
    method: "DELETE",
    path: "/api/session",
    roles: EVERYONE,
    handle: async ({ caller }) => {
      await endSession(caller);
      return noContent;
    },
  }),
  route({
    method: "POST",
    path: "/api/me/password",
    roles: EVERYONE,
    handle: async ({ caller, json }) => {
      const next = text(json, "newPassword");
      if (!isLongEnoughPassword(next)) throw invalid({ newPassword: PASSWORD_COPY });
      if (!(await changePassword(caller, text(json, "currentPassword"), next))) {
        throw invalid({ currentPassword: "That password isn't right." });
      }
      return noContent;
    },
  }),

  route({ method: "GET", path: "/api/staff", roles: OWNER, handle: async () => ok({ staff: await staffList() }) }),
  route({ method: "POST", path: "/api/staff", roles: OWNER, handle: async ({ json }) => created({ staff: await addStaff(json) }) }),
  locatedRoute({
    method: "GET",
    path: "/api/staff/:staffId",
    roles: OWNER,
    locate: (request) => staffById(request.param("staffId")),
    handle: async (_request, staff) => ok({ staff }),
  }),
  locatedRoute({
    method: "PATCH",
    path: "/api/staff/:staffId",
    roles: OWNER,
    locate: (request) => staffById(request.param("staffId")),
    handle: async ({ json }, staff) => ok({ staff: await changeStaffRole(staff, json) }),
  }),
  locatedRoute({
    method: "DELETE",
    path: "/api/staff/:staffId",
    roles: OWNER,
    locate: (request) => staffById(request.param("staffId")),
    handle: async (_request, staff) => {
      await removeStaff(staff);
      return noContent;
    },
  }),

  route({
    method: "POST",
    path: "/api/members",
    roles: OWNER,
    handle: async ({ json }) => {
      const fields = readNewMember(json, new Date());
      const profile = readProfile(json);
      const cadence = json["cadence"] ?? null;
      if (cadence !== null && !isOneOf(Cadence.options, cadence)) throw invalid({ cadence: OPTIONS_COPY });
      if (await emailIsTaken(pool, fields.email)) throw emailTaken();
      const id = randomUUID();
      if (cadence) await createMemberWithPlus(id, fields, profile, cadence);
      else await inTransaction((db) => insertMember(db, id, fields, profile));
      return created({ member: memberView(await requireMemberRow(pool, id)) });
    },
  }),
  route({
    method: "GET",
    path: "/api/members",
    roles: ALL_STAFF,
    handle: async ({ caller, query }) => {
      const members = await allMembers(query.get("q"));
      return ok({ members: members.map((row) => (caller.role === "billingLead" ? billingProjection(row) : memberView(row))) });
    },
  }),
  locatedRoute({
    method: "GET",
    path: "/api/members/:memberId",
    roles: ALL_STAFF,
    locate: locateMember,
    handle: async ({ caller }, row) => {
      const fresh = await freshRow(row);
      return ok({ member: caller.role === "billingLead" ? billingProjection(fresh) : memberView(fresh) });
    },
  }),
  locatedRoute({
    method: "POST",
    path: "/api/members/:memberId/restore",
    roles: OWNER,
    locate: locateMember,
    handle: async (_request, row) => {
      await restoreAccount(row, new Date());
      return ok({ member: memberView(await requireMemberRow(pool, row.id)) });
    },
  }),

  route({
    method: "GET",
    path: "/api/me",
    roles: MEMBER,
    handle: async ({ caller }) => ok({ member: memberView(await freshRow(await callerMember(caller))) }),
  }),
  route({
    method: "PATCH",
    path: "/api/me",
    roles: MEMBER,
    handle: async ({ caller, json }) => {
      const member = await callerMember(caller);
      const profile = readProfile(json);
      refuseWhileClosing(member.account_state);
      await saveProfile(member.id, profile);
      return ok({ member: memberView(await callerMember(caller)) });
    },
  }),
  route({
    method: "GET",
    path: "/api/me/membership",
    roles: MEMBER,
    handle: async ({ caller }) => ok({ membership: memberView(await freshRow(await callerMember(caller))).membership }),
  }),
  route({
    method: "POST",
    path: "/api/me/membership",
    roles: MEMBER,
    handle: async ({ caller, json, rawBody, header }) =>
      joinWithRequestKey(caller.id, header("request-key"), rawBody, async () => {
        const cadence = json["cadence"];
        if (!isOneOf(Cadence.options, cadence)) throw invalid({ cadence: OPTIONS_COPY });
        return created({ membership: await join(await callerMember(caller), cadence) });
      }),
  }),
  route({
    method: "PATCH",
    path: "/api/me/membership",
    roles: MEMBER,
    handle: async ({ caller, json }) => {
      const cadence = json["cadence"];
      if (!isOneOf(Cadence.options, cadence)) throw invalid({ cadence: OPTIONS_COPY });
      return ok({ membership: await changeCadence(await callerMember(caller), cadence) });
    },
  }),
  route({
    method: "POST",
    path: "/api/me/membership/cancel",
    roles: MEMBER,
    handle: async ({ caller }) => ok({ membership: await cancelPlus(await callerMember(caller)) }),
  }),

  route({
    method: "GET",
    path: "/api/phlebotomists",
    roles: DESK,
    handle: async () => ok({ phlebotomists: (await phlebotomists()).map(({ id, name, states }) => ({ id, name, states })) }),
  }),
  locatedRoute({
    method: "GET",
    path: "/api/slots",
    roles: DESK,
    locate: async ({ query }) => {
      const id = query.get("memberId");
      if (id === null) throw notFound();
      return liveMemberOr404(id);
    },
    handle: async ({ query }, member) => ok({ slots: await slotsOn(member, requireDate(query.get("date"), "date"), new Date(), "staff") }),
  }),
  route({
    method: "GET",
    path: "/api/me/slots",
    roles: MEMBER,
    handle: async ({ caller, query }) => ok({ slots: await slotsOn(await callerMember(caller), requireDate(query.get("date"), "date"), new Date(), "member") }),
  }),
  locatedRoute({
    method: "GET",
    path: "/api/draws",
    roles: ({ query }) => (query.has("from") || query.has("to") ? DESK : CARE),
    locate: async ({ query }) => {
      const id = query.get("memberId");
      if (id !== null) await liveMemberOr404(id);
    },
    handle: async ({ query }) => {
      const now = new Date();
      const from = query.get("from");
      const to = query.get("to");
      const state = query.get("state");
      const memberId = query.get("memberId");
      const given = [from !== null || to !== null, state !== null, memberId !== null].filter(Boolean).length;
      if (given !== 1) throw invalid({ from: "Choose a date range, a state or a member." });
      if (memberId !== null) return ok({ draws: (await drawRows("d.member_id = $1", [memberId], "d.starts_at DESC")).map((row) => drawView(row, now, "staff")) });
      if (state !== null) {
        const order = state === "booked" || state === "cancelled" ? "d.starts_at" : "d.collected_at";
        return ok({ draws: (await drawRows("d.state = $1", [state], order)).map((row) => drawView(row, now, "staff")) });
      }
      const first = requireDate(from, "from");
      const last = requireDate(to, "to");
      if (last < first || last > addDays(first, 6)) throw invalid({ from: "Choose a date range, a state or a member." });
      const startOfFirst = instantOf(first, "00:00", "phoenix");
      const endOfLast = instantOf(addDays(last, 1), "00:00", "phoenix");
      return ok({ draws: (await drawRows("d.starts_at >= $1 AND d.starts_at < $2 AND d.state <> 'cancelled'", [startOfFirst, endOfLast], "d.starts_at")).map((row) => drawView(row, now, "staff")) });
    },
  }),
  locatedRoute({
    method: "POST",
    path: "/api/draws",
    roles: DESK,
    locate: async (request) => {
      const body = request.peekJson();
      if (!body) return null;
      const member = await liveMemberOr404(text(body, "memberId"));
      return { member, phlebotomistId: await locatePhlebotomistInBody(request) };
    },
    handle: async ({ caller, json }, located) => {
      if (!located) throw invalid({ memberId: "Choose a member." });
      const row = await bookDraw(located.member, json, located.phlebotomistId, caller.name, "staff");
      return created({ draw: drawView(row, new Date(), "staff") });
    },
  }),
  locatedRoute({
    method: "GET",
    path: "/api/draws/:drawId",
    roles: CARE,
    locate: locateDraw,
    handle: async (_request, row) => ok({ draw: drawView(row, new Date(), "staff") }),
  }),
  locatedRoute({
    method: "PATCH",
    path: "/api/draws/:drawId",
    roles: DESK,
    locate: locateDraw,
    handle: async ({ json }, row) => {
      const moved = await moveDraw(await liveMemberOr404(row.member_id), row, json, "staff");
      return ok({ draw: drawView(moved, new Date(), "staff") });
    },
  }),
  locatedRoute({
    method: "POST",
    path: "/api/draws/:drawId/cancel",
    roles: DESK,
    locate: locateDraw,
    handle: async (_request, row) => ok({ draw: drawView(await cancelDraw(row, "staff"), new Date(), "staff") }),
  }),
  locatedRoute({
    method: "POST",
    path: "/api/draws/:drawId/visit-page",
    roles: DESK,
    locate: locateDraw,
    handle: async (_request, row) => created({ visitPage: await newVisitPage(row) }),
  }),
  locatedRoute({
    method: "DELETE",
    path: "/api/draws/:drawId/visit-page",
    roles: DESK,
    locate: locateDraw,
    handle: async (_request, row) => ok({ visitPage: await endVisitPage(row) }),
  }),
  route({
    method: "GET",
    path: "/api/me/draws",
    roles: MEMBER,
    handle: async ({ caller }) => {
      const now = new Date();
      return ok({ draws: (await drawRows("d.member_id = $1", [caller.id], "d.starts_at DESC")).map((row) => drawView(row, now, "member")) });
    },
  }),
  locatedRoute({
    method: "POST",
    path: "/api/me/draws",
    roles: MEMBER,
    locate: locatePhlebotomistInBody,
    handle: async ({ caller, json }, phlebotomistId) => {
      const row = await bookDraw(await callerMember(caller), json, phlebotomistId, "a member", "member");
      return created({ draw: drawView(row, new Date(), "member") });
    },
  }),
  locatedRoute({
    method: "PATCH",
    path: "/api/me/draws/:drawId",
    roles: MEMBER,
    locate: locateDraw,
    handle: async ({ caller, json }, row) => {
      const moved = await moveDraw(await callerMember(caller), row, json, "member");
      return ok({ draw: drawView(moved, new Date(), "member") });
    },
  }),
  locatedRoute({
    method: "POST",
    path: "/api/me/draws/:drawId/cancel",
    roles: MEMBER,
    locate: locateDraw,
    handle: async (_request, row) => ok({ draw: drawView(await cancelDraw(row, "member"), new Date(), "member") }),
  }),

  locatedOpenRoute({
    method: "GET",
    path: "/api/visits/:token",
    locate: (request) => locateVisit(request.param("token")),
    handle: async (_request, located) => ok(visitView(located, new Date())),
  }),
  locatedOpenRoute({
    method: "POST",
    path: "/api/visits/:token/kit-codes",
    locate: (request) => locateVisit(request.param("token")),
    handle: async ({ json }, located) => {
      const { status, kitCodes } = await addKitCode(located.draw, json);
      return { status, json: { kitCodes } };
    },
  }),
  locatedOpenRoute({
    method: "POST",
    path: "/api/visits/:token/collect",
    locate: (request) => locateVisit(request.param("token")),
    handle: async (_request, located) => {
      const collectedAt = await markCollected(located.draw, new Date());
      return ok({ state: "collected", collectedAt: wholeSeconds(collectedAt) });
    },
  }),

  locatedRoute({
    method: "POST",
    path: "/api/draws/:drawId/results-file/preview",
    roles: CARE,
    body: PREVIEW_UPLOAD,
    locate: locateDraw,
    handle: async ({ multipart }, row) => {
      const file = multipart.files.get("file");
      if (!file) throw invalid({ file: "The first row must be kitCode,marker,value,unit." });
      const rows = readResultsFile(file, row, await savedValues(pool, row.id));
      requireCollectedOrReady(row);
      return ok({ rows });
    },
  }),
  locatedRoute({
    method: "POST",
    path: "/api/draws/:drawId/results-file",
    roles: CARE,
    body: SAVE_UPLOAD,
    locate: locateDraw,
    handle: async ({ caller, multipart }, row) => {
      const hadReport = row.has_report;
      const { draw, saved, unchanged } = await saveResultsFile(row, multipart.files.get("file"), multipart.files.get("report"), caller.name);
      return { status: saved === 0 && hadReport ? 200 : 201, json: { draw: drawView(draw, new Date(), "staff"), saved, unchanged } };
    },
  }),
  locatedRoute({
    method: "POST",
    path: "/api/draws/:drawId/results",
    roles: CARE,
    locate: locateDraw,
    handle: async ({ caller, json }, row) => created({ draw: drawView(await saveResults(row, json, caller.name), new Date(), "staff") }),
  }),
  locatedRoute({
    method: "POST",
    path: "/api/draws/:drawId/report",
    roles: CARE,
    body: SAVE_UPLOAD,
    locate: locateDraw,
    handle: async ({ multipart }, row) => created({ draw: drawView(await saveReport(row, multipart.files.get("report")), new Date(), "staff") }),
  }),
  locatedRoute({
    method: "GET",
    path: "/api/draws/:drawId/report",
    roles: [...CARE, "member"],
    locate: async (request, caller) => {
      const row = await locateDraw(request, caller);
      if (caller.role === "member" && row.state !== "released") throw notFound();
      return row;
    },
    handle: async (_request, row) => ({ status: 200, raw: await readReport(row), headers: { "Content-Type": "application/pdf" } }),
  }),
  locatedRoute({
    method: "POST",
    path: "/api/draws/:drawId/release",
    roles: SPECIALISTS,
    locate: locateDraw,
    handle: async (_request, row) => {
      const member = await liveMemberOr404(row.member_id);
      return ok({ draw: drawView(await releaseDraw(row, member.email), new Date(), "staff") });
    },
  }),
  route({
    method: "GET",
    path: "/api/me/results",
    roles: MEMBER,
    handle: async ({ caller }) => ok({ markers: await memberResults(await callerMember(caller), true) }),
  }),
  locatedRoute({
    method: "GET",
    path: "/api/members/:memberId/results",
    roles: CARE,
    locate: locateLiveMember,
    handle: async (_request, member) => ok({ markers: await memberResults(member, false) }),
  }),
  locatedRoute({
    method: "PATCH",
    path: "/api/results/:resultId",
    roles: SPECIALISTS,
    locate: requireResult,
    handle: async ({ caller, json }, result) => {
      await correctResult(result, json, caller.name, new Date());
      const member = await liveMemberOr404(result.member_id);
      const entry = (await memberResults(member, false)).flatMap((marker) => marker.draws).find((candidate) => candidate.resultId === result.id);
      return ok({ result: entry });
    },
  }),
  locatedRoute({
    method: "GET",
    path: "/api/results/:resultId/history",
    roles: CARE,
    locate: requireResult,
    handle: async (_request, result) => ok({ history: await resultHistory(result.id) }),
  }),

  route({
    method: "GET",
    path: "/api/ranges",
    roles: ALL_STAFF,
    handle: async ({ query }) => {
      const marker = query.get("marker") ?? "";
      if (!markerById(marker)) throw invalid({ marker: "Choose a marker from the catalog." });
      const on = requireDate(query.get("on"), "on");
      return ok(rangesOn(marker, on, await rangeTables([marker])));
    },
  }),
  route({ method: "GET", path: "/api/range-changes", roles: OWNER, handle: async () => ok({ changes: await rangeChanges() }) }),
  route({
    method: "POST",
    path: "/api/range-changes",
    roles: OWNER,
    handle: async ({ caller, json }) => created({ change: await addRangeChange(json, caller.name, new Date()) }),
  }),

  locatedRoute({
    method: "POST",
    path: "/api/members/:memberId/plans",
    roles: SPECIALISTS,
    locate: async (request) => {
      const member = await locateLiveMember(request);
      const basedOn = nullableText(request.peekJson() ?? {}, "basedOnPlanId");
      if (basedOn !== null && !(await planExists(basedOn, member.id))) throw notFound();
      return member;
    },
    handle: async ({ json }, member) => created({ plan: await createDraft(member.id, json, new Date()) }),
  }),
  locatedRoute({
    method: "GET",
    path: "/api/members/:memberId/plans",
    roles: SPECIALISTS,
    locate: locateLiveMember,
    handle: async (_request, member) => ok({ plans: await memberPlans(member.id) }),
  }),
  locatedRoute({
    method: "GET",
    path: "/api/longevity-plans/:planId",
    roles: SPECIALISTS,
    locate: requirePlan,
    handle: async (_request, plan) => ok({ plan: await planForStaff(plan) }),
  }),
  locatedRoute({
    method: "PUT",
    path: "/api/longevity-plans/:planId",
    roles: SPECIALISTS,
    locate: requirePlan,
    handle: async ({ json }, plan) => ok({ plan: await saveDraft(plan, json, new Date()) }),
  }),
  locatedRoute({
    method: "POST",
    path: "/api/longevity-plans/:planId/publish",
    roles: SPECIALISTS,
    locate: requirePlan,
    handle: async ({ caller }, plan) => ok({ plan: await publishPlan(plan, caller.name, new Date()) }),
  }),
  route({ method: "GET", path: "/api/me/plan", roles: MEMBER, handle: async ({ caller }) => ok({ plan: await planForMember(caller.id) }) }),

  route({ method: "GET", path: "/api/ingredients", roles: SPECIALISTS, handle: async () => ok({ ingredients: INGREDIENTS }) }),
  locatedRoute({
    method: "POST",
    path: "/api/members/:memberId/blends/preview",
    roles: SPECIALISTS,
    locate: locateLiveMember,
    handle: async ({ json }) => ok({ blend: readBlend(json) }),
  }),
  locatedRoute({
    method: "POST",
    path: "/api/members/:memberId/blends",
    roles: SPECIALISTS,
    locate: locateLiveMember,
    handle: async ({ caller, json }, member) => created({ blend: await saveBlend(pool, member.id, readBlend(json), caller.name, new Date()) }),
  }),
  locatedRoute({
    method: "GET",
    path: "/api/members/:memberId/blends",
    roles: SPECIALISTS,
    locate: locateLiveMember,
    handle: async (_request, member) => ok({ blends: await memberBlends(member.id) }),
  }),
  route({ method: "GET", path: "/api/me/blend", roles: MEMBER, handle: async ({ caller }) => ok({ blend: await currentBlend(pool, caller.id) }) }),

  route({
    method: "POST",
    path: "/api/me/messages",
    roles: MEMBER,
    body: MESSAGE_UPLOAD,
    rate: enforceMessageLimit,
    handle: async ({ caller, multipart }) => {
      const member = await callerMember(caller);
      refuseWhileClosing(member.account_state);
      return created({ message: await sendMessage({ memberId: member.id, role: "member", name: member.name, countsAgainstLimit: true }, multipart, new Date()) });
    },
  }),
  route({ method: "GET", path: "/api/me/messages", roles: MEMBER, handle: async ({ caller }) => ok({ messages: await memberMessages(caller.id) }) }),
  route({ method: "GET", path: "/api/message-threads", roles: CARE, handle: async () => ok({ threads: await messageThreads() }) }),
  locatedRoute({
    method: "GET",
    path: "/api/members/:memberId/messages",
    roles: CARE,
    locate: locateLiveMember,
    handle: async (_request, member) => ok({ messages: await memberMessages(member.id) }),
  }),
  locatedRoute({
    method: "POST",
    path: "/api/members/:memberId/messages",
    roles: CARE,
    body: MESSAGE_UPLOAD,
    locate: locateLiveMember,
    handle: async ({ caller, multipart }, member) =>
      created({ message: await sendMessage({ memberId: member.id, role: caller.role, name: caller.name, countsAgainstLimit: false }, multipart, new Date()) }),
  }),
  locatedRoute({
    method: "POST",
    path: "/api/members/:memberId/messages/handled",
    roles: CARE,
    locate: locateLiveMember,
    handle: async (_request, member) => {
      await markThreadHandled(member.id);
      return ok({ thread: { state: "handled" } });
    },
  }),
  ...(["shown", "original"] as const).map((which) =>
    locatedRoute({
      method: "GET",
      path: which === "shown" ? "/api/attachments/:attachmentId" : "/api/attachments/:attachmentId/original",
      roles: [...CARE, "member"],
      locate: async (request, caller) => {
        const attachment = await locateAttachment(request.param("attachmentId"));
        if (!attachment) throw notFound();
        hideFromOtherMembers(attachment.member_id, caller);
        return attachment;
      },
      handle: async (_request, attachment) => {
        const { bytes, contentType } = await attachmentBytes(attachment, which);
        return { status: 200, raw: bytes, headers: { "Content-Type": contentType } };
      },
    }),
  ),

  route({
    method: "GET",
    path: "/api/me/results-history",
    roles: MEMBER,
    rate: enforceDownloadLimit,
    handle: async ({ caller }) => {
      const member = await callerMember(caller);
      const file = await resultsHistoryFile(member);
      const now = new Date();
      await inTransaction((db) => countDownload(db, member.id, now));
      return {
        status: 200,
        raw: file,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="ocotillo-results-history.csv"',
        },
      };
    },
  }),
  route({
    method: "GET",
    path: "/api/receipts",
    roles: BILLING,
    handle: async ({ query }) => ok(await receiptPage(query.get("month"), query.get("cursor"))),
  }),
  locatedRoute({
    method: "GET",
    path: "/api/receipts/:receiptId",
    roles: [...BILLING, "member"],
    locate: async (request, caller) => {
      const receipt = await locateReceipt(request.param("receiptId"));
      if (!receipt) throw notFound();
      hideFromOtherMembers(receipt.member_id, caller);
      return receipt;
    },
    handle: async (_request, receipt) => ok({ receipt: receiptView(receipt) }),
  }),
  route({ method: "GET", path: "/api/me/receipts", roles: MEMBER, handle: async ({ caller }) => ok({ receipts: await memberReceipts(caller.id) }) }),

  route({
    method: "POST",
    path: "/api/me/closure",
    roles: MEMBER,
    handle: async ({ caller }) => {
      await requestClosure(await callerMember(caller), new Date());
      return ok({ member: memberView(await callerMember(caller)) });
    },
  }),
];
