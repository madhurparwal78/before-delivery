// Every endpoint, the roles it is open to, and its handler.

import { ApiError } from "./errors.js";
import { fieldOf } from "./fields.js";
import { openRoute, route, type Reply, type Route } from "./router.js";
import { signIn, signOut } from "./sessions.js";
import { downloadAgreement } from "../domain/agreements.js";
import { buyOut } from "../domain/buyout.js";
import { activate, close } from "../domain/closing.js";
import { conditionPhoto, listConditionChecks, recordConditionCheck } from "../domain/conditionChecks.js";
import { downloadBillOfSale, getContract, getEquity, getInvoice, getQuote, getQuotes, listContracts } from "../domain/contractViews.js";
import { exchangeSize } from "../domain/exchange.js";
import { familyOverview } from "../domain/family.js";
import { availability, listInstruments } from "../domain/fleet.js";
import { addInstrument, addStudent, listFamilies } from "../domain/intake.js";
import { recordPayment, reversePayment } from "../domain/payments.js";
import { currentPriceList, listPriceLists, publishPriceList, withdrawPriceList } from "../domain/priceLists.js";
import { reserve } from "../domain/reservations.js";
import { listSchools, roster, rosterCsv, sendDeliveryNotice } from "../domain/roster.js";
import { readAgreement, revokeSigningLink, sendSigningLink, signAgreement } from "../domain/signing.js";
import { pool } from "../db/pool.js";

const ok = (json: unknown, status = 200): Reply => ({ status, json });
const ID = "([^/]+)";
const contract = (tail = ""): RegExp => new RegExp(`^/api/contracts/${ID}${tail}$`);

export const routes: Route[] = [
  openRoute("GET", /^\/api\/health$/, async () => ok({ status: "ok" })),
  openRoute("POST", /^\/api\/session$/, async (request) => {
    const email = fieldOf(request.body, "email");
    const password = fieldOf(request.body, "password");
    const session = typeof email === "string" && typeof password === "string" ? await signIn(email, password) : null;
    if (session === null) throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
    return { status: 200, json: { user: session.user }, cookie: session.cookie };
  }, "json"),
  route("GET", /^\/api\/me$/, "signed-in", async (r) => ok({ user: r.user })),
  route("DELETE", /^\/api\/session$/, "signed-in", async (r) => ({ status: 204, cookie: await signOut(r.headers.cookie) })),
  route("GET", /^\/api\/availability$/, "signed-in", async () => ok({ items: await availability(pool) })),
  route("GET", /^\/api\/schools$/, "signed-in", async () => ok(await listSchools())),
  route("GET", /^\/api\/price-lists\/current$/, "signed-in", async (r) => ok(await currentPriceList(r.query.get("on")))),
  route("GET", /^\/api\/price-lists$/, ["owner"], async () => ok(await listPriceLists())),
  route("POST", /^\/api\/price-lists$/, ["owner"], async (r) => ok(await publishPriceList(r.body), 201), "json"),
  route("POST", /^\/api\/price-lists\/([^/]+)\/withdraw$/, ["owner"], async (_r, [id]) => ok(await withdrawPriceList(id)), "json"),
  route("GET", /^\/api\/instruments$/, ["owner", "tech"], async () => ok({ instruments: await listInstruments(pool) })),
  route("POST", /^\/api\/instruments$/, ["owner"], async (r) => ok(await addInstrument(r.body), 201), "json"),
  route("GET", /^\/api\/families$/, ["owner"], async () => ok(await listFamilies())),
  route("POST", /^\/api\/students$/, ["owner"], async (r) => ok(await addStudent(r.body), 201), "json"),
  route("GET", /^\/api\/family$/, ["parent"], async (r) => ok(await familyOverview(r.user))),
  route("POST", /^\/api\/reservations$/, ["parent"], async (r) => ok(await reserve(r.user, r.body), 201), "json"),
  route("GET", /^\/api\/contracts$/, ["owner", "tech", "parent"], async (r) => ok(await listContracts(r.user))),
  route("GET", contract(), ["owner", "tech", "parent"], async (r, [id]) => ok(await getContract(r.user, id))),
  route("POST", contract("/signing-link"), ["owner"], async (r, [id]) => ok(await sendSigningLink(r.user, id), 201), "json"),
  route("POST", contract("/signing-link/revoke"), ["owner"], async (r, [id]) => ok(await revokeSigningLink(r.user, id)), "json"),
  openRoute("GET", /^\/api\/signing\/([^/]+)$/, async (_r, [token]) => ok(await readAgreement(token))),
  openRoute("POST", /^\/api\/signing\/([^/]+)$/, async (r, [token]) => ok(await signAgreement(token, r.body)), "json"),
  route("POST", contract("/activate"), ["owner"], async (r, [id]) => ok(await activate(r.user, id)), "json"),
  route("POST", contract("/return"), ["owner"], async (r, [id]) => ok(await close(r.user, id, "returned")), "json"),
  route("POST", contract("/write-off"), ["owner"], async (r, [id]) => ok(await close(r.user, id, "written_off")), "json"),
  route("GET", contract("/invoice"), ["owner", "parent"], async (r, [id]) => ok(await getInvoice(r.user, id))),
  route("GET", contract("/equity"), ["owner", "parent"], async (r, [id]) => ok(await getEquity(r.user, id))),
  route("GET", contract("/quote"), ["owner", "parent"], async (r, [id]) => ok(await getQuote(r.user, id, r.query.get("month")))),
  route("GET", contract("/quotes"), ["owner", "parent"], async (r, [id]) => ok(await getQuotes(r.user, id))),
  route("POST", contract("/payments"), ["owner"], async (r, [id]) => recordPayment(r, id), "json"),
  route("POST", contract("/payments/([^/]+)/reversal"), ["owner"], async (r, [id, paymentId]) => reversePayment(r, id, paymentId), "json"),
  route("POST", contract("/buyout"), ["owner", "parent"], async (r, [id]) => buyOut(r, id), "json"),
  route("POST", contract("/exchange"), ["owner"], async (r, [id]) => exchangeSize(r, id), "json"),
  route("GET", contract("/agreement\\.pdf"), ["owner", "parent"], async (r, [id]) => downloadAgreement(r, id)),
  route("GET", contract("/bill-of-sale\\.pdf"), ["owner", "parent"], async (r, [id]) => downloadBillOfSale(r.user, id)),
  route("POST", contract("/condition-events"), ["owner", "tech"], async (r, [id]) => ok(await recordConditionCheck(r.user, id, r.multipart), 201), "multipart"),
  route("GET", contract("/condition-events"), ["owner", "tech", "parent"], async (r, [id]) => ok(await listConditionChecks(r.user, id))),
  route("GET", /^\/api\/condition-photos\/([^/]+)$/, ["owner", "tech", "parent"], async (r, [id]) => conditionPhoto(r.user, id)),
  route("GET", /^\/api\/schools\/([^/]+)\/roster$/, ["owner", "director"], async (r, [id]) => ok(await roster(r.user, id))),
  route("GET", /^\/api\/schools\/([^/]+)\/roster\.csv$/, ["owner", "director"], async (r, [id]) => ({ status: 200,
    bytes: Buffer.from((await rosterCsv(r.user, id)).text, "utf8"), type: "text/csv; charset=utf-8",
    disposition: `attachment; filename="roster-${id}.csv"` })),
  route("POST", /^\/api\/schools\/([^/]+)\/delivery-notice$/, ["owner"], async (r, [id]) => ok(await sendDeliveryNotice(id, r.body), 202), "json"),
];
