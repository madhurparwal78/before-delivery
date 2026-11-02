import { allow, CART_COOKIE, CUSTOMER, endSession, signedIn, startSession, type Ctx, type Reply } from "../context.js";
import { query } from "../db.js";
import { loadPricing } from "../domain/quote.js";
import { ApiError, bool, cookies, notFound, str, validation } from "../http.js";
import { address, addresses, checkPassword, createUser, PocketBaseError, saveAddress, type Address, type User } from "../pocketbase.js";
import { PROVINCE_NAMES } from "../../shared/format.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userJson = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

/** An empty crate started before signing in follows the customer's default address province. */
async function adoptProvince(ctx: Ctx, user: User): Promise<void> {
  const crate = cookies(ctx.req).get(CART_COOKIE);
  if (!crate || user.role !== "customer") return;
  const home = (await addresses(user.id)).find((a) => a.is_default);
  if (home) {
    await query("UPDATE crates SET province = $2 WHERE id::text = $1 AND user_id IS NULL AND hold_status <> 'active'", [crate, home.province]);
  }
}

export async function signUp(ctx: Ctx): Promise<Reply> {
  const email = str(ctx.body, "email")?.trim().toLowerCase() ?? "";
  const password = str(ctx.body, "password") ?? "";
  const name = str(ctx.body, "name")?.trim() ?? "";
  const fields: Record<string, string> = {};
  if (!EMAIL.test(email)) fields.email = "Enter a valid email.";
  if (password.length < 10 || password.length > 128) fields.password = "Use 10 to 128 characters.";
  if (name.length < 1 || name.length > 80) fields.name = "Enter your name (up to 80 characters).";
  if (Object.keys(fields).length > 0) throw validation(fields);
  await query("SELECT 1");
  let user: User;
  try {
    user = await createUser(email, password, name, "customer");
  } catch (error) {
    if (error instanceof PocketBaseError && error.data.email) {
      throw new ApiError(409, "email_taken", "An account with that email already exists.");
    }
    throw error;
  }
  await startSession(ctx, user);
  return { status: 201, body: { user: userJson(user) } };
}

export async function signIn(ctx: Ctx): Promise<Reply> {
  const email = str(ctx.body, "email")?.trim().toLowerCase() ?? "";
  const password = str(ctx.body, "password") ?? "";
  if (!email || !password) throw validation({ ...(email ? {} : { email: "Enter your email." }), ...(password ? {} : { password: "Enter your password." }) });
  await query("SELECT 1");
  const user = await checkPassword(email, password);
  if (!user) throw new ApiError(401, "invalid_credentials", "That email and password don't match.");
  await startSession(ctx, user);
  await adoptProvince(ctx, user).catch(() => undefined);
  return { status: 200, body: { user: userJson(user) } };
}

export async function signOut(ctx: Ctx): Promise<Reply> {
  await endSession(ctx);
  return { status: 204 };
}

export async function me(ctx: Ctx): Promise<Reply> {
  return { status: 200, body: { user: userJson(await signedIn(ctx)) } };
}

// ---- addresses ----------------------------------------------------------------------------

const POSTAL = /^([A-Za-z])(\d)([A-Za-z]) ?(\d)([A-Za-z])(\d)$/;

/** Validates address fields; postal codes are stored as uppercase `A1A 1A1` matching the province. */
async function addressFields(body: Ctx["body"], current?: Address): Promise<Omit<Address, "id">> {
  const pricing = await loadPricing();
  const pick = (key: keyof Omit<Address, "id" | "is_default">) =>
    (body[key] === undefined ? current?.[key] : str(body, key))?.trim() ?? "";
  const province = pick("province");
  const fields: Record<string, string> = {};
  const name = pick("name");
  const line1 = pick("line1");
  const city = pick("city");
  const known = pricing.provinces.find((p) => p.code === province);
  if (!name || name.length > 80) fields.name = "Enter your full name.";
  if (!line1 || line1.length > 120) fields.line1 = "Enter your street address.";
  if (!city || city.length > 80) fields.city = "Enter your city.";
  if (!known) fields.province = "We don't ship to that province yet.";
  const postal = POSTAL.exec(pick("postal_code"));
  const postalCode = postal ? `${postal[1]}${postal[2]}${postal[3]} ${postal[4]}${postal[5]}${postal[6]}`.toUpperCase() : "";
  if (known && (!postal || !known.postalLetters.includes(postalCode[0]))) {
    fields.postal_code = `Enter a postal code like A1A 1A1 for ${PROVINCE_NAMES[province]}.`;
  }
  const isDefault = body.is_default === undefined ? (current?.is_default ?? false) : bool(body, "is_default");
  if (isDefault === undefined) fields.is_default = "Choose whether this is your default address.";
  if (Object.keys(fields).length > 0) throw validation(fields);
  return { name, line1, line2: pick("line2"), city, province, postal_code: postalCode, is_default: isDefault ?? false };
}

export async function listAddresses(ctx: Ctx): Promise<Reply> {
  const user = await signedIn(ctx);
  allow(user, CUSTOMER);
  return { status: 200, body: { addresses: await addresses(user.id) } };
}

export async function createAddress(ctx: Ctx): Promise<Reply> {
  const user = await signedIn(ctx);
  allow(user, CUSTOMER);
  const saved = await saveAddress(user.id, await addressFields(ctx.body));
  return { status: 201, body: { address: saved } };
}

export async function updateAddress(ctx: Ctx): Promise<Reply> {
  const user = await signedIn(ctx);
  const current = await address(user.id, ctx.params[0]);
  if (!current) throw notFound();
  allow(user, CUSTOMER);
  const fields = await addressFields(ctx.body, current);
  if (current.is_default && !fields.is_default) throw validation({ is_default: "Make another address your default first." });
  return { status: 200, body: { address: await saveAddress(user.id, fields, current.id) } };
}
