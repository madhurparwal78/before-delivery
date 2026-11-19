/** The endpoints every visitor can read: health, tower, search, units, media and shared links. */

import { pool, isSchemaReady, queryOne } from '../db';
import { ApiError, invalidFields } from '../errors';
import { applyLapseCheck } from '../domain/lapse';
import { isVisibleToBuyers, loadUnit, publicUnit, sharedUnit, towerCells } from '../domain/units';
import { unconfirmedCodes } from '../search/pending';
import { runSearch } from '../domain/search';
import { SearchUnavailable } from '../search/client';
import { countSearchRequest } from '../domain/limits';
import { currentAccount } from '../http/auth';
import { clientAddress, prepareMediaResponse, sendJson, type Wire } from '../http/wire';
import { mediaUrl, readMediaToken } from '../storage/mediaToken';
import { getObject, StorageUnavailable } from '../storage/s3';
import { MODEL_KEYS } from '../assets/glb';
import { TEXTURE_KEYS } from '../assets/views';
import { validateSearchInput } from '../../shared/searchInput';
import { FLOOR_BANDS, type BandId } from '../../shared/units';

export function health(wire: Wire): void {
  if (!isSchemaReady()) {
    sendJson(wire, 503, { status: 'starting' });
    return;
  }
  sendJson(wire, 200, { status: 'ok' });
}

export async function tower(wire: Wire): Promise<void> {
  await applyLapseCheck(pool);
  const units = await towerCells(pool);
  const plates = {} as Record<BandId, string>;
  for (const band of FLOOR_BANDS) plates[band.id] = mediaUrl(MODEL_KEYS.plate(band.id), null);
  sendJson(wire, 200, {
    units,
    assets: {
      shell: mediaUrl(MODEL_KEYS.shell, null),
      plates,
      facade: mediaUrl(TEXTURE_KEYS.facade, null),
      ramp: mediaUrl(TEXTURE_KEYS.ramp, null),
    },
  });
}

export async function search(wire: Wire): Promise<void> {
  const account = await currentAccount(wire);
  if (!account) {
    const decision = await countSearchRequest(pool, clientAddress(wire));
    if (decision.refused) {
      throw new ApiError('search_rate_limited', {
        retryAfterSeconds: decision.retryAfterSeconds,
        placeholders: { seconds: String(decision.retryAfterSeconds) },
      });
    }
  }

  const validated = validateSearchInput({
    q: wire.url.searchParams.get('q'),
    bedrooms: wire.url.searchParams.getAll('bedrooms'),
    band: wire.url.searchParams.getAll('band'),
    facing: wire.url.searchParams.getAll('facing'),
    view: wire.url.searchParams.getAll('view'),
    status: wire.url.searchParams.getAll('status'),
    priceMin: wire.url.searchParams.get('priceMin'),
    priceMax: wire.url.searchParams.get('priceMax'),
    after: wire.url.searchParams.get('after'),
    limit: wire.url.searchParams.get('limit'),
  });
  if (Object.keys(validated.fields).length > 0) throw invalidFields(validated.fields);

  try {
    sendJson(wire, 200, await runSearch(validated.query));
  } catch (error) {
    if (error instanceof SearchUnavailable) throw new ApiError('search_unavailable');
    throw error;
  }
}

export async function unit(wire: Wire, code: string): Promise<void> {
  await applyLapseCheck(pool);
  const row = await loadUnit(pool, code);
  if (!row || !isVisibleToBuyers(row.status)) throw new ApiError('not_found');
  const syncing = await unconfirmedCodes(pool, [row.code]);
  sendJson(wire, 200, { unit: publicUnit(row, syncing.has(row.code)) });
}

const MEDIA_TYPES: { suffix: string; type: string }[] = [
  { suffix: '.glb', type: 'model/gltf-binary' },
  { suffix: '.png', type: 'image/png' },
  { suffix: '.jpg', type: 'image/jpeg' },
];

export async function media(wire: Wire, token: string): Promise<void> {
  const claim = readMediaToken(token);
  if (!claim) throw new ApiError('not_found');
  if (claim.u) {
    await applyLapseCheck(pool);
    const row = await loadUnit(pool, claim.u);
    if (!row || row.status === 'withdrawn') throw new ApiError('not_found');
  }
  let object;
  try {
    object = await getObject(claim.k);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError('media_unavailable');
    throw error;
  }
  if (!object) throw new ApiError('not_found');
  const contentType = MEDIA_TYPES.find((entry) => claim.k.endsWith(entry.suffix))?.type ?? object.contentType;
  prepareMediaResponse(wire, { size: object.size, etag: object.etag, contentType });
  object.stream.pipe(wire.response);
}

export async function sharedHold(wire: Wire, token: string): Promise<void> {
  await applyLapseCheck(pool);
  const hold = await queryOne<{ unit_code: string; ends_at: Date }>(
    pool,
    "select unit_code, ends_at from holds where share_token = $1 and status = 'active'",
    [token],
  );
  if (!hold) throw new ApiError('not_found');
  const row = await loadUnit(pool, hold.unit_code);
  if (!row || !isVisibleToBuyers(row.status)) throw new ApiError('not_found');
  sendJson(wire, 200, { unit: sharedUnit(row), endsAt: hold.ends_at.toISOString() }, { 'Cache-Control': 'no-store' });
}

export function sharedWrite(wire: Wire): void {
  wire.request.resume();
  sendJson(wire, 405, new ApiError('read_only').body());
}
