import { createUser, createSession, deleteSession, findUserByEmail, userFromRow, verifyPassword } from "../users.js";
import { ApiError } from "../errors.js";
import { json, noContent, parseJsonBody, route, requireUser, type RouteContext } from "../router.js";
import { rows } from "../db.js";
import { clearSessionCookie, setSessionCookie } from "../http.js";

type ApplicationBody = {
  business_name?: unknown;
  contact_name?: unknown;
  email?: unknown;
  phone?: unknown;
  password?: unknown;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const validateApplication = (body: ApplicationBody): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (text(body.business_name).length < 1 || text(body.business_name).length > 120) {
    errors.business_name = "Enter the business name, 1 to 120 characters.";
  }
  if (text(body.contact_name).length < 1 || text(body.contact_name).length > 120) {
    errors.contact_name = "Enter your name, 1 to 120 characters.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(body.email))) {
    errors.email = "Enter a valid email address.";
  }
  if (text(body.phone).length < 7 || text(body.phone).length > 30) {
    errors.phone = "Enter the phone number, 7 to 30 characters.";
  }
  if (text(body.password).length < 10 || text(body.password).length > 200) {
    errors.password = "Enter a password of 10 to 200 characters.";
  }
  return errors;
};

route("POST", "/api/applications", "none", async (ctx: RouteContext) => {
  const body = parseJsonBody<ApplicationBody>(ctx);
  const errors = validateApplication(body);
  if (Object.keys(errors).length > 0) throw ApiError.validationError(errors);
  const email = text(body.email);
  const existing = await findUserByEmail(ctx.db, email);
  if (existing) {
    throw ApiError.validationError({ email: "That email already has an account." });
  }
  const renterIdResult = await rows<{ id: string }>(
    ctx.db,
    "insert into renters (business_name, contact_name, email, phone, status) values ($1, $2, $3, $4, 'applied') returning id",
    [text(body.business_name), text(body.contact_name), email, text(body.phone)],
  );
  const renterId = renterIdResult[0]!.id;
  const newUserId = await createUser(ctx.db, email, text(body.password), text(body.contact_name), "renter", renterId);
  const token = await createSession(ctx.db, newUserId);
  const response = json(
    {
      user: userFromRow({
        id: newUserId,
        email,
        name: text(body.contact_name),
        role: "renter",
        renter_id: renterId,
        renter_status: "applied",
      }),
      renter: { id: renterId, status: "applied" },
    },
    201,
  );
  response.headers.set("Set-Cookie", setSessionCookie(token));
  return response;
});

route("POST", "/api/session", "none", async (ctx: RouteContext) => {
  const body = parseJsonBody<{ email?: unknown; password?: unknown }>(ctx);
  const email = text(body.email);
  const password = text(body.password);
  const found = await findUserByEmail(ctx.db, email);
  if (!found || !(await verifyPassword(password, found.password_hash))) {
    throw ApiError.invalidCredentials();
  }
  const token = await createSession(ctx.db, found.id);
  const response = json({
    user: userFromRow({
      id: found.id,
      email: found.email,
      name: found.name,
      role: found.role,
      renter_id: found.renter_id,
      renter_status: found.renter_status,
    }),
  });
  response.headers.set("Set-Cookie", setSessionCookie(token));
  return response;
});

route("DELETE", "/api/session", "any", async (ctx: RouteContext) => {
  const token = ctx.req.cookies["rs_session"] ?? null;
  if (token) await deleteSession(ctx.db, token);
  const response = noContent();
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
});

route("GET", "/api/me", "any", async (ctx: RouteContext) => {
  const user = requireUser(ctx);
  return json({ user });
});

route("GET", "/api/health", "none", async () => json({ status: "ok" }));
