import { limits, providers } from '../config.ts';
import {
  catalogBusy,
  catalogMalformed,
  catalogMissing,
  catalogUnavailable,
} from '../http/errors.ts';

/**
 * The invented Varietal Coin Register. It is the only source of catalogue
 * records, reference images and album-hole definitions, is called server-side
 * only, and no locally invented record ever stands in for a reply.
 */

export interface VarietyRecord {
  reference: string;
  issue: string;
  mintmark: string;
  revision: number;
  imagePath: string;
}

export interface AlbumHoleRecord {
  label: string;
  reference: string;
  mintmark: string;
}

export interface AlbumRecord {
  set: string;
  title: string;
  revision: number;
  holes: AlbumHoleRecord[];
}

async function callRegister(path: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.providerTimeoutMs);
  try {
    return await fetch(`${providers.wiremockUrl}${path}`, {
      signal: controller.signal,
      headers: { accept: '*/*' },
    });
  } catch {
    // Timed out or unreachable.
    throw catalogUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

/** Maps the register's own HTTP outcomes onto the published provider errors. */
function checkStatus(reply: Response, path: string): void {
  if (reply.status === 429) {
    const header = Number.parseInt(reply.headers.get('retry-after') ?? '', 10);
    throw catalogBusy(Number.isFinite(header) ? header : limits.catalogRetryS);
  }
  if (reply.status === 404) throw catalogMissing();
  if (reply.status >= 500) throw catalogUnavailable();
  if (!reply.ok) {
    // Any other refusal is a reply the product cannot read.
    throw catalogMalformed();
  }
  if (path.startsWith('/catalog/images/')) return;
}

async function readJson(reply: Response): Promise<unknown> {
  const text = await reply.text().catch(() => {
    throw catalogUnavailable();
  });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw catalogMalformed();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * A reply is malformed when it is not JSON, a published field is missing or of
 * the wrong type, `reference` differs from the request, `revision` is not a
 * positive integer, or `image_path` does not start with `/catalog/images/`.
 */
export async function lookupVariety(reference: string): Promise<VarietyRecord> {
  const reply = await callRegister(`/catalog/varieties?reference=${encodeURIComponent(reference)}`);
  checkStatus(reply, '/catalog/varieties');
  const body = await readJson(reply);
  if (!isRecord(body)) throw catalogMalformed();

  const { reference: ref, issue, mintmark, revision, image_path: imagePath } = body;
  if (typeof ref !== 'string' || ref !== reference) throw catalogMalformed();
  if (typeof issue !== 'string' || issue === '') throw catalogMalformed();
  if (typeof mintmark !== 'string' || mintmark === '') throw catalogMalformed();
  if (!isPositiveInteger(revision)) throw catalogMalformed();
  if (typeof imagePath !== 'string' || !imagePath.startsWith('/catalog/images/')) {
    throw catalogMalformed();
  }
  return { reference: ref, issue, mintmark, revision, imagePath };
}

const SVG_ROOT = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i;

/** The image must be a well-formed SVG, else the whole reply is malformed. */
export async function fetchVarietyImage(imagePath: string): Promise<Buffer> {
  const reply = await callRegister(imagePath);
  checkStatus(reply, '/catalog/images/');
  const bytes = Buffer.from(await reply.arrayBuffer().catch(() => {
    throw catalogUnavailable();
  }));
  const text = bytes.toString('utf8');
  if (!SVG_ROOT.test(text) || !/<\/svg\s*>\s*$/i.test(text.trimEnd())) {
    throw catalogMalformed();
  }
  return bytes;
}

/** Album definitions follow the same rules, capped at FLAN_ALBUM_MAX_HOLES. */
export async function lookupAlbum(set: string): Promise<AlbumRecord> {
  const reply = await callRegister(`/catalog/albums?set=${encodeURIComponent(set)}`);
  checkStatus(reply, '/catalog/albums');
  const body = await readJson(reply);
  if (!isRecord(body)) throw catalogMalformed();

  const { set: setKey, title, revision, holes } = body;
  if (typeof setKey !== 'string' || setKey !== set) throw catalogMalformed();
  if (typeof title !== 'string' || title === '') throw catalogMalformed();
  if (!isPositiveInteger(revision)) throw catalogMalformed();
  if (!Array.isArray(holes) || holes.length === 0) throw catalogMalformed();
  if (holes.length > limits.albumMaxHoles) throw catalogMalformed();

  const parsed: AlbumHoleRecord[] = holes.map((hole) => {
    if (!isRecord(hole)) throw catalogMalformed();
    const { label, reference, mintmark } = hole;
    if (typeof label !== 'string' || label === '') throw catalogMalformed();
    if (typeof reference !== 'string' || reference === '') throw catalogMalformed();
    if (typeof mintmark !== 'string' || mintmark === '') throw catalogMalformed();
    return { label, reference, mintmark };
  });
  return { set: setKey, title, revision, holes: parsed };
}
