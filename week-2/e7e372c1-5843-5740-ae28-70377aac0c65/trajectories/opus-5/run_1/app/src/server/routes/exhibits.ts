/**
 * Exhibit downloads. Who may see a hash, and how conditional and range
 * requests are answered, is decided from the database alone.
 */
import { ApiResponse, RequestContext, headerOf, parseCookies } from '../http';
import { fail } from '../errors';
import { SESSION_COOKIE, authenticate } from '../auth';
import { ExhibitVisibility, exhibitsForHash } from '../restatementStore';
import { readVaultBytes } from '../vault';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface RangeRequest {
  first: number;
  last: number;
}

type RangeDecision = { kind: 'none' } | { kind: 'range'; range: RangeRequest } | { kind: 'unsatisfiable' };

function decideRange(header: string | undefined, size: number): RangeDecision {
  if (header === undefined) return { kind: 'none' };
  const match = /^bytes=(.+)$/.exec(header.trim());
  if (!match) return { kind: 'none' };
  const spec = (match[1] as string).trim();
  if (spec.includes(',')) return { kind: 'none' };
  const suffix = /^-(\d+)$/.exec(spec);
  if (suffix) {
    const count = Number(suffix[1]);
    if (count === 0) return { kind: 'unsatisfiable' };
    const first = Math.max(0, size - count);
    return { kind: 'range', range: { first, last: size - 1 } };
  }
  const explicit = /^(\d+)-(\d*)$/.exec(spec);
  if (!explicit) return { kind: 'none' };
  const first = Number(explicit[1]);
  if (first >= size) return { kind: 'unsatisfiable' };
  const lastText = explicit[2] as string;
  const last = lastText === '' ? size - 1 : Math.min(Number(lastText), size - 1);
  if (last < first) return { kind: 'unsatisfiable' };
  return { kind: 'range', range: { first, last } };
}

function notFound(): never {
  throw fail('not_found');
}

async function chooseVisible(
  context: RequestContext,
  candidates: ExhibitVisibility[],
): Promise<ExhibitVisibility> {
  const published = candidates.find((candidate) => candidate.publiclyVisible);
  if (published !== undefined) return published;
  if (candidates.length === 0) notFound();
  const cookies = parseCookies(headerOf(context, 'cookie'));
  const user = await authenticate(cookies[SESSION_COOKIE]);
  if (user === null) notFound();
  return candidates[0] as ExhibitVisibility;
}

export async function getExhibit(context: RequestContext): Promise<ApiResponse> {
  const sha256 = context.params.sha256 ?? '';
  if (!SHA256_PATTERN.test(sha256)) notFound();
  const candidates = await exhibitsForHash(sha256);
  const exhibit = await chooseVisible(context, candidates);

  const headers: Record<string, string> = {
    ETag: `"${sha256}"`,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': exhibit.publiclyVisible
      ? 'public, max-age=31536000, immutable'
      : 'private, no-store',
  };

  const ifNoneMatch = headerOf(context, 'if-none-match');
  if (ifNoneMatch !== undefined) {
    const candidatesMatch = ifNoneMatch
      .split(',')
      .map((value) => value.trim().replace(/^W\//, ''));
    if (candidatesMatch.includes('*') || candidatesMatch.includes(`"${sha256}"`)) {
      return { status: 304, headers };
    }
  }

  const decision = decideRange(headerOf(context, 'range'), exhibit.bytes);
  if (decision.kind === 'unsatisfiable') {
    throw fail('range_not_satisfiable', {
      headers: { ...headers, 'Content-Range': `bytes */${exhibit.bytes}` },
    });
  }

  const body = await readVaultBytes(exhibit.key);
  const bodyHeaders: Record<string, string> = {
    ...headers,
    'Content-Type': 'application/pdf',
    'X-Exhibit-SHA256': sha256,
    'Content-Disposition': `attachment; filename="${exhibit.accession}.pdf"`,
  };
  if (decision.kind === 'range') {
    const slice = body.subarray(decision.range.first, decision.range.last + 1);
    return {
      status: 206,
      headers: {
        ...bodyHeaders,
        'Content-Range': `bytes ${decision.range.first}-${decision.range.last}/${exhibit.bytes}`,
      },
      bytes: slice,
    };
  }
  return { status: 200, headers: bodyHeaders, bytes: body };
}
