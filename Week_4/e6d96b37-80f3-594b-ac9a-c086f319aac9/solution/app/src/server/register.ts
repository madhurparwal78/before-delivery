// The Varietal Coin Register (WireMock), called server-side only within the provider timeout.
// A reply is accepted only when it is a well-formed record; every failure maps to a register error.

import { config } from "./config.js";
import { catalogBusy, catalogMalformed, catalogMissing, catalogUnavailable } from "./errors.js";

export interface VarietyRecord {
  reference: string;
  issue: string;
  mintmark: string;
  revision: number;
  image_path: string;
  image: Buffer;
}

export interface AlbumDefinition {
  set: string;
  title: string;
  revision: number;
  holes: { label: string; reference: string; mintmark: string }[];
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

async function call(path: string, signal: AbortSignal): Promise<Response> {
  let reply: Response;
  try {
    reply = await fetch(`${config.registerUrl}${path}`, { signal });
  } catch {
    throw catalogUnavailable();
  }
  if (reply.status === 429) {
    await reply.arrayBuffer().catch(() => undefined);
    const stated = Number.parseInt(reply.headers.get("retry-after") ?? "", 10);
    throw catalogBusy(Number.isFinite(stated) && stated >= 0 ? stated : config.limits.FLAN_CATALOG_RETRY_S);
  }
  if (reply.status === 404) {
    await reply.arrayBuffer().catch(() => undefined);
    throw catalogMissing();
  }
  if (!reply.ok) {
    await reply.arrayBuffer().catch(() => undefined);
    throw catalogUnavailable();
  }
  return reply;
}

async function readJson(reply: Response): Promise<{ [key: string]: Json }> {
  let parsed: Json;
  try {
    parsed = JSON.parse(await reply.text()) as Json;
  } catch (error) {
    if (error instanceof SyntaxError) throw catalogMalformed();
    throw catalogUnavailable();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw catalogMalformed();
  return parsed;
}

function str(value: Json | undefined): string {
  if (typeof value !== "string") throw catalogMalformed();
  return value;
}

function positiveInt(value: Json | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw catalogMalformed();
  return value;
}

/** Tag-balance check: one root <svg> element, every element closed in order. */
function wellFormedSvg(text: string): boolean {
  const body = text.replace(/^﻿?\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*/, "");
  const tags = body.match(/<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*?)?\/?>/g);
  if (!tags || !/^<svg[\s>]/.test(body) || !body.trimEnd().endsWith("</svg>")) return false;
  const stack: string[] = [];
  for (const tag of tags) {
    const name = /^<\/?([A-Za-z][\w:.-]*)/.exec(tag)![1]!;
    if (tag.startsWith("</")) {
      if (stack.pop() !== name) return false;
    } else if (!tag.endsWith("/>")) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

/** Looks a reference up and fetches its image, together inside one provider timeout. */
export async function lookupVariety(reference: string): Promise<VarietyRecord> {
  const signal = AbortSignal.timeout(config.limits.FLAN_PROVIDER_TIMEOUT_MS);
  const record = await readJson(await call(`/catalog/varieties?reference=${encodeURIComponent(reference)}`, signal));
  const found = {
    reference: str(record.reference),
    issue: str(record.issue),
    mintmark: str(record.mintmark),
    revision: positiveInt(record.revision),
    image_path: str(record.image_path),
  };
  if (found.reference !== reference || !found.image_path.startsWith("/catalog/images/")) throw catalogMalformed();
  const imageReply = await call(found.image_path, signal);
  let svg: string;
  try {
    svg = await imageReply.text();
  } catch {
    throw catalogUnavailable();
  }
  if (!wellFormedSvg(svg)) throw catalogMalformed();
  return { ...found, image: Buffer.from(svg, "utf8") };
}

export async function lookupAlbum(set: string): Promise<AlbumDefinition> {
  const signal = AbortSignal.timeout(config.limits.FLAN_PROVIDER_TIMEOUT_MS);
  const album = await readJson(await call(`/catalog/albums?set=${encodeURIComponent(set)}`, signal));
  const holes = album.holes;
  if (!Array.isArray(holes) || holes.length > config.limits.FLAN_ALBUM_MAX_HOLES) throw catalogMalformed();
  const parsed = holes.map((hole) => {
    if (hole === null || typeof hole !== "object" || Array.isArray(hole)) throw catalogMalformed();
    return { label: str(hole.label), reference: str(hole.reference), mintmark: str(hole.mintmark) };
  });
  if (new Set(parsed.map((h) => h.label)).size !== parsed.length) throw catalogMalformed();
  const definition = { set: str(album.set), title: str(album.title), revision: positiveInt(album.revision), holes: parsed };
  if (definition.set !== set) throw catalogMalformed();
  return definition;
}
