import { PROVIDER_TIMEOUT_MS, config } from '../config';
import type { FactorRow } from '../domain/factors';

export class LibraryUnreachable extends Error {}

export interface Edition {
  edition: string;
  validFrom: string;
}

async function read(path: string): Promise<unknown> {
  let answer: Response;
  try {
    answer = await fetch(`${config.wiremockUrl}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new LibraryUnreachable('the factor library did not answer in time');
  }
  if (!answer.ok) throw new LibraryUnreachable(`the factor library answered ${answer.status}`);
  try {
    return await answer.json();
  } catch {
    throw new LibraryUnreachable('the factor library answered something other than JSON');
  }
}

/** `Check for newer factors` reads only the edition list. */
export async function readEditions(): Promise<Edition[]> {
  const body = read('/v2/editions');
  const parsed = (await body) as { editions?: unknown };
  if (!Array.isArray(parsed.editions)) throw new LibraryUnreachable('the edition list was not a list');
  return parsed.editions.map((entry) => {
    const found = entry as { edition?: unknown; validFrom?: unknown };
    if (typeof found.edition !== 'string' || typeof found.validFrom !== 'string') {
      throw new LibraryUnreachable('an edition was not in the published shape');
    }
    return { edition: found.edition, validFrom: found.validFrom };
  });
}

/** Every page of one edition, read exactly as the library prints it. */
export async function readFactors(edition: string): Promise<FactorRow[]> {
  const rows: FactorRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const path = `/v2/factors?edition=${encodeURIComponent(edition)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const parsed = (await read(path)) as { rows?: unknown; nextCursor?: unknown };
    if (!Array.isArray(parsed.rows)) throw new LibraryUnreachable('a factor page was not in the published shape');
    for (const entry of parsed.rows) rows.push(entry as FactorRow);
    cursor = typeof parsed.nextCursor === 'string' && parsed.nextCursor !== '' ? parsed.nextCursor : null;
    if (cursor === null) return rows;
  }
  throw new LibraryUnreachable('the factor library never stopped paging');
}
