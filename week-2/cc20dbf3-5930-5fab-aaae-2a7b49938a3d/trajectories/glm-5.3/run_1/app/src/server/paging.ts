import { createHmac, createHash } from "node:crypto";
import { Pool } from "pg";

export interface CursorPayload {
  k: string;
  i: string;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeCursor(secret: string, payload: CursorPayload): string {
  const payloadText = JSON.stringify(payload);
  const encoded = Buffer.from(payloadText, "utf8").toString("base64url");
  return `${encoded}.${sign(secret, encoded)}`;
}

export function decodeCursor(secret: string, cursor: string): CursorPayload | null {
  const [encoded, signature] = cursor.split(".");
  if (encoded === undefined || signature === undefined) return null;
  const expected = sign(secret, encoded);
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqualStrings(expected, signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CursorPayload;
    if (typeof parsed.k !== "string" || typeof parsed.i !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  let difference = 0;
  for (let i = 0; i < bufferA.length; i++) {
    difference |= bufferA[i] ^ bufferB[i];
  }
  return difference === 0;
}

export function hashRequest(method: string, path: string, body: Buffer | null): string {
  return createHash("sha256").update(method).update("\n").update(path).update("\n").update(body ?? Buffer.alloc(0)).digest("hex");
}

export async function readCursorSecret(pool: Pool): Promise<string> {
  const result = await pool.query("SELECT value FROM app_secrets WHERE id = 'cursor'");
  return result.rows[0].value as string;
}
