import { authenticate, hashPassword, passwordMatches, sessionTokenOf, startSession } from "./auth.js";
import { nowSeconds, one, pool, rows, transaction, type Db, only } from "./db.js";
import { addDefaultRates, parseDelimited } from "./domain.js";
import { ApiError, conflict, fieldErrors, instantText, newId, noContent, notFound, ok, refused, searchText, route, type ApiRoute, type Ctx, type Untrusted } from "./http.js";
import { config } from "./config.js";
import { foldEmail, foldTelephone, isEmail, isUkTelephone } from "../shared/rules.js";
import type { DeskRow, CustomerRow } from "./records.js";

const SHEET_LIMIT = 2_000_000;
const WAIT_OVER = "The wait is over. This customer can't be brought back.";

export const customerState = (c: CustomerRow, now = nowSeconds()): string =>
  c.state === "closed" && (c.erase_at as number) <= now ? "erasing" : c.state;
const customerJson = (c: CustomerRow): Record<string, unknown> => ({
  id: c.id, name: c.name, email: c.email, telephone: c.telephone, language: c.language, notes: c.notes, state: customerState(c), closedAt: instantText(c.closed_at), eraseAt: instantText(c.erase_at),
});
const deskJson = (d: DeskRow): Record<string, string> => ({ id: d.id, name: d.name, email: d.email });
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const validateCustomer = (body: Untrusted): Record<string, string> => {
  const fields: Record<string, string> = {};
  if (!text(body.name).trim()) fields.name = "Enter your name.";
  if (!isEmail(text(body.email))) fields.email = "Enter a real email address.";
  if (!isUkTelephone(text(body.telephone))) fields.telephone = "Enter a UK telephone number.";
  if (!["en", "pl", "ur"].includes(body.language)) fields.language = "Choose a language.";
  return fields;
};
export const insertCustomer = async (db: Db, deskId: string, c: { name: string; email: string; telephone: string; language: string; notes?: string | null }, now = nowSeconds()): Promise<CustomerRow> =>
  only<CustomerRow>(db, "INSERT INTO customers (id,desk_id,name,email,email_folded,telephone,telephone_folded,language,notes,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
    [newId("CU"), deskId, c.name, c.email.trim(), foldEmail(c.email), c.telephone, foldTelephone(c.telephone), c.language, c.notes ?? null, now]);

const loadCustomer = async (ctx: Ctx): Promise<CustomerRow> => {
  const row = await one<CustomerRow>(pool, "SELECT * FROM customers WHERE id=$1 AND desk_id=$2 AND state<>'erased'", [ctx.params.id, ctx.desk!.id]);
  if (!row) throw notFound();
  return row;
};

export const customersList = async (deskId: string, state: string, q: string | null): Promise<CustomerRow[]> => {
  const list = await rows<CustomerRow>(pool, "SELECT * FROM customers WHERE desk_id=$1 AND state<>'erased' ORDER BY created_at, id", [deskId]);
  const needle = q?.toLowerCase();
  return list.filter((c) => {
    const reads = customerState(c);
    const inFilter = state === "closed" ? reads === "closed" || reads === "erasing" : reads === state;
    return inFilter && (!needle || c.name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle));
  });
};

