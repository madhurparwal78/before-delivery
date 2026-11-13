import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Player } from "../shared/protocol";
import { now } from "./clock";
import { config } from "./config";
import { isUniqueViolation, only, query, transaction, type Tx } from "./db";
import { ApiError } from "./errors";
import { mailReachable, sendMail } from "./mail";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGES = {
  email: "Enter a valid email address.",
  emailTaken: "That email already has an account.",
  displayName: "Use 3 to 20 characters.",
  displayNameTaken: "That display name is taken.",
  password: "Use at least 10 characters.",
};

interface PlayerRow {
  id: string;
  email: string;
  display_name: string;
  verified: boolean;
}

const toPlayer = (row: PlayerRow): Player => ({
  player_id: row.id,
  email: row.email,
  display_name: row.display_name,
  verified: row.verified,
});

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = "", hash = ""] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  return timingSafeEqual(await scryptAsync(password, Buffer.from(salt, "hex"), expected.length), expected);
}

const randomToken = (): string => randomBytes(32).toString("base64url");
const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function createSession(playerId: string): Promise<string> {
  const token = randomToken();
  await query("INSERT INTO sessions (token_hash, player_id, created_at) VALUES ($1, $2, $3)", [tokenHash(token), playerId, now()]);
  return token;
}

export async function playerForSession(token: string): Promise<Player | null> {
  const rows = await query<PlayerRow>(
    `SELECT p.id, p.email, p.display_name, p.verified FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = $1`,
    [tokenHash(token)],
  );
  const row = rows[0];
  return row ? toPlayer(row) : null;
}

