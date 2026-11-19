import { timingSafeEqual } from "node:crypto";
import { isRecord } from "../shared/guards.js";
import { config } from "./config.js";
import { validateAccount, createUser } from "./accounts.js";
import { iso, moveClock, now } from "./clock.js";
import { exactlyOne, isUniqueViolation, pool, tx } from "./db.js";
import { conflict, notFound, validation } from "./errors.js";
import { emit } from "./events.js";
import { insertImage, imageProblem, putImage } from "./uploads.js";
import { processSolid, type ImageFormat, type ProcessedImage } from "./images.js";
import { insertPin } from "./pins.js";
import { expireOperations } from "./operations.js";
import { validateComment, validateName, validatePinText, type PinText } from "./text.js";
import type { Body } from "./http.js";
import type { IncomingMessage } from "node:http";
import type { ReactionType } from "../shared/types.js";

type Fields = Record<string, unknown>;

function record(value: unknown, field: string): Fields {
  if (!isRecord(value)) throw validation(field);
  return value;
}

function list(body: Fields, name: string): Fields[] {
  const value = body[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw validation(name);
  return value.map((item) => record(item, name));
}

function text(item: Fields, field: string): string {
  const value = item[field];
  if (typeof value !== "string" || value === "") throw validation(field);
  return value;
}

function optionalText(item: Fields, field: string): string | null {
  const value = item[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw validation(field);
  return value;
}

function instant(item: Fields): Date {
  const value = item["at"];
  if (value === undefined || value === null) return now();
  const parsed = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime())) throw validation("at");
  return parsed;
}

const reference = (ids: Map<string, number>, key: string, field: string): number => {
  const id = ids.get(key);
  if (id === undefined) throw validation(field);
  return id;
};

interface ImageSpec {
  width: number;
  height: number;
  format: ImageFormat;
  color: string;
}

function imageSpec(item: Fields): ImageSpec {
  const image = record(item["image"], "image");
  const width = image["width"];
  const height = image["height"];
  const format = image["format"];
  const color = image["color"];
  if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw validation("image");
  }
  if (format !== "png" && format !== "jpeg") throw validation("image");
  if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) throw validation("image");
  if (imageProblem({ width, height }) !== null) throw validation("image");
  return { width, height, format, color };
}

const REACTIONS: readonly ReactionType[] = ["love", "idea", "wow", "thanks"];