/** Rows match by folded email or telephone: no match adds, one fills empty fields, two go to the review list. */
const bringInSheet = async (deskId: string, content: string): Promise<{ added: number; filled: number; reviewList: { row: number; message: string }[] }> =>
  transaction(async (tx) => {
    await tx.query("SELECT id FROM desks WHERE id=$1 FOR UPDATE", [deskId]);
    const lines = parseDelimited(content);
    const header = (lines[0] ?? []).map((h) => h.trim().toLowerCase());
    if (header.join(",") !== "name,email,telephone,notes") throw refused("The first line has to read Name,Email,Telephone,Notes.");
    let added = 0;
    let filled = 0;
    const reviewList: { row: number; message: string }[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const [name = "", email = "", telephone = "", notes = ""] = lines[i];
      if (!name.trim() && !email.trim() && !telephone.trim()) continue;
      const customers = await rows<CustomerRow>(tx, "SELECT * FROM customers WHERE desk_id=$1 AND state<>'erased' AND ((email_folded=$2 AND $2<>'') OR (telephone_folded=$3 AND $3<>''))", [deskId, foldEmail(email), foldTelephone(telephone)]);
      if (customers.length === 0) {
        await insertCustomer(tx, deskId, { name, email, telephone, language: "en", notes: notes || null });
        added += 1;
      } else if (customers.length === 1) {
        const c = customers[0];
        const fills = { name: c.name || name, email: c.email || email.trim(), telephone: c.telephone || telephone, notes: c.notes || notes || null };
        if (fills.name !== c.name || fills.email !== c.email || fills.telephone !== c.telephone || fills.notes !== c.notes) {
          await tx.query("UPDATE customers SET name=$2,email=$3,email_folded=$4,telephone=$5,telephone_folded=$6,notes=$7 WHERE id=$1", [c.id, fills.name, fills.email, foldEmail(fills.email), fills.telephone, foldTelephone(fills.telephone), fills.notes]);
          filled += 1;
        }
      } else reviewList.push({ row: i + 1, message: "Matches two customers" });
    }
    await tx.query("UPDATE desks SET review_list=$2 WHERE id=$1", [deskId, JSON.stringify(reviewList)]);
    return { added, filled, reviewList };
  });

