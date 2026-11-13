import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import type { User } from '../../shared/wire.js';
import { config } from '../config.js';
import { canSeePlayer, canSeeTeam, canSeeTournament, canSeeMatch, isMatchOrganiser, matchIdByCode } from '../db/lookup.js';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff' };

type Access = (parts: string[], user: User | null) => Promise<boolean>;

const open: Access = async () => true;
const forUser = (check: (userId: string, id: string) => Promise<boolean>): Access => async ([id], user) => user === null || check(user.id, id ?? '');

const PAGES: { pattern: RegExp; access: Access }[] = [
  { pattern: /^\/(signin|signup|follow)?$/, access: open },
  { pattern: /^\/(matches|matches\/new|teams|teams\/new|tournaments|tournaments\/new|players)$/, access: open },
  { pattern: /^\/live\/([^/]+)(?:\/scorecard)?$/, access: async ([code]) => (await matchIdByCode(code ?? '')) !== null },
  { pattern: /^\/matches\/([^/]+)$/, access: forUser(isMatchOrganiser) },
  { pattern: /^\/matches\/([^/]+)\/(?:score|scorecard)$/, access: forUser(canSeeMatch) },
  { pattern: /^\/teams\/([^/]+)$/, access: forUser(canSeeTeam) },
  { pattern: /^\/tournaments\/([^/]+)$/, access: forUser(canSeeTournament) },
  { pattern: /^\/players\/([^/]+)$/, access: forUser(canSeePlayer) },
  { pattern: /^\/invitations\/([^/]+)$/, access: open },
];

/** 200 for a page the visitor may open, 404 for anything else (the client draws the not-found page either way). */
const pageStatus = async (pathname: string, user: User | null): Promise<number> => {
  for (const page of PAGES) {
    const match = page.pattern.exec(pathname);
    if (match) return (await page.access(match.slice(1).filter((part): part is string => part !== undefined), user)) ? 200 : 404;
  }
  return 404;
};

let template: string | null = null;

const shell = async (user: User | null): Promise<string> => {
  template ??= await readFile(join(config.clientDir, 'index.html'), 'utf8');
  const boot = JSON.stringify({ user }).replace(/</g, '\\u003c');
  return template.replace('<!--boot-->', `<script type="application/json" id="boot">${boot}</script>`);
};

export const servePage = async (res: ServerResponse, pathname: string, user: User | null): Promise<void> => {
  const status = await pageStatus(pathname, user);
  const body = Buffer.from(await shell(user));
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
  res.end(body);
};

/** Serves a built client file (script, style, font); false when there is none. */
export const serveAsset = async (res: ServerResponse, pathname: string): Promise<boolean> => {
  const type = TYPES[extname(pathname)];
  const file = normalize(join(config.clientDir, pathname));
  if (!type || !file.startsWith(config.clientDir + sep)) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(body);
    return true;
  } catch {
    return false;
  }
};
