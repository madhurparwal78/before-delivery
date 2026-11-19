import { ALERTS, FIELD_ERRORS } from "../shared/copy.js";
import { isEmail } from "./accounts.js";
import { tx } from "./db.js";
import { ApiError, invalid, type JsonObject } from "./http.js";
import { insertFixtures, type FixtureResult, type FixtureUser, type OutlineNode } from "./fixtures.js";

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

function node(value: unknown, path: string): OutlineNode {
  if (typeof value !== "object" || value === null) throw invalid({ [path]: "Send an outline node." });
  const raw = value as JsonObject;
  if ((raw.text === undefined) === (raw.mirrorOf === undefined)) throw invalid({ [path]: "A node has either text or mirrorOf." });
  const children = raw.children === undefined ? [] : raw.children;
  if (!Array.isArray(children)) throw invalid({ [`${path}.children`]: "Send a list." });
  return {
    ...(typeof raw.ref === "string" ? { ref: raw.ref } : {}),
    ...(typeof raw.text === "string" ? { text: raw.text } : {}),
    ...(typeof raw.mirrorOf === "string" ? { mirrorOf: raw.mirrorOf } : {}),
    ...(typeof raw.date === "string" ? { date: raw.date } : {}),
    ...(typeof raw.completed === "boolean" ? { completed: raw.completed } : {}),
    ...(typeof raw.collapsed === "boolean" ? { collapsed: raw.collapsed } : {}),
    children: children.map((child, index) => node(child, `${path}.children.${index}`)),
  };
}

function person(value: unknown, index: number): FixtureUser {
  const path = `users.${index}`;
  if (typeof value !== "object" || value === null) throw invalid({ [path]: "Send a user." });
  const raw = value as JsonObject;
  if (!isText(raw.ref) || !isText(raw.name) || !isText(raw.password) || typeof raw.email !== "string" || !isEmail(raw.email.trim().toLowerCase())) {
    throw invalid({ [path]: FIELD_ERRORS.email });
  }
  const outline = raw.outline === undefined ? [] : raw.outline;
  const shares = raw.shares === undefined ? [] : raw.shares;
  if (!Array.isArray(outline) || !Array.isArray(shares)) throw invalid({ [path]: "Send lists." });
  return {
    ref: raw.ref, email: raw.email, name: raw.name, password: raw.password,
    confirmed: raw.confirmed !== false,
    hideCompleted: raw.hideCompleted === true,
    outline: outline.map((entry, at) => node(entry, `${path}.outline.${at}`)),
    shares: shares.map((entry, at) => {
      const share = (entry ?? {}) as JsonObject;
      if (!isText(share.bullet) || typeof share.email !== "string" || (share.status !== "sent" && share.status !== "accepted")) {
        throw invalid({ [`${path}.shares.${at}`]: "Send a bullet ref, an email and a status." });
      }
      return { ...(typeof share.ref === "string" ? { ref: share.ref } : {}), bullet: share.bullet, email: share.email, status: share.status };
    }),
  };
}

export async function setupGrading(body: JsonObject): Promise<FixtureResult> {
  if (!Array.isArray(body.users)) throw invalid({ users: "Send a list of users." });
  const users = body.users.map(person);
  try {
    return await tx((client) => insertFixtures(client, users));
  } catch (error) {
    if (error instanceof Error && error.message === "email_taken") {
      throw new ApiError(409, { error: "email_taken", message: ALERTS.emailTaken });
    }
    if (error instanceof Error && error.message === "bad_share") throw invalid({ shares: "A share needs a known bullet and account." });
    throw error;
  }
}