export const accessRoutes: ApiRoute[] = [
  route({ method: "GET", path: "/api/health", access: "public", run: async () => ok({ status: "ok" }) }),
  route({
    method: "POST", path: "/api/auth/sign-up", access: "public", body: "json",
    run: async ({ json }) => {
      const fields: Record<string, string> = {};
      if (!text(json.name).trim()) fields.name = "Enter your name.";
      if (!isEmail(text(json.email))) fields.email = "Enter a real email address.";
      if (text(json.password).length < 8) fields.password = "Use at least 8 characters.";
      if (Object.keys(fields).length) throw fieldErrors(fields);
      const hash = await hashPassword(json.password);
      const desk = await transaction(async (tx) => {
        const made = await one<DeskRow>(tx, "INSERT INTO desks (id,name,email,email_folded,password_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email_folded) DO NOTHING RETURNING *",
          [newId("DK"), json.name.trim(), json.email.trim(), foldEmail(json.email), hash, nowSeconds()]);
        if (!made) throw conflict("emailTaken", "That email already has a desk.");
        await addDefaultRates(tx, made.id);
        return made;
      });
      return { status: 201, body: { desk: deskJson(desk) }, headers: await startSession(desk) };
    },
  }),
  route({
    method: "POST", path: "/api/auth/sign-in", access: "public", body: "json",
    run: async ({ json }) => {
      const desk = await one<DeskRow>(pool, "SELECT * FROM desks WHERE email_folded=$1", [foldEmail(text(json.email))]);
      if (!desk || !(await passwordMatches(text(json.password), desk.password_hash))) throw new ApiError(401, "wrongPassword", "That email and password do not match.");
      return { status: 200, body: { desk: deskJson(desk) }, headers: await startSession(desk) };
    },
  }),
  route({
    method: "POST", path: "/api/auth/sign-out",
    run: async ({ req }) => {
      await pool.query("UPDATE sessions SET ended_at=$2 WHERE token=$1", [sessionTokenOf(req), nowSeconds()]);
      return noContent();
    },
  }),
  route({
    method: "GET", path: "/api/auth/session", access: "public",
    run: async ({ req }) => {
      const session = await authenticate(req);
      if (session.desk) return ok({ desk: session.desk });
      throw session.ended ? new ApiError(401, "sessionEnded", "Your session ended. Sign in again to keep going — what you typed is still here.") : new ApiError(401, "notSignedIn", "Sign in to keep going.");
    },
  }),
  route({
    method: "POST", path: "/api/auth/password", body: "json",
    run: async ({ json, desk, req }) => {
      const row = await only<Pick<DeskRow, "password_hash">>(pool, "SELECT password_hash FROM desks WHERE id=$1", [desk!.id]);
      if (!(await passwordMatches(text(json.currentPassword), row.password_hash))) throw new ApiError(401, "wrongPassword", "That password is not right.", { currentPassword: "That password is not right." });
      if (text(json.newPassword).length < 8) throw refused("Use at least 8 characters.", "newPassword");
      await pool.query("UPDATE desks SET password_hash=$2 WHERE id=$1", [desk!.id, await hashPassword(json.newPassword)]);
      await pool.query("UPDATE sessions SET ended_at=$3 WHERE desk_id=$1 AND token<>$2 AND ended_at IS NULL", [desk!.id, sessionTokenOf(req), nowSeconds()]);
      return noContent();
    },
  }),
  route({
    method: "GET", path: "/api/customers",
    run: async ({ query, desk }) => ok({ customers: (await customersList(desk!.id, query.get("state") || "active", searchText(query))).map(customerJson) }),
  }),
  route({
    method: "POST", path: "/api/customers", body: "json",
    run: async ({ json, desk }) => {
      const fields = validateCustomer(json);
      if (Object.keys(fields).length) throw fieldErrors(fields);
      return ok(customerJson(await insertCustomer(pool, desk!.id, { name: json.name, email: json.email, telephone: json.telephone, language: json.language })), 201);
    },
  }),
  route({
    method: "POST", path: "/api/customers/import", body: "csv", limit: SHEET_LIMIT,
    run: async ({ text: content, desk }) => ok(await bringInSheet(desk!.id, content)),
  }),
  route({
    method: "GET", path: "/api/customers/review",
    run: async ({ desk }) => ok({ reviewList: (await only<Pick<DeskRow, "review_list">>(pool, "SELECT review_list FROM desks WHERE id=$1", [desk!.id])).review_list }),
  }),
  route({ method: "GET", path: "/api/customers/:id", load: loadCustomer, run: async ({ loaded }) => ok(customerJson(loaded)) }),
  route({
    method: "PATCH", path: "/api/customers/:id", body: "json", load: loadCustomer,
    run: async ({ json, loaded }) => {
      if (!text(json.name).trim()) throw refused("Enter your name.", "name");
      const name = json.name.trim();
      return ok(customerJson(await transaction(async (tx) => {
        await tx.query("UPDATE hires SET name=$2 WHERE customer_id=$1", [loaded.id, name]);
        return only<CustomerRow>(tx, "UPDATE customers SET name=$2 WHERE id=$1 RETURNING *", [loaded.id, name]);
      })));
    },
  }),
  route({
    method: "DELETE", path: "/api/customers/:id", load: loadCustomer,
    run: async ({ loaded }) => {
      if (await one(pool, "SELECT 1 FROM hires WHERE customer_id=$1 LIMIT 1", [loaded.id])) throw conflict("customerHasHire", "This customer has a hire, so it can't be removed.");
      await pool.query("DELETE FROM complaints WHERE customer_id=$1", [loaded.id]);
      await pool.query("DELETE FROM customers WHERE id=$1", [loaded.id]);
      return noContent();
    },
  }),
  route({
    method: "POST", path: "/api/customers/:id/close", body: "json", load: loadCustomer,
    run: async ({ loaded }) => {
      if (loaded.state !== "active") throw conflict("alreadyClosed", "This customer is already closed.");
      const now = nowSeconds();
      return ok(customerJson(await only<CustomerRow>(pool, "UPDATE customers SET state='closed',closed_at=$2,erase_at=$3 WHERE id=$1 RETURNING *", [loaded.id, now, now + config.closureWait])));
    },
  }),
  route({
    method: "POST", path: "/api/customers/:id/bring-back", body: "json", load: loadCustomer,
    run: async ({ loaded }) => {
      const back = await one<CustomerRow>(pool, "UPDATE customers SET state='active',closed_at=NULL,erase_at=NULL WHERE id=$1 AND state='closed' AND erase_at>$2 RETURNING *", [loaded.id, nowSeconds()]);
      if (!back) throw conflict("waitOver", WAIT_OVER);
      return ok(customerJson(back));
    },
  }),
];
