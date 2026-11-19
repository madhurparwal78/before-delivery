import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { carModel } from "../shared/model.js";
import type { Database, Transaction } from "./db.js";
import { cookies, errors, isRecord } from "./http.js";
import { OPENING_BALANCE, addMovement, balanceOf, walletAccount } from "./ledger.js";
import type { Services } from "./main.js";
import { MailUnavailable, sendMail } from "./smtp.js";

const SESSION_COOKIE = "kerb_session";
const STARTERS = ["kestrel-hatch", "wren-coupe", "moth-roadster"];
const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAIL_SUBJECT = "Your Kerbline sign-in link";

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly guest: boolean;
  readonly email: string | null;
  readonly units: "kmh" | "mph";
}

function shortCode(): string {
  return Array.from(randomBytes(4), (byte) => NAME_CHARS[byte % NAME_CHARS.length]).join("");
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000`;
}

async function openSession(db: Database | Transaction, playerId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.query("INSERT INTO sessions (token, player_id) VALUES ($1,$2)", [token, playerId]);
  return token;
}

export async function sessionPlayer(db: Database, req: IncomingMessage): Promise<Player | null> {
  const token = cookies(req).get(SESSION_COOKIE);
  if (!token) return null;
  const [row] = await db.query<{ id: string; name: string; guest: boolean; email: string | null; units: "kmh" | "mph" }>(
    `SELECT p.id, p.name, p.guest, p.email, p.units FROM sessions s JOIN players p ON p.id = s.player_id
      WHERE s.token = $1 AND NOT p.retired`, [token]);
  return row ?? null;
}

interface NewPlayer {
  readonly name: string;
  readonly guest: boolean;
  readonly email: string | null;
  readonly cars: readonly string[];
  readonly coins: number;
}

async function createPlayer(tx: Transaction, player: NewPlayer): Promise<string> {
  const id = randomUUID();
  await tx.query("INSERT INTO players (id, name, guest, email, selected_car_id) VALUES ($1,$2,$3,$4,$5)",
    [id, player.name, player.guest, player.email, player.cars[0]]);
  await tx.lockPlayer(id);
  await tx.query("INSERT INTO accounts (account) VALUES ($1)", [walletAccount(id)]);
  for (const carId of player.cars) await tx.query("INSERT INTO owned_cars (player_id, car_id) VALUES ($1,$2)", [id, carId]);
  if (player.coins > 0) await addMovement(tx, { playerId: id, kind: "opening", amount: player.coins });
  return id;
}

export async function startGuest(services: Services, body: unknown) {
  const request = isRecord(body) ? body : {};
  const fields: Record<string, string> = {};
  if (request.ageConfirmed !== true) fields.ageConfirmed = "Confirm you are 13 or older to play.";
  if (typeof request.starterCarId !== "string" || !STARTERS.includes(request.starterCarId)) fields.starterCarId = "Choose a starter car.";
  if (Object.keys(fields).length) throw errors.invalid(fields);
  return services.db.transaction(async (tx) => {
    const name = `Guest ${shortCode()}`;
    const id = await createPlayer(tx, { name, guest: true, email: null, cars: [request.starterCarId as string], coins: OPENING_BALANCE });
    return { body: { playerId: id, name, balance: OPENING_BALANCE }, token: await openSession(tx, id) };
  });
}

export async function gradingPlayer(services: Services, body: unknown) {
  const request = isRecord(body) ? body : {};
  const coins = request.coins ?? OPENING_BALANCE;
  const cars = request.cars ?? ["kestrel-hatch"];
  const name = request.name ?? `Racer ${shortCode()}`;
  const fields: Record<string, string> = {};
  if (!Number.isInteger(coins) || (coins as number) < 0) fields.coins = "Coins must be a whole number of at least 0.";
  if (!Array.isArray(cars) || cars.length === 0 || !cars.every((id) => typeof id === "string" && carModel(id))
    || new Set(cars).size !== cars.length) fields.cars = "List known car ids once each.";
  if (typeof name !== "string" || !name.trim() || name.length > 60) fields.name = "Give a name of 1 to 60 characters.";
  if (Object.keys(fields).length) throw errors.invalid(fields);
  return services.db.transaction(async (tx) => {
    const id = await createPlayer(tx, { name: name as string, guest: false, email: null, cars: cars as string[], coins: coins as number });
    return { body: { playerId: id }, token: await openSession(tx, id) };
  });
}

export async function me(db: Database, player: Player) {
  return {
    playerId: player.id, name: player.name, guest: player.guest, email: player.email, units: player.units,
    balance: await balanceOf(db, player.id),
  };
}

export async function setUnits(services: Services, player: Player, body: unknown) {
  const units = isRecord(body) ? body.units : undefined;
  if (units !== "kmh" && units !== "mph") throw errors.invalid({ units: "Choose kmh or mph." });
  await services.db.query("UPDATE players SET units = $2 WHERE id = $1", [player.id, units]);
  return me(services.db, { ...player, units });
}

export async function requestLink(services: Services, body: unknown) {
  const email = isRecord(body) ? body.email : undefined;
  if (typeof email !== "string" || email.length > 254 || !EMAIL.test(email)) {
    throw errors.invalid({ email: "Enter a valid email address." });
  }
  const token = randomBytes(24).toString("base64url");
  const link = `${services.config.publicUrl}/sign-in/${token}`;
  const minutes = Math.max(1, Math.round(services.config.signinLinkTtlSeconds / 60));
  try {
    await sendMail(services.config.smtp, {
      to: email,
      subject: MAIL_SUBJECT,
      text: `Open this link to sign in to Kerbline and save your garage:\n\n${link}\n\nThe link works once and expires in about ${minutes} minute${minutes === 1 ? "" : "s"}.\n`,
    });
  } catch (error) {
    if (error instanceof MailUnavailable) throw errors.mailUnavailable();
    throw error;
  }
  await services.db.query(
    "INSERT INTO signin_tokens (token, email, expires_at) VALUES ($1, $2, clock_timestamp() + make_interval(secs => $3))",
    [token, email, services.config.signinLinkTtlSeconds]);
  return { status: "sent" };
}

async function hasProgress(tx: Transaction, playerId: string): Promise<boolean> {
  const [row] = await tx.query("SELECT 1 FROM movements WHERE player_id = $1 AND kind <> 'opening' LIMIT 1", [playerId]);
  return Boolean(row);
}

async function garageSummary(tx: Transaction, playerId: string): Promise<string> {
  const [cars] = await tx.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM owned_cars WHERE player_id = $1", [playerId]);
  const balance = await balanceOf(tx, playerId);
  return `${balance.toLocaleString("en-US")} coins, ${cars.count} ${cars.count === 1 ? "car" : "cars"}`;
}

async function claimEmail(tx: Transaction, playerId: string, email: string): Promise<void> {
  await tx.query("UPDATE players SET guest = false, email = $2, name = $3 WHERE id = $1", [playerId, email, email.split("@")[0]]);
}

async function retire(tx: Transaction, playerId: string): Promise<void> {
  await tx.query("UPDATE players SET retired = true, email = NULL WHERE id = $1", [playerId]);
}

type Outcome = "new_account" | "signed_in" | "kept_device" | "kept_account";

export async function redeemLink(services: Services, session: Player | null, body: unknown) {
  const request = isRecord(body) ? body : {};
  const { token, keep } = request;
  return services.db.transaction(async (tx) => {
    const [link] = typeof token === "string" ? await tx.query<{ email: string; live: boolean }>(
      `SELECT email, (used_at IS NULL AND clock_timestamp() <= expires_at) AS live FROM signin_tokens WHERE token = $1 FOR UPDATE`,
      [token]) : [];
    if (typeof token === "string" && !link?.live) throw errors.linkExpired();
    if (typeof token !== "string" || (keep !== undefined && keep !== "device" && keep !== "account")) {
      throw errors.invalid(typeof token !== "string" ? { token: "Missing token." } : { keep: "Choose device or account." });
    }
    const email = link.email;
    const guest = session?.guest ? session : null;
    const [account] = await tx.query<{ id: string }>("SELECT id FROM players WHERE email = $1 AND NOT retired", [email]);
    for (const id of [guest?.id, account?.id].filter((value): value is string => Boolean(value)).sort()) await tx.lockPlayer(id);
    let playerId: string;
    let outcome: Outcome;
    if (!account) {
      if (guest) {
        await claimEmail(tx, guest.id, email);
        playerId = guest.id;
      } else {
        playerId = await createPlayer(tx, { name: email.split("@")[0], guest: false, email, cars: ["kestrel-hatch"], coins: OPENING_BALANCE });
      }
      outcome = "new_account";
    } else if (!guest) {
      playerId = account.id;
      outcome = "signed_in";
    } else {
      const deviceProgress = await hasProgress(tx, guest.id);
      const accountProgress = await hasProgress(tx, account.id);
      let choice: "device" | "account" | "neither";
      if (deviceProgress && accountProgress) {
        if (!keep) throw errors.conflict("GARAGE_CHOICE_REQUIRED", `Your account's garage has ${await garageSummary(tx, account.id)}.`);
        choice = keep as "device" | "account";
      } else {
        choice = deviceProgress ? "device" : accountProgress ? "account" : "neither";
      }
      if (choice === "device") {
        await retire(tx, account.id);
        await claimEmail(tx, guest.id, email);
        playerId = guest.id;
        outcome = "kept_device";
      } else {
        await retire(tx, guest.id);
        playerId = account.id;
        outcome = choice === "account" ? "kept_account" : "signed_in";
      }
    }
    await tx.query("UPDATE signin_tokens SET used_at = clock_timestamp() WHERE token = $1", [token]);
    return { body: { playerId, email, outcome }, token: await openSession(tx, playerId) };
  });
}
