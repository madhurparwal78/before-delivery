import { request } from "undici";
import jsQRModule from "jsqr";
import { PNG } from "pngjs";
import type { FlanEnv } from "../shared/env.js";
import { totpCode } from "./kcadmin.js";

const jsQR = jsQRModule as unknown as (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

/**
 * Drives Keycloak's own login pages to complete the CONFIGURE_TOTP required action,
 * producing a genuine OTP credential for the given user. Returns the base32 secret.
 *
 * Keycloak 26 exposes no admin API for creating OTP credentials, so this walks the
 * same browser flow a person would: password page, setup page (secret from its QR),
 * then the code submission.
 */
export async function provisionTotp(
  env: FlanEnv,
  username: string,
  password: string,
): Promise<string> {
  const cookies = new Map<string, Cookie>();
  const jar = {
    store: (setCookie: string[] | string | undefined) => {
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
        for (const attr of attrs) {
          const lower = attr.trim().toLowerCase();
          if (lower.startsWith("domain=")) domain = attr.trim().slice(7);
          else if (lower.startsWith("path=")) path = attr.trim().slice(5);
          else if (lower === "httponly") httpOnly = true;
        }
        if (!domain) domain = "keycloak:8080";
        cookies.set(`${domain}|${path}|${name}`, { name, value, domain, path, httpOnly });
      }
    },
    header: (): string => [...cookies.values()].map((c) => `${c.name}=${c.value}`).join("; "),
  };

  const timeout = env.FLAN_PROVIDER_TIMEOUT_MS * 3;

  const fetchText = async (url: string, method: string, body?: string, contentType?: string) => {
    const headers: Record<string, string> = { Cookie: jar.header() };
    if (contentType) headers["Content-Type"] = contentType;
    const res = await request(url, {
      method,
      body,
      headers,
      bodyTimeout: timeout,
      headersTimeout: timeout,
    });
    jar.store(res.headers["set-cookie"]);
    const text = await res.body.text();
    const location = res.headers.location;
    return { status: res.statusCode, text, location: Array.isArray(location) ? location[0] : location };
  };

  const authorizeUrl = `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/auth?${new URLSearchParams({
    client_id: env.AUTH_CLIENT_ID,
    redirect_uri: `${env.APP_PUBLIC_URL}/auth/callback`,
    response_type: "code",
    scope: "openid",
    state: "flan-provision",
  }).toString()}`;

  const loginPage = await fetchText(authorizeUrl, "GET");
  const formAction = formActionOf(loginPage.text);
  if (!formAction) throw new Error("login form not found");

  const passwordPost = await fetchText(formAction, "POST", new URLSearchParams({
    username,
    password,
    credentialId: "",
  }).toString(), "application/x-www-form-urlencoded");

  const setupTarget = redirectWithinRealm(env, passwordPost.location);
  if (!setupTarget) throw new Error("required-action redirect not found");

  const setupPage = await fetchText(setupTarget, "GET");
  const setupForm = formActionOf(setupPage.text);
  const totpSecretField = matchValue(setupPage.text, /name="totpSecret" value="([^"]+)"/);
  if (!setupForm || !totpSecretField) throw new Error("totp setup page not found");

  const secret = await secretFromQr(env, setupPage.text);
  const code = totpCode(secret, env.FLAN_TOTP_PERIOD_S);

  await fetchText(setupForm, "POST", new URLSearchParams({
    totp: code,
    totpSecret: totpSecretField,
    userLabel: "flan",
    "logout-sessions": "on",
  }).toString(), "application/x-www-form-urlencoded");

  return secret;
}

function formActionOf(html: string): string | null {
  const m = html.match(/<form[^>]*action="([^"]+)"/);
  if (!m) return null;
  return m[1].replace(/&amp;/g, "&");
}

function matchValue(html: string, pattern: RegExp): string | null {
  const m = html.match(pattern);
  return m ? m[1] : null;
}

function redirectWithinRealm(env: FlanEnv, location: string | undefined): string | null {
  if (!location) return null;
  if (location.startsWith(env.KEYCLOAK_URL)) return location;
  if (location.startsWith("/")) return `${env.KEYCLOAK_URL}${location}`;
  return null;
}

/** The setup page's QR code is a data-URI PNG holding the otpauth URL with the base32 secret. */
async function secretFromQr(env: FlanEnv, html: string): Promise<string> {
  const b64 = matchValue(html, /kc-totp-secret-qr-code" src="data:image\/png;base64,\s*([A-Za-z0-9+/=]+)"/);
  if (!b64) throw new Error("totp qr not found");
  const png = Buffer.from(b64, "base64");
  const secret = await decodeQrSecret(png);
  if (!secret) throw new Error("totp secret not decoded");
  return secret;
}

export async function decodeQrSecret(png: Buffer): Promise<string | null> {
  const image = PNG.sync.read(png);
  const code = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  if (!code) return null;
  const m = code.data.match(/secret=([A-Z2-7]+)/);
  return m ? m[1] : null;
}
