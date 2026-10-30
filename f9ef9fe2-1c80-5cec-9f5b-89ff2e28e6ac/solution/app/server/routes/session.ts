import { json, route } from "../http.js";
import { statusBody } from "../services.js";
import { signIn, signOut } from "../session.js";
import { authed, bodyOf, type Errors, failIfAny } from "../validate.js";

route("GET", "/api/health", async () => json(200, { status: "ok" }));

route("GET", "/api/status", async () => json(200, statusBody()));

route("POST", "/api/session", async (request) => {
  const body = bodyOf(request);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const errors: Errors = {};
  if (email === "") errors.email = "Enter your email.";
  if (password === "") errors.password = "Enter your password.";
  failIfAny(errors);
  const { user, cookie } = await signIn(email, password, new Date());
  return json(200, { user }, { "Set-Cookie": cookie });
});

route(
  "DELETE",
  "/api/session",
  authed(async (request) => ({ status: 204, headers: { "Set-Cookie": await signOut(request.headers) } })),
);

route(
  "GET",
  "/api/me",
  authed(async (_request, user) => json(200, { user })),
);
