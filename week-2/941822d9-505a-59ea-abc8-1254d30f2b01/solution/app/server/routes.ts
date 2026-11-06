import { db } from "./db.js";
import { fail, forbidden, notFound, Validation } from "./http/errors.js";
import { open, sessionToken, SESSION_COOKIE, signedIn, type Reply, type Route } from "./http/router.js";
import { certificateRow, currentPdf, readableCertificate, reissueCertificate, revokeCertificate, searchCertificates, transcript, versionForDownloadToken, versionPdf, certificateJson } from "./domain/certificates.js";
import { checkout, quoteReply } from "./domain/checkout.js";
import { changeSeatCap, createCohort, joinWaitlist, leaveWaitlist, readCohort } from "./domain/cohortPlanning.js";
import { courseHistory, courseJson, createCourse, isId, listCourses, readableCourse, transitionCourse, updateCourse } from "./domain/courses.js";
import { ENROLMENT_SELECT, enrolmentsJson, readableEnrolment, type EnrolmentRow } from "./domain/enrolments.js";
import { answerModule, readModule, submitEvaluation } from "./domain/learning.js";
import { createLink, listLinks, revokeLink, verifiedPdf, verifiedSummary } from "./domain/links.js";
import { assignSeat, buyPack, listPacks, packLedger, returnSeat } from "./domain/packs.js";
import { approveRefund, declineRefund, refundQueue, requestRefund } from "./domain/refunds.js";
import { changeCoverage, createExport, dashboard, monthlyReport, nurseRecord, readExport, searchNurses, searchText } from "./domain/sponsor.js";
import { endSession, renameUser, startSession, userJson, type Role, type SessionUser } from "./domain/users.js";

const ok = (json: unknown, status = 200): Reply => ({ status, json });
const noContent: Reply = { status: 204 };

const pdfReply = (file: { bytes: Buffer; filename: string }): Reply => ({
  status: 200,
  bytes: file.bytes,
  contentType: "application/pdf",
  headers: { "Content-Disposition": `attachment; filename="${file.filename}"` },
});

function onlyRole(user: SessionUser, role: Role): void {
  if (user.role !== role) throw forbidden();
}

const verificationCapability = () => true;

