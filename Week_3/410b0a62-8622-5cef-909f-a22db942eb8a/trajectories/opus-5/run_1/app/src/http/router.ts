import type { RequestContext } from './context.js';
import * as pages from './pages.js';
import * as auth from './api/auth.js';
import * as athletes from './api/athletes.js';
import * as workouts from './api/workouts.js';
import * as uploads from './api/uploads.js';
import * as library from './api/library.js';
import * as plans from './api/plans.js';
import * as links from './api/links.js';
import * as system from './api/system.js';

export type RouteKind = 'api' | 'page';

export interface Route {
  method: string;
  segments: string[];
  kind: RouteKind;
  handler: (ctx: RequestContext) => Promise<void>;
}

function route(
  method: string,
  path: string,
  kind: RouteKind,
  handler: (ctx: RequestContext) => Promise<void>,
): Route {
  return { method, segments: path.split('/').filter((part) => part !== ''), kind, handler };
}

export const ROUTES: Route[] = [
  route('GET', '/api/health', 'api', system.health),
  route('POST', '/api/grading/seed', 'api', system.gradingSeed),
  route('POST', '/api/grading/reset', 'api', system.gradingReset),
  route('GET', '/api/live', 'api', system.live),
  route('POST', '/api/auth/sign-in', 'api', auth.signIn),
  route('POST', '/api/auth/sign-out', 'api', auth.signOut),
  route('GET', '/api/me', 'api', auth.me),
  route('GET', '/api/athletes', 'api', athletes.listAthletes),
  route('GET', '/api/athletes/:id', 'api', athletes.getAthlete),
  route('POST', '/api/athletes/:id/thresholds', 'api', athletes.postThreshold),
  route('GET', '/api/athletes/:id/weeks', 'api', athletes.getWeeks),
  route('GET', '/api/athletes/:id/series', 'api', athletes.getSeries),
  route('POST', '/api/athletes/:id/workouts', 'api', workouts.createWorkout),
  route('POST', '/api/athletes/:id/manual', 'api', workouts.createManual),
  route('POST', '/api/athletes/:id/uploads', 'api', uploads.createUpload),
  route('POST', '/api/athletes/:id/copy-week', 'api', plans.copyWeek),
  route('GET', '/api/workouts/:id', 'api', workouts.getWorkout),
  route('PATCH', '/api/workouts/:id', 'api', workouts.patchWorkout),
  route('DELETE', '/api/workouts/:id', 'api', workouts.deleteWorkout),
  route('GET', '/api/workouts/:id/original', 'api', workouts.getOriginal),
  route('GET', '/api/workouts/:id/comments', 'api', workouts.listComments),
  route('POST', '/api/workouts/:id/comments', 'api', workouts.createComment),
  route('GET', '/api/library', 'api', library.listLibrary),
  route('POST', '/api/library', 'api', library.createLibraryItem),
  route('DELETE', '/api/library/:id', 'api', library.removeLibraryItem),
  route('GET', '/api/plans', 'api', plans.listPlans),
  route('POST', '/api/plans', 'api', plans.createPlan),
  route('POST', '/api/plans/:id/apply', 'api', plans.applyPlan),
  route('POST', '/api/links', 'api', links.createLink),
  route('GET', '/api/links', 'api', links.listLinks),
  route('POST', '/api/links/:id/accept', 'api', links.acceptLink),
  route('POST', '/api/links/:id/decline', 'api', links.declineLink),
  route('DELETE', '/api/links/:id', 'api', links.removeLink),
  route('GET', '/auth/one-time/:token', 'page', pages.oneTimeSignInPage),
  route('GET', '/sign-in', 'page', pages.signInPage),
  route('GET', '/', 'page', pages.homePage),
  route('GET', '/athletes/:id', 'page', pages.athletePage),
  route('GET', '/athletes/:id/builder', 'page', pages.builderPage),
  route('GET', '/workouts/:id', 'page', pages.workoutPage),
  route('GET', '/coach', 'page', pages.coachPage),
  route('GET', '/plans', 'page', pages.plansPage),
  route('GET', '/inbox', 'page', pages.inboxPage),
  route('GET', '/coaches', 'page', pages.coachesPage),
];

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

export function matchRoute(method: string, pathname: string): RouteMatch | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  for (const candidate of ROUTES) {
    if (candidate.method !== method || candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const segment = candidate.segments[index] as string;
      const value = parts[index] as string;
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
      else if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}