/** Creates users, boards, sections, pins, saves, follows, comments and reactions in one call and returns their ids. */
export async function seedWorld(raw: unknown): Promise<Record<string, number>> {
  const body = record(raw, "body");
  const users = list(body, "users").map((item) => ({
    key: text(item, "key"),
    fields: validateAccount({ email: item["email"], password: item["password"], name: item["name"], handle: item["handle"] }),
  }));
  const boards = list(body, "boards").map((item) => {
    const visibility = item["visibility"];
    if (visibility !== "public" && visibility !== "secret") throw validation("visibility");
    return {
      key: text(item, "key"),
      owner: text(item, "owner"),
      name: validateName(item["name"]),
      visibility,
      members: list(item, "members").map((entry) => {
        if (entry["role"] !== "editor" && entry["role"] !== "viewer") throw validation("role");
        return { user: text(entry, "user"), role: entry["role"] };
      }),
      sections: list(item, "sections").map((entry) => ({ key: text(entry, "key"), name: validateName(entry["name"]) })),
      cover: optionalText(item, "cover"),
      at: instant(item),
    };
  });
  const pins = list(body, "pins").map((item) => ({
    key: text(item, "key"),
    owner: text(item, "owner"),
    board: text(item, "board"),
    section: optionalText(item, "section"),
    text: validatePinText({ title: item["title"], description: item["description"], alt: item["alt"], source: item["source"] }),
    image: imageSpec(item),
    at: instant(item),
  }));
  const saves = list(body, "saves").map((item) => ({
    key: text(item, "key"), of: text(item, "of"), by: text(item, "by"), board: text(item, "board"), section: optionalText(item, "section"), at: instant(item),
  }));
  const follows = list(body, "follows").map((item) => ({
    follower: text(item, "follower"), user: optionalText(item, "user"), board: optionalText(item, "board"),
  }));
  const comments = list(body, "comments").map((item) => ({
    key: text(item, "key"), pin: text(item, "pin"), author: text(item, "author"), parent: optionalText(item, "parent"),
    text: validateComment(item["text"]), at: instant(item),
  }));
  const reactions = list(body, "reactions").map((item) => {
    const type = REACTIONS.find((candidate) => candidate === item["type"]);
    if (!type) throw validation("type");
    return { pin: text(item, "pin"), user: text(item, "user"), type, at: instant(item) };
  });

  const specKey = (spec: ImageSpec): string => `${spec.width}x${spec.height}-${spec.format}-${spec.color.toLowerCase()}`;
  const specs = new Map(pins.map((pin) => [specKey(pin.image), pin.image]));
  const stored = new Map<string, { id: string; image: ProcessedImage }>();
  const pending = [...specs];
  const workers = Array.from({ length: Math.min(6, pending.length) }, async () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      const [key, spec] = next;
      const image = await processSolid(spec.width, spec.height, spec.format, spec.color);
      stored.set(key, { id: await putImage(image), image });
    }
  });
  await Promise.all(workers);

  return tx(async (client) => {
    const ids: Record<string, number> = {};
    const userIds = new Map<string, number>();
    const boardIds = new Map<string, number>();
    const sectionIds = new Map<string, number>();
    const pinIds = new Map<string, number>();
    const pinTexts = new Map<string, { text: PinText; imageId: string; root: number }>();
    const commentIds = new Map<string, number>();
    try {
      for (const user of users) {
        const id = await createUser(client, user.fields, now());
        userIds.set(user.key, id);
        ids[user.key] = id;
      }
      for (const board of boards) {
        const { id: boardId } = await exactlyOne<{ id: number }>(
          client,
          "INSERT INTO boards (owner_id, name, visibility, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
          [reference(userIds, board.owner, "owner"), board.name, board.visibility, board.at],
        );
        boardIds.set(board.key, boardId);
        ids[board.key] = boardId;
        for (const member of board.members) {
          await client.query("INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)", [boardId, reference(userIds, member.user, "user"), member.role]);
        }
        for (const [index, section] of board.sections.entries()) {
          const row = await exactlyOne<{ id: number }>(client, "INSERT INTO sections (board_id, name, position) VALUES ($1, $2, $3) RETURNING id", [boardId, section.name, index + 1]);
          sectionIds.set(section.key, row.id);
          ids[section.key] = row.id;
        }
      }
    } catch (error) {
      throw isUniqueViolation(error) ? conflict("board_name_taken") : error;
    }
    for (const { id, image } of stored.values()) await insertImage(client, id, image);
    const nextPosition = new Map<string, number>();
    const lastSaved = new Map<number, Date>();
    const place = async (boardKey: string, sectionKey: string | null, at: Date): Promise<{ boardId: number; sectionId: number | null; position: number }> => {
      const boardId = reference(boardIds, boardKey, "board");
      const sectionId = sectionKey === null ? null : reference(sectionIds, sectionKey, "section");
      const container = `${boardId}:${sectionId ?? 0}`;
      const position = (nextPosition.get(container) ?? 0) + 1;
      nextPosition.set(container, position);
      const seen = lastSaved.get(boardId);
      if (!seen || seen < at) lastSaved.set(boardId, at);
      return { boardId, sectionId, position };
    };
    for (const pin of pins) {
      const spot = await place(pin.board, pin.section, pin.at);
      const image = stored.get(specKey(pin.image));
      if (!image) throw validation("image");
      const id = await insertPin(client, { ownerId: reference(userIds, pin.owner, "owner"), ...spot, imageId: image.id, text: pin.text, savedFrom: null, createdAt: pin.at });
      pinIds.set(pin.key, id);
      pinTexts.set(pin.key, { text: pin.text, imageId: image.id, root: id });
      ids[pin.key] = id;
    }
    for (const save of saves) {
      const source = pinTexts.get(save.of);
      if (!source) throw validation("of");
      const spot = await place(save.board, save.section, save.at);
      const id = await insertPin(client, { ownerId: reference(userIds, save.by, "by"), ...spot, imageId: source.imageId, text: source.text, savedFrom: source.root, createdAt: save.at });
      pinIds.set(save.key, id);
      pinTexts.set(save.key, source);
      ids[save.key] = id;
    }
    for (const [boardId, at] of lastSaved) await client.query("UPDATE boards SET last_saved_at = $2 WHERE id = $1", [boardId, at]);
    for (const board of boards) {
      if (board.cover !== null) await client.query("UPDATE boards SET cover_pin_id = $2 WHERE id = $1", [reference(boardIds, board.key, "board"), reference(pinIds, board.cover, "cover")]);
    }
    for (const follow of follows) {
      const follower = reference(userIds, follow.follower, "follower");
      if (follow.user !== null) await client.query("INSERT INTO follows (follower_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [follower, reference(userIds, follow.user, "user")]);
      else if (follow.board !== null) await client.query("INSERT INTO board_follows (follower_id, board_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [follower, reference(boardIds, follow.board, "board")]);
      else throw validation("follows");
    }
    for (const comment of comments) {
      const row = await exactlyOne<{ id: number }>(
        client,
        "INSERT INTO comments (pin_id, author_id, parent_id, text, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [reference(pinIds, comment.pin, "pin"), reference(userIds, comment.author, "author"), comment.parent === null ? null : reference(commentIds, comment.parent, "parent"), comment.text, comment.at],
      );
      commentIds.set(comment.key, row.id);
      ids[comment.key] = row.id;
    }
    for (const reaction of reactions) {
      await client.query(
        "INSERT INTO reactions (pin_id, user_id, type, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (pin_id, user_id) DO UPDATE SET type = $3",
        [reference(pinIds, reaction.pin, "pin"), reference(userIds, reaction.user, "user"), reaction.type, reaction.at],
      );
    }
    return ids;
  });
}

/** The grading routes need the key in `X-Grading-Key`; without it they answer exactly like an unknown path. */
export function requireGradingKey(req: IncomingMessage): void {
  const given = req.headers["x-grading-key"];
  const key = config.gradingKey;
  if (!key || typeof given !== "string") throw notFound();
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw notFound();
}

export async function moveBusinessClock(body: Body): Promise<string> {
  const value = body.get("now");
  const target = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(target.getTime())) throw validation("now");
  await moveClock(target);
  await emit(pool, { kind: "all" }, { type: "clock", now: iso(now()) });
  await expireOperations();
  return iso(now());
}
