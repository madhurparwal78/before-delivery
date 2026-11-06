import { ApiError } from "./errors.js";

export type Request = {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: Buffer | null;
  cookies: Record<string, string>;
  remoteAddress: string;
};

export const readBody = async (
  stream: AsyncIterable<Uint8Array>,
  limit: number,
): Promise<Buffer | null> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > limit) throw ApiError.payloadTooLarge();
    chunks.push(Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : null;
};

export const originAllowed = (origin: string | undefined, host: string | undefined, proto = "http"): boolean => {
  if (!origin) return true;
  if (!host) return false;
  const originUrl = new URL(origin);
  const own = `${proto}://${host}`;
  return originUrl.origin === new URL(own).origin;
};


export const sessionCookieOf = (cookieHeader: string | undefined): Record<string, string> => {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
};

export const setSessionCookie = (token: string): string =>
  `rs_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600`;

export const clearSessionCookie = (): string => `rs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export const requestOriginHost = (headers: Record<string, string>): string | undefined =>
  headers["x-forwarded-host"] ?? headers["host"];

export const requestProto = (headers: Record<string, string>): string => {
  const forwarded = headers["x-forwarded-proto"];
  return forwarded ?? "http";
};
