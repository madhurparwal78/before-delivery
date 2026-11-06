import { createHash } from 'node:crypto';
import { formatTimestamp } from '../../domain/time';
import { pool } from '../db/pool';
import { loadFigure, loadMovedReadings, rederiveFigure, type FigureRecord } from '../figures';
import { sendJson, type RequestContext } from '../http/context';
import { ApiError, notFound, storageUnavailable } from '../http/errors';
import { requirePerson, requireProject } from '../http/guards';
import type { Route } from '../http/router';
import {
  dateHeader,
  issueLink,
  linkById,
  linkStatus,
  linksForFigure,
  linkByToken,
  linkUrl,
  markRevoked,
  type RegulatorLink,
} from '../links';
import { figureJson, movedReadingJson } from '../presenters';
import { loadProject } from '../projects';
import { getObject, StorageUnavailable } from '../services/storage';

function linkJson(link: RegulatorLink, nowMs: number): Record<string, unknown> {
  return {
    id: link.id,
    token: link.token,
    url: linkUrl(link.token),
    status: linkStatus(link, nowMs),
    issued_at: formatTimestamp(link.issuedAtMs),
    expires_at: formatTimestamp(link.expiresAtMs),
    revoked_at: link.revokedAtMs === null ? null : formatTimestamp(link.revokedAtMs),
  };
}

async function sealerFigure(context: RequestContext, figureId: string): Promise<FigureRecord> {
  const person = await requirePerson(pool, context);
  const figure = await loadFigure(pool, figureId);
  if (figure === null) throw notFound();
  await requireProject(pool, person, figure.projectSlug, 'sealer');
  return figure;
}

/** Every public link surface decides the status once, from one read of the server clock. */
async function publicLink(token: string): Promise<{ link: RegulatorLink; nowMs: number }> {
  const { links, nowMs } = await linkByToken(pool, token);
  const link = links[0];
  if (link === undefined) throw notFound();
  const status = linkStatus(link, nowMs);
  if (status === 'revoked') {
    throw new ApiError(
      410,
      'link_revoked',
      { revoked_at: formatTimestamp(link.revokedAtMs!) },
      { date: dateHeader(nowMs) },
    );
  }
  if (status === 'expired') {
    throw new ApiError(
      410,
      'link_expired',
      { expires_at: formatTimestamp(link.expiresAtMs) },
      { date: dateHeader(nowMs) },
    );
  }
  return { link, nowMs };
}

async function publicFigureBody(
  link: RegulatorLink,
  nowMs: number,
): Promise<Record<string, unknown>> {
  const figure = (await loadFigure(pool, link.figureId))!;
  const project = (await loadProject(pool, figure.projectSlug))!;
  const rederived = await rederiveFigure(pool, figure, project);
  return {
    link: { status: linkStatus(link, nowMs), expires_at: formatTimestamp(link.expiresAtMs) },
    project: { name: project.name, kind: project.kind },
    figure: figureJson(figure, { checkedAtMs: rederived.checkedAtMs, rederived }),
  };
}

export const linkRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: '/api/figures/:id/links',
    handler: async (context) => {
      const figure = await sealerFigure(context, context.params.id!);
      if (figure.status !== 'sealed') throw new ApiError(409, 'figure_not_sealed');
      const link = await issueLink(pool, figure.id);
      sendJson(context, 201, {
        id: link.id,
        token: link.token,
        url: linkUrl(link.token),
        status: 'live',
        issued_at: formatTimestamp(link.issuedAtMs),
        expires_at: formatTimestamp(link.expiresAtMs),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/figures/:id/links',
    handler: async (context) => {
      const figure = await sealerFigure(context, context.params.id!);
      const { links, nowMs } = await linksForFigure(pool, figure.id);
      sendJson(
        context,
        200,
        { links: links.map((link) => linkJson(link, nowMs)) },
        { date: dateHeader(nowMs) },
      );
    },
  },
  {
    method: 'POST',
    path: '/api/figures/:id/links/:linkId/revoke',
    handler: async (context) => {
      const figure = await sealerFigure(context, context.params.id!);
      const { links, nowMs } = await linkById(pool, context.params.linkId!);
      const link = links[0];
      if (link === undefined || link.figureId !== figure.id) throw notFound();
      const status = linkStatus(link, nowMs);
      if (nowMs >= link.expiresAtMs) {
        throw new ApiError(409, 'link_expired', {}, { date: dateHeader(nowMs) });
      }
      if (status === 'revoked') {
        throw new ApiError(409, 'link_revoked', {}, { date: dateHeader(nowMs) });
      }
      const revoked = await markRevoked(pool, link.id);
      sendJson(
        context,
        200,
        {
          id: revoked.id,
          status: 'revoked',
          revoked_at: formatTimestamp(revoked.revokedAtMs!),
        },
        { date: dateHeader(nowMs) },
      );
    },
  },
  {
    method: 'GET',
    path: '/api/public/links/:token',
    handler: async (context) => {
      const { link, nowMs } = await publicLink(context.params.token!);
      sendJson(context, 200, await publicFigureBody(link, nowMs), { date: dateHeader(nowMs) });
    },
  },
  {
    method: 'POST',
    path: '/api/public/links/:token/rederive',
    handler: async (context) => {
      const { link, nowMs } = await publicLink(context.params.token!);
      sendJson(context, 200, await publicFigureBody(link, nowMs), { date: dateHeader(nowMs) });
    },
  },
  {
    method: 'GET',
    path: '/api/public/links/:token/audit',
    handler: async (context) => {
      const { link, nowMs } = await publicLink(context.params.token!);
      const figure = (await loadFigure(pool, link.figureId))!;
      const moved = await loadMovedReadings(pool, figure);
      sendJson(
        context,
        200,
        { figure_id: figure.id, moved: moved.map(movedReadingJson) },
        { date: dateHeader(nowMs) },
      );
    },
  },
  {
    method: 'GET',
    path: '/api/public/links/:token/evidence',
    handler: async (context) => {
      const { link, nowMs } = await publicLink(context.params.token!);
      const figure = (await loadFigure(pool, link.figureId))!;
      let bytes: Buffer;
      try {
        bytes = await getObject(figure.readingsKey);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw storageUnavailable();
        throw error;
      }
      if (createHash('sha256').update(bytes).digest('hex') !== figure.fingerprint) {
        throw new ApiError(409, 'evidence_mismatch');
      }
      context.response.writeHead(200, {
        'content-type': 'text/csv',
        'content-length': bytes.length,
        'content-disposition': `attachment; filename="${figure.id}-readings.csv"`,
        'x-fluxseal-fingerprint': figure.fingerprint,
        'cache-control': 'no-store',
        date: dateHeader(nowMs),
      });
      context.response.end(bytes);
    },
  },
];
