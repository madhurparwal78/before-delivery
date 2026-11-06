import { hashPassword, requireActor, requireRole } from "../auth.js";
import { all, newId, one, pool, tx } from "../db.js";
import { ApiError, field, invalid, json, route } from "../http.js";
import { siteInScope, type RenterRow } from "../scope.js";

const renterJson = (renter: RenterRow) => ({ id: renter.id, name: renter.name, business: renter.business, email: renter.email, home_site_id: renter.home_site_id });

route("GET", "/api/renters", async (request) => {
  const actor = await requireActor(request);
  requireRole(actor, "front_desk", "manager");
  const query = (request.query.get("q") ?? "").trim();
  const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const renters = await all<RenterRow>(pool,
    `SELECT * FROM renters WHERE operator_id = $1 AND (name ILIKE $2 OR business ILIKE $2 OR email ILIKE $2) ORDER BY business, id`,
    [actor.operatorId, pattern]);
  return json(200, { renters: renters.map(renterJson) });
});

route("POST", "/api/renters", async (request) => {
  const actor = await requireActor(request);
  const homeSite = field(request.body, "home_site_id");
  if (typeof homeSite === "string") await siteInScope(pool, actor, homeSite);
  requireRole(actor, "manager");
  const text = (name: string): string => {
    const value = field(request.body, name);
    return typeof value === "string" ? value.trim() : "";
  };
  const [name, business, email, phone] = [text("name"), text("business"), text("email").toLowerCase(), text("phone")];
  const password = field(request.body, "password");
  if (email && (await one(pool, "SELECT 1 FROM users WHERE lower(email) = $1", [email]))) throw new ApiError(409, "email_taken");
  const fields: Record<string, string> = {};
  if (!name) fields.name = "Enter the renter's name.";
  if (!business) fields.business = "Enter the business name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = "Enter a valid email address.";
  if (!phone) fields.phone = "Enter a phone number.";
  if (typeof password !== "string" || password.length < 10) fields.password = "Use a password of at least 10 characters.";
  if (typeof homeSite !== "string") fields.home_site_id = "Choose the renter's home site.";
  if (Object.keys(fields).length > 0 || typeof password !== "string" || typeof homeSite !== "string") throw invalid(fields);
  const renter: RenterRow = { id: newId("rn"), operator_id: actor.operatorId, home_site_id: homeSite, name, business, email, phone };
  const passwordHash = await hashPassword(password);
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`email:${email}`]);
    if (await one(client, "SELECT 1 FROM users WHERE lower(email) = $1", [email])) throw new ApiError(409, "email_taken");
    await client.query("INSERT INTO renters (id, operator_id, home_site_id, name, business, email, phone) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [renter.id, renter.operator_id, renter.home_site_id, name, business, email, phone]);
    await client.query("INSERT INTO users (id, email, name, role, operator_id, site_id, renter_id, password_hash) VALUES ($1,$2,$3,'renter',$4,NULL,$5,$6)",
      [newId("us"), email, name, actor.operatorId, renter.id, passwordHash]);
  });
  return json(201, { renter: { ...renterJson(renter), phone } });
});
