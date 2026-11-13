import { readFile } from 'node:fs/promises';
import type { Context } from 'hono';
import { openableAthlete, userOfRequest, type User } from './access.js';
import { config } from './config.js';
import { liveCursor } from './live.js';
import { loadWorkout } from './workouts.js';

const CLIENT_DIR = new URL('../client/', import.meta.url);
const CONTENT_TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
const STATIC_FILE = /^\/(assets|fonts)\/([\w.-]+\.(?:js|css|woff2))$/;

let shell: string | null = null;

async function shellHtml(): Promise<string> {
  shell ??= (await readFile(new URL('index.html', CLIENT_DIR), 'utf8')).replace('%CHART_DURATION%', String(config.chartAnimationMs));
  return shell;
}

const html = async (status: 200 | 404): Promise<Response> =>
  new Response((await shellHtml()).replace('%LIVE_CURSOR%', String(liveCursor())), { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

/** The not-found page: the app shell answering 404, which the client renders as the not-found view. */
export const notFoundPage = (_c: Context): Promise<Response> => html(404);

async function staticFile(path: string): Promise<Response | null> {
  const match = STATIC_FILE.exec(path);
  if (!match) return null;
  try {
    const bytes = await readFile(new URL(`${match[1]}/${match[2]}`, CLIENT_DIR));
    const extension = path.slice(path.lastIndexOf('.'));
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream', 'cache-control': 'no-cache' }
    });
  } catch {
    return null;
  }
}

const COACH_PAGES = new Set(['/coach', '/plans', '/inbox']);

async function mayOpen(user: User, path: string): Promise<boolean> {
  if (COACH_PAGES.has(path)) return user.role === 'coach';
  if (path === '/coaches') return user.role === 'athlete';
  const athlete = /^\/athletes\/([^/]+)(?:\/builder)?$/.exec(path);
  if (athlete) return (await openableAthlete(user, athlete[1] as string)) !== null;
  const workout = /^\/workouts\/([^/]+)$/.exec(path);
  if (workout) {
    const stored = await loadWorkout(workout[1] as string);
    return stored !== null && (await openableAthlete(user, stored.workout.athlete_id)) !== null;
  }
  return false;
}

const KNOWN_PAGE = /^\/(?:coach|plans|inbox|coaches|athletes\/[^/]+(?:\/builder)?|workouts\/[^/]+)$/;

export async function handlePage(c: Context): Promise<Response> {
  const path = c.req.path;
  const file = await staticFile(path);
  if (file) return file;
  if (path === '/sign-in') return html(200);
  const user = await userOfRequest(c);
  if (path === '/') return c.redirect(user ? (user.role === 'coach' ? '/coach' : `/athletes/${user.id}`) : '/sign-in', 303);
  if (!KNOWN_PAGE.test(path)) return html(404);
  if (!user) return c.redirect('/sign-in', 303);
  return html((await mayOpen(user, path)) ? 200 : 404);
}