export const routes: Route[] = [
  open("GET", "/api/health", async () => ok({ status: "ok" })),

  open("POST", "/api/session", async (ctx) => {
    const v = new Validation(ctx.body, ["email", "password"]);
    const { email, password } = ctx.body;
    const session = typeof email === "string" && typeof password === "string" ? await startSession(email.trim(), password, ctx.now) : null;
    if (!session) {
      v.add("password", "Email or password is incorrect.");
      throw v.error();
    }
    v.done();
    return {
      status: 200,
      json: { user: userJson(session.user) },
      headers: { "Set-Cookie": `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax` },
    };
  }),
  signedIn("DELETE", "/api/session", async (ctx) => {
    new Validation(ctx.body, []).done();
    const token = sessionToken(ctx.headers);
    if (token !== null) await endSession(token);
    return { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
  }),
  signedIn("GET", "/api/me", async (ctx) => ok({ user: userJson(ctx.user, true) })),
  signedIn("PATCH", "/api/me", async (ctx) => {
    const v = new Validation(ctx.body, ["display_name"]);
    const name = typeof ctx.body.display_name === "string" ? ctx.body.display_name.trim() : "";
    if (name.length < 1 || name.length > 80) v.add("display_name", "Enter a display name of 1 to 80 characters.");
    v.done();
    const user = await renameUser(ctx.user.id, name);
    if (!user) throw notFound();
    return ok({ user: userJson(user, true) });
  }),

  signedIn("GET", "/api/courses", async (ctx) => ok({ courses: await listCourses(db, ctx.user) })),
  signedIn("POST", "/api/courses", async (ctx) => ok({ course: await createCourse(ctx.user, ctx.body, ctx.now) }, 201)),
  signedIn("GET", "/api/courses/:id", async (ctx) => ok({ course: await courseJson(db, await readableCourse(db, ctx.user, ctx.params.id), ctx.user, ctx.now) })),
  signedIn("PATCH", "/api/courses/:id", async (ctx) => {
    const ifMatch = ctx.headers["if-match"];
    return ok({ course: await updateCourse(ctx.user, ctx.params.id, typeof ifMatch === "string" ? ifMatch : undefined, ctx.body, ctx.now) });
  }),
  signedIn("POST", "/api/courses/:id/transitions", async (ctx) => {
    const ifMatch = ctx.headers["if-match"];
    return ok({ course: await transitionCourse(ctx.user, ctx.params.id, typeof ifMatch === "string" ? ifMatch : undefined, ctx.body, ctx.now) });
  }),
  signedIn("GET", "/api/courses/:id/history", async (ctx) => ok({ history: await courseHistory(db, ctx.user, ctx.params.id) })),
  signedIn("POST", "/api/courses/:id/cohorts", async (ctx) => ok({ cohort: await createCohort(ctx.user, ctx.params.id, ctx.body, ctx.now) }, 201)),

  signedIn("GET", "/api/cohorts/:id", async (ctx) => ok({ cohort: await readCohort(ctx.user, ctx.params.id, ctx.now) })),
  signedIn("PATCH", "/api/cohorts/:id", async (ctx) => ok({ cohort: await changeSeatCap(ctx.user, ctx.params.id, ctx.body, ctx.now) })),
  signedIn("POST", "/api/cohorts/:id/waitlist", async (ctx) => {
    const joined = await joinWaitlist(ctx.user, ctx.params.id, ctx.body, ctx.now);
    return ok({ waitlist_entry: joined.entry }, joined.created ? 201 : 200);
  }),
  signedIn("DELETE", "/api/cohorts/:id/waitlist", async (ctx) => {
    await leaveWaitlist(ctx.user, ctx.params.id, ctx.body);
    return noContent;
  }),

  signedIn("GET", "/api/checkout/quote", quoteReply),
  signedIn("POST", "/api/checkout", checkout),

  signedIn("GET", "/api/me/enrolments", async (ctx) => {
    onlyRole(ctx.user, "learner");
    const rows = await db.q<EnrolmentRow>(`${ENROLMENT_SELECT} WHERE e.learner_id = $1 AND e.state <> 'held' ORDER BY e.enrolled_at DESC`, [ctx.user.id]);
    return ok({ enrolments: await enrolmentsJson(db, rows) });
  }),
  signedIn("GET", "/api/enrolments/:id", async (ctx) => {
    const [enrolment] = await enrolmentsJson(db, [await readableEnrolment(db, ctx.user, ctx.params.id)]);
    return ok({ enrolment });
  }),
  signedIn("GET", "/api/enrolments/:id/modules/:module", readModule),
  signedIn("POST", "/api/enrolments/:id/modules/:module/answer", answerModule),
  signedIn("POST", "/api/enrolments/:id/evaluation", submitEvaluation),
  signedIn("POST", "/api/enrolments/:id/refund-request", async (ctx) => ok({ refund_request: await requestRefund(ctx.user, ctx.params.id, ctx.body, ctx.now) }, 201)),

  signedIn("GET", "/api/me/transcript", async (ctx) => {
    onlyRole(ctx.user, "learner");
    return ok(await transcript(db, ctx.user));
  }),
  signedIn("GET", "/api/certificates/:id", async (ctx) => ok({ certificate: certificateJson(await readableCertificate(db, ctx.user, ctx.params.id)) })),
  open(
    "GET",
    "/api/certificates/:id/pdf",
    async (ctx) => {
      const token = ctx.query.get("token");
      if (token !== null) {
        const id = ctx.params.id;
        const version = isId(id) ? await versionForDownloadToken(id, token, ctx.now) : null;
        const row = version === null ? undefined : await certificateRow(db, id);
        if (version === null || !row) throw notFound();
        return pdfReply({ bytes: await versionPdf(row.serial, version), filename: `${row.serial}-v${version}.pdf` });
      }
      if (!ctx.user) throw fail(401, "unauthenticated");
      return pdfReply(await currentPdf(await readableCertificate(db, ctx.user, ctx.params.id)));
    },
    { capability: (query) => query.has("token") },
  ),
  signedIn("POST", "/api/certificates/:id/share-links", async (ctx) => ok({ link: await createLink(ctx.user, ctx.params.id, ctx.body, ctx.now) }, 201)),
  signedIn("GET", "/api/certificates/:id/share-links", async (ctx) => ok({ links: await listLinks(ctx.user, ctx.params.id, ctx.now) })),
  signedIn("DELETE", "/api/certificates/:id/share-links/:link", async (ctx) => {
    await revokeLink(ctx.user, ctx.params.id, ctx.params.link, ctx.body, ctx.now);
    return noContent;
  }),
  signedIn("GET", "/api/planner/certificates", async (ctx) => {
    onlyRole(ctx.user, "planner");
    return ok({ certificates: await searchCertificates(db, searchText(ctx.query)) });
  }),
  signedIn("POST", "/api/certificates/:id/reissue", async (ctx) => {
    const reissued = await reissueCertificate(ctx.user, ctx.params.id, ctx.body, ctx.origin, ctx.now);
    return ok({ certificate: reissued.certificate }, reissued.sealed ? 201 : 202);
  }),
  signedIn("POST", "/api/certificates/:id/revoke", async (ctx) => ok({ certificate: await revokeCertificate(ctx.user, ctx.params.id, ctx.body, ctx.now) })),

  open("GET", "/api/verify/:token", async (ctx) => ok({ certificate: await verifiedSummary(ctx.params.token ?? "", ctx.now) }), {
    capability: verificationCapability,
    head: true,
  }),
  open("GET", "/api/verify/:token/pdf", async (ctx) => pdfReply(await verifiedPdf(ctx.params.token ?? "", ctx.now)), {
    capability: verificationCapability,
    head: true,
  }),

  signedIn("GET", "/api/refund-requests", async (ctx) => {
    onlyRole(ctx.user, "planner");
    return ok({ refund_requests: await refundQueue(ctx.now) });
  }),
  signedIn("POST", "/api/refund-requests/:id/approve", async (ctx) => ok(await approveRefund(ctx.user, ctx.params.id, ctx.body, ctx.now))),
  signedIn("POST", "/api/refund-requests/:id/decline", async (ctx) => ok(await declineRefund(ctx.user, ctx.params.id, ctx.body, ctx.now))),

  signedIn("GET", "/api/sponsor/dashboard", async (ctx) => ok(await dashboard(ctx.user, ctx.now))),
  signedIn("PATCH", "/api/sponsor/coverage", async (ctx) => ok(await changeCoverage(ctx.user, ctx.body, ctx.now))),
  signedIn("GET", "/api/sponsor/packs", async (ctx) => ok({ packs: await listPacks(ctx.user, ctx.now) })),
  signedIn("POST", "/api/sponsor/packs", buyPack),
  signedIn("GET", "/api/sponsor/packs/:id/ledger", async (ctx) => ok(await packLedger(ctx.user, ctx.params.id, ctx.now))),
  signedIn("POST", "/api/sponsor/packs/:id/assignments", assignSeat),
  signedIn("DELETE", "/api/sponsor/assignments/:id", returnSeat),
  signedIn("GET", "/api/sponsor/learners", async (ctx) => {
    if (ctx.user.role !== "coordinator") throw forbidden();
    return ok({ learners: await searchNurses(ctx.user, searchText(ctx.query)) });
  }),
  signedIn("GET", "/api/sponsor/learners/:id", async (ctx) => ok(await nurseRecord(ctx.user, ctx.params.id))),
  signedIn("GET", "/api/sponsor/reports/monthly", async (ctx) => ok(await monthlyReport(ctx.user, ctx.query))),
  signedIn("POST", "/api/sponsor/exports", async (ctx) => ok({ export: await createExport(ctx.user, ctx.body, ctx.now) }, 201)),
  signedIn("GET", "/api/sponsor/exports/:id.csv", async (ctx) => ({
    status: 200,
    bytes: await readExport(ctx.user, ctx.params.id),
    contentType: "text/csv; charset=utf-8",
    headers: { "Content-Disposition": 'attachment; filename="completions.csv"' },
  })),
];