export async function endSession(token: string): Promise<void> {
  await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

function validationError(fields: Record<string, string>): ApiError {
  return new ApiError("VALIDATION", { fields });
}

function passwordProblem(password: unknown): string | null {
  return typeof password === "string" && password.length >= 10 ? null : MESSAGES.password;
}

function emailProblem(email: unknown): string | null {
  return typeof email === "string" && EMAIL_PATTERN.test(email) ? null : MESSAGES.email;
}

interface Signup {
  player: Player;
  session: string;
  verificationSent: boolean;
}

export async function signUp(input: Record<string, unknown>, origin: string): Promise<Signup> {
  const { email, display_name: displayName, password } = input;
  const fields: Record<string, string> = {};
  const emailBad = emailProblem(email);
  if (emailBad) fields.email = emailBad;
  if (typeof displayName !== "string" || displayName.length < 3 || displayName.length > 20) fields.display_name = MESSAGES.displayName;
  const passwordBad = passwordProblem(password);
  if (passwordBad) fields.password = passwordBad;
  if (Object.keys(fields).length > 0 || typeof email !== "string" || typeof displayName !== "string" || typeof password !== "string") {
    throw validationError(fields);
  }
  let row: PlayerRow;
  try {
    row = only(await query<PlayerRow>(
      `INSERT INTO players (email, display_name, password_hash, created_at) VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, verified`,
      [email, displayName, await hashPassword(password), now()],
    ));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw validationError(
      error.constraint === "players_email_key" ? { email: MESSAGES.emailTaken } : { display_name: MESSAGES.displayNameTaken },
    );
  }
  const player = toPlayer(row);
  const session = await createSession(player.player_id);
  const verificationSent = await sendVerification(player, origin).then(
    () => true,
    () => false,
  );
  return { player, session, verificationSent };
}

export async function signIn(input: Record<string, unknown>): Promise<{ player: Player; session: string }> {
  const { email, password } = input;
  if (typeof email !== "string" || typeof password !== "string") throw new ApiError("BAD_CREDENTIALS");
  const rows = await query<PlayerRow & { password_hash: string }>(
    "SELECT id, email, display_name, verified, password_hash FROM players WHERE lower(email) = lower($1)",
    [email],
  );
  const row = rows[0];
  if (!row || !(await passwordMatches(password, row.password_hash))) throw new ApiError("BAD_CREDENTIALS");
  return { player: toPlayer(row), session: await createSession(row.id) };
}

type TokenKind = "verify" | "reset";

/** A token becomes usable only after Mailpit has accepted the message that carries it. */
async function sendToken(player: Player, kind: TokenKind, origin: string): Promise<void> {
  const token = randomToken();
  const verify = kind === "verify";
  const minutes = verify ? config.verifyTtlMinutes : config.resetTtlMinutes;
  const link = `${origin}/${verify ? "verify" : "reset"}/${token}`;
  await sendMail(
    player.email,
    verify ? "Confirm your email for Seam" : "Reset your Seam password",
    verify
      ? `Welcome to Seam.\n\nConfirm your email to join duels and the leaderboard:\n${link}\n\nThe link works once and expires in ${minutes} minutes.\n`
      : `Someone asked to reset the password of your Seam account.\n\nChoose a new password here:\n${link}\n\nThe link works once and expires in ${minutes} minutes. If this was not you, ignore this message.\n`,
  );
  const expires = new Date(now().getTime() + minutes * 60_000);
  await query("INSERT INTO email_tokens (token_hash, player_id, kind, expires_at) VALUES ($1, $2, $3, $4)", [
    tokenHash(token),
    player.player_id,
    kind,
    expires,
  ]);
}

const sendVerification = (player: Player, origin: string): Promise<void> => sendToken(player, "verify", origin);

export async function resendVerification(player: Player, origin: string): Promise<void> {
  if (player.verified) throw new ApiError("ALREADY_VERIFIED");
  await sendVerification(player, origin);
}

export async function requestReset(email: unknown, origin: string): Promise<void> {
  const problem = emailProblem(email);
  if (problem || typeof email !== "string") throw validationError({ email: MESSAGES.email });
  if (!(await mailReachable())) throw new ApiError("MAIL_UNAVAILABLE");
  const rows = await query<PlayerRow>("SELECT id, email, display_name, verified FROM players WHERE lower(email) = lower($1)", [email]);
  const row = rows[0];
  if (row) await sendToken(toPlayer(row), "reset", origin);
}

interface UsableToken {
  playerId: string;
  hash: string;
}

/** Finds the token and applies the token checks in order: unknown, used, expired. */
async function usableToken(tx: Tx, token: unknown, kind: TokenKind): Promise<UsableToken> {
  const hash = typeof token === "string" ? tokenHash(token) : "";
  const rows = await tx<{ player_id: string; expires_at: Date; used_at: Date | null }>(
    "SELECT player_id, expires_at, used_at FROM email_tokens WHERE token_hash = $1 AND kind = $2 FOR UPDATE",
    [hash, kind],
  );
  const row = rows[0];
  if (!row) throw new ApiError("TOKEN_NOT_FOUND");
  if (row.used_at) throw new ApiError("TOKEN_USED");
  if (row.expires_at.getTime() <= now().getTime()) throw new ApiError("TOKEN_EXPIRED");
  return { playerId: row.player_id, hash };
}

export async function confirmEmail(token: unknown): Promise<{ playerId: string; displayName: string }> {
  return transaction(async (tx) => {
    const found = await usableToken(tx, token, "verify");
    await tx("UPDATE email_tokens SET used_at = $2 WHERE token_hash = $1", [found.hash, now()]);
    const player = only(await tx<PlayerRow>("UPDATE players SET verified = true WHERE id = $1 RETURNING id, email, display_name, verified", [found.playerId]));
    return { playerId: player.id, displayName: player.display_name };
  });
}

export async function confirmReset(token: unknown, password: unknown): Promise<{ player: Player; session: string }> {
  const player = await transaction(async (tx) => {
    const found = await usableToken(tx, token, "reset");
    const problem = passwordProblem(password);
    if (problem || typeof password !== "string") throw validationError({ password: MESSAGES.password });
    await tx("UPDATE email_tokens SET used_at = $2 WHERE token_hash = $1", [found.hash, now()]);
    await tx("DELETE FROM sessions WHERE player_id = $1", [found.playerId]);
    const updated = only(
      await tx<PlayerRow>("UPDATE players SET password_hash = $2 WHERE id = $1 RETURNING id, email, display_name, verified", [found.playerId, await hashPassword(password)]),
    );
    return toPlayer(updated);
  });
  return { player, session: await createSession(player.player_id) };
}
