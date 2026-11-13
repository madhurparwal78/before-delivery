import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { consumeOneTimeToken, createSession } from '../db/users.js';
import { findWorkout } from '../db/workouts.js';
import { notFound } from './errors.js';
import { sendHtml, sendRedirect } from './respond.js';
import {
  requireAthlete,
  requireCoach,
  requireUser,
  sessionCookie,
  visibleAthlete,
  type RequestContext,
} from './context.js';

function shell(route: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tempoline — Ottermere Sport</title>
<link rel="stylesheet" href="/styles.css">
<script type="module" src="/app.js"></script>
</head>
<body>
<div id="app" data-route="${route}" data-chart-animation-ms="${config.chartAnimationMs}">${body}</div>
</body>
</html>`;
}

const NOT_FOUND_BODY = `<main class="not-found">
<h1 class="display-line">Not found</h1>
<p>This page isn't available to you.</p>
<a class="pill" href="/">Back to home</a>
</main>`;

export function notFoundHtml(): string {
  return shell('not-found', NOT_FOUND_BODY);
}

export function sendNotFoundPage(ctx: RequestContext): void {
  sendHtml(ctx.res, 404, notFoundHtml());
}

function page(ctx: RequestContext, route: string): void {
  sendHtml(ctx.res, 200, shell(route, ''));
}

export async function signInPage(ctx: RequestContext): Promise<void> {
  page(ctx, 'sign-in');
}

export async function homePage(ctx: RequestContext): Promise<void> {
  requireUser(ctx);
  page(ctx, 'home');
}

export async function athletePage(ctx: RequestContext): Promise<void> {
  await visibleAthlete(ctx, ctx.params.id as string);
  page(ctx, 'athlete');
}

export async function builderPage(ctx: RequestContext): Promise<void> {
  await visibleAthlete(ctx, ctx.params.id as string);
  page(ctx, 'builder');
}

export async function workoutPage(ctx: RequestContext): Promise<void> {
  const row = await findWorkout(pool, ctx.params.id as string);
  if (!row) throw notFound();
  await visibleAthlete(ctx, row.athlete_id);
  page(ctx, 'workout');
}

export async function coachPage(ctx: RequestContext): Promise<void> {
  requireCoach(ctx);
  page(ctx, 'coach');
}

export async function plansPage(ctx: RequestContext): Promise<void> {
  requireCoach(ctx);
  page(ctx, 'plans');
}

export async function inboxPage(ctx: RequestContext): Promise<void> {
  requireCoach(ctx);
  page(ctx, 'inbox');
}

export async function coachesPage(ctx: RequestContext): Promise<void> {
  requireAthlete(ctx);
  page(ctx, 'coaches');
}

export async function oneTimeSignInPage(ctx: RequestContext): Promise<void> {
  const userId = await consumeOneTimeToken(pool, ctx.params.token as string);
  if (!userId) throw notFound();
  const sessionId = await createSession(pool, userId);
  sendRedirect(ctx.res, '/', { 'set-cookie': sessionCookie(sessionId) });
}
