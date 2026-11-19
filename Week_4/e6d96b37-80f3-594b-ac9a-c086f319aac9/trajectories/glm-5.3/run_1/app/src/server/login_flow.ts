import { request } from "undici";
import type { FlanEnv } from "../shared/env.js";
import type { StorageState } from "../shared/seed.js";

interface SimpleCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

/**
 * Drives Keycloak's own browser login pages (password, then one-time code) over HTTP
 * and returns a Playwright storage state holding both the Keycloak session cookies
 * and the application session cookie. This is a genuine sign-in, not a stand-in.
 */
export async function driveLogin(env: FlanEnv, username: string, password: string): Promise<StorageState> {
  const cookies: SimpleCookie[] = [];

  const store = (setCookie: string[] | string | undefined, requestHost: string) => {
    const list = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const raw of list) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = "";
      let path = "/";
      let httpOnly = false;
      let secure = false;
      let sameSite: string | undefined;
      let expires: number | undefined;
      for (const attr of attrs) {
        const lower = attr.trim().toLowerCase();
        if (lower.startsWith("domain=")) domain = attr.trim().slice(7);
        else if (lower.startsWith("path=")) path = attr.trim().slice(5);
        else if (lower === "httponly") httpOnly = true;
        else if (lower === "secure") secure = true;
        else if (lower.startsWith("samesite=")) sameSite = attr.trim().slice(9);
        else if (lower.startsWith("expires=")) {
          const when = Date.parse(attr.trim().slice(8));
          if (Number.isFinite(when)) expires = Math.floor(when / 1000);
        }
      }
      // A cookie without a Domain attribute is host-only.
      if (!domain) domain = requestHost;
      const existing = cookies.findIndex((c) => c.name === name && c.domain === domain && c.path === path);
      const cookie: SimpleCookie = { name, value, domain, path, httpOnly, secure, sameSite, expires };
      if (existing === -1) cookies.push(cookie);
      else cookies[existing] = cookie;
    }
  };

  const header = (): string => cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const timeout = env.FLAN_PROVIDER_TIMEOUT_MS * 6;
  const fetchText = async (url: string, method: string, body?: string, contentType?: string) => {
    const headers: Record<string, string> = { Cookie: header() };
    if (contentType) headers["Content-Type"] = contentType;
    const res = await request(url, { method, body, headers, bodyTimeout: timeout, headersTimeout: timeout });
    store(res.headers["set-cookie"], new URL(url).host);
    const text = await res.body.text();
    const location = res.headers.location;
    return { status: res.statusCode, text, location: Array.isArray(location) ? location[0] : location };
  };

  const authorizeUrl = `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/auth?${new URLSearchParams({
    client_id: env.AUTH_CLIENT_ID,
    redirect_uri: `${env.APP_PUBLIC_URL}/auth/callback`,
    response_type: "code",
    scope: "openid",
    state: "flan-seed-login",
  }).toString()}`;

  const loginPage = await fetchText(authorizeUrl, "GET");
  const formAction = formActionOf(loginPage.text);
  if (!formAction) throw new Error("login form not found");

  const passwordPost = await fetchText(formAction, "POST", new URLSearchParams({
    username,
    password,
    credentialId: "",
  }).toString(), "application/x-www-form-urlencoded");

  // With OTP configured the flow renders the one-time-code page (200) instead of
  // redirecting straight back.
  let target = passwordPost.location;
  let page = passwordPost.text;
  if (target === undefined || target === "") {
    const otpForm = formActionOf(page);
    const hasOtp = /name="otp"/.test(page);
    if (!otpForm || !hasOtp) throw new Error("otp form not found");
    const { totpCode } = await import("./kcadmin.js");
    const secretRow = await import("./db.js").then((m) => m.pool.query<{ totp_secret: string }>(
      "SELECT totp_secret FROM seeded_identities WHERE username = $1",
      [username],
    ));
    const secret = secretRow.rows[0]?.totp_secret;
    if (!secret) throw new Error("totp secret missing");
    const period = env.FLAN_TOTP_PERIOD_S;
    const waitNextPeriod = async (): Promise<void> => {
      const into = Math.floor(Date.now() / 1000) % period;
      const waitMs = (period - into + 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    };
    await waitNextPeriod();
    let code = totpCode(secret, period);
    let otpPost = await fetchText(otpForm, "POST", new URLSearchParams({ otp: code, credentialId: "" }).toString(), "application/x-www-form-urlencoded");
    target = otpPost.location;
    page = otpPost.text;
    let guard = 0;
    while (/name="otp"/.test(page) && !target && guard < 3) {
      guard += 1;
      await waitNextPeriod();
      const retryForm = formActionOf(page);
      if (!retryForm) break;
      code = totpCode(secret, period);
      otpPost = await fetchText(retryForm, "POST", new URLSearchParams({ otp: code, credentialId: "" }).toString(), "application/x-www-form-urlencoded");
      target = otpPost.location;
      page = otpPost.text;
    }
  }

  // Follow Keycloak redirects until the app callback hands back the app cookie.
  let guard = 0;
  while (target && guard < 8) {
    guard += 1;
    if (target.startsWith(env.APP_PUBLIC_URL)) {
      const callback = await fetchText(target, "GET");
      target = callback.location;
      continue;
    }
    const absolute = target.startsWith("/") ? `${env.KEYCLOAK_URL}${target}` : target;
    const next = await fetchText(absolute, "GET");
    target = next.location;
    page = next.text;
  }

  const appHost = new URL(env.APP_PUBLIC_URL).host;
  const kcHost = new URL(env.KEYCLOAK_URL).host;
  const state: StorageState = {
    cookies: cookies
      .filter((c) => c.domain.includes(appHost) || c.domain.includes(kcHost))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      })),
    origins: [],
  };
  const hasApp = state.cookies.some((c) => c.name === "flan_session");
  if (!hasApp) throw new Error("app session missing");
  return state;
}

function formActionOf(html: string): string | null {
  const m = html.match(/<form[^>]*action="([^"]+)"/);
  if (!m) return null;
  return m[1].replace(/&amp;/g, "&");
}
