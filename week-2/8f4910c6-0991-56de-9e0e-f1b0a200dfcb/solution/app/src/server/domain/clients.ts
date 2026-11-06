// Brand clients.

import { exec, lockKey, pool, rows, tx, type Db } from "../db.js";
import { memberRoute, json } from "../http.js";
import { STAFF } from "../auth.js";
import { EMAIL_COPY, FieldErrors, required } from "../errors.js";
import { asObject, newId, str } from "../util.js";
import { isEmail, singleLine, slugBase } from "../../shared/text.js";
import { isValidZone } from "../../shared/zones.js";

interface ClientRow {
  id: string;
  slug: string;
  company: string;
  contact_name: string;
  contact_email: string;
  time_zone: string;
}

function clientBody(row: ClientRow) {
  return { id: row.id, slug: row.slug, company: row.company, contactName: row.contact_name,
    contactEmail: row.contact_email, timeZone: row.time_zone };
}

/** `base`, or the lowest free `base-2`, `base-3` … in `table`. */
export async function freeSlug(db: Db, table: "clients" | "talent", base: string): Promise<string> {
  const root = base || "client";
  const taken = new Set((await rows<{ slug: string }>(db, `SELECT slug FROM ${table} WHERE slug = $1 OR slug LIKE $2`,
    [root, `${root}-%`])).map((row) => row.slug));
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n++;
  return `${root}-${n}`;
}

memberRoute("GET", "/api/clients", async (ctx) => {
  ctx.allow(...STAFF);
  const found = await rows<ClientRow>(pool, "SELECT * FROM clients ORDER BY company, id");
  return json(200, { clients: found.map(clientBody) });
});

memberRoute("POST", "/api/clients", async (ctx) => {
  ctx.allow("booker", "accounts_lead", "agency_director");
  const body = asObject(await ctx.json());
  const company = singleLine(str(body, "company")).trim();
  const contactName = singleLine(str(body, "contactName")).trim();
  const contactEmail = singleLine(str(body, "contactEmail")).trim();
  const timeZone = str(body, "timeZone").trim();
  const errors: FieldErrors = new FieldErrors();
  if (!company) errors.add("company", required("Company"));
  if (!contactName) errors.add("contactName", required("Contact name"));
  if (!contactEmail) errors.add("contactEmail", required("Contact email"));
  else if (!isEmail(contactEmail)) errors.add("contactEmail", EMAIL_COPY);
  if (!timeZone) errors.add("timeZone", required("Time zone"));
  else if (!isValidZone(timeZone)) errors.add("timeZone", "Choose a time zone like America/Toronto.");
  errors.throwIfAny();
  return tx(async (client) => {
    await lockKey(client, "client-slugs");
    const id = newId();
    const slug = await freeSlug(client, "clients", slugBase(company));
    await exec(client, `INSERT INTO clients (id, slug, company, contact_name, contact_email, time_zone)
      VALUES ($1, $2, $3, $4, $5, $6)`, [id, slug, company, contactName, contactEmail, timeZone]);
    return json(201, clientBody({ id, slug, company, contact_name: contactName, contact_email: contactEmail,
      time_zone: timeZone }));
  });
});
